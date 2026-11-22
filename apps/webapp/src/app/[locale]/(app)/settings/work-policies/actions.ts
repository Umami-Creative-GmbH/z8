"use server";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { employee, team, workPolicy, workPolicyPreset, workPolicyViolation } from "@/db/schema";
import type { TimeRegulationBreakRulesPreset } from "@/db/schema/types";
import {
	assignEmployeeWorkPolicy,
	closeManualWorkPolicyAssignment,
	resolveEffectiveContractOnDay,
	scheduleContractDefaultPolicyUpdate,
} from "@/lib/contracts";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { instantFromDate, plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { storeStep } from "@/lib/organization-action/store-step";
import { hasValidLatestClockIns } from "@/lib/scheduling/latest-clock-in";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { markOrganizationWorkBalancesDirty } from "@/lib/work-balance/service";
import {
	findWorkPolicyAssignmentInOrganization,
	listWorkPolicyAssignmentsForOrganization,
	loadWorkPoliciesWithLatestVersion,
	loadWorkPolicyWithLatestVersion,
	setOrganizationDefaultWorkPolicy,
	type WorkPolicyWithVersionDetails,
} from "@/lib/work-policy/policy-queries";
import {
	createVersionedWorkPolicy,
	duplicateVersionedWorkPolicy,
	lockContractDefaultsOrgExclusiveInTx,
	lockPolicyAssignmentsForRetirementInTx,
	type PublishWorkPolicyVersionResult,
	retirePolicyReferencesInTx,
	type SameDayReplacementWarning,
	updateOrPublishWorkPolicy,
} from "@/lib/work-policy/versioned-policy-writer";

export type { PublishWorkPolicyVersionResult, SameDayReplacementWarning };

// ============================================
// TYPES
// ============================================

export type WorkPolicyWithDetails = WorkPolicyWithVersionDetails;

export type WorkPolicyAssignmentWithDetails = Omit<
	Awaited<ReturnType<typeof listWorkPolicyAssignmentsForOrganization>>[number],
	"employee"
> & {
	policy: { id: string; name: string } | null;
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};

export type WorkPolicyViolationWithDetails = typeof workPolicyViolation.$inferSelect & {
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: {
			firstName: string | null;
			lastName: string | null;
			name?: string | null;
			email?: string | null;
		} | null;
	} | null;
	policy: { id: string; name: string } | null;
};

// ============================================
// INPUT SCHEMAS
// ============================================

const breakOptionSchema = z.object({
	splitCount: z.number().nullable(),
	minimumSplitMinutes: z.number().nullable(),
	minimumLongestSplitMinutes: z.number().nullable(),
});

const breakRuleSchema = z.object({
	workingMinutesThreshold: z.number(),
	requiredBreakMinutes: z.number(),
	options: z.array(breakOptionSchema),
});

const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

const scheduleDaySchema = z.object({
	dayOfWeek: dayOfWeekSchema,
	hoursPerDay: z.string(),
	isWorkDay: z.boolean(),
	cycleWeek: z.number().int().optional(),
	/** Latest clock-in (`HH:mm`, local wall-clock) on a work day; null or absent means none. */
	latestClockIn: z.string().nullish(),
});

const scheduleCycleSchema = z.enum(["daily", "weekly", "biweekly", "monthly", "yearly"]);
const workingDaysPresetSchema = z.enum(["weekdays", "weekends", "all_days", "custom"]);

const workPolicyFieldsSchema = z.object({
	name: z.string().trim().min(1, "Policy name is required"),
	description: z.string().optional(),
	scheduleEnabled: z.boolean(),
	regulationEnabled: z.boolean(),
	presenceEnabled: z.boolean(),

	// Presence fields (used when presenceEnabled = true)
	presence: z
		.object({
			presenceMode: z.enum(["minimum_count", "fixed_days"]),
			requiredOnsiteDays: z.number().int().optional(),
			requiredOnsiteFixedDays: z.array(z.string()).optional(),
			locationId: z.string().optional(),
			evaluationPeriod: z.enum(["weekly", "biweekly", "monthly"]).optional(),
			enforcement: z.enum(["block", "warn", "none"]).optional(),
		})
		.optional(),

	// Schedule fields (used when scheduleEnabled = true)
	schedule: z
		.object({
			scheduleCycle: scheduleCycleSchema,
			scheduleType: z.enum(["simple", "detailed"]),
			workingDaysPreset: workingDaysPresetSchema,
			hoursPerCycle: z.string().optional(),
			homeOfficeDaysPerCycle: z.number().int().optional(),
			days: z.array(scheduleDaySchema).optional(),
		})
		.optional(),

	// Regulation fields (used when regulationEnabled = true)
	regulation: z
		.object({
			maxDailyMinutes: z.number().int().min(1).max(1440).nullable().optional(),
			maxWeeklyMinutes: z.number().int().min(1).max(10080).nullable().optional(),
			maxUninterruptedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
			minRestPeriodMinutes: z.number().int().min(1).max(1440).nullable().optional(),
			restPeriodEnforcement: z.enum(["block", "warn", "none"]).nullable().optional(),
			overtimeDailyThresholdMinutes: z.number().int().min(1).max(1440).nullable().optional(),
			overtimeWeeklyThresholdMinutes: z.number().int().min(1).max(10080).nullable().optional(),
			overtimeMonthlyThresholdMinutes: z.number().int().min(1).max(44640).nullable().optional(),
			alertBeforeLimitMinutes: z.number().int().min(0).max(1440).nullable().optional(),
			alertThresholdPercent: z.number().int().min(1).max(100).nullable().optional(),
			breakRules: z.array(breakRuleSchema),
		})
		.optional(),
});

const effectiveFromDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Effective date must use YYYY-MM-DD format")
	.optional();

const updateWorkPolicySchema = z.object({
	policyId: z.string().min(1),
	data: workPolicyFieldsSchema.partial().extend({
		isActive: z.boolean().optional(),
		effectiveFromDate: effectiveFromDateSchema,
	}),
});

const publishWorkPolicyVersionSchema = z.object({
	policyId: z.string().min(1),
	effectiveFromDate: effectiveFromDateSchema,
	data: workPolicyFieldsSchema.partial().extend({
		isActive: z.boolean().optional(),
	}),
});

const workPolicyPresetInputSchema = z.object({
	name: z.string().trim().min(1, "Preset name is required"),
	description: z.string().optional(),
	countryCode: z.string().nullish(),
	scheduleEnabled: z.boolean(),
	regulationEnabled: z.boolean(),
	schedule: z
		.object({
			scheduleCycle: scheduleCycleSchema.optional(),
			workingDaysPreset: workingDaysPresetSchema.optional(),
			hoursPerCycle: z.string().optional(),
		})
		.optional(),
	regulation: z
		.object({
			maxDailyMinutes: z.number().optional(),
			maxWeeklyMinutes: z.number().optional(),
			maxUninterruptedMinutes: z.number().optional(),
			breakRules: z.array(breakRuleSchema, "Preset break rules are malformed").optional(),
		})
		.optional(),
});

const presetWithInputSchema = z.object({
	presetId: z.string().min(1),
	input: workPolicyPresetInputSchema,
});

const createWorkPolicyAssignmentSchema = z
	.object({
		policyId: z.string().min(1),
		assignmentType: z.enum(["organization", "team", "employee"]),
		teamId: z.string().optional(),
		employeeId: z.string().optional(),
	})
	.superRefine((input, context) => {
		const issue = (message: string, field: "teamId" | "employeeId") =>
			context.addIssue({ code: "custom", message, path: [field] });
		if (input.assignmentType === "organization") {
			if (input.teamId || input.employeeId) {
				issue(
					"Organization assignments cannot target teams or employees",
					input.teamId ? "teamId" : "employeeId",
				);
			}
		} else if (input.assignmentType === "team") {
			if (!input.teamId) issue("Team assignments require a teamId", "teamId");
			else if (input.employeeId) issue("Team assignments cannot target an employee", "employeeId");
		} else if (!input.employeeId) {
			issue("Employee assignments require an employeeId", "employeeId");
		} else if (input.teamId) {
			issue("Employee assignments cannot target a team", "teamId");
		}
	});

const idSchema = z.string().min(1);

// Form input types
export type BreakOptionInput = z.input<typeof breakOptionSchema>;
export type BreakRuleInput = z.input<typeof breakRuleSchema>;
export type ScheduleDayInput = z.input<typeof scheduleDaySchema>;
export type CreateWorkPolicyInput = z.input<typeof workPolicyFieldsSchema>;
export type UpdateWorkPolicyInput = Partial<CreateWorkPolicyInput>;
export type WorkPolicyPresetInput = z.input<typeof workPolicyPresetInputSchema>;
type ParsedWorkPolicy = z.output<typeof workPolicyFieldsSchema>;
type ParsedWorkPolicyPreset = z.output<typeof workPolicyPresetInputSchema>;

export type WorkPolicyPresetWithSource = typeof workPolicyPreset.$inferSelect & {
	source: "system" | "custom";
	sourceLabel: "System" | "Custom";
};

function policyNotFound(policyId?: string, message = "Policy not found") {
	return Effect.fail(new NotFoundError({ message, entityType: "work_policy", entityId: policyId }));
}

function presetNotFound(presetId: string) {
	return Effect.fail(
		new NotFoundError({
			message: "Preset not found",
			entityType: "work_policy_preset",
			entityId: presetId,
		}),
	);
}

function markWorkBalancesDirty(organizationId: string) {
	return Effect.promise(() => markOrganizationWorkBalancesDirty({ organizationId }));
}

function findPolicyWithDetails(policyId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("workPolicies.findWithDetails", () =>
			loadWorkPolicyWithLatestVersion(dbService.db, organizationId, policyId),
		);
	});
}

// ============================================
// GET POLICIES
// ============================================

export const getWorkPolicies = organizationAction(
	{ name: "workPolicies.list", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getWorkPolicies", () =>
				loadWorkPoliciesWithLatestVersion(dbService.db, organizationId),
			);
		}),
);

export const getWorkPolicy = organizationAction(
	{ name: "workPolicies.get", requires: "scopedManager", schema: idSchema },
	({ organizationId, input: policyId }) => findPolicyWithDetails(policyId, organizationId),
);

/** Fails unless every work day's latest clock-in is blank or a `HH:mm` time. */
function validateLatestClockIns(days: ScheduleDayInput[] | undefined) {
	return days && !hasValidLatestClockIns(days)
		? Effect.fail(
				new ValidationError({
					message: "Latest clock-in must be a time between 00:00 and 23:59",
					field: "schedule.days.latestClockIn",
				}),
			)
		: Effect.void;
}

/** Creates a policy in the organization; shared by the policy and preset actions. */
function createPolicyIn(organizationId: string, userId: string, data: ParsedWorkPolicy) {
	return Effect.gen(function* () {
		// Validate at least one feature is enabled
		if (!data.scheduleEnabled && !data.regulationEnabled && !data.presenceEnabled) {
			return yield* Effect.fail(
				new ValidationError({
					message: "At least one feature (schedule, regulation, or presence) must be enabled",
					field: "scheduleEnabled",
				}),
			);
		}
		yield* validateLatestClockIns(data.schedule?.days);

		const created = yield* storeStep("workPolicies.create", (db) =>
			createVersionedWorkPolicy(db, {
				organizationId,
				actorUserId: userId,
				data,
			}),
		);

		yield* markWorkBalancesDirty(organizationId);

		return created.policy as WorkPolicyWithDetails;
	});
}

/** Makes a policy of the organization its default via canonical org assignment (never mutates work_policy.is_default). */
function setDefaultPolicyIn(organizationId: string, userId: string, policyId: string) {
	return Effect.gen(function* () {
		yield* storeStep("workPolicies.setDefault", (db) =>
			setOrganizationDefaultWorkPolicy(db, {
				organizationId,
				actorUserId: userId,
				policyId,
			}),
		);

		yield* markWorkBalancesDirty(organizationId);
	});
}

// ============================================
// CREATE POLICY
// ============================================

export const createWorkPolicy = organizationAction(
	{ name: "workPolicies.create", requires: "orgAdmin", schema: workPolicyFieldsSchema },
	({ actor, organizationId, input }) => createPolicyIn(organizationId, actor.userId, input),
);

// ============================================
// UPDATE POLICY
// ============================================

export const updateWorkPolicy = organizationAction(
	{ name: "workPolicies.update", requires: "orgAdmin", schema: updateWorkPolicySchema },
	({ actor, organizationId, input: { policyId, data } }) =>
		Effect.gen(function* () {
			const shouldDirtyWorkBalances =
				data.scheduleEnabled !== undefined || data.schedule !== undefined;

			const result = yield* storeStep("workPolicies.update", (db) =>
				updateOrPublishWorkPolicy(db, {
					organizationId,
					actorUserId: actor.userId,
					policyId,
					data,
				}),
			);

			if (shouldDirtyWorkBalances) {
				yield* markWorkBalancesDirty(organizationId);
			}

			return result.policy as WorkPolicyWithDetails;
		}),
);

/**
 * Publishes an effective-dated immutable work policy version (post-cutover) or updates
 * unsealed v1 (pre-cutover), returning version metadata and any same-day replacement warning.
 */
export const publishWorkPolicyVersion = organizationAction(
	{
		name: "workPolicies.publishVersion",
		requires: "orgAdmin",
		schema: publishWorkPolicyVersionSchema,
	},
	({ actor, organizationId, input: { policyId, effectiveFromDate, data } }) =>
		Effect.gen(function* () {
			const result = yield* storeStep("workPolicies.publishVersion", (db) =>
				updateOrPublishWorkPolicy(db, {
					organizationId,
					actorUserId: actor.userId,
					policyId,
					data: { ...data, effectiveFromDate },
					forceNewVersion: true,
				}),
			);

			if (data.scheduleEnabled !== undefined || data.schedule !== undefined) {
				yield* markWorkBalancesDirty(organizationId);
			}

			return result;
		}),
);

// ============================================
// DELETE POLICY
// ============================================

export const deleteWorkPolicy = organizationAction(
	{ name: "workPolicies.delete", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: policyId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const existingPolicy = yield* dbService.query("getExisting", () =>
				dbService.db.query.workPolicy.findFirst({
					where: and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)),
				}),
			);

			if (!existingPolicy) {
				return yield* policyNotFound(policyId);
			}

			yield* dbService.query("softDelete", async () => {
				const orgTimezone = await loadOrganizationTimezone(dbService.db, organizationId);
				const now = currentTimestamp();
				const orgTodayDate = plainDateAt(instantFromDate(now), orgTimezone).toString();

				await dbService.db.transaction(async (tx) => {
					await lockContractDefaultsOrgExclusiveInTx(tx, organizationId);
					await lockPolicyAssignmentsForRetirementInTx(tx, organizationId, policyId);
					await tx
						.update(workPolicy)
						.set({
							isActive: false,
							updatedBy: actor.userId,
							updatedAt: now,
						})
						.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));

					await retirePolicyReferencesInTx(tx, {
						organizationId,
						policyId,
						actorUserId: actor.userId,
						orgTodayDate,
						orgTimezone,
						now,
					});
				});
			});

			yield* markWorkBalancesDirty(organizationId);
		}),
);

// ============================================
// ASSIGNMENTS
// ============================================

/**
 * Fails unless the actor may set the policy of this employee: an org admin may
 * set anyone's, a scoped manager only their reports'.
 */
function refuseUnlessManaged(actor: OrganizationActor, employeeId: string, action: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		if (scope.organizationWide || scope.employeeIds.has(employeeId)) return;
		return yield* Effect.fail(
			new AuthorizationError({
				message: "Insufficient permissions",
				userId: actor.userId,
				resource: "work_policy_assignment",
				action,
			}),
		);
	});
}

function findEmployeeInOrganization(employeeId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [row] = yield* dbService.query("workPolicies.findEmployee", () =>
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
	});
}

export const getWorkPolicyAssignments = organizationAction(
	{ name: "workPolicies.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService.query("getWorkPolicyAssignments", () =>
				listWorkPolicyAssignmentsForOrganization(dbService.db, organizationId),
			);

			const typedAssignments = assignments.map((assignment) => ({
				...assignment,
				employee: assignment.employee
					? {
							id: assignment.employee.id,
							firstName: assignment.employee.user?.firstName ?? null,
							lastName: assignment.employee.user?.lastName ?? null,
							user: assignment.employee.user,
						}
					: null,
			})) satisfies WorkPolicyAssignmentWithDetails[];

			if (scope.organizationWide) {
				return typedAssignments;
			}

			return typedAssignments.filter(
				(assignment) =>
					assignment.assignmentType === "employee" &&
					assignment.employeeId !== null &&
					scope.employeeIds.has(assignment.employeeId),
			);
		}),
);

/**
 * A scoped manager may assign a policy to their own reports; organization and
 * team assignments need an org admin.
 */
export const createWorkPolicyAssignment = organizationAction(
	{
		name: "workPolicies.createAssignment",
		requires: "scopedManager",
		schema: createWorkPolicyAssignmentSchema,
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			if (data.assignmentType !== "employee") {
				yield* actor.require("orgAdmin");
			}

			if (data.employeeId) {
				yield* findEmployeeInOrganization(data.employeeId, organizationId);
				yield* refuseUnlessManaged(actor, data.employeeId, "create");
			}

			const dbService = yield* DatabaseService;
			const teamId = data.teamId;
			if (data.assignmentType === "team" && teamId) {
				const assignedTeam = yield* dbService.query("workPolicies.findTeam", () =>
					dbService.db.query.team.findFirst({
						where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
						columns: { id: true },
					}),
				);
				if (!assignedTeam) {
					return yield* Effect.fail(
						new NotFoundError({ message: "Team not found", entityType: "team", entityId: teamId }),
					);
				}
			}

			const policy = yield* dbService.query("getAssignmentPolicy", () =>
				dbService.db.query.workPolicy.findFirst({
					where: and(
						eq(workPolicy.id, data.policyId),
						eq(workPolicy.organizationId, organizationId),
					),
					columns: { id: true },
				}),
			);
			if (!policy) {
				return yield* policyNotFound(data.policyId);
			}

			const actorIsOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			const assignmentId = yield* storeStep("workPolicies.createAssignment", async (db) => {
				if (data.assignmentType === "employee" && data.employeeId) {
					const result = await assignEmployeeWorkPolicy(db, {
						organizationId,
						employeeId: data.employeeId,
						policyId: data.policyId,
						actorUserId: actor.userId,
						actorIsOrgAdmin,
					});
					return result.assignmentId;
				}

				const orgTz = await loadOrganizationTimezone(db, organizationId);
				const today = plainDateAt(systemClock.nowInstant(), orgTz).toString();
				const result = await scheduleContractDefaultPolicyUpdate(db, {
					organizationId,
					actorUserId: actor.userId,
					scope: data.assignmentType === "team" ? "team" : "organization",
					teamId: data.assignmentType === "team" ? (data.teamId ?? null) : null,
					effectiveFromDate: today,
					workPolicyId: data.policyId,
				});
				return result.workPolicyAssignmentId ?? result.contractDefaultId;
			});

			yield* markWorkBalancesDirty(organizationId);

			return { id: assignmentId };
		}),
);

export const deleteWorkPolicyAssignment = organizationAction(
	{ name: "workPolicies.deleteAssignment", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* dbService.query("getExistingAssignment", () =>
				findWorkPolicyAssignmentInOrganization(dbService.db, organizationId, assignmentId),
			);
			if (!assignment) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Work policy assignment not found",
						entityType: "work_policy_assignment",
						entityId: assignmentId,
					}),
				);
			}

			if (assignment.assignmentType !== "employee") {
				yield* actor.require("orgAdmin");
			}
			if (assignment.employeeId) {
				yield* refuseUnlessManaged(actor, assignment.employeeId, "delete");
			}

			const actorIsOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			yield* storeStep("workPolicies.deleteAssignment", (db) =>
				closeManualWorkPolicyAssignment(db, {
					organizationId,
					assignmentId,
					actorIsOrgAdmin,
				}),
			);

			yield* markWorkBalancesDirty(organizationId);
		}),
);

// ============================================
// PRESETS
// ============================================

function normalizePresetName(name: string) {
	return name.trim();
}

function validationError(message: string, field: string) {
	return new ValidationError({ message, field });
}

const persistedBreakRulesSchema = z.object({ rules: z.array(breakRuleSchema) });

function parsePresetBreakRulesStrict(value: unknown): BreakRuleInput[] {
	if (!value) return [];

	let parsed: unknown;
	try {
		parsed = typeof value === "string" ? JSON.parse(value) : value;
	} catch {
		throw validationError("Preset break rules are malformed", "breakRulesJson");
	}

	const result = persistedBreakRulesSchema.safeParse(parsed);
	if (!result.success) {
		throw validationError("Preset break rules are malformed", "breakRulesJson");
	}

	return result.data.rules;
}

function validatePersistedPresetBreakRules(value: unknown) {
	return Effect.try({
		try: () => {
			parsePresetBreakRulesStrict(value);
		},
		catch: (error) =>
			error instanceof ValidationError
				? error
				: validationError("Preset break rules are malformed", "breakRulesJson"),
	});
}

function stringifyPresetBreakRules(input: ParsedWorkPolicyPreset) {
	const rules = input.regulationEnabled ? (input.regulation?.breakRules ?? []) : [];
	return JSON.stringify({ rules }) as unknown as TimeRegulationBreakRulesPreset;
}

function presetInputToPolicyInput(input: ParsedWorkPolicyPreset): ParsedWorkPolicy {
	return {
		name: normalizePresetName(input.name),
		description: input.description?.trim() || undefined,
		scheduleEnabled: input.scheduleEnabled,
		regulationEnabled: input.regulationEnabled,
		presenceEnabled: false,
		schedule: input.scheduleEnabled
			? {
					scheduleCycle: input.schedule?.scheduleCycle ?? "weekly",
					scheduleType: "simple",
					workingDaysPreset: input.schedule?.workingDaysPreset ?? "weekdays",
					hoursPerCycle: input.schedule?.hoursPerCycle ?? "40",
					homeOfficeDaysPerCycle: 0,
				}
			: undefined,
		regulation: input.regulationEnabled
			? {
					maxDailyMinutes: input.regulation?.maxDailyMinutes,
					maxWeeklyMinutes: input.regulation?.maxWeeklyMinutes,
					maxUninterruptedMinutes: input.regulation?.maxUninterruptedMinutes,
					breakRules: input.regulation?.breakRules ?? [],
				}
			: undefined,
	};
}

function presetToInput(preset: typeof workPolicyPreset.$inferSelect): ParsedWorkPolicyPreset {
	const breakRules = parsePresetBreakRulesStrict(preset.breakRulesJson);

	return {
		name: preset.name,
		description: preset.description ?? undefined,
		countryCode: preset.countryCode,
		scheduleEnabled: Boolean(
			preset.scheduleCycle || preset.workingDaysPreset || preset.hoursPerCycle,
		),
		regulationEnabled: Boolean(
			preset.maxDailyMinutes ||
			preset.maxWeeklyMinutes ||
			preset.maxUninterruptedMinutes ||
			breakRules.length,
		),
		schedule: {
			scheduleCycle: preset.scheduleCycle ?? "weekly",
			workingDaysPreset: preset.workingDaysPreset ?? "weekdays",
			hoursPerCycle: preset.hoursPerCycle ?? "40",
		},
		regulation: {
			maxDailyMinutes: preset.maxDailyMinutes ?? undefined,
			maxWeeklyMinutes: preset.maxWeeklyMinutes ?? undefined,
			maxUninterruptedMinutes: preset.maxUninterruptedMinutes ?? undefined,
			breakRules,
		},
	};
}

function presetInputToBaseValues(input: ParsedWorkPolicyPreset) {
	return {
		name: normalizePresetName(input.name),
		description: input.description?.trim() || null,
		countryCode: input.countryCode ?? null,
		scheduleCycle: input.scheduleEnabled ? (input.schedule?.scheduleCycle ?? "weekly") : null,
		workingDaysPreset: input.scheduleEnabled
			? (input.schedule?.workingDaysPreset ?? "weekdays")
			: null,
		hoursPerCycle: input.scheduleEnabled ? (input.schedule?.hoursPerCycle ?? "40") : null,
		maxDailyMinutes: input.regulationEnabled ? input.regulation?.maxDailyMinutes : null,
		maxWeeklyMinutes: input.regulationEnabled ? input.regulation?.maxWeeklyMinutes : null,
		maxUninterruptedMinutes: input.regulationEnabled
			? input.regulation?.maxUninterruptedMinutes
			: null,
		breakRulesJson: stringifyPresetBreakRules(input),
	};
}

function presetInputToInsertValues(organizationId: string, input: ParsedWorkPolicyPreset) {
	return {
		organizationId,
		...presetInputToBaseValues(input),
		isActive: true,
	};
}

/** Fails when the organization already has a preset of this name, archived ones included. */
function refuseDuplicatePresetName(organizationId: string, name: string, presetId?: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const duplicate = yield* dbService.query("checkDuplicatePreset", () =>
			dbService.db.query.workPolicyPreset.findFirst({
				where: and(
					eq(workPolicyPreset.organizationId, organizationId),
					eq(workPolicyPreset.name, normalizePresetName(name)),
				),
			}),
		);

		if (duplicate && duplicate.id !== presetId) {
			return yield* Effect.fail(
				new ConflictError({
					message: "A preset with this name already exists",
					conflictType: "duplicate_name",
					details: { entityType: "work_policy_preset", field: "name" },
				}),
			);
		}
	});
}

/** An active preset the organization may use: a system preset or its own. */
function findUsablePreset(presetId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const preset = yield* dbService.query("getVisibleWorkPolicyPreset", () =>
			dbService.db.query.workPolicyPreset.findFirst({
				where: and(
					eq(workPolicyPreset.id, presetId),
					eq(workPolicyPreset.isActive, true),
					or(
						isNull(workPolicyPreset.organizationId),
						eq(workPolicyPreset.organizationId, organizationId),
					),
				),
			}),
		);
		if (!preset?.isActive || (preset.organizationId && preset.organizationId !== organizationId)) {
			return yield* presetNotFound(presetId);
		}
		return preset;
	});
}

function createPolicyFromPresetIn(
	organizationId: string,
	userId: string,
	input: ParsedWorkPolicyPreset,
	setAsDefault: boolean,
) {
	return Effect.gen(function* () {
		const policy = yield* createPolicyIn(organizationId, userId, presetInputToPolicyInput(input));
		if (setAsDefault) {
			yield* setDefaultPolicyIn(organizationId, userId, policy.id);
		}
		return policy;
	});
}

export const getWorkPolicyPresets = organizationAction(
	{ name: "workPolicies.listPresets", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const presets = yield* dbService.query("getWorkPolicyPresets", () =>
				dbService.db.query.workPolicyPreset.findMany({
					where: and(
						eq(workPolicyPreset.isActive, true),
						or(
							isNull(workPolicyPreset.organizationId),
							eq(workPolicyPreset.organizationId, organizationId),
						),
					),
					orderBy: [workPolicyPreset.name],
				}),
			);

			return presets.map((preset) => ({
				...preset,
				source: preset.organizationId ? "custom" : "system",
				sourceLabel: preset.organizationId ? "Custom" : "System",
			})) satisfies WorkPolicyPresetWithSource[];
		}),
);

// ============================================
// VIOLATIONS
// ============================================

export const getWorkPolicyViolations = organizationAction(
	{
		name: "workPolicies.listViolations",
		requires: "orgAdmin",
		schema: z.strictObject({ startDate: z.date(), endDate: z.date() }),
	},
	({ organizationId, input: { startDate, endDate } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const violations = yield* dbService.query("getWorkPolicyViolations", () =>
				dbService.db.query.workPolicyViolation.findMany({
					where: and(
						eq(workPolicyViolation.organizationId, organizationId),
						gte(workPolicyViolation.violationDate, startDate),
						lte(workPolicyViolation.violationDate, endDate),
					),
					with: {
						employee: {
							columns: { id: true },
							with: {
								user: { columns: { firstName: true, lastName: true, name: true, email: true } },
							},
						},
						policy: {
							columns: { id: true, name: true },
						},
					},
					orderBy: [desc(workPolicyViolation.violationDate)],
				}),
			);

			return violations.map((violation) => ({
				...violation,
				employee: violation.employee
					? {
							id: violation.employee.id,
							firstName: violation.employee.user?.firstName ?? null,
							lastName: violation.employee.user?.lastName ?? null,
							user: violation.employee.user,
						}
					: null,
			})) satisfies WorkPolicyViolationWithDetails[];
		}),
);

export const acknowledgeWorkPolicyViolation = organizationAction(
	{
		name: "workPolicies.acknowledgeViolation",
		requires: "orgAdmin",
		schema: z.strictObject({ violationId: z.string().min(1), note: z.string().optional() }),
	},
	({ actor, organizationId, input: { violationId, note } }) =>
		Effect.gen(function* () {
			// The acknowledgement names the employee who acknowledged it.
			const acknowledgedBy = actor.employee?.id;
			if (!acknowledgedBy) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: actor.userId,
					}),
				);
			}

			const dbService = yield* DatabaseService;
			yield* dbService.query("acknowledgeViolation", async () => {
				await dbService.db
					.update(workPolicyViolation)
					.set({
						acknowledgedBy,
						acknowledgedAt: new Date(),
						acknowledgedNote: note,
					})
					.where(
						and(
							eq(workPolicyViolation.id, violationId),
							eq(workPolicyViolation.organizationId, organizationId),
						),
					);
			});
		}),
);

// ============================================
// SET DEFAULT
// ============================================

export const setDefaultWorkPolicy = organizationAction(
	{ name: "workPolicies.setDefault", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: policyId }) =>
		setDefaultPolicyIn(organizationId, actor.userId, policyId),
);

export const createWorkPolicyPreset = organizationAction(
	{ name: "workPolicies.createPreset", requires: "orgAdmin", schema: workPolicyPresetInputSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			yield* refuseDuplicatePresetName(organizationId, input.name);

			const dbService = yield* DatabaseService;
			const [createdPreset] = yield* dbService.query("createWorkPolicyPreset", () =>
				dbService.db
					.insert(workPolicyPreset)
					.values(presetInputToInsertValues(organizationId, input))
					.returning(),
			);

			return createdPreset;
		}),
);

export const updateWorkPolicyPreset = organizationAction(
	{ name: "workPolicies.updatePreset", requires: "orgAdmin", schema: presetWithInputSchema },
	({ organizationId, input: { presetId, input } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const preset = yield* dbService.query("getWorkPolicyPreset", () =>
				dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.organizationId, organizationId),
						eq(workPolicyPreset.isActive, true),
					),
				}),
			);

			if (!preset || preset.organizationId !== organizationId) {
				return yield* presetNotFound(presetId);
			}

			yield* refuseDuplicatePresetName(organizationId, input.name, presetId);

			yield* dbService.query("updateWorkPolicyPreset", async () => {
				await dbService.db
					.update(workPolicyPreset)
					.set(presetInputToBaseValues(input))
					.where(
						and(
							eq(workPolicyPreset.id, presetId),
							eq(workPolicyPreset.organizationId, organizationId),
							eq(workPolicyPreset.isActive, true),
						),
					);
			});
		}),
);

export const archiveWorkPolicyPreset = organizationAction(
	{ name: "workPolicies.archivePreset", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: presetId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const preset = yield* dbService.query("getWorkPolicyPreset", () =>
				dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.organizationId, organizationId),
					),
				}),
			);

			if (!preset) {
				return yield* presetNotFound(presetId);
			}

			if (preset.organizationId === null) {
				return yield* Effect.fail(
					new ValidationError({
						message: "System presets cannot be archived",
						field: "presetId",
					}),
				);
			}

			if (preset.organizationId !== organizationId) {
				return yield* presetNotFound(presetId);
			}

			yield* dbService.query("archiveWorkPolicyPreset", async () => {
				await dbService.db
					.update(workPolicyPreset)
					.set({ isActive: false })
					.where(
						and(
							eq(workPolicyPreset.id, presetId),
							eq(workPolicyPreset.organizationId, organizationId),
						),
					);
			});
		}),
);

export const copySystemWorkPolicyPreset = organizationAction(
	{ name: "workPolicies.copySystemPreset", requires: "orgAdmin", schema: presetWithInputSchema },
	({ organizationId, input: { presetId, input } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const sourcePreset = yield* dbService.query("getSystemWorkPolicyPreset", () =>
				dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						isNull(workPolicyPreset.organizationId),
						eq(workPolicyPreset.isActive, true),
					),
				}),
			);

			if (!sourcePreset || sourcePreset.organizationId !== null || !sourcePreset.isActive) {
				return yield* presetNotFound(presetId);
			}

			yield* refuseDuplicatePresetName(organizationId, input.name);

			const [createdPreset] = yield* dbService.query("copySystemWorkPolicyPreset", () =>
				dbService.db
					.insert(workPolicyPreset)
					.values(presetInputToInsertValues(organizationId, input))
					.returning(),
			);

			return createdPreset;
		}),
);

export const createWorkPolicyFromPreset = organizationAction(
	{
		name: "workPolicies.createFromPreset",
		requires: "orgAdmin",
		schema: presetWithInputSchema.extend({ setAsDefault: z.boolean().optional() }),
	},
	({ actor, organizationId, input: { presetId, input, setAsDefault } }) =>
		Effect.gen(function* () {
			const preset = yield* findUsablePreset(presetId, organizationId);
			yield* validatePersistedPresetBreakRules(preset.breakRulesJson);
			return yield* createPolicyFromPresetIn(
				organizationId,
				actor.userId,
				input,
				setAsDefault ?? false,
			);
		}),
);

/** Creates a policy from a preset as it is stored, for the preset import UI. */
export const importWorkPolicyPreset = organizationAction(
	{
		name: "workPolicies.importPreset",
		requires: "orgAdmin",
		schema: z.strictObject({ presetId: z.string().min(1), setAsDefault: z.boolean().optional() }),
	},
	({ actor, organizationId, input: { presetId, setAsDefault } }) =>
		Effect.gen(function* () {
			const preset = yield* findUsablePreset(presetId, organizationId);
			const presetInput = yield* Effect.try({
				try: () => presetToInput(preset),
				catch: (error) =>
					error instanceof ValidationError
						? error
						: validationError("Preset break rules are malformed", "breakRulesJson"),
			});
			if (!normalizePresetName(presetInput.name)) {
				return yield* Effect.fail(validationError("Preset name is required", "name"));
			}
			return yield* createPolicyFromPresetIn(
				organizationId,
				actor.userId,
				presetInput,
				setAsDefault ?? false,
			);
		}),
);

// ============================================
// EMPLOYEE POLICY DETAILS
// ============================================

interface ScheduleDayDetail {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek?: number | null;
}

export interface EmployeeScheduleDetails {
	policyName: string;
	assignedVia: string;
	scheduleCycle?: string;
	scheduleType?: string;
	hoursPerCycle?: string;
	homeOfficeDaysPerCycle?: number;
	days?: ScheduleDayDetail[];
}

export const getEmployeeEffectiveScheduleDetails = organizationAction(
	{ name: "workPolicies.employeeScheduleDetails", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const emp = yield* dbService.query("getEmployee", () =>
				dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
					columns: { id: true },
				}),
			);

			if (!emp) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				);
			}

			const scope = yield* actor.managedScope();
			if (!scope.organizationWide && !scope.employeeIds.has(employeeId)) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.userId,
						resource: "employee_schedule_details",
						action: "read",
					}),
				);
			}

			const contract = yield* dbService.query("resolveEmployeeScheduleDetails", async () => {
				const orgTimezone = await loadOrganizationTimezone(dbService.db, organizationId);
				const today = plainDateAt(systemClock.nowInstant(), orgTimezone);
				return resolveEffectiveContractOnDay(dbService.db, {
					organizationId,
					employeeId,
					date: today,
				});
			});

			if (!contract) return null;

			if (contract.scheduleMode === "custom_days" || contract.scheduleMode === "hours_only") {
				const weeklyMinutes = contract.weeklyScheduleDays.reduce(
					(sum, d) => sum + (d.isWorkDay ? d.minutesPerDay : 0),
					0,
				);
				return {
					policyName: contract.workPolicy?.policyName ?? "Contract schedule",
					assignedVia: contract.workPolicy?.assignedVia ?? "Contract",
					scheduleCycle: "weekly",
					scheduleType: contract.scheduleMode === "custom_days" ? "detailed" : "simple",
					hoursPerCycle: (weeklyMinutes / 60).toFixed(2),
					days: contract.weeklyScheduleDays.map((d) => ({
						dayOfWeek: d.dayOfWeek,
						hoursPerDay: (d.minutesPerDay / 60).toFixed(2),
						isWorkDay: d.isWorkDay,
						cycleWeek: d.cycleWeek,
					})),
				} satisfies EmployeeScheduleDetails;
			}

			const resolvedPolicy = contract.workPolicy;
			if (!resolvedPolicy?.scheduleEnabled || !resolvedPolicy.schedule) {
				return null;
			}

			return {
				policyName: resolvedPolicy.policyName,
				assignedVia: resolvedPolicy.assignedVia,
				scheduleCycle: resolvedPolicy.schedule.scheduleCycle,
				scheduleType: resolvedPolicy.schedule.scheduleType,
				hoursPerCycle: resolvedPolicy.schedule.hoursPerCycle ?? undefined,
				homeOfficeDaysPerCycle: resolvedPolicy.schedule.homeOfficeDaysPerCycle,
				days: resolvedPolicy.schedule.days.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					hoursPerDay: d.hoursPerDay,
					isWorkDay: d.isWorkDay,
					cycleWeek: d.cycleWeek,
				})),
			} satisfies EmployeeScheduleDetails;
		}),
);

// ============================================
// HELPER ACTIONS FOR ASSIGNMENT DIALOG
// ============================================

export const getTeamsForAssignment = organizationAction(
	{ name: "workPolicies.assignmentTeams", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;
			const teams = yield* dbService.query("getTeamsForAssignment", () =>
				dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: (t, { asc }) => [asc(t.name)],
				}),
			);

			return scope.organizationWide
				? teams
				: teams.filter((teamRecord) => scope.teamIds.has(teamRecord.id));
		}),
);

export const getEmployeesForAssignment = organizationAction(
	{ name: "workPolicies.assignmentEmployees", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;
			const employees = yield* dbService.query("getEmployeesForAssignment", async () => {
				const rows = await dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					columns: { id: true, employeeNumber: true },
					with: { user: { columns: { firstName: true, lastName: true } } },
					orderBy: (employeeRecord, { asc }) => [asc(employeeRecord.id)],
				});

				return rows.map((employeeRecord) => ({
					id: employeeRecord.id,
					firstName: employeeRecord.user?.firstName ?? null,
					lastName: employeeRecord.user?.lastName ?? null,
					employeeNumber: employeeRecord.employeeNumber,
				}));
			});

			return scope.organizationWide
				? employees
				: employees.filter((employeeRecord) => scope.employeeIds.has(employeeRecord.id));
		}),
);

// ============================================
// DUPLICATE POLICY
// ============================================

export const duplicateWorkPolicy = organizationAction(
	{ name: "workPolicies.duplicate", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: policyId }) =>
		storeStep("workPolicies.duplicate", async (db) => {
			const duplicated = await duplicateVersionedWorkPolicy(db, {
				organizationId,
				actorUserId: actor.userId,
				policyId,
			});
			return duplicated.policy as WorkPolicyWithDetails;
		}),
);
