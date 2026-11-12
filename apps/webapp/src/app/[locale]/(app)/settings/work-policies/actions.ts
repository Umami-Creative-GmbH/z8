"use server";

import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
	employee,
	team,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,
	workPolicyPreset,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyViolation,
} from "@/db/schema";
import type { TimeRegulationBreakRulesPreset } from "@/db/schema/types";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
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
import { hasValidLatestClockIns, latestClockInForDay } from "@/lib/scheduling/latest-clock-in";
import { markOrganizationWorkBalancesDirty } from "@/lib/work-balance/service";

// ============================================
// TYPES
// ============================================

export type WorkPolicyWithDetails = typeof workPolicy.$inferSelect & {
	schedule:
		| (typeof workPolicySchedule.$inferSelect & {
				days: (typeof workPolicyScheduleDay.$inferSelect)[];
		  })
		| null;
	regulation:
		| (typeof workPolicyRegulation.$inferSelect & {
				breakRules: (typeof workPolicyBreakRule.$inferSelect & {
					options: (typeof workPolicyBreakOption.$inferSelect)[];
				})[];
		  })
		| null;
	presence: typeof workPolicyPresence.$inferSelect | null;
};

export type WorkPolicyAssignmentWithDetails = typeof workPolicyAssignment.$inferSelect & {
	policy: { id: string; name: string } | null;
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};

type EffectiveWorkPolicyAssignment = typeof workPolicyAssignment.$inferSelect & {
	policy:
		| (Pick<typeof workPolicy.$inferSelect, "name" | "isActive" | "scheduleEnabled"> & {
				schedule:
					| (Pick<
							typeof workPolicySchedule.$inferSelect,
							"scheduleCycle" | "scheduleType" | "hoursPerCycle" | "homeOfficeDaysPerCycle"
					  > & {
							days: Pick<
								typeof workPolicyScheduleDay.$inferSelect,
								"dayOfWeek" | "hoursPerDay" | "isWorkDay" | "cycleWeek" | "latestClockIn"
							>[];
					  })
					| null;
		  })
		| null;
	team?: Pick<typeof team.$inferSelect, "name"> | null;
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
			maxDailyMinutes: z.number().optional(),
			maxWeeklyMinutes: z.number().optional(),
			maxUninterruptedMinutes: z.number().optional(),
			breakRules: z.array(breakRuleSchema),
		})
		.optional(),
});

const updateWorkPolicySchema = z.object({
	policyId: z.string().min(1),
	data: workPolicyFieldsSchema.partial(),
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

const policyDetails = {
	schedule: {
		with: { days: true as const },
	},
	regulation: {
		with: {
			breakRules: {
				orderBy: [workPolicyBreakRule.sortOrder],
				with: {
					options: {
						orderBy: [workPolicyBreakOption.sortOrder],
					},
				},
			},
		},
	},
	presence: true as const,
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
		const policy = yield* dbService.query("workPolicies.findWithDetails", () =>
			dbService.db.query.workPolicy.findFirst({
				where: and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)),
				with: policyDetails,
			}),
		);
		return (policy ?? null) as WorkPolicyWithDetails | null;
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
			const policies = yield* dbService.query("getWorkPolicies", () =>
				dbService.db.query.workPolicy.findMany({
					where: and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true)),
					with: policyDetails,
					orderBy: (p, { asc }) => [asc(p.name)],
				}),
			);

			return policies as WorkPolicyWithDetails[];
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

type ScheduleFields = NonNullable<ParsedWorkPolicy["schedule"]>;
type RegulationFields = NonNullable<ParsedWorkPolicy["regulation"]>;
type PresenceFields = NonNullable<ParsedWorkPolicy["presence"]>;

function insertSchedule(policyId: string, schedule: ScheduleFields) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [created] = yield* dbService.query("createSchedule", () =>
			dbService.db
				.insert(workPolicySchedule)
				.values({
					policyId,
					scheduleCycle: schedule.scheduleCycle,
					scheduleType: schedule.scheduleType,
					workingDaysPreset:
						schedule.scheduleType === "detailed" ? "custom" : schedule.workingDaysPreset,
					hoursPerCycle: schedule.scheduleType === "simple" ? schedule.hoursPerCycle : null,
					homeOfficeDaysPerCycle: schedule.homeOfficeDaysPerCycle ?? 0,
					updatedAt: currentTimestamp(),
				})
				.returning(),
		);

		// Create day entries for detailed schedules
		const days = schedule.days;
		if (schedule.scheduleType === "detailed" && days) {
			yield* dbService.query("createScheduleDays", async () => {
				await dbService.db.insert(workPolicyScheduleDay).values(
					days.map((day) => ({
						scheduleId: created.id,
						dayOfWeek: day.dayOfWeek,
						hoursPerDay: day.hoursPerDay,
						isWorkDay: day.isWorkDay,
						cycleWeek: day.cycleWeek ?? 1,
						latestClockIn: latestClockInForDay(day),
					})),
				);
			});
		}
	});
}

function insertRegulation(policyId: string, regulation: RegulationFields) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [created] = yield* dbService.query("createRegulation", () =>
			dbService.db
				.insert(workPolicyRegulation)
				.values({
					policyId,
					maxDailyMinutes: regulation.maxDailyMinutes,
					maxWeeklyMinutes: regulation.maxWeeklyMinutes,
					maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
					updatedAt: currentTimestamp(),
				})
				.returning(),
		);

		// Create break rules with options
		for (const [ruleIndex, rule] of regulation.breakRules.entries()) {
			const [breakRule] = yield* dbService.query("createBreakRule", () =>
				dbService.db
					.insert(workPolicyBreakRule)
					.values({
						regulationId: created.id,
						workingMinutesThreshold: rule.workingMinutesThreshold,
						requiredBreakMinutes: rule.requiredBreakMinutes,
						sortOrder: ruleIndex,
						updatedAt: currentTimestamp(),
					})
					.returning(),
			);

			for (const [optIndex, option] of rule.options.entries()) {
				yield* dbService.query("createBreakOption", async () => {
					await dbService.db.insert(workPolicyBreakOption).values({
						breakRuleId: breakRule.id,
						splitCount: option.splitCount,
						minimumSplitMinutes: option.minimumSplitMinutes,
						minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
						sortOrder: optIndex,
					});
				});
			}
		}
	});
}

function insertPresence(policyId: string, presence: PresenceFields) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		yield* dbService.query("createPresence", async () => {
			await dbService.db.insert(workPolicyPresence).values({
				policyId,
				presenceMode: presence.presenceMode,
				requiredOnsiteDays: presence.requiredOnsiteDays ?? null,
				requiredOnsiteFixedDays: presence.requiredOnsiteFixedDays
					? JSON.stringify(presence.requiredOnsiteFixedDays)
					: null,
				locationId: presence.locationId || null,
				evaluationPeriod: presence.evaluationPeriod ?? "weekly",
				enforcement: presence.enforcement ?? "warn",
				updatedAt: currentTimestamp(),
			});
		});
	});
}

function fetchSavedPolicy(policyId: string, organizationId: string, message: string) {
	return Effect.gen(function* () {
		const policy = yield* findPolicyWithDetails(policyId, organizationId);
		return policy ?? (yield* policyNotFound(undefined, message));
	});
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

		const dbService = yield* DatabaseService;

		const existingPolicy = yield* dbService.query("checkDuplicateName", () =>
			dbService.db.query.workPolicy.findFirst({
				where: and(
					eq(workPolicy.organizationId, organizationId),
					eq(workPolicy.name, data.name),
					eq(workPolicy.isActive, true),
				),
			}),
		);

		if (existingPolicy) {
			return yield* Effect.fail(
				new ConflictError({
					message: "A policy with this name already exists",
					conflictType: "duplicate_name",
					details: { entityType: "work_policy", field: "name" },
				}),
			);
		}

		const [newPolicy] = yield* dbService.query("createPolicy", () =>
			dbService.db
				.insert(workPolicy)
				.values({
					organizationId,
					name: data.name,
					description: data.description,
					scheduleEnabled: data.scheduleEnabled,
					regulationEnabled: data.regulationEnabled,
					presenceEnabled: data.presenceEnabled ?? false,
					createdBy: userId,
					updatedAt: currentTimestamp(),
				})
				.returning(),
		);

		if (data.scheduleEnabled && data.schedule) {
			yield* insertSchedule(newPolicy.id, data.schedule);
		}
		if (data.regulationEnabled && data.regulation) {
			yield* insertRegulation(newPolicy.id, data.regulation);
		}
		if (data.presenceEnabled && data.presence) {
			yield* insertPresence(newPolicy.id, data.presence);
		}

		const completePolicy = yield* fetchSavedPolicy(
			newPolicy.id,
			organizationId,
			"Failed to fetch created policy",
		);

		yield* markWorkBalancesDirty(organizationId);

		return completePolicy;
	});
}

/** Makes a policy of the organization its default; shared by the policy and preset actions. */
function setDefaultPolicyIn(organizationId: string, userId: string, policyId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const policy = yield* dbService.query("getPolicy", () =>
			dbService.db.query.workPolicy.findFirst({
				where: and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)),
			}),
		);

		if (!policy) {
			return yield* policyNotFound(policyId);
		}

		yield* dbService.query("unsetDefault", async () => {
			await dbService.db
				.update(workPolicy)
				.set({
					isDefault: false,
					updatedBy: userId,
					updatedAt: currentTimestamp(),
				})
				.where(and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isDefault, true)));
		});

		yield* dbService.query("setDefault", async () => {
			await dbService.db
				.update(workPolicy)
				.set({
					isDefault: true,
					updatedBy: userId,
					updatedAt: currentTimestamp(),
				})
				.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));
		});

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
			const dbService = yield* DatabaseService;

			const existingPolicy = yield* dbService.query("getExisting", () =>
				dbService.db.query.workPolicy.findFirst({
					where: and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)),
					with: {
						schedule: true,
						regulation: true,
						presence: true,
					},
				}),
			);

			if (!existingPolicy) {
				return yield* policyNotFound(policyId);
			}
			yield* validateLatestClockIns(data.schedule?.days);

			// Check for duplicate name if name is being changed
			const name = data.name;
			if (name && name !== existingPolicy.name) {
				const duplicatePolicy = yield* dbService.query("checkDuplicate", () =>
					dbService.db.query.workPolicy.findFirst({
						where: and(
							eq(workPolicy.organizationId, organizationId),
							eq(workPolicy.name, name),
							eq(workPolicy.isActive, true),
						),
					}),
				);

				if (duplicatePolicy && duplicatePolicy.id !== policyId) {
					return yield* Effect.fail(
						new ConflictError({
							message: "A policy with this name already exists",
							conflictType: "duplicate_name",
							details: { entityType: "work_policy", field: "name" },
						}),
					);
				}
			}

			const shouldDirtyWorkBalances =
				data.scheduleEnabled !== undefined || data.schedule !== undefined;

			yield* dbService.query("updatePolicy", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						name: data.name ?? existingPolicy.name,
						description: data.description ?? existingPolicy.description,
						scheduleEnabled: data.scheduleEnabled ?? existingPolicy.scheduleEnabled,
						regulationEnabled: data.regulationEnabled ?? existingPolicy.regulationEnabled,
						presenceEnabled: data.presenceEnabled ?? existingPolicy.presenceEnabled,
						updatedBy: actor.userId,
						updatedAt: currentTimestamp(),
					})
					.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));
			});

			if (data.schedule) {
				// Delete existing schedule (cascade deletes days)
				if (existingPolicy.schedule) {
					yield* dbService.query("deleteOldSchedule", async () => {
						await dbService.db
							.delete(workPolicySchedule)
							.where(eq(workPolicySchedule.policyId, policyId));
					});
				}
				yield* insertSchedule(policyId, data.schedule);
			}

			if (data.regulation) {
				// Delete existing regulation (cascade deletes break rules and options)
				if (existingPolicy.regulation) {
					yield* dbService.query("deleteOldRegulation", async () => {
						await dbService.db
							.delete(workPolicyRegulation)
							.where(eq(workPolicyRegulation.policyId, policyId));
					});
				}
				yield* insertRegulation(policyId, data.regulation);
			}

			if (data.presence !== undefined) {
				yield* dbService.query("deleteOldPresence", async () => {
					await dbService.db
						.delete(workPolicyPresence)
						.where(eq(workPolicyPresence.policyId, policyId));
				});

				if ((data.presenceEnabled ?? existingPolicy.presenceEnabled) && data.presence) {
					yield* insertPresence(policyId, data.presence);
				}
			}

			const updatedPolicy = yield* fetchSavedPolicy(
				policyId,
				organizationId,
				"Failed to fetch updated policy",
			);

			if (shouldDirtyWorkBalances) {
				yield* markWorkBalancesDirty(organizationId);
			}

			return updatedPolicy;
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
				await dbService.db
					.update(workPolicy)
					.set({
						isActive: false,
						isDefault: false,
						updatedBy: actor.userId,
						updatedAt: currentTimestamp(),
					})
					.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));
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
				dbService.db.query.workPolicyAssignment.findMany({
					where: and(
						eq(workPolicyAssignment.organizationId, organizationId),
						eq(workPolicyAssignment.isActive, true),
					),
					with: {
						policy: {
							columns: { id: true, name: true },
						},
						team: {
							columns: { id: true, name: true },
						},
						employee: {
							columns: { id: true },
							with: { user: { columns: { firstName: true, lastName: true } } },
						},
					},
					orderBy: [desc(workPolicyAssignment.createdAt)],
				}),
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
					where: and(eq(workPolicy.id, data.policyId), eq(workPolicy.organizationId, organizationId)),
					columns: { id: true },
				}),
			);
			if (!policy) {
				return yield* policyNotFound(data.policyId);
			}

			const priority =
				data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

			const [assignment] = yield* dbService.query("createWorkPolicyAssignment", () =>
				dbService.db
					.insert(workPolicyAssignment)
					.values({
						policyId: data.policyId,
						organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						isActive: true,
						createdBy: actor.userId,
						updatedAt: currentTimestamp(),
					})
					.returning(),
			);

			yield* markWorkBalancesDirty(organizationId);

			return { id: assignment.id };
		}),
);

export const deleteWorkPolicyAssignment = organizationAction(
	{ name: "workPolicies.deleteAssignment", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* dbService.query("getExistingAssignment", () =>
				dbService.db.query.workPolicyAssignment.findFirst({
					where: and(
						eq(workPolicyAssignment.id, assignmentId),
						eq(workPolicyAssignment.organizationId, organizationId),
					),
				}),
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

			yield* dbService.query("deleteWorkPolicyAssignment", async () => {
				await dbService.db
					.update(workPolicyAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(workPolicyAssignment.id, assignmentId),
							eq(workPolicyAssignment.organizationId, organizationId),
						),
					);
			});

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

function scheduleDetailsOf(
	policy: NonNullable<EffectiveWorkPolicyAssignment["policy"]>,
	assignedVia: string,
): EmployeeScheduleDetails {
	const schedule = policy.schedule;
	return {
		policyName: policy.name,
		assignedVia,
		scheduleCycle: schedule?.scheduleCycle,
		scheduleType: schedule?.scheduleType,
		hoursPerCycle: schedule?.hoursPerCycle ?? undefined,
		homeOfficeDaysPerCycle: schedule?.homeOfficeDaysPerCycle ?? undefined,
		days: schedule?.days?.map((d) => ({
			dayOfWeek: d.dayOfWeek,
			hoursPerDay: d.hoursPerDay,
			isWorkDay: d.isWorkDay,
			cycleWeek: d.cycleWeek,
		})),
	};
}

export const getEmployeeEffectiveScheduleDetails = organizationAction(
	{ name: "workPolicies.employeeScheduleDetails", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const emp = yield* dbService.query("getEmployee", () =>
				dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
					with: { team: true },
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

			const now = new Date();
			const effectiveNow = [
				eq(workPolicyAssignment.organizationId, organizationId),
				eq(workPolicyAssignment.isActive, true),
				or(isNull(workPolicyAssignment.effectiveFrom), lte(workPolicyAssignment.effectiveFrom, now)),
				or(isNull(workPolicyAssignment.effectiveUntil), gt(workPolicyAssignment.effectiveUntil, now)),
			];
			const latestFirst = (
				assignment: typeof workPolicyAssignment._.columns,
				operators: { desc: typeof desc },
			) => [sql`${assignment.effectiveFrom} DESC NULLS LAST`, operators.desc(assignment.createdAt)];
			const withSchedule = {
				policy: {
					with: {
						schedule: {
							with: { days: true },
						},
					},
				},
			} as const;

			// Check employee-level assignment first
			const employeeAssignment = (yield* dbService.query("getEmployeePolicyAssignment", () =>
				dbService.db.query.workPolicyAssignment.findFirst({
					where: and(
						...effectiveNow,
						eq(workPolicyAssignment.employeeId, employeeId),
						eq(workPolicyAssignment.assignmentType, "employee"),
					),
					orderBy: latestFirst,
					with: withSchedule,
				}),
			)) as unknown as EffectiveWorkPolicyAssignment | undefined;

			if (employeeAssignment?.policy?.isActive && employeeAssignment.policy.scheduleEnabled) {
				return scheduleDetailsOf(employeeAssignment.policy, "Individual");
			}

			// Check team-level assignment
			const teamId = emp.teamId;
			if (teamId) {
				const teamAssignment = (yield* dbService.query("getTeamPolicyAssignment", () =>
					dbService.db.query.workPolicyAssignment.findFirst({
						where: and(
							...effectiveNow,
							eq(workPolicyAssignment.teamId, teamId),
							eq(workPolicyAssignment.assignmentType, "team"),
						),
						orderBy: latestFirst,
						with: { ...withSchedule, team: true },
					}),
				)) as unknown as EffectiveWorkPolicyAssignment | undefined;

				if (teamAssignment?.policy?.isActive && teamAssignment.policy.scheduleEnabled) {
					return scheduleDetailsOf(teamAssignment.policy, teamAssignment.team?.name ?? "Team");
				}
			}

			// Check organization-level assignment
			const orgAssignment = (yield* dbService.query("getOrgPolicyAssignment", () =>
				dbService.db.query.workPolicyAssignment.findFirst({
					where: and(...effectiveNow, eq(workPolicyAssignment.assignmentType, "organization")),
					orderBy: latestFirst,
					with: withSchedule,
				}),
			)) as unknown as EffectiveWorkPolicyAssignment | undefined;

			if (orgAssignment?.policy?.isActive && orgAssignment.policy.scheduleEnabled) {
				return scheduleDetailsOf(orgAssignment.policy, "Organization Default");
			}

			return null;
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
		Effect.gen(function* () {
			const existingPolicy = yield* findPolicyWithDetails(policyId, organizationId);
			if (!existingPolicy) {
				return yield* policyNotFound(policyId);
			}

			const dbService = yield* DatabaseService;

			// Generate unique name
			let newName = `${existingPolicy.name} (Copy)`;
			let copyNumber = 1;

			let nameExists = true;
			while (nameExists) {
				const candidate = newName;
				const duplicate = yield* dbService.query("checkDuplicate", () =>
					dbService.db.query.workPolicy.findFirst({
						where: and(
							eq(workPolicy.organizationId, organizationId),
							eq(workPolicy.name, candidate),
							eq(workPolicy.isActive, true),
						),
					}),
				);

				if (duplicate) {
					copyNumber++;
					newName = `${existingPolicy.name} (Copy ${copyNumber})`;
				} else {
					nameExists = false;
				}
			}

			const [newPolicy] = yield* dbService.query("createDuplicate", () =>
				dbService.db
					.insert(workPolicy)
					.values({
						organizationId,
						name: newName,
						description: existingPolicy.description,
						scheduleEnabled: existingPolicy.scheduleEnabled,
						regulationEnabled: existingPolicy.regulationEnabled,
						presenceEnabled: existingPolicy.presenceEnabled,
						isDefault: false,
						createdBy: actor.userId,
						updatedAt: currentTimestamp(),
					})
					.returning(),
			);

			if (existingPolicy.schedule) {
				const scheduleSource = existingPolicy.schedule;
				const [schedule] = yield* dbService.query("duplicateSchedule", () =>
					dbService.db
						.insert(workPolicySchedule)
						.values({
							policyId: newPolicy.id,
							scheduleCycle: scheduleSource.scheduleCycle,
							scheduleType: scheduleSource.scheduleType,
							workingDaysPreset: scheduleSource.workingDaysPreset,
							hoursPerCycle: scheduleSource.hoursPerCycle,
							homeOfficeDaysPerCycle: scheduleSource.homeOfficeDaysPerCycle,
							updatedAt: currentTimestamp(),
						})
						.returning(),
				);

				if (scheduleSource.days.length > 0) {
					yield* dbService.query("duplicateScheduleDays", async () => {
						await dbService.db.insert(workPolicyScheduleDay).values(
							scheduleSource.days.map((day) => ({
								scheduleId: schedule.id,
								dayOfWeek: day.dayOfWeek,
								hoursPerDay: day.hoursPerDay,
								isWorkDay: day.isWorkDay,
								cycleWeek: day.cycleWeek,
								latestClockIn: day.latestClockIn,
							})),
						);
					});
				}
			}

			if (existingPolicy.regulation) {
				const regulationSource = existingPolicy.regulation;
				const [regulation] = yield* dbService.query("duplicateRegulation", () =>
					dbService.db
						.insert(workPolicyRegulation)
						.values({
							policyId: newPolicy.id,
							maxDailyMinutes: regulationSource.maxDailyMinutes,
							maxWeeklyMinutes: regulationSource.maxWeeklyMinutes,
							maxUninterruptedMinutes: regulationSource.maxUninterruptedMinutes,
							updatedAt: currentTimestamp(),
						})
						.returning(),
				);

				for (const rule of regulationSource.breakRules) {
					const [breakRule] = yield* dbService.query("duplicateBreakRule", () =>
						dbService.db
							.insert(workPolicyBreakRule)
							.values({
								regulationId: regulation.id,
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								sortOrder: rule.sortOrder,
								updatedAt: currentTimestamp(),
							})
							.returning(),
					);

					if (rule.options.length > 0) {
						yield* dbService.query("duplicateBreakOptions", async () => {
							await dbService.db.insert(workPolicyBreakOption).values(
								rule.options.map((opt) => ({
									breakRuleId: breakRule.id,
									splitCount: opt.splitCount,
									minimumSplitMinutes: opt.minimumSplitMinutes,
									minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
									sortOrder: opt.sortOrder,
								})),
							);
						});
					}
				}
			}

			if (existingPolicy.presence) {
				const presenceSource = existingPolicy.presence;
				yield* dbService.query("duplicatePresence", async () => {
					await dbService.db.insert(workPolicyPresence).values({
						policyId: newPolicy.id,
						presenceMode: presenceSource.presenceMode,
						requiredOnsiteDays: presenceSource.requiredOnsiteDays,
						requiredOnsiteFixedDays: presenceSource.requiredOnsiteFixedDays,
						locationId: presenceSource.locationId,
						evaluationPeriod: presenceSource.evaluationPeriod,
						enforcement: presenceSource.enforcement,
						updatedAt: currentTimestamp(),
					});
				});
			}

			return yield* fetchSavedPolicy(
				newPolicy.id,
				organizationId,
				"Failed to fetch duplicated policy",
			);
		}),
);
