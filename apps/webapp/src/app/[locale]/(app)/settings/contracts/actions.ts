"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { employee } from "@/db/schema";
import {
	adoptContractDefault,
	archiveContractTemplate,
	assignEmployeeWorkPolicy,
	commitContractChange,
	createContractTemplate,
	createInitialEmploymentAgreement,
	customWorkDaysSchema,
	getContractDefaults,
	getContractTemplate,
	listContractMigrationConflicts,
	listContractsReviewQueue,
	listContractTemplates,
	listEmploymentTermAgreements,
	previewContractDefaultChange,
	previewEmployeeContractChange,
	previewPrimaryTeamMove,
	previewTemplateApplication,
	publishContractTemplateVersion,
	recordFixedTermExtension,
	resetEmployeeContractDivergences,
	resolveContractMigrationConflict,
	resolveEffectiveContractOnDay,
	scheduleContractDefault,
} from "@/lib/contracts";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { storeStep } from "@/lib/organization-action/store-step";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	markEmployeeWorkBalanceDirty,
	markOrganizationWorkBalancesDirty,
} from "@/lib/work-balance/service";

const uuidSchema = z.uuid("Invalid identifier");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
const presenceOverrideSchema = z.enum(["inherit", "exempt", "require_onsite"]);
const balanceModeSchema = z.enum(["tracked", "trust_based"]);
const scheduleModeSchema = z.enum(["inherit", "policy", "hours_only", "custom_days"]);
const templateScheduleModeSchema = z.enum(["policy", "hours_only", "custom_days"]);
const scheduleSourceSchema = z.enum(["policy", "published_shifts", "on_call"]);
const contractTypeSchema = z.enum(["fixed", "hourly"]);
const employmentProfileSchema = z.enum([
	"regular",
	"minijob",
	"short_term",
	"working_student",
	"apprentice",
]);
const arbzgScopeSchema = z.enum(["standard", "executive_exempt"]);
const onCallHoursKindSchema = z.enum(["exact", "minimum", "maximum", "unspecified"]);
const agreementKindSchema = z.enum(["permanent", "fixed_term"]);
const departureSyncActionSchema = z.enum([
	"update_leaving_date",
	"cancel_departure",
	"leave_unchanged",
]);

const scheduleContractDefaultSchema = z.strictObject({
	scope: z.enum(["organization", "team"]),
	teamId: uuidSchema.nullable().optional(),
	effectiveFromDate: isoDateSchema,
	workPolicyId: uuidSchema.nullable().optional(),
	weeklyContractMinutes: z.number().int().min(0).max(10080).nullable().optional(),
	scheduleMode: templateScheduleModeSchema.optional(),
	customDays: customWorkDaysSchema.nullable().optional(),
	workModel: workModelSchema.nullable().optional(),
	presenceOverride: presenceOverrideSchema.optional(),
	balanceMode: balanceModeSchema.optional(),
	scheduleSource: scheduleSourceSchema.optional(),
});

const templateVersionFieldsShape = {
	workPolicyId: uuidSchema.nullable().optional(),
	weeklyContractMinutes: z.number().int().min(0).max(10080).nullable().optional(),
	scheduleMode: templateScheduleModeSchema.optional(),
	customDays: customWorkDaysSchema.nullable().optional(),
	workModel: workModelSchema.nullable().optional(),
	presenceOverride: presenceOverrideSchema.optional(),
	balanceMode: balanceModeSchema.optional(),
	scheduleSource: scheduleSourceSchema.optional(),
	defaultContractType: contractTypeSchema.nullable().optional(),
	defaultEmploymentProfile: employmentProfileSchema.nullable().optional(),
	defaultArbzgScope: arbzgScopeSchema.nullable().optional(),
	defaultOnCallHoursKind: onCallHoursKindSchema.nullable().optional(),
	defaultOnCallWeeklyMinutes: z.number().int().min(1).max(10080).nullable().optional(),
	defaultOnCallDailyMinutes: z.number().int().min(1).max(1440).nullable().optional(),
	defaultHourlyRate: z.number().min(0).nullable().optional(),
	defaultCurrency: z.string().min(1).max(10).nullable().optional(),
};

const createContractTemplateSchema = z.strictObject({
	name: z.string().min(1, "Template name is required").max(160),
	description: z.string().max(1000).nullable().optional(),
	...templateVersionFieldsShape,
});

const publishContractTemplateVersionSchema = z.strictObject({
	templateId: uuidSchema,
	name: z.string().min(1).max(160).optional(),
	description: z.string().max(1000).nullable().optional(),
	...templateVersionFieldsShape,
});

const commitEmployeeContractChangeSchema = z.strictObject({
	employeeId: uuidSchema,
	validFromDate: isoDateSchema,
	reviewState: z.enum(["confirmed", "draft", "pending"]).optional(),
	status: z.enum(["active", "inactive", "terminated", "leave"]).optional(),
	workPolicyId: uuidSchema.nullable().optional(),
	weeklyContractMinutes: z.number().int().min(0).max(10080).nullable().optional(),
	scheduleMode: scheduleModeSchema.nullable().optional(),
	customDays: customWorkDaysSchema.nullable().optional(),
	workModel: workModelSchema.nullable().optional(),
	presenceOverride: presenceOverrideSchema.nullable().optional(),
	balanceMode: balanceModeSchema.nullable().optional(),
	scheduleSource: scheduleSourceSchema.nullable().optional(),
	contractType: contractTypeSchema.optional(),
	hourlyRate: z.number().min(0).nullable().optional(),
	currency: z.string().min(1).max(10).optional(),
	employmentProfile: employmentProfileSchema.optional(),
	arbzgScope: arbzgScopeSchema.optional(),
	onCallHoursKind: onCallHoursKindSchema.nullable().optional(),
	onCallWeeklyMinutes: z.number().int().min(1).max(10080).nullable().optional(),
	onCallDailyMinutes: z.number().int().min(1).max(1440).nullable().optional(),
	probationStartsOn: z.date().nullable().optional(),
	probationEndsOn: z.date().nullable().optional(),
	changeReason: z.string().max(500).nullable().optional(),
	sourceTemplateVersionId: uuidSchema.nullable().optional(),
	clearPersonalPolicyPin: z.boolean().optional(),
});

function markOrgBalancesDirtyQuietly(organizationId: string) {
	return Effect.promise(async () => {
		try {
			await markOrganizationWorkBalancesDirty({ organizationId });
		} catch {
			// Post-commit balance refresh is best-effort.
		}
	});
}

function markEmployeeBalancesDirtyQuietly(
	organizationId: string,
	employeeId: string,
	dirtyFromDate: string,
) {
	return Effect.promise(async () => {
		try {
			await markEmployeeWorkBalanceDirty({ organizationId, employeeId, dirtyFromDate });
		} catch {
			// Post-commit balance refresh is best-effort.
		}
	});
}

function loadEmployeeInOrg(organizationId: string, employeeId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [row] = yield* dbService.query("contracts.findEmployee", () =>
			dbService.db
				.select({ id: employee.id })
				.from(employee)
				.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
				.limit(1),
		);
		if (!row) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee not found",
					entityType: "employee",
					entityId: employeeId,
				}),
			);
		}
		return row;
	});
}

function checkManagedEmployeeAccess(actor: OrganizationActor, employeeId: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		yield* refuseUnless(scope.organizationWide || scope.employeeIds.has(employeeId), {
			userId: actor.userId,
			message: "You can only assign work policies to employees you manage",
			resource: "work_policy_assignment",
			action: "create",
		});
	});
}

// ============================================
// ORG & PRIMARY TEAM DEFAULT CONTRACTS
// ============================================

export const getContractDefaultsAction = organizationAction(
	{
		name: "contracts.getDefaults",
		requires: "orgAdmin",
		schema: z
			.strictObject({
				scope: z.enum(["organization", "team"]).optional(),
				teamId: uuidSchema.optional(),
			})
			.optional(),
	},
	({ organizationId, input }) =>
		storeStep("contracts.getDefaults", (db) =>
			getContractDefaults(db, organizationId, input ?? {}),
		),
);

export const previewContractDefaultChangeAction = organizationAction(
	{
		name: "contracts.previewDefaultChange",
		requires: "orgAdmin",
		schema: scheduleContractDefaultSchema,
	},
	({ organizationId, input }) =>
		storeStep("contracts.previewDefaultChange", (db) =>
			previewContractDefaultChange(db, {
				organizationId,
				...input,
			}),
		),
);

export const scheduleContractDefaultAction = organizationAction(
	{
		name: "contracts.scheduleDefault",
		requires: "orgAdmin",
		schema: scheduleContractDefaultSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep("contracts.scheduleDefault", (db) =>
				scheduleContractDefault(db, {
					organizationId,
					actorUserId: actor.userId,
					...input,
				}),
			);
			yield* markOrgBalancesDirtyQuietly(organizationId);
			return result;
		}),
);

// ============================================
// IMMUTABLE STAMPING CONTRACT TEMPLATES
// ============================================

export const listContractTemplatesAction = organizationAction(
	{
		name: "contracts.listTemplates",
		requires: "orgAdmin",
		schema: z.strictObject({ includeInactive: z.boolean().optional() }).optional(),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listTemplates", (db) =>
			listContractTemplates(db, organizationId, input ?? {}),
		),
);

export const getContractTemplateAction = organizationAction(
	{
		name: "contracts.getTemplate",
		requires: "orgAdmin",
		schema: uuidSchema,
	},
	({ organizationId, input: templateId }) =>
		storeStep("contracts.getTemplate", (db) => getContractTemplate(db, organizationId, templateId)),
);

export const createContractTemplateAction = organizationAction(
	{
		name: "contracts.createTemplate",
		requires: "orgAdmin",
		schema: createContractTemplateSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.createTemplate", (db) =>
			createContractTemplate(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

export const publishContractTemplateVersionAction = organizationAction(
	{
		name: "contracts.publishTemplateVersion",
		requires: "orgAdmin",
		schema: publishContractTemplateVersionSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.publishTemplateVersion", (db) =>
			publishContractTemplateVersion(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

export const archiveContractTemplateAction = organizationAction(
	{
		name: "contracts.archiveTemplate",
		requires: "orgAdmin",
		schema: uuidSchema,
	},
	({ actor, organizationId, input: templateId }) =>
		storeStep("contracts.archiveTemplate", (db) =>
			archiveContractTemplate(db, {
				organizationId,
				templateId,
				actorUserId: actor.userId,
			}),
		),
);

export const previewTemplateApplicationAction = organizationAction(
	{
		name: "contracts.previewTemplateApplication",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			templateVersionId: uuidSchema,
			effectiveFromDate: isoDateSchema,
			preserveDivergences: z.boolean().optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.previewTemplateApplication", (db) =>
			previewTemplateApplication(db, {
				organizationId,
				...input,
			}),
		),
);

// ============================================
// EMPLOYEE CONTRACT RESOLUTION, DIVERGENCE & ADOPTION
// ============================================

export const getEmployeeEffectiveContractAction = organizationAction(
	{
		name: "contracts.getEmployeeEffectiveContract",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			asOfDate: isoDateSchema.optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.getEmployeeEffectiveContract", async (db) => {
			const date =
				input.asOfDate ??
				plainDateAt(
					systemClock.nowInstant(),
					await loadOrganizationTimezone(db, organizationId),
				).toString();
			return resolveEffectiveContractOnDay(db, {
				organizationId,
				employeeId: input.employeeId,
				date,
			});
		}),
);

export const previewEmployeeContractChangeAction = organizationAction(
	{
		name: "contracts.previewEmployeeChange",
		requires: "orgAdmin",
		schema: commitEmployeeContractChangeSchema,
	},
	({ organizationId, input }) =>
		storeStep("contracts.previewEmployeeChange", (db) =>
			previewEmployeeContractChange(db, {
				organizationId,
				...input,
			}),
		),
);

export const commitEmployeeContractChangeAction = organizationAction(
	{
		name: "contracts.commitEmployeeChange",
		requires: "orgAdmin",
		schema: commitEmployeeContractChangeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep("contracts.commitEmployeeChange", (db) =>
				commitContractChange(db, {
					organizationId,
					actorUserId: actor.userId,
					...input,
				}),
			);
			if (result.employmentHistory.reviewState === "confirmed") {
				yield* markEmployeeBalancesDirtyQuietly(
					organizationId,
					input.employeeId,
					result.employmentHistory.validFromDate,
				);
			}
			return result;
		}),
);

export const resetEmployeeContractDivergencesAction = organizationAction(
	{
		name: "contracts.resetEmployeeDivergences",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			effectiveFromDate: isoDateSchema,
			changeReason: z.string().max(500).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep("contracts.resetEmployeeDivergences", (db) =>
				resetEmployeeContractDivergences(db, {
					organizationId,
					actorUserId: actor.userId,
					...input,
				}),
			);
			yield* markEmployeeBalancesDirtyQuietly(
				organizationId,
				input.employeeId,
				result.employmentHistory.validFromDate,
			);
			return result;
		}),
);

export const adoptEmployeeContractDefaultAction = organizationAction(
	{
		name: "contracts.adoptEmployeeDefault",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			effectiveFromDate: isoDateSchema,
			changeReason: z.string().max(500).nullable().optional(),
			keepDivergenceFields: z
				.array(
					z.enum([
						"workPolicy",
						"weeklyContractMinutes",
						"scheduleMode",
						"workModel",
						"presenceOverride",
						"balanceMode",
						"scheduleSource",
					]),
				)
				.optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep("contracts.adoptEmployeeDefault", (db) =>
				adoptContractDefault(db, {
					organizationId,
					actorUserId: actor.userId,
					...input,
				}),
			);
			yield* markEmployeeBalancesDirtyQuietly(
				organizationId,
				input.employeeId,
				result.employmentHistory.validFromDate,
			);
			return result;
		}),
);

// ============================================
// FIXED-TERM AGREEMENT LINEAR CHAINS
// ============================================

export const listEmployeeTermAgreementsAction = organizationAction(
	{
		name: "contracts.listTermAgreements",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			employmentPeriodId: uuidSchema.optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listTermAgreements", (db) =>
			listEmploymentTermAgreements(db, {
				organizationId,
				...input,
			}),
		),
);

export const createInitialEmploymentAgreementAction = organizationAction(
	{
		name: "contracts.createInitialAgreement",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			employmentPeriodId: uuidSchema.nullable().optional(),
			kind: agreementKindSchema,
			startsOn: isoDateSchema,
			endsOn: isoDateSchema.nullable().optional(),
			reason: z.string().max(500).nullable().optional(),
			notes: z.string().max(2000).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.createInitialAgreement", (db) =>
			createInitialEmploymentAgreement(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

export const recordFixedTermExtensionAction = organizationAction(
	{
		name: "contracts.recordFixedTermExtension",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			employmentPeriodId: uuidSchema.nullable().optional(),
			kind: agreementKindSchema,
			startsOn: isoDateSchema,
			endsOn: isoDateSchema.nullable().optional(),
			reason: z.string().max(500).nullable().optional(),
			notes: z.string().max(2000).nullable().optional(),
			departureSyncAction: departureSyncActionSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.recordFixedTermExtension", (db) =>
			recordFixedTermExtension(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);

// ============================================
// SCOPED-MANAGER WAGE-FREE POLICY ASSIGNMENT (A1)
// ============================================

export const assignEmployeeWorkPolicyAction = organizationAction(
	{
		name: "contracts.assignEmployeeWorkPolicy",
		requires: "scopedManager",
		schema: z.strictObject({
			employeeId: uuidSchema,
			policyId: uuidSchema,
			effectiveFromDate: isoDateSchema.optional(),
		}),
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* loadEmployeeInOrg(organizationId, input.employeeId);
			yield* checkManagedEmployeeAccess(actor, input.employeeId);

			const actorIsOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			const result = yield* storeStep("contracts.assignEmployeeWorkPolicy", (db) =>
				assignEmployeeWorkPolicy(db, {
					organizationId,
					employeeId: input.employeeId,
					policyId: input.policyId,
					actorUserId: actor.userId,
					actorIsOrgAdmin,
					effectiveFromDate: input.effectiveFromDate,
				}),
			);
			yield* markEmployeeBalancesDirtyQuietly(
				organizationId,
				input.employeeId,
				result.effectiveFromDate,
			);
			return result;
		}),
);

// ============================================
// PRIMARY-TEAM MOVE OPERATIONAL PREVIEW
// ============================================

export const previewPrimaryTeamMoveAction = organizationAction(
	{
		name: "contracts.previewPrimaryTeamMove",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			targetTeamId: uuidSchema.nullable(),
			effectiveOnDate: isoDateSchema.optional(),
		}),
	},
	({ organizationId, input }) =>
		storeStep("contracts.previewPrimaryTeamMove", (db) =>
			previewPrimaryTeamMove(db, {
				organizationId,
				...input,
			}),
		),
);

// ============================================
// MIGRATION & CONTRACT CONFLICTS / REVIEWS
// ============================================

export const listContractMigrationConflictsAction = organizationAction(
	{
		name: "contracts.listMigrationConflicts",
		requires: "orgAdmin",
		schema: z
			.strictObject({
				status: z.enum(["open", "resolved", "dismissed"]).optional(),
				employeeId: uuidSchema.optional(),
			})
			.optional(),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listMigrationConflicts", (db) =>
			listContractMigrationConflicts(db, organizationId, input ?? {}),
		),
);

export const listContractsReviewQueueAction = organizationAction(
	{
		name: "contracts.listReviewQueue",
		requires: "orgAdmin",
		schema: z
			.strictObject({
				includeResolved: z.boolean().optional(),
			})
			.optional(),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listReviewQueue", (db) =>
			listContractsReviewQueue(db, organizationId, input ?? {}),
		),
);

export const resolveContractMigrationConflictAction = organizationAction(
	{
		name: "contracts.resolveMigrationConflict",
		requires: "orgAdmin",
		schema: z.strictObject({
			conflictId: uuidSchema,
			status: z.enum(["resolved", "dismissed"]),
			resolutionNote: z.string().max(1000).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.resolveMigrationConflict", (db) =>
			resolveContractMigrationConflict(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);
