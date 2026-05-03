"use server";

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
	employee,
	legalEntity,
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
import { isOrgAdminCasl } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	AuthorizationError,
	type AnyAppError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
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
import {
	assertSameLegalEntityTarget,
	canAccessWorkPolicyComplianceActions,
	policyBelongsToOrganization,
} from "./policy-scope";

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
	} | null;
};

export type WorkPolicyViolationWithDetails = typeof workPolicyViolation.$inferSelect & {
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
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

function resolveSelectedPolicyLegalEntityId(
	actor: {
		accessTier: string;
		organizationId: string;
		session: { user: { id: string } };
		currentEmployee: { legalEntityId?: string | null } | null;
		legalEntityAdminIds?: string[];
		dbService: {
			db: typeof import("@/db").db;
			query: <T>(key: string, fn: () => Promise<T>) => Effect.Effect<T, AnyAppError, never>;
		};
	},
	requestedLegalEntityId: string | undefined,
	queryName: string,
) {
	return Effect.gen(function* (_) {
		if (requestedLegalEntityId) {
			const requestedEntity = yield* _(
				actor.dbService.query(`${queryName}:requestedLegalEntity`, async () => {
					return await actor.dbService.db.query.legalEntity.findFirst({
						where: and(
							eq(legalEntity.id, requestedLegalEntityId),
							eq(legalEntity.organizationId, actor.organizationId),
							eq(legalEntity.isActive, true),
						),
						columns: { id: true },
					});
				}),
			);
			const canAccess =
				Boolean(requestedEntity) &&
				(actor.accessTier === "orgAdmin" ||
				actor.legalEntityAdminIds?.includes(requestedLegalEntityId) ||
				actor.currentEmployee?.legalEntityId === requestedLegalEntityId);

			if (!canAccess) {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "You do not have access to this legal entity.",
							userId: actor.session.user.id,
							resource: "legal_entity",
							action: "access",
						}),
					),
				);
			}

			return requestedLegalEntityId;
		}

		if (actor.currentEmployee?.legalEntityId) {
			return actor.currentEmployee.legalEntityId;
		}

		const defaultEntity = yield* _(
			actor.dbService.query(queryName, async () => {
				return await actor.dbService.db.query.legalEntity.findFirst({
					where: and(
						eq(legalEntity.organizationId, actor.organizationId),
						eq(legalEntity.isDefault, true),
						eq(legalEntity.isActive, true),
					),
					columns: { id: true },
				});
			}),
		);

		if (!defaultEntity) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "No default legal entity exists for this organization.",
						entityType: "legal_entity",
					}),
				),
			);
		}

		return defaultEntity.id;
	});
}

function canAccessWorkPolicyLegalEntity(
	actor: {
		accessTier: string;
		currentEmployee: { legalEntityId?: string | null } | null;
		legalEntityAdminIds?: string[];
	},
	legalEntityId: string,
) {
	return (
		actor.accessTier === "orgAdmin" ||
		actor.legalEntityAdminIds?.includes(legalEntityId) ||
		actor.currentEmployee?.legalEntityId === legalEntityId
	);
}

function canManageWorkPolicyDefinitions(actor: { accessTier: string }) {
	return actor.accessTier === "orgAdmin" || actor.accessTier === "entityAdmin";
}

function requireWorkPolicyDefinitionMutationAccess(
	actor: { accessTier: string; session: { user: { id: string } } },
	action: "create" | "update" | "delete",
) {
	if (canManageWorkPolicyDefinitions(actor)) {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: "Insufficient permissions",
			userId: actor.session.user.id,
			resource: "work_policy",
			action,
		}),
	);
}

// ============================================
// GET POLICIES
// ============================================

export async function getWorkPolicies(
	organizationId: string,
	selectedLegalEntityId?: string,
): Promise<ServerActionResult<WorkPolicyWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getWorkPolicies:actor" }),
		);
		const scopedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				actor,
				selectedLegalEntityId,
				"getWorkPolicies:defaultLegalEntity",
			),
		);

		const dbService = yield* _(DatabaseService);
		const policies = yield* _(
			dbService.query("getWorkPolicies", async () => {
				return await dbService.db.query.workPolicy.findMany({
					where: and(
						eq(workPolicy.organizationId, organizationId),
						eq(workPolicy.legalEntityId, scopedLegalEntityId),
						eq(workPolicy.isActive, true),
					),
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

		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: policy.organizationId,
				queryName: "getWorkPolicy:actor",
			}),
		);

		if (!canAccessWorkPolicyLegalEntity(actor, policy.legalEntityId)) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy",
						action: "read",
					}),
				),
			);
		}

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
	selectedLegalEntityId?: string,
): Promise<ServerActionResult<WorkPolicyWithDetails>> {
	const effect = Effect.gen(function* (_) {
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
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "createWorkPolicy:actor",
			}),
		);
		yield* _(requireWorkPolicyDefinitionMutationAccess(actor, "create"));
		const scopedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				actor,
				selectedLegalEntityId,
				"createWorkPolicy:defaultLegalEntity",
			),
		);

		// Check for duplicate name
		const existingPolicy = yield* _(
			dbService.query("checkDuplicateName", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: and(
						eq(workPolicy.organizationId, organizationId),
						eq(workPolicy.legalEntityId, scopedLegalEntityId),
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
						legalEntityId: scopedLegalEntityId,
						name: data.name,
						description: data.description,
						scheduleEnabled: data.scheduleEnabled,
						regulationEnabled: data.regulationEnabled,
						presenceEnabled: data.presenceEnabled ?? false,
						createdBy: actor.session.user.id,
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

		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: existingPolicy!.organizationId,
				queryName: "updateWorkPolicy:actor",
			}),
		);

		if (!canAccessWorkPolicyLegalEntity(actor, existingPolicy!.legalEntityId)) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy",
						action: "update",
					}),
				),
			);
		}

		yield* _(requireWorkPolicyDefinitionMutationAccess(actor, "update"));

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
						updatedBy: actor.session.user.id,
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

		return updatedPolicy as WorkPolicyWithDetails;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// DELETE POLICY
// ============================================

export async function deleteWorkPolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
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

		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: existingPolicy!.organizationId,
				queryName: "deleteWorkPolicy:actor",
			}),
		);

		if (!canAccessWorkPolicyLegalEntity(actor, existingPolicy!.legalEntityId)) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions",
						userId: actor.session.user.id,
						resource: "work_policy",
						action: "delete",
					}),
				),
			);
		}

		yield* _(requireWorkPolicyDefinitionMutationAccess(actor, "delete"));

		// Soft delete
		yield* _(
			dbService.query("softDelete", async () => {
				await dbService.db
					.update(workPolicy)
					.set({
						isActive: false,
						isDefault: false,
						updatedBy: actor.session.user.id,
						updatedAt: currentTimestamp(),
					})
					.where(eq(workPolicy.id, policyId));
			}),
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
	selectedLegalEntityId?: string,
): Promise<ServerActionResult<WorkPolicyAssignmentWithDetails[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId,
				queryName: "getWorkPolicyAssignments:actor",
			}),
		);
		const dbService = yield* _(DatabaseService);
		const scopedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				actor,
				selectedLegalEntityId,
				"getWorkPolicyAssignments:defaultLegalEntity",
			),
		);
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const assignments = yield* _(
			dbService.query("getWorkPolicyAssignments", async () => {
				return await dbService.db.query.workPolicyAssignment.findMany({
					where: and(
						eq(workPolicyAssignment.organizationId, organizationId),
						eq(workPolicyAssignment.legalEntityId, scopedLegalEntityId),
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
							columns: { id: true, firstName: true, lastName: true },
						},
					},
					orderBy: [desc(workPolicyAssignment.createdAt)],
				});
			}),
		);

		const typedAssignments = assignments as WorkPolicyAssignmentWithDetails[];

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
		legalEntityId?: string;
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

		let targetEmployeeLegalEntityId: string | null = null;
		if (data.employeeId) {
			const targetEmployee = yield* _(
				getTargetEmployee(data.employeeId, "createWorkPolicyAssignment:getTargetEmployee"),
			);
			targetEmployeeLegalEntityId = targetEmployee.legalEntityId;
			yield* _(
				ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "Insufficient permissions",
					resource: "work_policy_assignment",
					action: "create",
				}),
			);
		}

		let targetTeamLegalEntityId: string | null = null;
		if (data.assignmentType === "team" && data.teamId) {
			const targetTeam = yield* _(
				getOrganizationTeam(
					data.teamId,
					actor.organizationId,
					"createWorkPolicyAssignment:getOrganizationTeam",
				),
			);
			targetTeamLegalEntityId = (targetTeam as unknown as { legalEntityId: string }).legalEntityId;
		}

		const dbService = yield* _(DatabaseService);
		const policy = yield* _(
			dbService.query("getAssignmentPolicy", async () => {
				return await dbService.db.query.workPolicy.findFirst({
					where: eq(workPolicy.id, data.policyId),
					columns: { id: true, organizationId: true, legalEntityId: true },
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

		const scopedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				{ ...actor, dbService },
				data.legalEntityId ?? policy.legalEntityId,
				"createWorkPolicyAssignment:defaultLegalEntity",
			),
		);

		if (policy.legalEntityId !== scopedLegalEntityId) {
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

		if (targetEmployeeLegalEntityId) {
			assertSameLegalEntityTarget({
				policyLegalEntityId: scopedLegalEntityId,
				targetLegalEntityId: targetEmployeeLegalEntityId,
				targetLabel: "employee",
			});
		}

		if (targetTeamLegalEntityId) {
			assertSameLegalEntityTarget({
				policyLegalEntityId: scopedLegalEntityId,
				targetLegalEntityId: targetTeamLegalEntityId,
				targetLabel: "team",
			});
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
						legalEntityId: scopedLegalEntityId,
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// PRESETS
// ============================================

export async function getWorkPolicyPresets(): Promise<
	ServerActionResult<(typeof workPolicyPreset.$inferSelect)[]>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const _session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);
		const presets = yield* _(
			dbService.query("getWorkPolicyPresets", async () => {
				return await dbService.db.query.workPolicyPreset.findMany({
					where: eq(workPolicyPreset.isActive, true),
					orderBy: [workPolicyPreset.name],
				});
			}),
		);

		return presets;
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
							columns: { id: true, firstName: true, lastName: true },
						},
						policy: {
							columns: { id: true, name: true },
						},
					},
					orderBy: [desc(workPolicyViolation.violationDate)],
				});
			}),
		);

		return violations as WorkPolicyViolationWithDetails[];
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

		return undefined;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

// ============================================
// IMPORT PRESET
// ============================================

export async function importWorkPolicyPreset(
	organizationId: string,
	presetId: string,
	setAsDefault: boolean = false,
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

		const dbService = yield* _(DatabaseService);

		// Fetch preset
		const preset = yield* _(
			dbService.query("getPreset", async () => {
				return await dbService.db.query.workPolicyPreset.findFirst({
					where: eq(workPolicyPreset.id, presetId),
				});
			}),
		);

		if (!preset) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "work_policy_preset",
						entityId: presetId,
					}),
				),
			);
		}

		if (!preset!.isActive) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Preset is not active",
						field: "isActive",
					}),
				),
			);
		}

		// Parse breakRulesJson - it's stored as a text column so may be a string
		let parsedBreakRules: {
			rules?: Array<{
				workingMinutesThreshold: number;
				requiredBreakMinutes: number;
				options?: Array<{
					splitCount: number | null;
					minimumSplitMinutes: number | null;
					minimumLongestSplitMinutes: number | null;
				}>;
			}>;
		} | null = null;
		if (preset!.breakRulesJson) {
			try {
				parsedBreakRules =
					typeof preset!.breakRulesJson === "string"
						? JSON.parse(preset!.breakRulesJson)
						: preset!.breakRulesJson;
			} catch {
				parsedBreakRules = null;
			}
		}

		// Transform preset break rules to input format (handle null/undefined safely)
		const breakRules: BreakRuleInput[] =
			parsedBreakRules?.rules?.map((rule) => ({
				workingMinutesThreshold: rule.workingMinutesThreshold,
				requiredBreakMinutes: rule.requiredBreakMinutes,
				options:
					rule.options?.map((opt) => ({
						splitCount: opt.splitCount,
						minimumSplitMinutes: opt.minimumSplitMinutes,
						minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
					})) ?? [],
			})) ?? [];

		// Validate that regulation presets have at least one break rule
		if (breakRules.length === 0) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Preset must have at least one break rule",
						field: "breakRules",
					}),
				),
			);
		}

		const policyInput: CreateWorkPolicyInput = {
			name: preset!.name,
			description: preset!.description ?? undefined,
			scheduleEnabled: false,
			regulationEnabled: true,
			presenceEnabled: false,
			regulation: {
				maxDailyMinutes: preset!.maxDailyMinutes ?? undefined,
				maxWeeklyMinutes: preset!.maxWeeklyMinutes ?? undefined,
				maxUninterruptedMinutes: preset!.maxUninterruptedMinutes ?? undefined,
				breakRules,
			},
		};

		// Create policy using existing function
		const createResult = yield* _(
			Effect.promise(() => createWorkPolicy(organizationId, policyInput)),
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

		const createdPolicy = createResult.data;

		// Set as default if requested
		if (setAsDefault) {
			const setDefaultResult = yield* _(
				Effect.promise(() => setDefaultWorkPolicy(createdPolicy.id)),
			);

			if (!setDefaultResult.success) {
				// Log but don't fail - policy was created successfully
				console.error("Failed to set as default:", setDefaultResult.error);
			}
		}

		return createdPolicy;
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

		if (employeeAssignment?.policy?.isActive && employeeAssignment.policy.scheduleEnabled) {
			const schedule = employeeAssignment.policy.schedule;
			return {
				policyName: employeeAssignment.policy.name,
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

			if (teamAssignment?.policy?.isActive && teamAssignment.policy.scheduleEnabled) {
				const schedule = teamAssignment.policy.schedule;
				return {
					policyName: teamAssignment.policy.name,
					assignedVia: teamAssignment.team?.name ?? "Team",
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

		if (orgAssignment?.policy?.isActive && orgAssignment.policy.scheduleEnabled) {
			const schedule = orgAssignment.policy.schedule;
			return {
				policyName: orgAssignment.policy.name,
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
	selectedLegalEntityIdParam?: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName: "getTeamsForAssignment:actor" }),
		);
		const selectedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				actor,
				selectedLegalEntityIdParam,
				"getTeamsForAssignment:defaultLegalEntity",
			),
		);
		const teams = yield* _(
			actor.dbService.query("getTeamsForAssignment", async () => {
				const teamEmployees = await actor.dbService.db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						eq(employee.legalEntityId, selectedLegalEntityId),
						eq(employee.isActive, true),
					),
					columns: { teamId: true },
				});
				const scopedTeamIds = [...new Set(teamEmployees.map((row) => row.teamId).filter(Boolean))] as string[];

				if (scopedTeamIds.length === 0) {
					return [];
				}

				return await actor.dbService.db.query.team.findMany({
					where: and(eq(team.organizationId, organizationId), inArray(team.id, scopedTeamIds)),
					columns: { id: true, name: true },
					orderBy: (t, { asc }) => [asc(t.name)],
				});
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeesForAssignment(organizationId: string, selectedLegalEntityIdParam?: string): Promise<
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
		const selectedLegalEntityId = yield* _(
			resolveSelectedPolicyLegalEntityId(
				actor,
				selectedLegalEntityIdParam,
				"getEmployeesForAssignment:defaultLegalEntity",
			),
		);
		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const employees = yield* _(
			dbService.query("getEmployeesForAssignment", async () => {
				return await dbService.db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						eq(employee.legalEntityId, selectedLegalEntityId),
						eq(employee.isActive, true),
					),
					columns: { id: true, firstName: true, lastName: true, employeeNumber: true },
					orderBy: (e, { asc }) => [asc(e.lastName), asc(e.firstName)],
				});
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
						legalEntityId: existingPolicy!.legalEntityId,
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
		if (existingPolicy!.schedule) {
			const [schedule] = yield* _(
				dbService.query("duplicateSchedule", async () => {
					return await dbService.db
						.insert(workPolicySchedule)
						.values({
							policyId: newPolicy.id,
							scheduleCycle: existingPolicy!.schedule!.scheduleCycle,
							scheduleType: existingPolicy!.schedule!.scheduleType,
							workingDaysPreset: existingPolicy!.schedule!.workingDaysPreset,
							hoursPerCycle: existingPolicy!.schedule!.hoursPerCycle,
							homeOfficeDaysPerCycle: existingPolicy!.schedule!.homeOfficeDaysPerCycle,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			if (existingPolicy!.schedule!.days.length > 0) {
				yield* _(
					dbService.query("duplicateScheduleDays", async () => {
						await dbService.db.insert(workPolicyScheduleDay).values(
							existingPolicy!.schedule!.days.map((day) => ({
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
		if (existingPolicy!.regulation) {
			const [regulation] = yield* _(
				dbService.query("duplicateRegulation", async () => {
					return await dbService.db
						.insert(workPolicyRegulation)
						.values({
							policyId: newPolicy.id,
							maxDailyMinutes: existingPolicy!.regulation!.maxDailyMinutes,
							maxWeeklyMinutes: existingPolicy!.regulation!.maxWeeklyMinutes,
							maxUninterruptedMinutes: existingPolicy!.regulation!.maxUninterruptedMinutes,
							updatedAt: currentTimestamp(),
						})
						.returning();
				}),
			);

			for (const rule of existingPolicy!.regulation!.breakRules) {
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
		if (existingPolicy!.presence) {
			yield* _(
				dbService.query("duplicatePresence", async () => {
					await dbService.db.insert(workPolicyPresence).values({
						policyId: newPolicy.id,
						presenceMode: existingPolicy!.presence!.presenceMode,
						requiredOnsiteDays: existingPolicy!.presence!.requiredOnsiteDays,
						requiredOnsiteFixedDays: existingPolicy!.presence!.requiredOnsiteFixedDays,
						locationId: existingPolicy!.presence!.locationId,
						evaluationPeriod: existingPolicy!.presence!.evaluationPeriod,
						enforcement: existingPolicy!.presence!.enforcement,
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
