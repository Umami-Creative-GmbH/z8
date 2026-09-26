import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { workPeriod } from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import {
	type AutomaticBreakAdjustmentOutcome,
	type LegacyBreakPlan,
	processAutomaticBreakIntents,
	runAutomaticBreakAdjustment,
} from "@/lib/time-tracking/automatic-break-adjustment";
import { calculateBreakDeficit } from "@/lib/time-tracking/break-policy-calculation";
import { getTodayRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { DatabaseError, NotFoundError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";
import { SurchargeService, SurchargeServiceLive } from "./surcharge.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "./work-policy.service";

// ============================================
// TYPES
// ============================================

export interface EnforceBreaksInput {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
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

export class BreakEnforcementService extends Context.Tag(
	"BreakEnforcementService",
)<
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
		 * Calculate break deficit for a given work session
		 * Returns the number of break minutes that need to be added
		 */
		readonly calculateBreakDeficit: (params: {
			employeeId: string;
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
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const BreakEnforcementServiceLive = Layer.effect(
	BreakEnforcementService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const workPolicyService = yield* _(WorkPolicyService);

		/**
		 * Calculate total break minutes taken today (gaps between work periods)
		 */
		const calculateBreaksTakenToday = (
			employeeId: string,
			timezone: string,
		): Effect.Effect<number, DatabaseError> =>
			Effect.gen(function* (_) {
				const { start: todayStartDT, end: todayEndDT } =
					getTodayRangeInTimezone(timezone);
				const todayStart = dateToDB(todayStartDT);
				const todayEnd = dateToDB(todayEndDT);
				if (!todayStart || !todayEnd) return 0;

				const periods = yield* _(
					dbService.query("getWorkPeriodsForBreakCalc", async () => {
						return await dbService.db.query.workPeriod.findMany({
							where: and(
								eq(workPeriod.employeeId, employeeId),
								gte(workPeriod.startTime, todayStart),
								lte(workPeriod.startTime, todayEnd),
							),
							orderBy: (wp, { asc }) => [asc(wp.startTime)],
						});
					}),
				);

				// Calculate gaps between consecutive work periods
				let totalBreakMinutes = 0;

				for (let i = 0; i < periods.length - 1; i++) {
					const currentEnd = periods[i].endTime;
					const nextStart = periods[i + 1].startTime;

					if (currentEnd && nextStart) {
						const gapMs = nextStart.getTime() - currentEnd.getTime();
						const gapMinutes = Math.floor(gapMs / 60000);
						// Only count gaps > 1 minute as breaks
						if (gapMinutes > 1) {
							totalBreakMinutes += gapMinutes;
						}
					}
				}

				return totalBreakMinutes;
			});

		/**
		 * Internal function to calculate break deficit
		 * Can be called directly without going through the service interface
		 */
		const calculateBreakDeficitInternal = (params: {
			employeeId: string;
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
			Effect.gen(function* (_) {
				const policy = yield* _(
					workPolicyService.getEffectivePolicy(params.employeeId),
				);

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
		 * The established legacy plan from plain reads: the period, today's breaks and the
		 * effective policy, with the established placement and arithmetic. Only a legacy
		 * organization's adjustment uses it; its writes run in the coordinated owner.
		 */
		const planLegacyBreakEnforcement = (
			input: EnforceBreaksInput,
		): Effect.Effect<LegacyBreakPlan | null, NotFoundError | DatabaseError> =>
			Effect.gen(function* (_) {
				const period = yield* _(
					dbService.query("getWorkPeriodForEnforcement", async () => {
						return await dbService.db.query.workPeriod.findFirst({
							where: and(
								eq(workPeriod.id, input.workPeriodId),
								eq(workPeriod.organizationId, input.organizationId),
								eq(workPeriod.employeeId, input.employeeId),
							),
						});
					}),
				);

				if (!period) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Work period not found",
								entityType: "workPeriod",
								entityId: input.workPeriodId,
							}),
						),
					);
				}

				// Skip if already auto-adjusted
				if (period.wasAutoAdjusted || !period.endTime || !period.clockOutId) {
					return null;
				}

				// Calculate breaks taken today
				const breaksTaken = yield* _(
					calculateBreaksTakenToday(input.employeeId, input.timezone),
				);

				// Calculate break deficit
				const deficitResult = yield* _(
					calculateBreakDeficitInternal({
						employeeId: input.employeeId,
						sessionDurationMinutes: input.sessionDurationMinutes,
						breaksTakenMinutes: breaksTaken,
					}),
				);

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
			Effect.gen(function* (_) {
				const outcome = yield* _(
					Effect.tryPromise({
						try: () =>
							runAutomaticBreakAdjustment({
								organizationId: input.organizationId,
								employeeId: input.employeeId,
								workPeriodId: input.workPeriodId,
								trigger: {
									userId:
										input.createdBy === SYSTEM_CRON_ACTOR ? null : input.createdBy,
									closureEntryId: null,
								},
								planLegacy: () =>
									Effect.runPromise(planLegacyBreakEnforcement(input)),
							}),
						catch: (cause) =>
							cause instanceof NotFoundError
								? cause
								: new DatabaseError({
										message:
											cause instanceof Error
												? cause.message
												: "Automatic break adjustment failed",
										operation: "adjustAutomaticBreak",
										cause,
									}),
					}),
				);
				return breakEnforcementResultOf(input.workPeriodId, outcome);
			});

		return BreakEnforcementService.of({
			calculateBreakDeficit: (params) => calculateBreakDeficitInternal(params),

			enforceBreaksAfterClockOut: (input) =>
				enforceBreaksAfterClockOutInternal(input),

			processUnprocessedPeriods: (input) =>
				Effect.gen(function* (_) {
					const targetDate = input.date || new Date();
					const targetDT = DateTime.fromJSDate(targetDate);
					const startOfDay = targetDT.startOf("day").toJSDate();
					const endOfDay = targetDT.endOf("day").toJSDate();

					// Find all completed work periods from the target day that haven't been auto-adjusted
					const periods = yield* _(
						dbService.query("getUnprocessedPeriods", async () => {
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
						}),
					);

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

						const enforcementResult = yield* _(
							Effect.catchAll(enforcementResultEffect, (error) =>
								Effect.succeed({
									wasAdjusted: false as const,
									error: error instanceof Error ? error.message : String(error),
								}),
							),
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
// LAYER DEPENDENCIES
// ============================================

/**
 * Full layer with all dependencies for running break enforcement
 */
export const BreakEnforcementServiceFullLive = BreakEnforcementServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

// ============================================
// STANDALONE RUNNER FOR WORKER/CRON
// ============================================

/**
 * Run break enforcement check for all unprocessed work periods.
 * This is a standalone function that can be called from workers/cron jobs.
 *
 * @param options - Optional configuration
 * @param options.date - Target date (defaults to today)
 * @param options.organizationId - Filter to specific organization
 */
export async function runBreakEnforcementCheck(options?: {
	date?: Date;
	organizationId?: string;
}): Promise<{
	processedCount: number;
	adjustedCount: number;
	/** Intents still held by unresolved review or another blocker. */
	deferredCount: number;
	errors: Array<{ workPeriodId: string; error: string }>;
}> {
	// Committed intents first, whatever the work's date: deferred adjustments recover
	// here once their review resolves, and lost immediate runs are retried.
	const recovered = await processAutomaticBreakIntents({
		organizationId: options?.organizationId,
		afterAdjusted: async (outcome, target) => {
			if (!outcome.surchargeSnapshot) return;
			const snapshot = outcome.surchargeSnapshot;
			await Effect.runPromise(
				Effect.gen(function* (_) {
					const surchargeService = yield* _(SurchargeService);
					yield* _(
						surchargeService.reconcileWorkPeriods({
							organizationId: target.organizationId,
							employeeId: target.employeeId,
							surchargePeriodIds: [outcome.workPeriodId, outcome.generatedWorkPeriodId],
							staleSurchargePeriodIds: [],
							surchargeSnapshot: snapshot,
						}),
					);
				}).pipe(Effect.provide(SurchargeServiceLive), Effect.provide(DatabaseServiceLive)),
			);
		},
	});

	const effect = Effect.gen(function* (_) {
		const breakService = yield* _(BreakEnforcementService);

		return yield* _(
			breakService.processUnprocessedPeriods({
				date: options?.date,
				organizationId: options?.organizationId,
			}),
		);
	}).pipe(
		Effect.provide(BreakEnforcementServiceLive),
		Effect.provide(WorkPolicyServiceLive),
		Effect.provide(DatabaseServiceLive),
	);

	const daily = await Effect.runPromise(effect);
	return {
		processedCount: recovered.processed + daily.processedCount,
		adjustedCount: recovered.adjusted + daily.adjustedCount,
		deferredCount: recovered.deferred,
		errors: [...recovered.errors, ...daily.errors],
	};
}

// ============================================
// TESTING HELPERS
// ============================================

/**
 * Export internal function for testing purposes.
 * This allows tests to verify the break deficit calculation logic
 * without going through the full Effect service infrastructure.
 */
export const calculateBreakDeficitForTesting = (
	params: {
		employeeId: string;
		sessionDurationMinutes: number;
		breaksTakenMinutes: number;
	},
	mockPolicyService: {
		getEffectivePolicy: (employeeId: string) => Effect.Effect<
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
	Effect.gen(function* (_) {
		const policy = yield* _(
			mockPolicyService.getEffectivePolicy(params.employeeId),
		);
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
