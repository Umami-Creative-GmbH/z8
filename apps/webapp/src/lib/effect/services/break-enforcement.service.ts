import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { timeEntry, workPeriod } from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type AutomaticBreakAdjustmentOutcome,
	type LegacyBreakPlan,
	runAutomaticBreakAdjustment,
} from "@/lib/time-tracking/automatic-break-adjustment";
import { calculateBreakDeficit } from "@/lib/time-tracking/break-policy-calculation";
import { readBreakMinutesTakenBefore } from "@/lib/time-tracking/breaks-taken";
import { capturedZone } from "@/lib/time-tracking/timezone-capture";
import { DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { tryPromiseWithRunner } from "@/lib/effect/promise-callback";
import { DatabaseService } from "./database.service";
import { WorkPolicyService } from "./work-policy.service";

// ============================================
// TYPES
// ============================================

export interface EnforceBreaksInput {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
	/** The zone a legacy adjustment's break entries are captured in; not the day counted. */
	timezone: string;
	createdBy: string;
}

export interface BreakEnforcementResult {
	wasAdjusted: boolean;
	affectedWorkPeriodIds: string[];
	adjustment?: {
		breakMinutes: number;
		breakInsertedAt: string; // ISO timestamp
		regulationName: string;
		originalDurationMinutes: number;
		adjustedDurationMinutes: number;
	};
}

/** The legacy cron's `createdBy`; it names no user, so it triggers nothing. */
const SYSTEM_CRON_ACTOR = "system-cron";

/** The adapter result of one routed adjustment. */
export function breakEnforcementResultOf(
	workPeriodId: string,
	outcome: AutomaticBreakAdjustmentOutcome,
): BreakEnforcementResult {
	if (outcome.kind !== "adjusted") {
		return {
			wasAdjusted: false,
			affectedWorkPeriodIds: resolveAffectedWorkPeriodIds(workPeriodId),
		};
	}
	return {
		wasAdjusted: true,
		affectedWorkPeriodIds: resolveAffectedWorkPeriodIds(
			outcome.workPeriodId,
			outcome.generatedWorkPeriodId,
		),
		adjustment: {
			breakMinutes: outcome.breakMinutes,
			breakInsertedAt: outcome.breakStartAt,
			regulationName: outcome.regulationName,
			originalDurationMinutes: outcome.originalDurationMinutes,
			adjustedDurationMinutes: outcome.adjustedDurationMinutes,
		},
	};
}

export function resolveAffectedWorkPeriodIds(
	originalWorkPeriodId: string,
	insertedWorkPeriodId?: string,
): string[] {
	return insertedWorkPeriodId
		? [originalWorkPeriodId, insertedWorkPeriodId]
		: [originalWorkPeriodId];
}

export interface ProcessUnprocessedPeriodsInput {
	organizationId?: string; // If not provided, process all organizations
	date?: Date; // If not provided, process today
}

export interface ProcessUnprocessedPeriodsResult {
	processedCount: number;
	adjustedCount: number;
	errors: Array<{ workPeriodId: string; error: string }>;
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class BreakEnforcementService extends Context.Service<
	BreakEnforcementService,
	{
		/**
		 * Check and enforce breaks after clock-out
		 * If the work period violates break rules, automatically insert a break
		 * by splitting the work period
		 */
		readonly enforceBreaksAfterClockOut: (
			input: EnforceBreaksInput,
		) => Effect.Effect<BreakEnforcementResult, NotFoundError | DatabaseError>;

		/**
		 * Process work periods that haven't been checked for break enforcement
		 * Used by cron job for safety net processing
		 */
		readonly processUnprocessedPeriods: (
			input: ProcessUnprocessedPeriodsInput,
		) => Effect.Effect<ProcessUnprocessedPeriodsResult, DatabaseError>;

		/**
		 * Calculate break deficit for a given work session under the policy in force
		 * at `policyAt` within the organization.
		 * Returns the number of break minutes that need to be added
		 */
		readonly calculateBreakDeficit: (params: {
			employeeId: string;
			organizationId: string;
			policyAt: Instant;
			sessionDurationMinutes: number;
			breaksTakenMinutes: number;
		}) => Effect.Effect<
			{
				deficit: number;
				applicableRule: {
					workingMinutesThreshold: number;
					requiredBreakMinutes: number;
				} | null;
				regulationId: string | null;
				regulationName: string | null;
				maxUninterruptedMinutes: number | null;
			},
			NotFoundError | DatabaseError
		>;
	}
>()("BreakEnforcementService") {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const BreakEnforcementServiceLive = Layer.effect(
	BreakEnforcementService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const workPolicyService = yield* WorkPolicyService;

		/**
		 * Internal function to calculate break deficit under the policy in force at
		 * `policyAt` within the organization (ADR 0003), never at the time it runs.
		 * Can be called directly without going through the service interface
		 */
		const calculateBreakDeficitInternal = (params: {
			employeeId: string;
			organizationId: string;
			policyAt: Instant;
			sessionDurationMinutes: number;
			breaksTakenMinutes: number;
		}): Effect.Effect<
			{
				deficit: number;
				applicableRule: {
					workingMinutesThreshold: number;
					requiredBreakMinutes: number;
				} | null;
				regulationId: string | null;
				regulationName: string | null;
				maxUninterruptedMinutes: number | null;
			},
			NotFoundError | DatabaseError
		> =>
			Effect.gen(function* () {
				const policy = yield* workPolicyService.getEffectivePolicyAt({
					employeeId: params.employeeId,
					organizationId: params.organizationId,
					at: params.policyAt,
				});

				// If no policy or no regulation enabled, no break requirements
				if (!policy?.regulation) {
					return {
						deficit: 0,
						applicableRule: null,
						regulationId: null,
						regulationName: null,
						maxUninterruptedMinutes: null,
					};
				}

				return calculateBreakDeficit({
					sessionDurationMinutes: params.sessionDurationMinutes,
					alreadyTakenBreakMinutes: params.breaksTakenMinutes,
					regulation: {
						id: policy.policyId,
						name: policy.policyName,
						maxUninterruptedMinutes: policy.regulation.maxUninterruptedMinutes,
						breakRules: policy.regulation.breakRules,
					},
				});
			});

		/**
		 * The established legacy plan from plain reads: the period, the breaks already
		 * taken on its own day and the policy in force when it ended, with the established
		 * placement and arithmetic. Only a legacy organization's adjustment uses it; its writes run
		 * in the coordinated owner.
		 */
		const planLegacyBreakEnforcement = (
			input: EnforceBreaksInput,
		): Effect.Effect<LegacyBreakPlan | null, NotFoundError | DatabaseError> =>
			Effect.gen(function* () {
				const period = yield* dbService.query("getWorkPeriodForEnforcement", async () => {
					return await dbService.db.query.workPeriod.findFirst({
						where: and(
							eq(workPeriod.id, input.workPeriodId),
							eq(workPeriod.organizationId, input.organizationId),
							eq(workPeriod.employeeId, input.employeeId),
						),
					});
				});

				if (!period) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Work period not found",
							entityType: "workPeriod",
							entityId: input.workPeriodId,
						}),
					);
				}

				// Skip if already auto-adjusted
				if (period.wasAutoAdjusted || !period.endTime || !period.clockOutId) {
					return null;
				}

				// Breaks already taken on the work's own local start day, counted as the
				// adopted adjustment counts them (#547): never the day enforcement runs,
				// and never `input.timezone`, which only captures the break entries.
				const clockIn = yield* dbService.query("getClockInCaptureForEnforcement", async () => {
					const [entry] = await dbService.db
						.select({
							timezone: timeEntry.timezone,
							utcOffsetMinutes: timeEntry.utcOffsetMinutes,
						})
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.id, period.clockInId),
								eq(timeEntry.organizationId, input.organizationId),
								eq(timeEntry.employeeId, input.employeeId),
							),
						)
						.limit(1);
					return entry;
				});
				if (!clockIn) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Clock-in entry not found",
							entityType: "timeEntry",
							entityId: period.clockInId,
						}),
					);
				}
				const endTime = period.endTime;
				const breaksTaken = yield* dbService.query("getBreaksTakenBeforeWork", () =>
					readBreakMinutesTakenBefore(dbService.db, {
						organizationId: input.organizationId,
						employeeId: input.employeeId,
						workPeriodId: period.id,
						startAt: instantFromDate(period.startTime),
						endAt: instantFromDate(endTime),
						startZone: capturedZone(clockIn),
					}),
				);

				// The rule in force when the work ended, as the adopted break snapshot
				// looks it up (#549): never the rule on the day enforcement runs.
				const deficitResult = yield* calculateBreakDeficitInternal({
					employeeId: input.employeeId,
					organizationId: input.organizationId,
					policyAt: instantFromDate(endTime),
					sessionDurationMinutes: input.sessionDurationMinutes,
					breaksTakenMinutes: breaksTaken,
				});

				// No enforcement needed if no deficit or no applicable rule
				if (
					deficitResult.deficit <= 0 ||
					!deficitResult.applicableRule ||
					!deficitResult.regulationId ||
					!deficitResult.regulationName
				) {
					return null;
				}

				// Determine where to insert the break
				// Insert after maxUninterruptedMinutes from start, or after the threshold
				const maxUninterrupted = deficitResult.maxUninterruptedMinutes;
				const insertAfterMinutes = maxUninterrupted
					? Math.min(
							maxUninterrupted,
							deficitResult.applicableRule.workingMinutesThreshold,
						)
					: deficitResult.applicableRule.workingMinutesThreshold;

				// Calculate break insertion point
				const startDT = dateFromDB(period.startTime);
				if (!startDT) return null;

				const breakStartDT = startDT.plus({ minutes: insertAfterMinutes });
				const breakEndDT = breakStartDT.plus({
					minutes: deficitResult.deficit,
				});
				const breakStartDate = dateToDB(breakStartDT);
				const breakEndDate = dateToDB(breakEndDT);

				if (!breakStartDate || !breakEndDate) return null;

				// Validate break times are within the work period
				if (
					breakStartDate <= period.startTime ||
					breakEndDate >= period.endTime
				) {
					return null;
				}

				const originalDurationMinutes =
					period.durationMinutes || input.sessionDurationMinutes;

				// Calculate new durations
				const firstDurationMinutes = Math.floor(
					(breakStartDate.getTime() - period.startTime.getTime()) / 60000,
				);
				const secondDurationMinutes = Math.floor(
					(period.endTime.getTime() - breakEndDate.getTime()) / 60000,
				);

				return {
					expected: {
						clockInId: period.clockInId,
						clockOutId: period.clockOutId,
						startTime: period.startTime,
						endTime: period.endTime,
						durationMinutes: period.durationMinutes,
					},
					breakStart: breakStartDate,
					breakEnd: breakEndDate,
					timezone: input.timezone,
					firstDurationMinutes,
					secondDurationMinutes,
					reason: {
						type: "break_enforcement",
						regulationId: deficitResult.regulationId,
						regulationName: deficitResult.regulationName,
						breakInsertedMinutes: deficitResult.deficit,
						breakInsertedAt: breakStartDate.toISOString(),
						originalDurationMinutes,
						adjustedDurationMinutes: firstDurationMinutes + secondDurationMinutes,
						ruleApplied: deficitResult.applicableRule,
					},
				} satisfies LegacyBreakPlan;
			});

		/**
		 * Enforces breaks after a clock-out through the one automatic adjustment owner
		 * (#305): adopted organizations run the completed-work operation and keep a
		 * durable intent while review blocks it; legacy organizations run the established
		 * plan with atomic, coordinated writes. A committed closure is never undone.
		 */
		const enforceBreaksAfterClockOutInternal = (
			input: EnforceBreaksInput,
		): Effect.Effect<BreakEnforcementResult, NotFoundError | DatabaseError> =>
			Effect.gen(function* () {
				const outcome = yield* tryPromiseWithRunner({
					try: (run) =>
						runAutomaticBreakAdjustment({
							organizationId: input.organizationId,
							employeeId: input.employeeId,
							workPeriodId: input.workPeriodId,
							trigger: {
								userId:
									input.createdBy === SYSTEM_CRON_ACTOR ? null : input.createdBy,
								closureEntryId: null,
							},
							planLegacy: () => run(planLegacyBreakEnforcement(input)),
						}),
					catch: (cause) =>
						cause instanceof NotFoundError
							? cause
							: new DatabaseError({
									message: "Automatic break adjustment failed",
									operation: "adjustAutomaticBreak",
									cause,
								}),
				});
				return breakEnforcementResultOf(input.workPeriodId, outcome);
			});

		return BreakEnforcementService.of({
			calculateBreakDeficit: (params) => calculateBreakDeficitInternal(params),

			enforceBreaksAfterClockOut: (input) =>
				enforceBreaksAfterClockOutInternal(input),

			processUnprocessedPeriods: (input) =>
				Effect.gen(function* () {
					const targetDate = input.date || new Date();
					const targetDT = DateTime.fromJSDate(targetDate);
					const startOfDay = targetDT.startOf("day").toJSDate();
					const endOfDay = targetDT.endOf("day").toJSDate();

					// Find all completed work periods from the target day that haven't been auto-adjusted
					const periods = yield* dbService.query("getUnprocessedPeriods", async () => {
						const conditions = [
							eq(workPeriod.isActive, false),
							eq(workPeriod.wasAutoAdjusted, false),
							gte(workPeriod.startTime, startOfDay),
							lte(workPeriod.startTime, endOfDay),
						];

						// Note: We intentionally don't filter by organizationId here
						// because workPeriod doesn't have a direct organizationId column
						// We'll filter by organization when processing each period

						return await dbService.db.query.workPeriod.findMany({
							where: (period) =>
								and(
									...conditions,
									// Adopted organizations commit a durable intent with every
									// ordinary closure; `processAutomaticBreakIntents` owns them.
									sql`not exists (select 1 from time_entry_append_control control where control.organization_id = ${period.organizationId} and control.mode = 'active')`,
								),
							with: {
								employee: {
									columns: {
										id: true,
										organizationId: true,
									},
									with: {
										userSettings: {
											columns: {
												timezone: true,
											},
										},
									},
								},
							},
						});
					});

					const result: ProcessUnprocessedPeriodsResult = {
						processedCount: 0,
						adjustedCount: 0,
						errors: [],
					};

					for (const period of periods) {
						// Filter by organization if specified
						if (
							input.organizationId &&
							period.organizationId !== input.organizationId
						) {
							continue;
						}

						result.processedCount++;

						const enforcementResultEffect = enforceBreaksAfterClockOutInternal({
							employeeId: period.employeeId,
							organizationId: period.organizationId,
							workPeriodId: period.id,
							sessionDurationMinutes: period.durationMinutes || 0,
							timezone: period.employee?.userSettings?.timezone || "UTC",
							createdBy: SYSTEM_CRON_ACTOR,
						});

						const enforcementResult = yield* Effect.catch(enforcementResultEffect, (error) =>
							Effect.succeed({
								wasAdjusted: false as const,
								error: error instanceof Error ? error.message : String(error),
							}),
						);

						if ("error" in enforcementResult) {
							result.errors.push({
								workPeriodId: period.id,
								error: enforcementResult.error,
							});
						} else if (enforcementResult.wasAdjusted) {
							result.adjustedCount++;
						}
					}

					return result;
				}),
		});
	}),
);

// ============================================
// TESTING HELPERS
// ============================================

/**
 * Export internal function for testing purposes.
 * This allows tests to verify the break deficit calculation logic
 * without going through the full Effect service infrastructure.
 * It looks the policy up as the internal calculation does: at `policyAt`,
 * within the organization.
 */
export const calculateBreakDeficitForTesting = (
	params: {
		employeeId: string;
		organizationId: string;
		policyAt: Instant;
		sessionDurationMinutes: number;
		breaksTakenMinutes: number;
	},
	mockPolicyService: {
		getEffectivePolicyAt: (input: {
			employeeId: string;
			organizationId: string;
			at: Instant;
		}) => Effect.Effect<
			{
				policyId: string;
				policyName: string;
				regulation: {
					maxDailyMinutes: number | null;
					maxWeeklyMinutes: number | null;
					maxUninterruptedMinutes: number | null;
					breakRules: Array<{
						workingMinutesThreshold: number;
						requiredBreakMinutes: number;
						options: Array<{
							splitCount: number | null;
							minimumSplitMinutes: number | null;
							minimumLongestSplitMinutes: number | null;
						}>;
					}>;
				} | null;
				schedule: unknown;
				assignmentType: "organization" | "team" | "employee";
				assignedVia: string;
			} | null,
			never
		>;
	},
): Effect.Effect<
	{
		deficit: number;
		applicableRule: {
			workingMinutesThreshold: number;
			requiredBreakMinutes: number;
		} | null;
		regulationId: string | null;
		regulationName: string | null;
		maxUninterruptedMinutes: number | null;
	},
	never
> =>
	Effect.gen(function* () {
		const policy = yield* mockPolicyService.getEffectivePolicyAt({
			employeeId: params.employeeId,
			organizationId: params.organizationId,
			at: params.policyAt,
		});
		return calculateBreakDeficit({
			sessionDurationMinutes: params.sessionDurationMinutes,
			alreadyTakenBreakMinutes: params.breaksTakenMinutes,
			regulation: policy?.regulation
				? {
						id: policy.policyId,
						name: policy.policyName,
						maxUninterruptedMinutes: policy.regulation.maxUninterruptedMinutes,
						breakRules: policy.regulation.breakRules,
					}
				: null,
		});
	});
