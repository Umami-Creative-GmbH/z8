"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	absenceCategory,
	db,
	payrollExportFormat,
	payrollWageTypeMapping,
	workCategory,
} from "@/db";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	createExportJob,
	type DatevLohnConfig,
	enqueuePayrollExportJob,
	getAbsenceCategories,
	getEmployeesForFilter,
	getExportDownloadUrl,
	getExportJobHistory,
	getPayrollExportConfig,
	getProjectsForFilter,
	getTeamsForFilter,
	getWageTypeMappings,
	getWorkCategories,
	type LexwareLohnConfig,
	type PayrollExportFilters,
	processExportJob,
	type SageLohnConfig,
	type WorkdayConfig,
} from "@/lib/payroll-export";
import { parsePayrollLogicalDate } from "@/lib/payroll-export/calendar-boundaries";
import { PayrollIdentifierDuplicateError } from "@/lib/payroll-export/personnel-identifier";
import { payrollIdentifierDuplicateConflict } from "@/lib/payroll-export/personnel-identifier-refusal";
import {
	listPayrollIdentifierFields,
	type SavePayrollExportConfigOutcome,
	savePayrollExportConfig,
} from "@/lib/payroll-export/personnel-identifier-store";
import { discardPayrollRun } from "@/lib/travel-expenses/payroll-run";
import { getTranslate } from "@/tolgee/server";

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface DatevConfigResult {
	id: string;
	formatId: string;
	config: DatevLohnConfig;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveDatevConfigInput {
	config: DatevLohnConfig;
}

// ============================================
// LEXWARE CONFIGURATION TYPES
// ============================================

export interface LexwareConfigResult {
	id: string;
	formatId: string;
	config: LexwareLohnConfig;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveLexwareConfigInput {
	config: LexwareLohnConfig;
}

// ============================================
// SAGE CONFIGURATION TYPES
// ============================================

export interface SageConfigResult {
	id: string;
	formatId: string;
	config: SageLohnConfig;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveSageConfigInput {
	config: SageLohnConfig;
}

// ============================================
// WAGE TYPE MAPPING TYPES
// ============================================

export interface SaveMappingInput {
	workCategoryId?: string | null;
	absenceCategoryId?: string | null;
	specialCategory?: string | null;
	/** @deprecated Use format-specific codes instead */
	wageTypeCode?: string;
	/** @deprecated Use format-specific codes instead */
	wageTypeName?: string;
	// Format-specific wage type codes
	datevWageTypeCode?: string | null;
	datevWageTypeName?: string | null;
	lexwareWageTypeCode?: string | null;
	lexwareWageTypeName?: string | null;
	sageWageTypeCode?: string | null;
	sageWageTypeName?: string | null;
	successFactorsTimeTypeCode?: string | null;
	successFactorsTimeTypeName?: string | null;
}

export interface DeleteMappingInput {
	mappingId: string;
}

// ============================================
// EXPORT TYPES
// ============================================

export interface StartExportInput {
	formatId: string;
	startDate: string; // ISO date
	endDate: string; // ISO date
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

// ============================================
// FILTER OPTIONS TYPES
// ============================================

/** A format configuration as the settings form sends it; the store checks its identifier. */
function configInputSchema<Config>() {
	return z.strictObject({
		config: z.custom<Config>(
			(value) => typeof value === "object" && value !== null && !Array.isArray(value),
			"Configuration is required",
		),
	});
}

const datevConfigInputSchema = configInputSchema<DatevLohnConfig>();
const lexwareConfigInputSchema = configInputSchema<LexwareLohnConfig>();
const sageConfigInputSchema = configInputSchema<SageLohnConfig>();
const successFactorsConfigInputSchema = configInputSchema<SuccessFactorsConfig>();
const workdayConfigInputSchema = configInputSchema<WorkdayConfig>();
const personioConfigInputSchema = configInputSchema<PersonioConfig>();

const credentialsInputSchema = z.strictObject({
	clientId: z.string({ error: "Client ID is required" }),
	clientSecret: z.string({ error: "Client secret is required" }),
});

const optionalCode = z.string().nullish();

const saveMappingSchema = z.strictObject({
	workCategoryId: optionalCode,
	absenceCategoryId: optionalCode,
	specialCategory: optionalCode,
	wageTypeCode: z.string().optional(),
	wageTypeName: z.string().optional(),
	datevWageTypeCode: optionalCode,
	datevWageTypeName: optionalCode,
	lexwareWageTypeCode: optionalCode,
	lexwareWageTypeName: optionalCode,
	sageWageTypeCode: optionalCode,
	sageWageTypeName: optionalCode,
	successFactorsTimeTypeCode: optionalCode,
	successFactorsTimeTypeName: optionalCode,
}) satisfies z.ZodType<SaveMappingInput>;

const deleteMappingSchema = z.strictObject({
	mappingId: z.string({ error: "Mapping is required" }),
}) satisfies z.ZodType<DeleteMappingInput>;

const startExportSchema = z.strictObject({
	formatId: z.string({ error: "Export format is required" }),
	startDate: z.string({ error: "Start date is required" }),
	endDate: z.string({ error: "End date is required" }),
	employeeIds: z.array(z.string()).optional(),
	teamIds: z.array(z.string()).optional(),
	projectIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<StartExportInput>;

const exportJobSchema = z.strictObject({ jobId: z.string({ error: "Export job is required" }) });

export interface FilterOptions {
	employees: Array<{
		id: string;
		firstName: string | null;
		lastName: string | null;
		employeeNumber: string | null;
	}>;
	teams: Array<{ id: string; name: string }>;
	projects: Array<{ id: string; name: string }>;
}

// ============================================
// CONFIGURATION ACTIONS
// ============================================

/** A saved configuration, or the refusal of a custom field identifier that isn't eligible (#821). */
function payrollConfigSaved(outcome: SavePayrollExportConfigOutcome) {
	return outcome.ok
		? Effect.succeed(outcome.config)
		: Effect.fail(
				new ValidationError({
					message:
						"Choose an active employee custom field of type text or number as the personnel identifier.",
					field: "config",
				}),
			);
}

/**
 * Saves a format's configuration through the `DatabaseService` (a database
 * failure stays a typed `DatabaseError`), refusing an ineligible custom field
 * identifier (#821).
 */
function saveConfig(input: Parameters<typeof savePayrollExportConfig>[1]) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("payrollExportConfig.save", () =>
			savePayrollExportConfig(dbService.db, input),
		);
	}).pipe(Effect.flatMap(payrollConfigSaved));
}

/** An employee custom field a payroll configuration may use as personnel identifier (#821). */
export interface PayrollIdentifierFieldOption {
	id: string;
	name: string;
}

/**
 * The active employee custom fields of type text or number, in order: the
 * "Custom field: <name>" options of every identifier and match setting.
 */
export const getPayrollIdentifierFieldsAction = organizationAction(
	{ name: "payrollExport.getPayrollIdentifierFields", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const fields = yield* dbService.query("payrollExport.identifierFields", () =>
				listPayrollIdentifierFields(dbService.db, organizationId),
			);
			return fields.map(({ id, name }) => ({ id, name }));
		}),
);

/**
 * Get DATEV configuration for organization
 */
export const getDatevConfigAction = organizationAction(
	{ name: "payrollExport.getDatevConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, "datev_lohn"),
			);

			if (!configResult) {
				return null;
			}

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as DatevLohnConfig,
				isActive: configResult.config.isActive,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

/**
 * Save DATEV configuration
 */
export const saveDatevConfigAction = organizationAction(
	{ name: "payrollExport.saveDatevConfig", requires: "orgAdmin", schema: datevConfigInputSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Ensure DATEV format exists
			yield* Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, "datev_lohn"),
				});

				if (!format) {
					// Create the format if it doesn't exist
					await db.insert(payrollExportFormat).values({
						id: "datev_lohn",
						name: "DATEV Lohn & Gehalt",
						version: "2024.1",
						description: "Export for DATEV payroll software",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: "datev_lohn",
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as DatevLohnConfig,
				isActive: config.isActive,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

// ============================================
// LEXWARE CONFIGURATION ACTIONS
// ============================================

const LEXWARE_FORMAT_ID = "lexware_lohn";

/**
 * Get Lexware configuration for organization
 */
export const getLexwareConfigAction = organizationAction(
	{ name: "payrollExport.getLexwareConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, LEXWARE_FORMAT_ID),
			);

			if (!configResult) {
				return null;
			}

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as LexwareLohnConfig,
				isActive: configResult.config.isActive,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

/**
 * Save Lexware configuration
 */
export const saveLexwareConfigAction = organizationAction(
	{
		name: "payrollExport.saveLexwareConfig",
		requires: "orgAdmin",
		schema: lexwareConfigInputSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Ensure Lexware format exists
			yield* Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, LEXWARE_FORMAT_ID),
				});

				if (!format) {
					// Create the format if it doesn't exist
					await db.insert(payrollExportFormat).values({
						id: LEXWARE_FORMAT_ID,
						name: "Lexware lohn+gehalt",
						version: "2024.1",
						description: "Export for Lexware lohn+gehalt payroll software",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: LEXWARE_FORMAT_ID,
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as LexwareLohnConfig,
				isActive: config.isActive,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

// ============================================
// SAGE CONFIGURATION ACTIONS
// ============================================

const SAGE_FORMAT_ID = "sage_lohn";

/**
 * Get Sage configuration for organization
 */
export const getSageConfigAction = organizationAction(
	{ name: "payrollExport.getSageConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, SAGE_FORMAT_ID),
			);

			if (!configResult) {
				return null;
			}

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as SageLohnConfig,
				isActive: configResult.config.isActive,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

/**
 * Save Sage configuration
 */
export const saveSageConfigAction = organizationAction(
	{ name: "payrollExport.saveSageConfig", requires: "orgAdmin", schema: sageConfigInputSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Ensure Sage format exists
			yield* Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, SAGE_FORMAT_ID),
				});

				if (!format) {
					// Create the format if it doesn't exist
					await db.insert(payrollExportFormat).values({
						id: SAGE_FORMAT_ID,
						name: "Sage Lohn",
						version: "2024.1",
						description: "Export for Sage Lohn payroll software",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: SAGE_FORMAT_ID,
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as SageLohnConfig,
				isActive: config.isActive,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

// ============================================
// SAP SUCCESSFACTORS CONFIGURATION
// ============================================

import type { SuccessFactorsConfig } from "@/lib/payroll-export/types";

const SF_FORMAT_ID = "successfactors_api";
const SF_CSV_FORMAT_ID = "successfactors_csv";

export interface SuccessFactorsConfigResult {
	id: string;
	formatId: string;
	config: SuccessFactorsConfig;
	isActive: boolean;
	hasCredentials: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveSuccessFactorsConfigInput {
	config: SuccessFactorsConfig;
}

/**
 * Get SAP SuccessFactors configuration for organization
 */
export const getSuccessFactorsConfigAction = organizationAction(
	{ name: "payrollExport.getSuccessFactorsConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, SF_FORMAT_ID),
			);

			if (!configResult) {
				return null;
			}

			const hasCredentials = yield* Effect.promise(async () => {
				const [clientId, clientSecret] = await Promise.all([
					getOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_ID),
					getOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_SECRET),
				]);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			});

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as SuccessFactorsConfig,
				isActive: configResult.config.isActive,
				hasCredentials,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

/**
 * Save SAP SuccessFactors configuration
 */
export const saveSuccessFactorsConfigAction = organizationAction(
	{
		name: "payrollExport.saveSuccessFactorsConfig",
		requires: "orgAdmin",
		schema: successFactorsConfigInputSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Ensure SAP SuccessFactors format exists (for both API and CSV modes)
			yield* Effect.promise(async () => {
				// Create API format if doesn't exist
				const apiFormat = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, SF_FORMAT_ID),
				});

				if (!apiFormat) {
					await db.insert(payrollExportFormat).values({
						id: SF_FORMAT_ID,
						name: "SAP SuccessFactors (API)",
						version: "1.0.0",
						description: "Export to SAP SuccessFactors via OData API",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}

				// Create CSV format if doesn't exist
				const csvFormat = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, SF_CSV_FORMAT_ID),
				});

				if (!csvFormat) {
					await db.insert(payrollExportFormat).values({
						id: SF_CSV_FORMAT_ID,
						name: "SAP SuccessFactors (CSV)",
						version: "1.0.0",
						description: "Export CSV file for SAP SuccessFactors import",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: SF_FORMAT_ID,
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			const hasCredentials = yield* Effect.promise(async () => {
				const [clientId, clientSecret] = await Promise.all([
					getOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_ID),
					getOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_SECRET),
				]);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as SuccessFactorsConfig,
				isActive: config.isActive,
				hasCredentials,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

/**
 * Test SAP SuccessFactors connection
 */
export const testSuccessFactorsConnectionAction = organizationAction(
	{
		name: "payrollExport.testSuccessFactorsConnection",
		requires: "orgAdmin",
		schema: successFactorsConfigInputSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			// Import the exporter to test connection
			const { successFactorsExporter } = yield* Effect.promise(
				() => import("@/lib/payroll-export/exporters/successfactors"),
			);

			const result = yield* Effect.promise(() =>
				successFactorsExporter.testConnection(
					organizationId,
					input.config as unknown as Record<string, unknown>,
				),
			);

			return result;
		}),
);

/**
 * SAP SuccessFactors credentials input
 */
export interface SaveSuccessFactorsCredentialsInput {
	clientId: string;
	clientSecret: string;
}

/**
 * Vault keys for SAP SuccessFactors credentials
 */
const SF_VAULT_KEY_CLIENT_ID = "payroll/successfactors/client_id";
const SF_VAULT_KEY_CLIENT_SECRET = "payroll/successfactors/client_secret";

/**
 * Save SAP SuccessFactors API credentials to Vault
 */
export const saveSuccessFactorsCredentialsAction = organizationAction(
	{
		name: "payrollExport.saveSuccessFactorsCredentials",
		requires: "orgAdmin",
		schema: credentialsInputSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			// Store credentials in Vault
			yield* Effect.promise(async () => {
				await storeOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_ID, input.clientId);
				await storeOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_SECRET, input.clientSecret);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

/**
 * Delete SAP SuccessFactors API credentials from Vault
 */
export const deleteSuccessFactorsCredentialsAction = organizationAction(
	{ name: "payrollExport.deleteSuccessFactorsCredentials", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			// Delete credentials from Vault
			yield* Effect.promise(async () => {
				await deleteOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_SECRET);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

// ============================================
// WORKDAY CONFIGURATION TYPES
// ============================================

const WORKDAY_FORMAT_ID = "workday_api";

const WORKDAY_VAULT_KEY_CLIENT_ID = "payroll/workday/client_id";
const WORKDAY_VAULT_KEY_CLIENT_SECRET = "payroll/workday/client_secret";

export interface WorkdayConfigResult {
	id: string;
	formatId: string;
	config: WorkdayConfig;
	isActive: boolean;
	hasCredentials: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveWorkdayConfigInput {
	config: WorkdayConfig;
}

export interface SaveWorkdayCredentialsInput {
	clientId: string;
	clientSecret: string;
}

// ============================================
// WORKDAY CONFIGURATION ACTIONS
// ============================================

export const getWorkdayConfigAction = organizationAction(
	{ name: "payrollExport.getWorkdayConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, WORKDAY_FORMAT_ID),
			);

			if (!configResult) {
				return null;
			}

			const hasCredentials = yield* Effect.promise(async () => {
				const [clientId, clientSecret] = await Promise.all([
					getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID),
					getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET),
				]);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			});

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as WorkdayConfig,
				isActive: configResult.config.isActive,
				hasCredentials,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

export const saveWorkdayConfigAction = organizationAction(
	{
		name: "payrollExport.saveWorkdayConfig",
		requires: "orgAdmin",
		schema: workdayConfigInputSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, WORKDAY_FORMAT_ID),
				});

				if (!format) {
					await db.insert(payrollExportFormat).values({
						id: WORKDAY_FORMAT_ID,
						name: "Workday (API)",
						version: "1.0.0",
						description: "Export to Workday via REST API",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: WORKDAY_FORMAT_ID,
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			const hasCredentials = yield* Effect.promise(async () => {
				const [clientId, clientSecret] = await Promise.all([
					getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID),
					getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET),
				]);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as WorkdayConfig,
				isActive: config.isActive,
				hasCredentials,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

export const saveWorkdayCredentialsAction = organizationAction(
	{
		name: "payrollExport.saveWorkdayCredentials",
		requires: "orgAdmin",
		schema: credentialsInputSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const clientId = input.clientId.trim();
			if (clientId.length === 0) {
				yield* Effect.fail(
					new ValidationError({
						message: "Workday client ID cannot be empty",
						field: "clientId",
					}),
				);
			}

			const clientSecret = input.clientSecret.trim();
			if (clientSecret.length === 0) {
				yield* Effect.fail(
					new ValidationError({
						message: "Workday client secret cannot be empty",
						field: "clientSecret",
					}),
				);
			}

			yield* Effect.promise(async () => {
				await storeOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID, clientId);
				await storeOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET, clientSecret);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

export const deleteWorkdayCredentialsAction = organizationAction(
	{ name: "payrollExport.deleteWorkdayCredentials", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			yield* Effect.promise(async () => {
				await deleteOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

export const testWorkdayConnectionAction = organizationAction(
	{
		name: "payrollExport.testWorkdayConnection",
		requires: "orgAdmin",
		schema: workdayConfigInputSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const { workdayConnector } = yield* Effect.promise(
				() => import("@/lib/payroll-export/exporters/workday/workday-connector"),
			);

			return yield* Effect.promise(() =>
				workdayConnector.testConnection(
					organizationId,
					input.config as unknown as Record<string, unknown>,
				),
			);
		}),
);

// ============================================
// WAGE TYPE MAPPING ACTIONS
// ============================================

/**
 * Get the organization's wage type mappings (shared by every export format)
 */
export const getMappingsAction = organizationAction(
	{ name: "payrollExport.getMappings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			return yield* Effect.promise(() => getWageTypeMappings(organizationId));
		}),
);

/**
 * Save a wage type mapping
 */
export const saveMappingAction = organizationAction(
	{ name: "payrollExport.saveMapping", requires: "orgAdmin", schema: saveMappingSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Validate that exactly one source is provided
			const sourceCount = [
				input.workCategoryId,
				input.absenceCategoryId,
				input.specialCategory,
			].filter(Boolean).length;

			if (sourceCount !== 1) {
				throw new Error(
					"Exactly one of workCategoryId, absenceCategoryId, or specialCategory must be provided",
				);
			}

			// Validate organization ownership of category IDs
			yield* Effect.promise(async () => {
				if (input.workCategoryId) {
					const category = await db.query.workCategory.findFirst({
						where: and(
							eq(workCategory.id, input.workCategoryId),
							eq(workCategory.organizationId, organizationId),
						),
					});
					if (!category) {
						throw new Error("Work category not found or access denied");
					}
				}

				if (input.absenceCategoryId) {
					const category = await db.query.absenceCategory.findFirst({
						where: and(
							eq(absenceCategory.id, input.absenceCategoryId),
							eq(absenceCategory.organizationId, organizationId),
						),
					});
					if (!category) {
						throw new Error("Absence category not found or access denied");
					}
				}
			});

			// Save mapping
			const mapping = yield* Effect.promise(async () => {
				// Check for existing mapping with same source
				const whereConditions = [eq(payrollWageTypeMapping.organizationId, organizationId)];

				if (input.workCategoryId) {
					whereConditions.push(eq(payrollWageTypeMapping.workCategoryId, input.workCategoryId));
				} else if (input.absenceCategoryId) {
					whereConditions.push(
						eq(payrollWageTypeMapping.absenceCategoryId, input.absenceCategoryId),
					);
				} else if (input.specialCategory) {
					whereConditions.push(eq(payrollWageTypeMapping.specialCategory, input.specialCategory));
				}

				const existing = await db.query.payrollWageTypeMapping.findFirst({
					where: and(...whereConditions),
				});

				if (existing) {
					// Update existing
					const [updated] = await db
						.update(payrollWageTypeMapping)
						.set({
							// Legacy fields (for backwards compatibility)
							wageTypeCode:
								input.wageTypeCode ||
								input.datevWageTypeCode ||
								input.lexwareWageTypeCode ||
								input.sageWageTypeCode ||
								input.successFactorsTimeTypeCode ||
								"",
							wageTypeName:
								input.wageTypeName ||
								input.datevWageTypeName ||
								input.lexwareWageTypeName ||
								input.sageWageTypeName ||
								input.successFactorsTimeTypeName ||
								null,
							// Drizzle ignores undefined fields; explicit null clears the stored value.
							datevWageTypeCode: input.datevWageTypeCode,
							datevWageTypeName: input.datevWageTypeName,
							lexwareWageTypeCode: input.lexwareWageTypeCode,
							lexwareWageTypeName: input.lexwareWageTypeName,
							sageWageTypeCode: input.sageWageTypeCode,
							sageWageTypeName: input.sageWageTypeName,
							successFactorsTimeTypeCode: input.successFactorsTimeTypeCode,
							successFactorsTimeTypeName: input.successFactorsTimeTypeName,
							isActive: true,
						})
						.where(
							and(
								eq(payrollWageTypeMapping.id, existing.id),
								eq(payrollWageTypeMapping.organizationId, organizationId),
							),
						)
						.returning();

					return updated;
				} else {
					// Insert new
					const [inserted] = await db
						.insert(payrollWageTypeMapping)
						.values({
							organizationId: organizationId,
							workCategoryId: input.workCategoryId || null,
							absenceCategoryId: input.absenceCategoryId || null,
							specialCategory: input.specialCategory || null,
							// Legacy fields (for backwards compatibility)
							wageTypeCode:
								input.wageTypeCode ||
								input.datevWageTypeCode ||
								input.lexwareWageTypeCode ||
								input.sageWageTypeCode ||
								input.successFactorsTimeTypeCode ||
								"",
							wageTypeName:
								input.wageTypeName ||
								input.datevWageTypeName ||
								input.lexwareWageTypeName ||
								input.sageWageTypeName ||
								input.successFactorsTimeTypeName ||
								null,
							// Format-specific codes
							datevWageTypeCode: input.datevWageTypeCode || null,
							datevWageTypeName: input.datevWageTypeName || null,
							lexwareWageTypeCode: input.lexwareWageTypeCode || null,
							lexwareWageTypeName: input.lexwareWageTypeName || null,
							sageWageTypeCode: input.sageWageTypeCode || null,
							sageWageTypeName: input.sageWageTypeName || null,
							successFactorsTimeTypeCode: input.successFactorsTimeTypeCode || null,
							successFactorsTimeTypeName: input.successFactorsTimeTypeName || null,
							isActive: true,
							createdBy: actor.userId,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: mapping.id,
				workCategoryId: mapping.workCategoryId,
				workCategoryName: null, // Not loaded here
				absenceCategoryId: mapping.absenceCategoryId,
				absenceCategoryName: null, // Not loaded here
				specialCategory: mapping.specialCategory,
				wageTypeCode: mapping.wageTypeCode,
				wageTypeName: mapping.wageTypeName,
				// Format-specific codes
				datevWageTypeCode: mapping.datevWageTypeCode,
				datevWageTypeName: mapping.datevWageTypeName,
				lexwareWageTypeCode: mapping.lexwareWageTypeCode,
				lexwareWageTypeName: mapping.lexwareWageTypeName,
				sageWageTypeCode: mapping.sageWageTypeCode,
				sageWageTypeName: mapping.sageWageTypeName,
				successFactorsTimeTypeCode: mapping.successFactorsTimeTypeCode,
				successFactorsTimeTypeName: mapping.successFactorsTimeTypeName,
				factor: mapping.factor || "1.00",
				isActive: mapping.isActive,
			};
		}),
);

/**
 * Delete a wage type mapping
 */
export const deleteMappingAction = organizationAction(
	{ name: "payrollExport.deleteMapping", requires: "orgAdmin", schema: deleteMappingSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			// Delete only within the organization
			yield* Effect.promise(async () => {
				const deleted = await db
					.delete(payrollWageTypeMapping)
					.where(
						and(
							eq(payrollWageTypeMapping.id, input.mappingId),
							eq(payrollWageTypeMapping.organizationId, organizationId),
						),
					)
					.returning({ id: payrollWageTypeMapping.id });

				if (deleted.length === 0) {
					throw new Error("Mapping not found or access denied");
				}
			});

			revalidatePath("/settings/payroll-export");
		}),
);

// ============================================
// CATEGORY OPTIONS ACTIONS
// ============================================

/**
 * Get work categories for mapping selection
 */
export const getWorkCategoriesAction = organizationAction(
	{ name: "payrollExport.getWorkCategories", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const categories = yield* Effect.promise(() => getWorkCategories(organizationId));

			return categories;
		}),
);

/**
 * Get absence categories for mapping selection
 */
export const getAbsenceCategoriesAction = organizationAction(
	{ name: "payrollExport.getAbsenceCategories", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const categories = yield* Effect.promise(() => getAbsenceCategories(organizationId));

			return categories;
		}),
);

// ============================================
// FILTER OPTIONS ACTION
// ============================================

/**
 * Get filter options (employees, teams, projects)
 */
export const getFilterOptionsAction = organizationAction(
	{ name: "payrollExport.getFilterOptions", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const [employees, teams, projects] = yield* Effect.promise(() =>
				Promise.all([
					getEmployeesForFilter(organizationId),
					getTeamsForFilter(organizationId),
					getProjectsForFilter(organizationId),
				]),
			);

			return { employees, teams, projects };
		}),
);

// ============================================
// EXPORT ACTIONS
// ============================================

/** The export's first and last logical date; refused when malformed or backwards. */
function payrollDateRange(startDate: string, endDate: string) {
	return Effect.gen(function* () {
		const parse = (value: string, field: string) =>
			Effect.try({
				try: () => parsePlainDate(value),
				catch: () => new ValidationError({ message: "Invalid date format provided", field }),
			});
		const start = yield* parse(startDate, "startDate");
		const end = yield* parse(endDate, "endDate");
		if (comparePlainDates(end, start) < 0) {
			return yield* Effect.fail(
				new ValidationError({ message: "End date must be after start date", field: "endDate" }),
			);
		}
		return { start, end };
	});
}

/**
 * Start a payroll export
 */
export const startExportAction = organizationAction(
	{ name: "payrollExport.startExport", requires: "orgAdmin", schema: startExportSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// The export is requested by the caller's employee record.
			const currentEmployee = actor.employee;
			if (!currentEmployee) {
				return yield* Effect.fail(
					new NotFoundError({ message: "Employee profile not found", entityType: "employee" }),
				);
			}
			// The range is logical dates (YYYY-MM-DD), not instants: no time zone applies.
			const range = yield* payrollDateRange(input.startDate, input.endDate);

			const filters: PayrollExportFilters = {
				dateRange: {
					start: parsePayrollLogicalDate(range.start.toString()),
					end: parsePayrollLogicalDate(range.end.toString()),
				},
				employeeIds: input.employeeIds,
				teamIds: input.teamIds,
				projectIds: input.projectIds,
			};

			// Create export job
			const { jobId, isAsync } = yield* Effect.promise(() =>
				createExportJob({
					organizationId: organizationId,
					formatId: input.formatId,
					requestedById: currentEmployee.id,
					filters,
					// Checked above: an organization administrator may execute eligible repairs.
					repairActorUserId: actor.userId,
				}),
			);

			// If sync, process immediately and return result
			if (!isAsync) {
				const processed = yield* Effect.promise(() =>
					processExportJob({ jobId, organizationId: organizationId }).then(
						(output) => ({ output, refusal: null }),
						(error: unknown) => {
							// Two employees under one identifier: the user can fix it, so it is a
							// translated conflict naming them (#1199). Other failures stay defects.
							if (error instanceof PayrollIdentifierDuplicateError) {
								return { output: null, refusal: error };
							}
							throw error;
						},
					),
				);
				if (processed.refusal) {
					const t = yield* Effect.promise(() => getTranslate());
					return yield* Effect.fail(payrollIdentifierDuplicateConflict(processed.refusal, t));
				}
				const { result, downloadUrl } = processed.output;

				revalidatePath("/settings/payroll-export");

				return {
					jobId,
					isAsync: false,
					downloadUrl,
					fileContent: result?.content
						? typeof result.content === "string"
							? result.content
							: result.content.toString("utf-8")
						: undefined,
					unmappedOvertimePayoutCount: result?.metadata.unmappedOvertimePayouts.length ?? 0,
				};
			}

			yield* Effect.promise(() =>
				enqueuePayrollExportJob({ jobId, organizationId: organizationId }),
			);

			revalidatePath("/settings/payroll-export");

			return { jobId, isAsync: true };
		}),
);

/**
 * Get export history
 */
export const getExportHistoryAction = organizationAction(
	{ name: "payrollExport.getExportHistory", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const history = yield* Effect.promise(() => getExportJobHistory(organizationId));

			return history;
		}),
);

/**
 * Get download URL for export
 */
export const getExportDownloadUrlAction = organizationAction(
	{ name: "payrollExport.getExportDownloadUrl", requires: "orgAdmin", schema: exportJobSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const url = yield* Effect.promise(() => getExportDownloadUrl(organizationId, input.jobId));

			return url;
		}),
);

/**
 * Discards an unconfirmed payroll run (#852): the reports it includes are free
 * again for the next export or a bank-transfer reimbursement. Administrators
 * start exports here for every employee, so they may discard any run.
 */
export const discardPayrollRunAction = organizationAction(
	{ name: "payrollExport.discardPayrollRun", requires: "orgAdmin", schema: exportJobSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			if (!z.uuid().safeParse(input.jobId).success) return { status: "not_found" } as const;

			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("payrollRun.discard", () =>
				discardPayrollRun(dbService.db, {
					organizationId,
					jobId: input.jobId,
					actorUserId: actor.userId,
					employeeScope: "all",
				}),
			);
			if (result.status === "discarded") revalidatePath("/settings/payroll-export");
			return result;
		}),
);

// ============================================
// PERSONIO CONFIGURATION TYPES
// ============================================

import { getExporter, type PersonioConfig } from "@/lib/payroll-export";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault/secrets";

const PERSONIO_FORMAT_ID = "personio";
const VAULT_KEY_CLIENT_ID = "payroll/personio/client_id";
const VAULT_KEY_CLIENT_SECRET = "payroll/personio/client_secret";

export interface PersonioConfigResult {
	id: string;
	formatId: string;
	config: PersonioConfig;
	isActive: boolean;
	hasCredentials: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface SavePersonioConfigInput {
	config: PersonioConfig;
}

export interface SavePersonioCredentialsInput {
	clientId: string;
	clientSecret: string;
}

// ============================================
// PERSONIO CONFIGURATION ACTIONS
// ============================================

/**
 * Get Personio configuration for organization
 */
export const getPersonioConfigAction = organizationAction(
	{ name: "payrollExport.getPersonioConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, PERSONIO_FORMAT_ID),
			);

			if (!configResult) {
				return null;
			}

			// Check if credentials exist in Vault
			const hasCredentials = yield* Effect.promise(async () => {
				const clientId = await getOrgSecret(organizationId, VAULT_KEY_CLIENT_ID);
				return clientId !== null;
			});

			return {
				id: configResult.config.id,
				formatId: configResult.config.formatId,
				config: configResult.config.config as unknown as PersonioConfig,
				isActive: configResult.config.isActive,
				hasCredentials,
				createdAt: configResult.config.createdAt,
				updatedAt: configResult.config.updatedAt,
			};
		}),
);

/**
 * Save Personio configuration
 */
export const savePersonioConfigAction = organizationAction(
	{
		name: "payrollExport.savePersonioConfig",
		requires: "orgAdmin",
		schema: personioConfigInputSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			// Ensure Personio format exists
			yield* Effect.promise(async () => {
				const format = await db.query.payrollExportFormat.findFirst({
					where: eq(payrollExportFormat.id, PERSONIO_FORMAT_ID),
				});

				if (!format) {
					// Create the format if it doesn't exist
					await db.insert(payrollExportFormat).values({
						id: PERSONIO_FORMAT_ID,
						name: "Personio",
						version: "1.0",
						description: "Push time entries directly to Personio HR",
						isEnabled: true,
						requiresConfiguration: true,
						supportsAsync: true,
						syncThreshold: 500,
						updatedAt: new Date(),
					});
				}
			});

			// Save or update config; a custom field identifier must be eligible (#821)
			const config = yield* saveConfig({
				organizationId: organizationId,
				formatId: PERSONIO_FORMAT_ID,
				config: input.config as unknown as Record<string, unknown>,
				actorUserId: actor.userId,
			});

			// Check if credentials exist
			const hasCredentials = yield* Effect.promise(async () => {
				const clientId = await getOrgSecret(organizationId, VAULT_KEY_CLIENT_ID);
				return clientId !== null;
			});

			revalidatePath("/settings/payroll-export");

			return {
				id: config.id,
				formatId: config.formatId,
				config: config.config as unknown as PersonioConfig,
				isActive: config.isActive,
				hasCredentials,
				createdAt: config.createdAt,
				updatedAt: config.updatedAt,
			};
		}),
);

/**
 * Save Personio API credentials to Vault
 */
export const savePersonioCredentialsAction = organizationAction(
	{
		name: "payrollExport.savePersonioCredentials",
		requires: "orgAdmin",
		schema: credentialsInputSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			// Store credentials in Vault
			yield* Effect.promise(async () => {
				await storeOrgSecret(organizationId, VAULT_KEY_CLIENT_ID, input.clientId);
				await storeOrgSecret(organizationId, VAULT_KEY_CLIENT_SECRET, input.clientSecret);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

/**
 * Delete Personio API credentials from Vault
 */
export const deletePersonioCredentialsAction = organizationAction(
	{ name: "payrollExport.deletePersonioCredentials", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			// Delete credentials from Vault
			yield* Effect.promise(async () => {
				await deleteOrgSecret(organizationId, VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, VAULT_KEY_CLIENT_SECRET);
			});

			revalidatePath("/settings/payroll-export");

			return { success: true };
		}),
);

/**
 * Test Personio API connection
 */
export const testPersonioConnectionAction = organizationAction(
	{ name: "payrollExport.testPersonioConnection", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			// Get the Personio exporter and test connection
			const exporter = getExporter(PERSONIO_FORMAT_ID);
			if (!exporter) {
				return { success: false, error: "Personio exporter not available" };
			}

			// Get config
			const configResult = yield* Effect.promise(() =>
				getPayrollExportConfig(organizationId, PERSONIO_FORMAT_ID),
			);

			const config = configResult?.config.config || {};

			const result = yield* Effect.promise(() =>
				exporter.testConnection(organizationId, config as Record<string, unknown>),
			);

			return result;
		}),
);
