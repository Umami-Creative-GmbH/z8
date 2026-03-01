"use server";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import {
	absenceCategory,
	db,
	payrollExportConfig,
	payrollExportFormat,
	payrollWageTypeMapping,
	workCategory,
} from "@/db";
import { employee } from "@/db/schema";
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	createExportJob,
	processExportJob,
	getExportJobHistory,
	getExportDownloadUrl,
	getPayrollExportConfig,
	getWageTypeMappings,
	getWorkCategories,
	getAbsenceCategories,
	getEmployeesForFilter,
	getTeamsForFilter,
	getProjectsForFilter,
	type PayrollExportFilters,
	type DatevLohnConfig,
	type LexwareLohnConfig,
	type SageLohnConfig,
	type WorkdayConfig,
	type WageTypeMapping,
	type PayrollExportJobSummary,
} from "@/lib/payroll-export";

// Using isOrgAdminCasl from auth-helpers for CASL-based authorization

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
	organizationId: string;
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
	organizationId: string;
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
	organizationId: string;
	config: SageLohnConfig;
}

// ============================================
// WAGE TYPE MAPPING TYPES
// ============================================

export interface SaveMappingInput {
	organizationId: string;
	configId: string;
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
	organizationId: string;
	mappingId: string;
}

// ============================================
// EXPORT TYPES
// ============================================

export interface StartExportInput {
	organizationId: string;
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

export interface FilterOptions {
	employees: Array<{ id: string; firstName: string | null; lastName: string | null; employeeNumber: string | null }>;
	teams: Array<{ id: string; name: string }>;
	projects: Array<{ id: string; name: string }>;
}

// ============================================
// CONFIGURATION ACTIONS
// ============================================

/**
 * Get DATEV configuration for organization
 */
export async function getDatevConfigAction(
	organizationId: string,
): Promise<ServerActionResult<DatevConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, "datev_lohn")),
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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save DATEV configuration
 */
export async function saveDatevConfigAction(
	input: SaveDatevConfigInput,
): Promise<ServerActionResult<DatevConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure DATEV format exists
		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		// Save or update config
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, "datev_lohn"),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: "datev_lohn",
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: config.id,
			formatId: config.formatId,
			config: config.config as unknown as DatevLohnConfig,
			isActive: config.isActive,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// LEXWARE CONFIGURATION ACTIONS
// ============================================

const LEXWARE_FORMAT_ID = "lexware_lohn";

/**
 * Get Lexware configuration for organization
 */
export async function getLexwareConfigAction(
	organizationId: string,
): Promise<ServerActionResult<LexwareConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, LEXWARE_FORMAT_ID)),
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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save Lexware configuration
 */
export async function saveLexwareConfigAction(
	input: SaveLexwareConfigInput,
): Promise<ServerActionResult<LexwareConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure Lexware format exists
		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		// Save or update config
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, LEXWARE_FORMAT_ID),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: LEXWARE_FORMAT_ID,
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: config.id,
			formatId: config.formatId,
			config: config.config as unknown as LexwareLohnConfig,
			isActive: config.isActive,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// SAGE CONFIGURATION ACTIONS
// ============================================

const SAGE_FORMAT_ID = "sage_lohn";

/**
 * Get Sage configuration for organization
 */
export async function getSageConfigAction(
	organizationId: string,
): Promise<ServerActionResult<SageConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, SAGE_FORMAT_ID)),
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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save Sage configuration
 */
export async function saveSageConfigAction(
	input: SaveSageConfigInput,
): Promise<ServerActionResult<SageConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure Sage format exists
		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		// Save or update config
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, SAGE_FORMAT_ID),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: SAGE_FORMAT_ID,
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: config.id,
			formatId: config.formatId,
			config: config.config as unknown as SageLohnConfig,
			isActive: config.isActive,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

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
	createdAt: Date;
	updatedAt: Date;
}

export interface SaveSuccessFactorsConfigInput {
	organizationId: string;
	config: SuccessFactorsConfig;
}

/**
 * Get SAP SuccessFactors configuration for organization
 */
export async function getSuccessFactorsConfigAction(
	organizationId: string,
): Promise<ServerActionResult<SuccessFactorsConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, SF_FORMAT_ID)),
		);

		if (!configResult) {
			return null;
		}

		return {
			id: configResult.config.id,
			formatId: configResult.config.formatId,
			config: configResult.config.config as unknown as SuccessFactorsConfig,
			isActive: configResult.config.isActive,
			createdAt: configResult.config.createdAt,
			updatedAt: configResult.config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save SAP SuccessFactors configuration
 */
export async function saveSuccessFactorsConfigAction(
	input: SaveSuccessFactorsConfigInput,
): Promise<ServerActionResult<SuccessFactorsConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure SAP SuccessFactors format exists (for both API and CSV modes)
		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		// Save or update config (shared between API and CSV modes)
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, SF_FORMAT_ID),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: SF_FORMAT_ID,
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		revalidatePath("/settings/payroll-export");

		return {
			id: config.id,
			formatId: config.formatId,
			config: config.config as unknown as SuccessFactorsConfig,
			isActive: config.isActive,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Test SAP SuccessFactors connection
 */
export async function testSuccessFactorsConnectionAction(input: {
	organizationId: string;
	config: SuccessFactorsConfig;
}): Promise<ServerActionResult<{ success: boolean; error?: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		// Import the exporter to test connection
		const { successFactorsExporter } = yield* _(
			Effect.promise(() => import("@/lib/payroll-export/exporters/successfactors")),
		);

		const result = yield* _(
			Effect.promise(() =>
				successFactorsExporter.testConnection(
					input.organizationId,
					input.config as unknown as Record<string, unknown>,
				),
			),
		);

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * SAP SuccessFactors credentials input
 */
export interface SaveSuccessFactorsCredentialsInput {
	organizationId: string;
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
export async function saveSuccessFactorsCredentialsAction(
	input: SaveSuccessFactorsCredentialsInput,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Store credentials in Vault
		yield* _(
			Effect.promise(async () => {
				await storeOrgSecret(input.organizationId, SF_VAULT_KEY_CLIENT_ID, input.clientId);
				await storeOrgSecret(input.organizationId, SF_VAULT_KEY_CLIENT_SECRET, input.clientSecret);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete SAP SuccessFactors API credentials from Vault
 */
export async function deleteSuccessFactorsCredentialsAction(
	organizationId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "delete",
					}),
				),
			);
		}

		// Delete credentials from Vault
		yield* _(
			Effect.promise(async () => {
				await deleteOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, SF_VAULT_KEY_CLIENT_SECRET);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

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
	organizationId: string;
	config: WorkdayConfig;
}

export interface SaveWorkdayCredentialsInput {
	organizationId: string;
	clientId: string;
	clientSecret: string;
}

// ============================================
// WORKDAY CONFIGURATION ACTIONS
// ============================================

export async function getWorkdayConfigAction(
	organizationId: string,
): Promise<ServerActionResult<WorkdayConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, WORKDAY_FORMAT_ID)),
		);

		if (!configResult) {
			return null;
		}

		const hasCredentials = yield* _(
			Effect.promise(async () => {
				const clientId = await getOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID);
				const clientSecret = await getOrgSecret(
					organizationId,
					WORKDAY_VAULT_KEY_CLIENT_SECRET,
				);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			}),
		);

		return {
			id: configResult.config.id,
			formatId: configResult.config.formatId,
			config: configResult.config.config as unknown as WorkdayConfig,
			isActive: configResult.config.isActive,
			hasCredentials,
			createdAt: configResult.config.createdAt,
			updatedAt: configResult.config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function saveWorkdayConfigAction(
	input: SaveWorkdayConfigInput,
): Promise<ServerActionResult<WorkdayConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, WORKDAY_FORMAT_ID),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				}

				const [inserted] = await db
					.insert(payrollExportConfig)
					.values({
						organizationId: input.organizationId,
						formatId: WORKDAY_FORMAT_ID,
						config: input.config as unknown as Record<string, unknown>,
						isActive: true,
						createdBy: session.user.id,
						updatedAt: new Date(),
					})
					.returning();

				return inserted;
			}),
		);

		const hasCredentials = yield* _(
			Effect.promise(async () => {
				const clientId = await getOrgSecret(input.organizationId, WORKDAY_VAULT_KEY_CLIENT_ID);
				const clientSecret = await getOrgSecret(
					input.organizationId,
					WORKDAY_VAULT_KEY_CLIENT_SECRET,
				);
				return (
					clientId !== null &&
					clientSecret !== null &&
					clientId.trim().length > 0 &&
					clientSecret.trim().length > 0
				);
			}),
		);

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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function saveWorkdayCredentialsAction(
	input: SaveWorkdayCredentialsInput,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		const clientId = input.clientId.trim();
		if (clientId.length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Workday client ID cannot be empty",
						field: "clientId",
					}),
				),
			);
		}

		const clientSecret = input.clientSecret.trim();
		if (clientSecret.length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Workday client secret cannot be empty",
						field: "clientSecret",
					}),
				),
			);
		}

		yield* _(
			Effect.promise(async () => {
				await storeOrgSecret(input.organizationId, WORKDAY_VAULT_KEY_CLIENT_ID, clientId);
				await storeOrgSecret(
					input.organizationId,
					WORKDAY_VAULT_KEY_CLIENT_SECRET,
					clientSecret,
				);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function deleteWorkdayCredentialsAction(
	organizationId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "delete",
					}),
				),
			);
		}

		yield* _(
			Effect.promise(async () => {
				await deleteOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, WORKDAY_VAULT_KEY_CLIENT_SECRET);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function testWorkdayConnectionAction(input: {
	organizationId: string;
	config: WorkdayConfig;
}): Promise<ServerActionResult<{ success: boolean; error?: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const { workdayConnector } = yield* _(
			Effect.promise(() => import("@/lib/payroll-export/exporters/workday/workday-connector")),
		);

		return yield* _(
			Effect.promise(() =>
				workdayConnector.testConnection(
					input.organizationId,
					input.config as unknown as Record<string, unknown>,
				),
			),
		);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// WAGE TYPE MAPPING ACTIONS
// ============================================

/**
 * Get wage type mappings for organization's DATEV config
 */
export async function getMappingsAction(
	organizationId: string,
): Promise<ServerActionResult<WageTypeMapping[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "read",
					}),
				),
			);
		}

		// Get config first
		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, "datev_lohn")),
		);

		if (!configResult) {
			return [];
		}

		// Get mappings
		const mappings = yield* _(
			Effect.promise(() => getWageTypeMappings(configResult.config.id)),
		);

		return mappings;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save a wage type mapping
 */
export async function saveMappingAction(
	input: SaveMappingInput,
): Promise<ServerActionResult<WageTypeMapping>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "create",
					}),
				),
			);
		}

		// Validate that exactly one source is provided
		const sourceCount = [
			input.workCategoryId,
			input.absenceCategoryId,
			input.specialCategory,
		].filter(Boolean).length;

		if (sourceCount !== 1) {
			throw new Error("Exactly one of workCategoryId, absenceCategoryId, or specialCategory must be provided");
		}

		// Validate organization ownership of configId and category IDs
		yield* _(
			Effect.promise(async () => {
				// Validate configId belongs to organization
				const config = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.id, input.configId),
						eq(payrollExportConfig.organizationId, input.organizationId),
					),
				});
				if (!config) {
					throw new Error("Configuration not found or access denied");
				}

				if (input.workCategoryId) {
					const category = await db.query.workCategory.findFirst({
						where: and(
							eq(workCategory.id, input.workCategoryId),
							eq(workCategory.organizationId, input.organizationId),
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
							eq(absenceCategory.organizationId, input.organizationId),
						),
					});
					if (!category) {
						throw new Error("Absence category not found or access denied");
					}
				}
			}),
		);

		// Save mapping
		const mapping = yield* _(
			Effect.promise(async () => {
				// Check for existing mapping with same source
				const whereConditions = [eq(payrollWageTypeMapping.configId, input.configId)];

				if (input.workCategoryId) {
					whereConditions.push(eq(payrollWageTypeMapping.workCategoryId, input.workCategoryId));
				} else if (input.absenceCategoryId) {
					whereConditions.push(eq(payrollWageTypeMapping.absenceCategoryId, input.absenceCategoryId));
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
							wageTypeCode: input.wageTypeCode || input.datevWageTypeCode || input.lexwareWageTypeCode || input.sageWageTypeCode || input.successFactorsTimeTypeCode || "",
							wageTypeName: input.wageTypeName || input.datevWageTypeName || input.lexwareWageTypeName || input.sageWageTypeName || input.successFactorsTimeTypeName || null,
							// Format-specific codes
							datevWageTypeCode: input.datevWageTypeCode ?? existing.datevWageTypeCode,
							datevWageTypeName: input.datevWageTypeName ?? existing.datevWageTypeName,
							lexwareWageTypeCode: input.lexwareWageTypeCode ?? existing.lexwareWageTypeCode,
							lexwareWageTypeName: input.lexwareWageTypeName ?? existing.lexwareWageTypeName,
							sageWageTypeCode: input.sageWageTypeCode ?? existing.sageWageTypeCode,
							sageWageTypeName: input.sageWageTypeName ?? existing.sageWageTypeName,
							successFactorsTimeTypeCode: input.successFactorsTimeTypeCode ?? existing.successFactorsTimeTypeCode,
							successFactorsTimeTypeName: input.successFactorsTimeTypeName ?? existing.successFactorsTimeTypeName,
							isActive: true,
						})
						.where(eq(payrollWageTypeMapping.id, existing.id))
						.returning();

					return updated;
				} else {
					// Insert new
					const [inserted] = await db
						.insert(payrollWageTypeMapping)
						.values({
							configId: input.configId,
							workCategoryId: input.workCategoryId || null,
							absenceCategoryId: input.absenceCategoryId || null,
							specialCategory: input.specialCategory || null,
							// Legacy fields (for backwards compatibility)
							wageTypeCode: input.wageTypeCode || input.datevWageTypeCode || input.lexwareWageTypeCode || input.sageWageTypeCode || input.successFactorsTimeTypeCode || "",
							wageTypeName: input.wageTypeName || input.datevWageTypeName || input.lexwareWageTypeName || input.sageWageTypeName || input.successFactorsTimeTypeName || null,
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
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete a wage type mapping
 */
export async function deleteMappingAction(
	input: DeleteMappingInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_wage_type_mapping",
						action: "delete",
					}),
				),
			);
		}

		// Validate mapping belongs to organization before deleting
		yield* _(
			Effect.promise(async () => {
				const mapping = await db.query.payrollWageTypeMapping.findFirst({
					where: eq(payrollWageTypeMapping.id, input.mappingId),
					with: { config: true },
				});

				if (!mapping) {
					throw new Error("Mapping not found");
				}

				if (mapping.config.organizationId !== input.organizationId) {
					throw new Error("Mapping not found or access denied");
				}

				await db
					.delete(payrollWageTypeMapping)
					.where(eq(payrollWageTypeMapping.id, input.mappingId));
			}),
		);

		revalidatePath("/settings/payroll-export");
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// CATEGORY OPTIONS ACTIONS
// ============================================

/**
 * Get work categories for mapping selection
 */
export async function getWorkCategoriesAction(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string; factor: string | null }>>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "work_category",
						action: "read",
					}),
				),
			);
		}

		const categories = yield* _(
			Effect.promise(() => getWorkCategories(organizationId)),
		);

		return categories;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get absence categories for mapping selection
 */
export async function getAbsenceCategoriesAction(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string; type: string | null }>>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "absence_category",
						action: "read",
					}),
				),
			);
		}

		const categories = yield* _(
			Effect.promise(() => getAbsenceCategories(organizationId)),
		);

		return categories;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// FILTER OPTIONS ACTION
// ============================================

/**
 * Get filter options (employees, teams, projects)
 */
export async function getFilterOptionsAction(
	organizationId: string,
): Promise<ServerActionResult<FilterOptions>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "filter_options",
						action: "read",
					}),
				),
			);
		}

		const [employees, teams, projects] = yield* _(
			Effect.promise(() =>
				Promise.all([
					getEmployeesForFilter(organizationId),
					getTeamsForFilter(organizationId),
					getProjectsForFilter(organizationId),
				]),
			),
		);

		return { employees, teams, projects };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// EXPORT ACTIONS
// ============================================

/**
 * Start a payroll export
 */
export async function startExportAction(
	input: StartExportInput,
): Promise<ServerActionResult<{ jobId: string; isAsync: boolean; downloadUrl?: string; fileContent?: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Get current employee
		const dbService = yield* _(DatabaseService);
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, input.organizationId),
					),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "create",
					}),
				),
			);
		}

		// Parse and validate dates
		const startDate = DateTime.fromISO(input.startDate);
		const endDate = DateTime.fromISO(input.endDate);

		if (!startDate.isValid || !endDate.isValid) {
			throw new Error("Invalid date format provided");
		}

		if (endDate < startDate) {
			throw new Error("End date must be after start date");
		}

		const filters: PayrollExportFilters = {
			dateRange: {
				start: startDate,
				end: endDate,
			},
			employeeIds: input.employeeIds,
			teamIds: input.teamIds,
			projectIds: input.projectIds,
		};

		// Create export job
		const { jobId, isAsync } = yield* _(
			Effect.promise(() =>
				createExportJob({
					organizationId: input.organizationId,
					formatId: input.formatId,
					requestedById: currentEmployee.id,
					filters,
				}),
			),
		);

		// If sync, process immediately and return result
		if (!isAsync) {
			const { result, downloadUrl } = yield* _(
				Effect.promise(() => processExportJob(jobId)),
			);

			revalidatePath("/settings/payroll-export");

			return {
				jobId,
				isAsync: false,
				downloadUrl,
				fileContent: result?.content ? (typeof result.content === "string" ? result.content : result.content.toString("utf-8")) : undefined,
			};
		}

		// For async, just return job ID
		revalidatePath("/settings/payroll-export");

		return { jobId, isAsync: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get export history
 */
export async function getExportHistoryAction(
	organizationId: string,
): Promise<ServerActionResult<PayrollExportJobSummary[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "read",
					}),
				),
			);
		}

		const history = yield* _(
			Effect.promise(() => getExportJobHistory(organizationId)),
		);

		return history;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get download URL for export
 */
export async function getExportDownloadUrlAction(
	organizationId: string,
	jobId: string,
): Promise<ServerActionResult<string | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export",
						action: "download",
					}),
				),
			);
		}

		const url = yield* _(
			Effect.promise(() => getExportDownloadUrl(organizationId, jobId)),
		);

		return url;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// PERSONIO CONFIGURATION TYPES
// ============================================

import { storeOrgSecret, getOrgSecret, deleteOrgSecret } from "@/lib/vault/secrets";
import { getExporter, type PersonioConfig } from "@/lib/payroll-export";

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
	organizationId: string;
	config: PersonioConfig;
}

export interface SavePersonioCredentialsInput {
	organizationId: string;
	clientId: string;
	clientSecret: string;
}

// ============================================
// PERSONIO CONFIGURATION ACTIONS
// ============================================

/**
 * Get Personio configuration for organization
 */
export async function getPersonioConfigAction(
	organizationId: string,
): Promise<ServerActionResult<PersonioConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, PERSONIO_FORMAT_ID)),
		);

		if (!configResult) {
			return null;
		}

		// Check if credentials exist in Vault
		const hasCredentials = yield* _(
			Effect.promise(async () => {
				const clientId = await getOrgSecret(organizationId, VAULT_KEY_CLIENT_ID);
				return clientId !== null;
			}),
		);

		return {
			id: configResult.config.id,
			formatId: configResult.config.formatId,
			config: configResult.config.config as unknown as PersonioConfig,
			isActive: configResult.config.isActive,
			hasCredentials,
			createdAt: configResult.config.createdAt,
			updatedAt: configResult.config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save Personio configuration
 */
export async function savePersonioConfigAction(
	input: SavePersonioConfigInput,
): Promise<ServerActionResult<PersonioConfigResult>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Ensure Personio format exists
		yield* _(
			Effect.promise(async () => {
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
			}),
		);

		// Save or update config
		const config = yield* _(
			Effect.promise(async () => {
				const existing = await db.query.payrollExportConfig.findFirst({
					where: and(
						eq(payrollExportConfig.organizationId, input.organizationId),
						eq(payrollExportConfig.formatId, PERSONIO_FORMAT_ID),
					),
				});

				if (existing) {
					const [updated] = await db
						.update(payrollExportConfig)
						.set({
							config: input.config as unknown as Record<string, unknown>,
							updatedBy: session.user.id,
						})
						.where(eq(payrollExportConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					const [inserted] = await db
						.insert(payrollExportConfig)
						.values({
							organizationId: input.organizationId,
							formatId: PERSONIO_FORMAT_ID,
							config: input.config as unknown as Record<string, unknown>,
							isActive: true,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		// Check if credentials exist
		const hasCredentials = yield* _(
			Effect.promise(async () => {
				const clientId = await getOrgSecret(input.organizationId, VAULT_KEY_CLIENT_ID);
				return clientId !== null;
			}),
		);

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
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save Personio API credentials to Vault
 */
export async function savePersonioCredentialsAction(
	input: SavePersonioCredentialsInput,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "create",
					}),
				),
			);
		}

		// Store credentials in Vault
		yield* _(
			Effect.promise(async () => {
				await storeOrgSecret(input.organizationId, VAULT_KEY_CLIENT_ID, input.clientId);
				await storeOrgSecret(input.organizationId, VAULT_KEY_CLIENT_SECRET, input.clientSecret);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete Personio API credentials from Vault
 */
export async function deletePersonioCredentialsAction(
	organizationId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "delete",
					}),
				),
			);
		}

		// Delete credentials from Vault
		yield* _(
			Effect.promise(async () => {
				await deleteOrgSecret(organizationId, VAULT_KEY_CLIENT_ID);
				await deleteOrgSecret(organizationId, VAULT_KEY_CLIENT_SECRET);
			}),
		);

		revalidatePath("/settings/payroll-export");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Test Personio API connection
 */
export async function testPersonioConnectionAction(
	organizationId: string,
): Promise<ServerActionResult<{ success: boolean; error?: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "payroll_export_config",
						action: "read",
					}),
				),
			);
		}

		// Get the Personio exporter and test connection
		const exporter = getExporter(PERSONIO_FORMAT_ID);
		if (!exporter) {
			return { success: false, error: "Personio exporter not available" };
		}

		// Get config
		const configResult = yield* _(
			Effect.promise(() => getPayrollExportConfig(organizationId, PERSONIO_FORMAT_ID)),
		);

		const config = configResult?.config.config || {};

		const result = yield* _(
			Effect.promise(() => exporter.testConnection(organizationId, config as Record<string, unknown>)),
		);

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
