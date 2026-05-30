"use server";

import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
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
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { markOrganizationWorkBalancesDirty } from "@/lib/work-balance/service";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	filterItemsToManagedEmployees,
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
	getOrganizationTeam,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
	requireSettingsActorEmployeeAssignmentAccess,
	requireSettingsActorEmployeeRecord,
	validateAssignmentTargetFields,
} from "../employees/employee-action-utils";
import { canAccessWorkPolicyComplianceActions, policyBelongsToOrganization } from "./policy-scope";

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
								"dayOfWeek" | "hoursPerDay" | "isWorkDay" | "cycleWeek"
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

// Form input types
export interface BreakOptionInput {
	splitCount: number | null;
	minimumSplitMinutes: number | null;
	minimumLongestSplitMinutes: number | null;
}

export interface BreakRuleInput {
	workingMinutesThreshold: number;
	requiredBreakMinutes: number;
	options: BreakOptionInput[];
}

export interface ScheduleDayInput {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek?: number;
}

export interface CreateWorkPolicyInput {
	name: string;
	description?: string;
	scheduleEnabled: boolean;
	regulationEnabled: boolean;
	presenceEnabled: boolean;

	// Presence fields (used when presenceEnabled = true)
	presence?: {
		presenceMode: "minimum_count" | "fixed_days";
		requiredOnsiteDays?: number;
		requiredOnsiteFixedDays?: string[];
		locationId?: string;
		evaluationPeriod?: "weekly" | "biweekly" | "monthly";
		enforcement?: "block" | "warn" | "none";
	};

	// Schedule fields (used when scheduleEnabled = true)
	schedule?: {
		scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
		scheduleType: "simple" | "detailed";
		workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
		hoursPerCycle?: string;
		homeOfficeDaysPerCycle?: number;
		days?: ScheduleDayInput[];
	};

	// Regulation fields (used when regulationEnabled = true)
	regulation?: {
		maxDailyMinutes?: number;
		maxWeeklyMinutes?: number;
		maxUninterruptedMinutes?: number;
		breakRules: BreakRuleInput[];
	};
}

export type UpdateWorkPolicyInput = Partial<CreateWorkPolicyInput>;

export interface WorkPolicyPresetInput {
	name: string;
	description?: string;
	countryCode?: string | null;
	scheduleEnabled: boolean;
	regulationEnabled: boolean;
	schedule?: {
		scheduleCycle?: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
		workingDaysPreset?: "weekdays" | "weekends" | "all_days" | "custom";
		hoursPerCycle?: string;
	};
	regulation?: {
		maxDailyMinutes?: number;
		maxWeeklyMinutes?: number;
		maxUninterruptedMinutes?: number;
		breakRules?: BreakRuleInput[];
	};
}

export type WorkPolicyPresetWithSource = typeof workPolicyPreset.$inferSelect & {
	source: "system" | "custom";
	sourceLabel: "System" | "Custom";
};

// Using isOrgAdminCasl from auth-helpers for CASL-based authorization

// ============================================
// GET POLICIES
// ============================================

export async function getWorkPolicies(
	organizationId: string,
): Promise<ServerActionResult<WorkPolicyWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getWorkPolicies:actor" }),
		);

		const dbService = yield* _(DatabaseService);
		const policies = yield* _(
			dbService.query("getWorkPolicies", async () => {
				return await dbService.db.query.workPolicy.findMany({
					where: and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true)),
					with: {
						schedule: {
							with: { days: true },
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
						presence: true,
					},
					orderBy: (p, { asc }) => [asc(p.name)],
				});
			}),
		);

		return policies as WorkPolicyWithDetails[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getWorkPolicy(
	policyId: string,
): Promise<ServerActionResult<WorkPolicyWithDetails | null>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const policy = yield* _(
			dbService.query("getWorkPolicy", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
					with: {
						schedule: {
							with: { days: true },
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
						presence: true,
					},
				});
			}),
		);

		if (!policy) {
			return null;
		}

		yield* _(
			getEmployeeSettingsActorContext({
				organizationId: policy.organizationId,
				queryName: "getWorkPolicy:actor",
			}),
		);

		return policy as WorkPolicyWithDetails;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// CREATE POLICY
// ============================================

export async function createWorkPolicy(
	organizationId: string,
	data: CreateWorkPolicyInput,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_policy",
						action: "create",
					}),
				),
			);
		}

		// Validate at least one feature is enabled
		if (!data.scheduleEnabled && !data.regulationEnabled && !data.presenceEnabled) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "At least one feature (schedule, regulation, or presence) must be enabled",
						field: "scheduleEnabled",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);

		// Check for duplicate name
		const existingPolicy = yield* _(
			dbService.query("checkDuplicateName", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: and(
						eq(workPolicy.organizationId, organizationId),
						eq(workPolicy.name, data.name),
						eq(workPolicy.isActive, true),
					),
				});
			}),
		);

		if (existingPolicy) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "A policy with this name already exists",
						conflictType: "duplicate_name",
						details: { entityType: "work_policy", field: "name" },
					}),
				),
			);
		}

		// Create main policy
		const [newPolicy] = yield* _(
			dbService.query("createPolicy", async () => {
				return await dbService.db
					.insert(workPolicy)
					.values({
						organizationId,
						name: data.name,
						description: data.description,
						scheduleEnabled: data.scheduleEnabled,
						regulationEnabled: data.regulationEnabled,
						presenceEnabled: data.presenceEnabled ?? false,
						createdBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		// Create schedule if enabled
		if (data.scheduleEnabled && data.schedule) {
			const [schedule] = yield* _(
				dbService.query("createSchedule", async () => {
					return await dbService.db
						.insert(workPolicySchedule)
						.values({
							policyId: newPolicy.id,
							scheduleCycle: data.schedule!.scheduleCycle,
							scheduleType: data.schedule!.scheduleType,
							workingDaysPreset:
								data.schedule!.scheduleType === "detailed"
									? "custom"
									: data.schedule!.workingDaysPreset,
							hoursPerCycle:
								data.schedule!.scheduleType === "simple" ? data.schedule!.hoursPerCycle : null,
							homeOfficeDaysPerCycle: data.schedule!.homeOfficeDaysPerCycle ?? 0,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			// Create day entries for detailed schedules
			if (data.schedule.scheduleType === "detailed" && data.schedule.days) {
				yield* _(
					dbService.query("createScheduleDays", async () => {
						await dbService.db.insert(workPolicyScheduleDay).values(
							data.schedule!.days!.map((day) => ({
								scheduleId: schedule.id,
								dayOfWeek: day.dayOfWeek,
								hoursPerDay: day.hoursPerDay,
								isWorkDay: day.isWorkDay,
								cycleWeek: day.cycleWeek ?? 1,
							})),
						);
					}),
				);
			}
		}

		// Create regulation if enabled
		if (data.regulationEnabled && data.regulation) {
			const [regulation] = yield* _(
				dbService.query("createRegulation", async () => {
					return await dbService.db
						.insert(workPolicyRegulation)
						.values({
							policyId: newPolicy.id,
							maxDailyMinutes: data.regulation!.maxDailyMinutes,
							maxWeeklyMinutes: data.regulation!.maxWeeklyMinutes,
							maxUninterruptedMinutes: data.regulation!.maxUninterruptedMinutes,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			// Create break rules with options
			for (const [ruleIndex, rule] of data.regulation.breakRules.entries()) {
				const [breakRule] = yield* _(
					dbService.query("createBreakRule", async () => {
						return await dbService.db
							.insert(workPolicyBreakRule)
							.values({
								regulationId: regulation.id,
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								sortOrder: ruleIndex,
								updatedAt: currentTimestamp(),
							})
							.returning();
					}),
				);

				for (const [optIndex, option] of rule.options.entries()) {
					yield* _(
						dbService.query("createBreakOption", async () => {
							await dbService.db.insert(workPolicyBreakOption).values({
								breakRuleId: breakRule.id,
								splitCount: option.splitCount,
								minimumSplitMinutes: option.minimumSplitMinutes,
								minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
								sortOrder: optIndex,
							});
						}),
					);
				}
			}
		}

		// Create presence config if enabled
		if (data.presenceEnabled && data.presence) {
			yield* _(
				dbService.query("createPresence", async () => {
					await dbService.db.insert(workPolicyPresence).values({
						policyId: newPolicy.id,
						presenceMode: data.presence!.presenceMode,
						requiredOnsiteDays: data.presence!.requiredOnsiteDays ?? null,
						requiredOnsiteFixedDays: data.presence!.requiredOnsiteFixedDays
							? JSON.stringify(data.presence!.requiredOnsiteFixedDays)
							: null,
						locationId: data.presence!.locationId || null,
						evaluationPeriod: data.presence!.evaluationPeriod ?? "weekly",
						enforcement: data.presence!.enforcement ?? "warn",
						updatedAt: currentTimestamp(),
					});
				}),
			);
		}

		// Fetch complete policy
		const completePolicy = yield* _(
			dbService.query("fetchComplete", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, newPolicy.id),
					with: {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
						presence: true,
					},
				});
			}),
		);

		if (!completePolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch created policy",
						entityType: "work_policy",
					}),
				),
			);
		}

		yield* _(Effect.promise(() => markOrganizationWorkBalancesDirty({ organizationId })));

		return completePolicy as WorkPolicyWithDetails;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// UPDATE POLICY
// ============================================

export async function updateWorkPolicy(
	policyId: string,
	data: UpdateWorkPolicyInput,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get existing policy
		const existingPolicy = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
					with: {
						schedule: true,
						regulation: true,
						presence: true,
					},
				});
			}),
		);

		if (!existingPolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Policy not found",
						entityType: "work_policy",
						entityId: policyId,
					}),
				),
			);
		}
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(existingPolicy!.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_policy",
						action: "update",
					}),
				),
			);
		}

		// Check for duplicate name if name is being changed
		if (data.name && data.name !== existingPolicy!.name) {
			const duplicatePolicy = yield* _(
				dbService.query("checkDuplicate", async () => {
					return await dbService.db.query.workPolicy.findFirst({
						where: and(
							eq(workPolicy.organizationId, existingPolicy!.organizationId),
							eq(workPolicy.name, data.name!),
							eq(workPolicy.isActive, true),
						),
					});
				}),
			);

			if (duplicatePolicy && duplicatePolicy.id !== policyId) {
				yield* _(
					Effect.fail(
						new ConflictError({
							message: "A policy with this name already exists",
							conflictType: "duplicate_name",
							details: { entityType: "work_policy", field: "name" },
						}),
					),
				);
			}
		}

		// Update main policy
		const shouldDirtyWorkBalances =
			data.scheduleEnabled !== undefined || data.schedule !== undefined;

		yield* _(
			dbService.query("updatePolicy", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						name: data.name ?? existingPolicy!.name,
						description: data.description ?? existingPolicy!.description,
						scheduleEnabled: data.scheduleEnabled ?? existingPolicy!.scheduleEnabled,
						regulationEnabled: data.regulationEnabled ?? existingPolicy!.regulationEnabled,
						presenceEnabled: data.presenceEnabled ?? existingPolicy!.presenceEnabled,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workPolicy.id, policyId));
			}),
		);

		// Update schedule if provided
		if (data.schedule) {
			// Delete existing schedule (cascade deletes days)
			if (existingPolicy!.schedule) {
				yield* _(
					dbService.query("deleteOldSchedule", async () => {
						await dbService.db
							.delete(workPolicySchedule)
							.where(eq(workPolicySchedule.policyId, policyId));
					}),
				);
			}

			// Create new schedule
			const [schedule] = yield* _(
				dbService.query("createSchedule", async () => {
					return await dbService.db
						.insert(workPolicySchedule)
						.values({
							policyId,
							scheduleCycle: data.schedule!.scheduleCycle,
							scheduleType: data.schedule!.scheduleType,
							workingDaysPreset:
								data.schedule!.scheduleType === "detailed"
									? "custom"
									: data.schedule!.workingDaysPreset,
							hoursPerCycle:
								data.schedule!.scheduleType === "simple" ? data.schedule!.hoursPerCycle : null,
							homeOfficeDaysPerCycle: data.schedule!.homeOfficeDaysPerCycle ?? 0,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			if (data.schedule.scheduleType === "detailed" && data.schedule.days) {
				yield* _(
					dbService.query("createScheduleDays", async () => {
						await dbService.db.insert(workPolicyScheduleDay).values(
							data.schedule!.days!.map((day) => ({
								scheduleId: schedule.id,
								dayOfWeek: day.dayOfWeek,
								hoursPerDay: day.hoursPerDay,
								isWorkDay: day.isWorkDay,
								cycleWeek: day.cycleWeek ?? 1,
							})),
						);
					}),
				);
			}
		}

		// Update regulation if provided
		if (data.regulation) {
			// Delete existing regulation (cascade deletes break rules and options)
			if (existingPolicy!.regulation) {
				yield* _(
					dbService.query("deleteOldRegulation", async () => {
						await dbService.db
							.delete(workPolicyRegulation)
							.where(eq(workPolicyRegulation.policyId, policyId));
					}),
				);
			}

			// Create new regulation
			const [regulation] = yield* _(
				dbService.query("createRegulation", async () => {
					return await dbService.db
						.insert(workPolicyRegulation)
						.values({
							policyId,
							maxDailyMinutes: data.regulation!.maxDailyMinutes,
							maxWeeklyMinutes: data.regulation!.maxWeeklyMinutes,
							maxUninterruptedMinutes: data.regulation!.maxUninterruptedMinutes,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			for (const [ruleIndex, rule] of data.regulation.breakRules.entries()) {
				const [breakRule] = yield* _(
					dbService.query("createBreakRule", async () => {
						return await dbService.db
							.insert(workPolicyBreakRule)
							.values({
								regulationId: regulation.id,
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								sortOrder: ruleIndex,
								updatedAt: currentTimestamp(),
							})
							.returning();
					}),
				);

				for (const [optIndex, option] of rule.options.entries()) {
					yield* _(
						dbService.query("createBreakOption", async () => {
							await dbService.db.insert(workPolicyBreakOption).values({
								breakRuleId: breakRule.id,
								splitCount: option.splitCount,
								minimumSplitMinutes: option.minimumSplitMinutes,
								minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
								sortOrder: optIndex,
							});
						}),
					);
				}
			}
		}

		// Update presence if provided
		if (data.presence !== undefined) {
			// Delete existing presence config
			yield* _(
				dbService.query("deleteOldPresence", async () => {
					await dbService.db
						.delete(workPolicyPresence)
						.where(eq(workPolicyPresence.policyId, policyId));
				}),
			);

			// Create new presence config if enabled
			if ((data.presenceEnabled ?? existingPolicy!.presenceEnabled) && data.presence) {
				yield* _(
					dbService.query("createPresence", async () => {
						await dbService.db.insert(workPolicyPresence).values({
							policyId,
							presenceMode: data.presence!.presenceMode,
							requiredOnsiteDays: data.presence!.requiredOnsiteDays ?? null,
							requiredOnsiteFixedDays: data.presence!.requiredOnsiteFixedDays
								? JSON.stringify(data.presence!.requiredOnsiteFixedDays)
								: null,
							locationId: data.presence!.locationId || null,
							evaluationPeriod: data.presence!.evaluationPeriod ?? "weekly",
							enforcement: data.presence!.enforcement ?? "warn",
							updatedAt: currentTimestamp(),
						});
					}),
				);
			}
		}

		// Fetch updated policy
		const updatedPolicy = yield* _(
			dbService.query("fetchUpdated", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
					with: {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
						presence: true,
					},
				});
			}),
		);

		if (!updatedPolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch updated policy",
						entityType: "work_policy",
					}),
				),
			);
		}

		if (shouldDirtyWorkBalances) {
			yield* _(
				Effect.promise(() =>
					markOrganizationWorkBalancesDirty({ organizationId: existingPolicy!.organizationId }),
				),
			);
		}

		return updatedPolicy as WorkPolicyWithDetails;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DELETE POLICY
// ============================================

export async function deleteWorkPolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const existingPolicy = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
				});
			}),
		);

		if (!existingPolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Policy not found",
						entityType: "work_policy",
						entityId: policyId,
					}),
				),
			);
		}
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(existingPolicy!.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_policy",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("softDelete", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						isActive: false,
						isDefault: false,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workPolicy.id, policyId));
			}),
		);

		yield* _(
			Effect.promise(() =>
				markOrganizationWorkBalancesDirty({ organizationId: existingPolicy!.organizationId }),
			),
		);

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// ASSIGNMENTS
// ============================================

export async function getWorkPolicyAssignments(
	organizationId: string,
): Promise<ServerActionResult<WorkPolicyAssignmentWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getWorkPolicyAssignments:actor",
			}),
		);
		const dbService = yield* _(DatabaseService);
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const assignments = yield* _(
			dbService.query("getWorkPolicyAssignments", async () => {
				return await dbService.db.query.workPolicyAssignment.findMany({
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
				});
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

		if (!managedEmployeeIds) {
			return typedAssignments;
		}

		return filterItemsToManagedEmployees(
			typedAssignments.filter((assignment) => assignment.assignmentType === "employee"),
			managedEmployeeIds,
		) as WorkPolicyAssignmentWithDetails[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createWorkPolicyAssignment(
	organizationId: string,
	data: {
		policyId: string;
		assignmentType: "organization" | "team" | "employee";
		teamId?: string;
		employeeId?: string;
	},
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "createWorkPolicyAssignment:actor",
			}),
		);
		yield* _(
			requireSettingsActorEmployeeAssignmentAccess(actor, data.assignmentType, {
				message: "Insufficient permissions",
				resource: "work_policy_assignment",
				action: "create",
			}),
		);
		yield* _(validateAssignmentTargetFields(data.assignmentType, data));

		if (data.assignmentType !== "employee") {
			yield* _(
				requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Insufficient permissions",
					resource: "work_policy_assignment",
					action: "create",
				}),
			);
		}

		if (data.employeeId) {
			const targetEmployee = yield* _(
				getTargetEmployee(data.employeeId, "createWorkPolicyAssignment:getTargetEmployee"),
			);
			yield* _(
				ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "Insufficient permissions",
					resource: "work_policy_assignment",
					action: "create",
				}),
			);
		}

		if (data.assignmentType === "team" && data.teamId) {
			yield* _(
				getOrganizationTeam(
					data.teamId,
					actor.organizationId,
					"createWorkPolicyAssignment:getOrganizationTeam",
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const policy = yield* _(
			dbService.query("getAssignmentPolicy", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, data.policyId),
					columns: { id: true, organizationId: true },
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Policy not found",
								entityType: "work_policy",
								entityId: data.policyId,
							}),
						),
			),
		);

		if (!policyBelongsToOrganization(policy.organizationId, actor.organizationId)) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy_assignment",
						action: "create",
					}),
				),
			);
		}

		const priority =
			data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		const [assignment] = yield* _(
			dbService.query("createWorkPolicyAssignment", async () => {
				return await dbService.db
					.insert(workPolicyAssignment)
					.values({
						policyId: data.policyId,
						organizationId: organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId ?? null,
						employeeId: data.employeeId ?? null,
						priority,
						isActive: true,
						createdBy: actor.session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		yield* _(
			Effect.promise(() =>
				markOrganizationWorkBalancesDirty({ organizationId: actor.organizationId }),
			),
		);

		return { id: assignment.id };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function deleteWorkPolicyAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteWorkPolicyAssignment:actor" }),
		);

		const dbService = yield* _(DatabaseService);
		const assignment = yield* _(
			dbService.query("getExistingAssignment", async () => {
				return await dbService.db.query.workPolicyAssignment.findFirst({
					where: eq(workPolicyAssignment.id, assignmentId),
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Work policy assignment not found",
								entityType: "work_policy_assignment",
								entityId: assignmentId,
							}),
						),
			),
		);

		yield* _(
			requireSettingsActorEmployeeAssignmentAccess(actor, assignment.assignmentType, {
				message: "Insufficient permissions",
				resource: "work_policy_assignment",
				action: "delete",
			}),
		);

		if (assignment.employeeId) {
			const targetEmployee = yield* _(
				getTargetEmployee(assignment.employeeId, "deleteWorkPolicyAssignment:getTargetEmployee"),
			);
			yield* _(
				ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "Insufficient permissions",
					resource: "work_policy_assignment",
					action: "delete",
				}),
			);
		}

		yield* _(
			dbService.query("deleteWorkPolicyAssignment", async () => {
				await dbService.db
					.update(workPolicyAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(workPolicyAssignment.id, assignmentId),
							eq(workPolicyAssignment.organizationId, actor.organizationId),
						),
					);
			}),
		);

		yield* _(
			Effect.promise(() =>
				markOrganizationWorkBalancesDirty({ organizationId: assignment.organizationId }),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// PRESETS
// ============================================

function normalizePresetName(name: string) {
	return name.trim();
}

function isNumberOrNull(value: unknown): value is number | null {
	return typeof value === "number" || value === null;
}

function isBreakOptionInput(value: unknown): value is BreakOptionInput {
	if (!value || typeof value !== "object") return false;

	const option = value as Partial<BreakOptionInput>;
	return (
		isNumberOrNull(option.splitCount) &&
		isNumberOrNull(option.minimumSplitMinutes) &&
		isNumberOrNull(option.minimumLongestSplitMinutes)
	);
}

function isBreakRuleInput(value: unknown): value is BreakRuleInput {
	if (!value || typeof value !== "object") return false;

	const rule = value as Partial<BreakRuleInput>;
	return (
		typeof rule.workingMinutesThreshold === "number" &&
		typeof rule.requiredBreakMinutes === "number" &&
		Array.isArray(rule.options) &&
		rule.options.every(isBreakOptionInput)
	);
}

function validationError(message: string, field: string) {
	return new ValidationError({ message, field });
}

function parsePresetBreakRulesStrict(value: unknown): BreakRuleInput[] {
	if (!value) return [];

	let parsed: unknown;
	try {
		parsed = typeof value === "string" ? JSON.parse(value) : value;
	} catch {
		throw validationError("Preset break rules are malformed", "breakRulesJson");
	}

	if (!parsed || typeof parsed !== "object") {
		throw validationError("Preset break rules are malformed", "breakRulesJson");
	}

	const rules = (parsed as { rules?: unknown }).rules;
	if (!Array.isArray(rules) || !rules.every(isBreakRuleInput)) {
		throw validationError("Preset break rules are malformed", "breakRulesJson");
	}

	return rules;
}

function validatePresetBreakRules(input: WorkPolicyPresetInput) {
	const rules = input.regulation?.breakRules;
	if (rules === undefined && !input.regulationEnabled) return Effect.void;

	if (rules !== undefined && (!Array.isArray(rules) || !rules.every(isBreakRuleInput))) {
		return Effect.fail(
			validationError("Preset break rules are malformed", "regulation.breakRules"),
		);
	}

	return Effect.void;
}

function validatePersistedPresetBreakRules(value: unknown) {
	try {
		parsePresetBreakRulesStrict(value);
		return Effect.void;
	} catch (error) {
		if (error instanceof ValidationError) return Effect.fail(error);
		return Effect.fail(validationError("Preset break rules are malformed", "breakRulesJson"));
	}
}

function stringifyPresetBreakRules(input: WorkPolicyPresetInput) {
	const rules = input.regulationEnabled ? (input.regulation?.breakRules ?? []) : [];
	return JSON.stringify({ rules }) as unknown as TimeRegulationBreakRulesPreset;
}

function presetInputToPolicyInput(input: WorkPolicyPresetInput): CreateWorkPolicyInput {
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

function presetToInput(preset: typeof workPolicyPreset.$inferSelect): WorkPolicyPresetInput {
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

function presetInputToBaseValues(input: WorkPolicyPresetInput) {
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

function presetInputToInsertValues(organizationId: string, input: WorkPolicyPresetInput) {
	return {
		organizationId,
		...presetInputToBaseValues(input),
		isActive: true,
	};
}

function presetInputToUpdateValues(input: WorkPolicyPresetInput) {
	return presetInputToBaseValues(input);
}

function validatePresetName(input: WorkPolicyPresetInput) {
	if (!normalizePresetName(input.name)) {
		return Effect.fail(
			new ValidationError({
				message: "Preset name is required",
				field: "name",
			}),
		);
	}
	return validatePresetBreakRules(input);
}

export async function getWorkPolicyPresets(
	organizationId?: string,
): Promise<ServerActionResult<WorkPolicyPresetWithSource[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getWorkPolicyPresets:actor",
			}),
		);
		const activeOrganizationId = organizationId ?? actor.organizationId;

		const dbService = yield* _(DatabaseService);
		const presets = yield* _(
			dbService.query("getWorkPolicyPresets", async () => {
				return await dbService.db.query.workPolicyPreset.findMany({
					where: and(
						eq(workPolicyPreset.isActive, true),
						or(
							isNull(workPolicyPreset.organizationId),
							eq(workPolicyPreset.organizationId, activeOrganizationId),
						),
					),
					orderBy: [workPolicyPreset.name],
				});
			}),
		);

		return presets.map((preset) => ({
			...preset,
			source: preset.organizationId ? "custom" : "system",
			sourceLabel: preset.organizationId ? "Custom" : "System",
		})) satisfies WorkPolicyPresetWithSource[];
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// VIOLATIONS
// ============================================

export async function getWorkPolicyViolations(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<ServerActionResult<WorkPolicyViolationWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getWorkPolicyViolations:actor",
			}),
		);

		if (!canAccessWorkPolicyComplianceActions(actor.accessTier)) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy_violation",
						action: "read",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const violations = yield* _(
			dbService.query("getWorkPolicyViolations", async () => {
				return await dbService.db.query.workPolicyViolation.findMany({
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
				});
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function acknowledgeWorkPolicyViolation(
	violationId: string,
	note?: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "acknowledgeWorkPolicyViolation:actor" }),
		);

		if (!canAccessWorkPolicyComplianceActions(actor.accessTier)) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy_violation",
						action: "update",
					}),
				),
			);
		}

		const dbService = yield* _(DatabaseService);
		const employeeRecord = yield* _(
			requireSettingsActorEmployeeRecord(actor, {
				message: "Employee profile not found",
				resource: "employee",
				action: "update",
			}),
		);

		yield* _(
			dbService.query("acknowledgeViolation", async () => {
				await dbService.db
					.update(workPolicyViolation)
					.set({
						acknowledgedBy: employeeRecord.id,
						acknowledgedAt: new Date(),
						acknowledgedNote: note,
					})
					.where(
						and(
							eq(workPolicyViolation.id, violationId),
							eq(workPolicyViolation.organizationId, employeeRecord.organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// SET DEFAULT
// ============================================

export async function setDefaultWorkPolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const policy = yield* _(
			dbService.query("getPolicy", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
				});
			}),
		);

		if (!policy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Policy not found",
						entityType: "work_policy",
						entityId: policyId,
					}),
				),
			);
		}

		const hasPermission = yield* _(Effect.promise(() => isOrgAdminCasl(policy!.organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_policy",
						action: "update",
					}),
				),
			);
		}

		// Unset current default
		yield* _(
			dbService.query("unsetDefault", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						isDefault: false,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(
						and(
							eq(workPolicy.organizationId, policy!.organizationId),
							eq(workPolicy.isDefault, true),
						),
					);
			}),
		);

		// Set new default
		yield* _(
			dbService.query("setDefault", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						isDefault: true,
						updatedBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workPolicy.id, policyId));
			}),
		);

		yield* _(
			Effect.promise(() =>
				markOrganizationWorkBalancesDirty({ organizationId: policy!.organizationId }),
			),
		);

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createWorkPolicyPreset(
	organizationId: string,
	input: WorkPolicyPresetInput,
): Promise<ServerActionResult<typeof workPolicyPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "createWorkPolicyPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy_preset",
				action: "create",
			}),
		);
		yield* _(validatePresetName(input));

		const dbService = yield* _(DatabaseService);
		const name = normalizePresetName(input.name);
		const duplicate = yield* _(
			dbService.query("checkDuplicatePreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.organizationId, organizationId),
						eq(workPolicyPreset.name, name),
					),
				});
			}),
		);

		if (duplicate) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "A preset with this name already exists",
						conflictType: "duplicate_name",
						details: { entityType: "work_policy_preset", field: "name" },
					}),
				),
			);
		}

		const [createdPreset] = yield* _(
			dbService.query("createWorkPolicyPreset", async () => {
				return await dbService.db
					.insert(workPolicyPreset)
					.values(presetInputToInsertValues(organizationId, input))
					.returning();
			}),
		);

		return createdPreset;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function updateWorkPolicyPreset(
	organizationId: string,
	presetId: string,
	input: WorkPolicyPresetInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "updateWorkPolicyPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy_preset",
				action: "update",
			}),
		);
		yield* _(validatePresetName(input));

		const dbService = yield* _(DatabaseService);
		const preset = yield* _(
			dbService.query("getWorkPolicyPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.organizationId, organizationId),
						eq(workPolicyPreset.isActive, true),
					),
				});
			}),
		);

		if (!preset || preset.organizationId !== organizationId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		const name = normalizePresetName(input.name);
		const duplicate = yield* _(
			dbService.query("checkDuplicatePreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.organizationId, organizationId),
						eq(workPolicyPreset.name, name),
					),
				});
			}),
		);

		if (duplicate && duplicate.id !== presetId) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "A preset with this name already exists",
						conflictType: "duplicate_name",
						details: { entityType: "work_policy_preset", field: "name" },
					}),
				),
			);
		}

		yield* _(
			dbService.query("updateWorkPolicyPreset", async () => {
				await dbService.db
					.update(workPolicyPreset)
					.set(presetInputToUpdateValues(input))
					.where(
						and(
							eq(workPolicyPreset.id, presetId),
							eq(workPolicyPreset.organizationId, organizationId),
							eq(workPolicyPreset.isActive, true),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function archiveWorkPolicyPreset(
	organizationId: string,
	presetId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "archiveWorkPolicyPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy_preset",
				action: "delete",
			}),
		);

		const dbService = yield* _(DatabaseService);
		const preset = yield* _(
			dbService.query("getWorkPolicyPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.organizationId, organizationId),
					),
				});
			}),
		);

		if (!preset) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		if (preset.organizationId === null) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "System presets cannot be archived",
						field: "presetId",
					}),
				),
			);
		}

		if (preset.organizationId !== organizationId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		yield* _(
			dbService.query("archiveWorkPolicyPreset", async () => {
				await dbService.db
					.update(workPolicyPreset)
					.set({ isActive: false })
					.where(
						and(
							eq(workPolicyPreset.id, presetId),
							eq(workPolicyPreset.organizationId, organizationId),
						),
					);
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function copySystemWorkPolicyPreset(
	organizationId: string,
	presetId: string,
	input: WorkPolicyPresetInput,
): Promise<ServerActionResult<typeof workPolicyPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "copySystemWorkPolicyPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy_preset",
				action: "create",
			}),
		);
		yield* _(validatePresetName(input));

		const dbService = yield* _(DatabaseService);
		const sourcePreset = yield* _(
			dbService.query("getSystemWorkPolicyPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						isNull(workPolicyPreset.organizationId),
						eq(workPolicyPreset.isActive, true),
					),
				});
			}),
		);

		if (!sourcePreset || sourcePreset.organizationId !== null || !sourcePreset.isActive) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		const name = normalizePresetName(input.name);
		const duplicate = yield* _(
			dbService.query("checkDuplicatePreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.organizationId, organizationId),
						eq(workPolicyPreset.name, name),
					),
				});
			}),
		);

		if (duplicate) {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "A preset with this name already exists",
						conflictType: "duplicate_name",
						details: { entityType: "work_policy_preset", field: "name" },
					}),
				),
			);
		}

		const [createdPreset] = yield* _(
			dbService.query("copySystemWorkPolicyPreset", async () => {
				return await dbService.db
					.insert(workPolicyPreset)
					.values(presetInputToInsertValues(organizationId, input))
					.returning();
			}),
		);

		return createdPreset;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function createWorkPolicyFromPreset(
	organizationId: string,
	presetId: string,
	input: WorkPolicyPresetInput,
	setAsDefault: boolean = false,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "createWorkPolicyFromPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy",
				action: "create",
			}),
		);

		const dbService = yield* _(DatabaseService);
		const preset = yield* _(
			dbService.query("getVisibleWorkPolicyPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.isActive, true),
						or(
							isNull(workPolicyPreset.organizationId),
							eq(workPolicyPreset.organizationId, organizationId),
						),
					),
				});
			}),
		);

		if (!preset?.isActive || (preset.organizationId && preset.organizationId !== organizationId)) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}
		yield* _(validatePersistedPresetBreakRules(preset.breakRulesJson));
		yield* _(validatePresetName(input));

		const createResult = yield* _(
			Effect.promise(() => createWorkPolicy(organizationId, presetInputToPolicyInput(input))),
		);
		if (!createResult.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: createResult.error ?? "Failed to create policy from preset",
						field: "preset",
					}),
				),
			);
		}

		if (setAsDefault) {
			const setDefaultResult = yield* _(
				Effect.promise(() => setDefaultWorkPolicy(createResult.data.id)),
			);
			if (!setDefaultResult.success) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: setDefaultResult.error ?? "Failed to set policy as default",
							field: "setAsDefault",
						}),
					),
				);
			}
		}

		return createResult.data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// Temporary compatibility wrapper for the existing preset import UI.
export async function importWorkPolicyPreset(
	organizationId: string,
	presetId: string,
	setAsDefault: boolean = false,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "importWorkPolicyPreset:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Insufficient permissions",
				resource: "work_policy",
				action: "create",
			}),
		);

		const dbService = yield* _(DatabaseService);
		const preset = yield* _(
			dbService.query("getPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: and(
						eq(workPolicyPreset.id, presetId),
						eq(workPolicyPreset.isActive, true),
						or(
							isNull(workPolicyPreset.organizationId),
							eq(workPolicyPreset.organizationId, organizationId),
						),
					),
				});
			}),
		);

		if (!preset) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		let presetInput: WorkPolicyPresetInput;
		try {
			presetInput = presetToInput(preset);
		} catch (error) {
			return yield* _(
				Effect.fail(
					error instanceof ValidationError
						? error
						: validationError("Preset break rules are malformed", "breakRulesJson"),
				),
			);
		}

		const result = yield* _(
			Effect.promise(() =>
				createWorkPolicyFromPreset(organizationId, presetId, presetInput, setAsDefault),
			),
		);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error ?? "Failed to import preset",
						field: "preset",
					}),
				),
			);
		}

		return result.data;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DUPLICATE POLICY
// ============================================

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

export async function getEmployeeEffectiveScheduleDetails(
	employeeId: string,
): Promise<ServerActionResult<EmployeeScheduleDetails | null>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				queryName: "getEmployeeEffectiveScheduleDetails:actor",
			}),
		);
		const dbService = yield* _(DatabaseService);
		const targetEmployee = yield* _(
			getTargetEmployee(employeeId, "getEmployeeEffectiveScheduleDetails:getTargetEmployee"),
		);
		yield* _(
			ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
				message: "Insufficient permissions",
				resource: "employee_schedule_details",
				action: "read",
			}),
		);

		// Get employee with organization
		const emp = yield* _(
			dbService.query("getEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, employeeId),
						eq(employee.organizationId, actor.organizationId),
					),
					with: { team: true },
				});
			}),
		);

		if (!emp) {
			return null;
		}

		const now = new Date();

		// Check employee-level assignment first
		const employeeAssignment = yield* _(
			dbService.query("getEmployeePolicyAssignment", async () => {
				return await dbService.db.query.workPolicyAssignment.findFirst({
					where: and(
						eq(workPolicyAssignment.organizationId, actor.organizationId),
						eq(workPolicyAssignment.employeeId, employeeId),
						eq(workPolicyAssignment.assignmentType, "employee"),
						eq(workPolicyAssignment.isActive, true),
						or(
							isNull(workPolicyAssignment.effectiveFrom),
							lte(workPolicyAssignment.effectiveFrom, now),
						),
						or(
							isNull(workPolicyAssignment.effectiveUntil),
							gte(workPolicyAssignment.effectiveUntil, now),
						),
					),
					orderBy: (assignment, { desc }) => [
						sql`${assignment.effectiveFrom} DESC NULLS LAST`,
						desc(assignment.createdAt),
					],
					with: {
						policy: {
							with: {
								schedule: {
									with: {
										days: true,
									},
								},
							},
						},
					},
				});
			}),
		);
		const typedEmployeeAssignment =
			employeeAssignment as unknown as EffectiveWorkPolicyAssignment | null;

		if (
			typedEmployeeAssignment?.policy?.isActive &&
			typedEmployeeAssignment.policy.scheduleEnabled
		) {
			const schedule = typedEmployeeAssignment.policy.schedule;
			return {
				policyName: typedEmployeeAssignment.policy.name,
				assignedVia: "Individual",
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

		// Check team-level assignment
		if (emp.teamId) {
			const teamAssignment = yield* _(
				dbService.query("getTeamPolicyAssignment", async () => {
					return await dbService.db.query.workPolicyAssignment.findFirst({
						where: and(
							eq(workPolicyAssignment.organizationId, actor.organizationId),
							eq(workPolicyAssignment.teamId, emp.teamId!),
							eq(workPolicyAssignment.assignmentType, "team"),
							eq(workPolicyAssignment.isActive, true),
							or(
								isNull(workPolicyAssignment.effectiveFrom),
								lte(workPolicyAssignment.effectiveFrom, now),
							),
							or(
								isNull(workPolicyAssignment.effectiveUntil),
								gte(workPolicyAssignment.effectiveUntil, now),
							),
						),
						orderBy: (assignment, { desc }) => [
							sql`${assignment.effectiveFrom} DESC NULLS LAST`,
							desc(assignment.createdAt),
						],
						with: {
							policy: {
								with: {
									schedule: {
										with: {
											days: true,
										},
									},
								},
							},
							team: true,
						},
					});
				}),
			);
			const typedTeamAssignment = teamAssignment as unknown as EffectiveWorkPolicyAssignment | null;

			if (typedTeamAssignment?.policy?.isActive && typedTeamAssignment.policy.scheduleEnabled) {
				const schedule = typedTeamAssignment.policy.schedule;
				return {
					policyName: typedTeamAssignment.policy.name,
					assignedVia: typedTeamAssignment.team?.name ?? "Team",
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
		}

		// Check organization-level assignment
		const orgAssignment = yield* _(
			dbService.query("getOrgPolicyAssignment", async () => {
				return await dbService.db.query.workPolicyAssignment.findFirst({
					where: and(
						eq(workPolicyAssignment.organizationId, actor.organizationId),
						eq(workPolicyAssignment.assignmentType, "organization"),
						eq(workPolicyAssignment.isActive, true),
						or(
							isNull(workPolicyAssignment.effectiveFrom),
							lte(workPolicyAssignment.effectiveFrom, now),
						),
						or(
							isNull(workPolicyAssignment.effectiveUntil),
							gte(workPolicyAssignment.effectiveUntil, now),
						),
					),
					orderBy: (assignment, { desc }) => [
						sql`${assignment.effectiveFrom} DESC NULLS LAST`,
						desc(assignment.createdAt),
					],
					with: {
						policy: {
							with: {
								schedule: {
									with: {
										days: true,
									},
								},
							},
						},
					},
				});
			}),
		);
		const typedOrgAssignment = orgAssignment as unknown as EffectiveWorkPolicyAssignment | null;

		if (typedOrgAssignment?.policy?.isActive && typedOrgAssignment.policy.scheduleEnabled) {
			const schedule = typedOrgAssignment.policy.schedule;
			return {
				policyName: typedOrgAssignment.policy.name,
				assignedVia: "Organization Default",
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

		return null;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// HELPER ACTIONS FOR ASSIGNMENT DIALOG
// ============================================

export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const teams = yield* _(
			dbService.query("getTeamsForAssignment", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: (t, { asc }) => [asc(t.name)],
				});
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeesForAssignment(organizationId: string): Promise<
	ServerActionResult<
		{
			id: string;
			firstName: string | null;
			lastName: string | null;
			employeeNumber: string | null;
		}[]
	>
> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getEmployeesForAssignment:actor",
			}),
		);
		const dbService = yield* _(DatabaseService);
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const employees = yield* _(
			dbService.query("getEmployeesForAssignment", async () => {
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
			}),
		);

		if (!managedEmployeeIds) {
			return employees;
		}

		return employees.filter((employeeRecord) => managedEmployeeIds.has(employeeRecord.id));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DUPLICATE POLICY
// ============================================

export async function duplicateWorkPolicy(
	policyId: string,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const existingPolicy = yield* _(
			dbService.query("getExisting", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, policyId),
					with: {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
						presence: true,
					},
				});
			}),
		);

		if (!existingPolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Policy not found",
						entityType: "work_policy",
						entityId: policyId,
					}),
				),
			);
		}
		const existingPolicyWithDetails = existingPolicy as WorkPolicyWithDetails;

		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdminCasl(existingPolicy!.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: session.user.id,
						resource: "work_policy",
						action: "create",
					}),
				),
			);
		}

		// Generate unique name
		let newName = `${existingPolicy!.name} (Copy)`;
		let copyNumber = 1;

		let nameExists = true;
		while (nameExists) {
			const duplicate = yield* _(
				dbService.query("checkDuplicate", async () => {
					return await dbService.db.query.workPolicy.findFirst({
						where: and(
							eq(workPolicy.organizationId, existingPolicy!.organizationId),
							eq(workPolicy.name, newName),
							eq(workPolicy.isActive, true),
						),
					});
				}),
			);

			if (duplicate) {
				copyNumber++;
				newName = `${existingPolicy!.name} (Copy ${copyNumber})`;
			} else {
				nameExists = false;
			}
		}

		// Create new policy
		const [newPolicy] = yield* _(
			dbService.query("createDuplicate", async () => {
				return await dbService.db
					.insert(workPolicy)
					.values({
						organizationId: existingPolicy!.organizationId,
						name: newName,
						description: existingPolicy!.description,
						scheduleEnabled: existingPolicy!.scheduleEnabled,
						regulationEnabled: existingPolicy!.regulationEnabled,
						presenceEnabled: existingPolicy!.presenceEnabled,
						isDefault: false,
						createdBy: session.user.id,
						updatedAt: currentTimestamp(),
					})
					.returning();
			}),
		);

		// Duplicate schedule if exists
		if (existingPolicyWithDetails.schedule) {
			const scheduleSource = existingPolicyWithDetails.schedule;
			const [schedule] = yield* _(
				dbService.query("duplicateSchedule", async () => {
					return await dbService.db
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
						.returning();
				}),
			);

			if (scheduleSource.days.length > 0) {
				yield* _(
					dbService.query("duplicateScheduleDays", async () => {
						await dbService.db.insert(workPolicyScheduleDay).values(
							scheduleSource.days.map((day) => ({
								scheduleId: schedule.id,
								dayOfWeek: day.dayOfWeek,
								hoursPerDay: day.hoursPerDay,
								isWorkDay: day.isWorkDay,
								cycleWeek: day.cycleWeek,
							})),
						);
					}),
				);
			}
		}

		// Duplicate regulation if exists
		if (existingPolicyWithDetails.regulation) {
			const regulationSource = existingPolicyWithDetails.regulation;
			const [regulation] = yield* _(
				dbService.query("duplicateRegulation", async () => {
					return await dbService.db
						.insert(workPolicyRegulation)
						.values({
							policyId: newPolicy.id,
							maxDailyMinutes: regulationSource.maxDailyMinutes,
							maxWeeklyMinutes: regulationSource.maxWeeklyMinutes,
							maxUninterruptedMinutes: regulationSource.maxUninterruptedMinutes,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			for (const rule of regulationSource.breakRules) {
				const [breakRule] = yield* _(
					dbService.query("duplicateBreakRule", async () => {
						return await dbService.db
							.insert(workPolicyBreakRule)
							.values({
								regulationId: regulation.id,
								workingMinutesThreshold: rule.workingMinutesThreshold,
								requiredBreakMinutes: rule.requiredBreakMinutes,
								sortOrder: rule.sortOrder,
								updatedAt: currentTimestamp(),
							})
							.returning();
					}),
				);

				if (rule.options.length > 0) {
					yield* _(
						dbService.query("duplicateBreakOptions", async () => {
							await dbService.db.insert(workPolicyBreakOption).values(
								rule.options.map((opt) => ({
									breakRuleId: breakRule.id,
									splitCount: opt.splitCount,
									minimumSplitMinutes: opt.minimumSplitMinutes,
									minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
									sortOrder: opt.sortOrder,
								})),
							);
						}),
					);
				}
			}
		}

		// Duplicate presence if exists
		if (existingPolicyWithDetails.presence) {
			const presenceSource = existingPolicyWithDetails.presence;
			yield* _(
				dbService.query("duplicatePresence", async () => {
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
				}),
			);
		}

		// Fetch complete policy
		const completePolicy = yield* _(
			dbService.query("fetchComplete", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, newPolicy.id),
					with: {
						schedule: {
							with: { days: true },
						},
						regulation: {
							with: {
								breakRules: {
									with: { options: true },
								},
							},
						},
						presence: true,
					},
				});
			}),
		);

		if (!completePolicy) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Failed to fetch duplicated policy",
						entityType: "work_policy",
					}),
				),
			);
		}

		return completePolicy as WorkPolicyWithDetails;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
