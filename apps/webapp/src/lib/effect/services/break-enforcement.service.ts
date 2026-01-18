import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	timeEntry,
	workPeriod,
	type WorkPeriodAutoAdjustmentReason,
} from "@/db/schema";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { getTodayRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import { type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService, DatabaseServiceLive } from "./database.service";
import { TimeRegulationService, TimeRegulationServiceLive } from "./time-regulation.service";

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
	adjustment?: {
		breakMinutes: number;
		breakInsertedAt: string; // ISO timestamp
		regulationName: string;
		originalDurationMinutes: number;
		adjustedDurationMinutes: number;
	};
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

export class BreakEnforcementService extends Context.Tag("BreakEnforcementService")<
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
		const regulationService = yield* _(TimeRegulationService);

		/**
		 * Calculate total break minutes taken today (gaps between work periods)
		 */
		const calculateBreaksTakenToday = (
			employeeId: string,
			timezone: string,
		): Effect.Effect<number, DatabaseError> =>
			Effect.gen(function* (_) {
				const { start: todayStartDT, end: todayEndDT } = getTodayRangeInTimezone(timezone);
				const todayStart = dateToDB(todayStartDT)!;
				const todayEnd = dateToDB(todayEndDT)!;

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
		 * Create a time entry for break enforcement
		 */
		const createBreakTimeEntry = (params: {
			employeeId: string;
			type: "clock_in" | "clock_out";
			timestamp: Date;
			createdBy: string;
			notes?: string;
		}): Effect.Effect<typeof timeEntry.$inferSelect, DatabaseError> =>
			Effect.gen(function* (_) {
				// Get previous entry for blockchain linking
				const previousEntry = yield* _(
					dbService.query("getPreviousEntryForBreak", async () => {
						const [entry] = await dbService.db
							.select()
							.from(timeEntry)
							.where(eq(timeEntry.employeeId, params.employeeId))
							.orderBy(desc(timeEntry.createdAt))
							.limit(1);
						return entry;
					}),
				);

				// Calculate hash
				const hash = calculateHash({
					employeeId: params.employeeId,
					type: params.type,
					timestamp: params.timestamp.toISOString(),
					previousHash: previousEntry?.hash || null,
				});

				// Create time entry
				const entry = yield* _(
					dbService.query("createBreakTimeEntry", async () => {
						const [newEntry] = await dbService.db
							.insert(timeEntry)
							.values({
								employeeId: params.employeeId,
								type: params.type,
								timestamp: params.timestamp,
								hash,
								previousHash: previousEntry?.hash || null,
								ipAddress: "system",
								deviceInfo: "break-enforcement",
								createdBy: params.createdBy,
								notes: params.notes,
							})
							.returning();
						return newEntry;
					}),
				);

				return entry;
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
				const regulation = yield* _(
					regulationService.getEffectiveRegulation(params.employeeId),
				);

				if (!regulation) {
					return {
						deficit: 0,
						applicableRule: null,
						regulationId: null,
						regulationName: null,
						maxUninterruptedMinutes: null,
					};
				}

				// Find the applicable break rule (highest threshold that applies)
				const applicableRule = regulation.breakRules
					.filter((rule) => params.sessionDurationMinutes > rule.workingMinutesThreshold)
					.sort((a, b) => b.workingMinutesThreshold - a.workingMinutesThreshold)[0];

				if (!applicableRule) {
					return {
						deficit: 0,
						applicableRule: null,
						regulationId: regulation.regulationId,
						regulationName: regulation.regulationName,
						maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
					};
				}

				const deficit = Math.max(
					0,
					applicableRule.requiredBreakMinutes - params.breaksTakenMinutes,
				);

				return {
					deficit,
					applicableRule: {
						workingMinutesThreshold: applicableRule.workingMinutesThreshold,
						requiredBreakMinutes: applicableRule.requiredBreakMinutes,
					},
					regulationId: regulation.regulationId,
					regulationName: regulation.regulationName,
					maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
				};
			});

		/**
		 * Internal function to enforce breaks after clock-out
		 * Can be called directly without going through the service interface
		 */
		const enforceBreaksAfterClockOutInternal = (
			input: EnforceBreaksInput,
		): Effect.Effect<BreakEnforcementResult, NotFoundError | DatabaseError> =>
			Effect.gen(function* (_) {
				// Get the work period
				const period = yield* _(
					dbService.query("getWorkPeriodForEnforcement", async () => {
						return await dbService.db.query.workPeriod.findFirst({
							where: eq(workPeriod.id, input.workPeriodId),
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
				if (period.wasAutoAdjusted) {
					return { wasAdjusted: false };
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
				if (deficitResult.deficit <= 0 || !deficitResult.applicableRule) {
					return { wasAdjusted: false };
				}

				// Determine where to insert the break
				// Insert after maxUninterruptedMinutes from start, or after the threshold
				const maxUninterrupted = deficitResult.maxUninterruptedMinutes;
				const insertAfterMinutes = maxUninterrupted
					? Math.min(maxUninterrupted, deficitResult.applicableRule.workingMinutesThreshold)
					: deficitResult.applicableRule.workingMinutesThreshold;

				// Calculate break insertion point
				const startDT = dateFromDB(period.startTime);
				if (!startDT || !period.endTime) {
					return { wasAdjusted: false };
				}

				const breakStartDT = startDT.plus({ minutes: insertAfterMinutes });
				const breakEndDT = breakStartDT.plus({ minutes: deficitResult.deficit });
				const breakStartDate = dateToDB(breakStartDT);
				const breakEndDate = dateToDB(breakEndDT);

				if (!breakStartDate || !breakEndDate) {
					return { wasAdjusted: false };
				}

				// Validate break times are within the work period
				if (breakStartDate <= period.startTime || breakEndDate >= period.endTime) {
					return { wasAdjusted: false };
				}

				// Store original values for audit trail
				const originalEndTime = period.endTime;
				const originalDurationMinutes = period.durationMinutes || input.sessionDurationMinutes;

				// Create clock-out entry for first period at break start
				const firstClockOut = yield* _(
					createBreakTimeEntry({
						employeeId: input.employeeId,
						type: "clock_out",
						timestamp: breakStartDate,
						createdBy: input.createdBy,
						notes: "Auto-adjusted: break enforcement",
					}),
				);

				// Create clock-in entry for second period at break end
				const secondClockIn = yield* _(
					createBreakTimeEntry({
						employeeId: input.employeeId,
						type: "clock_in",
						timestamp: breakEndDate,
						createdBy: input.createdBy,
						notes: "Auto-adjusted: break enforcement",
					}),
				);

				// Calculate new durations
				const firstDurationMs = breakStartDate.getTime() - period.startTime.getTime();
				const firstDurationMinutes = Math.floor(firstDurationMs / 60000);

				const secondDurationMs = period.endTime.getTime() - breakEndDate.getTime();
				const secondDurationMinutes = Math.floor(secondDurationMs / 60000);

				// Build auto-adjustment reason
				const adjustmentReason: WorkPeriodAutoAdjustmentReason = {
					type: "break_enforcement",
					regulationId: deficitResult.regulationId!,
					regulationName: deficitResult.regulationName!,
					breakInsertedMinutes: deficitResult.deficit,
					breakInsertedAt: breakStartDate.toISOString(),
					originalDurationMinutes,
					adjustedDurationMinutes: firstDurationMinutes + secondDurationMinutes,
					ruleApplied: deficitResult.applicableRule,
				};

				// Update the original work period to end at break start
				yield* _(
					dbService.query("updateFirstWorkPeriod", async () => {
						await dbService.db
							.update(workPeriod)
							.set({
								clockOutId: firstClockOut.id,
								endTime: breakStartDate,
								durationMinutes: firstDurationMinutes,
								wasAutoAdjusted: true,
								autoAdjustmentReason: adjustmentReason,
								autoAdjustedAt: new Date(),
								originalEndTime: originalEndTime,
								originalDurationMinutes: originalDurationMinutes,
								updatedAt: new Date(),
							})
							.where(eq(workPeriod.id, period.id));
					}),
				);

				// Create a new work period for the second segment
				yield* _(
					dbService.query("createSecondWorkPeriod", async () => {
						await dbService.db.insert(workPeriod).values({
							employeeId: input.employeeId,
							clockInId: secondClockIn.id,
							clockOutId: period.clockOutId,
							startTime: breakEndDate,
							endTime: period.endTime,
							durationMinutes: secondDurationMinutes,
							projectId: period.projectId,
							isActive: false,
							wasAutoAdjusted: true,
							autoAdjustmentReason: adjustmentReason,
							autoAdjustedAt: new Date(),
							originalEndTime: null, // Only first period has original values
							originalDurationMinutes: null,
						});
					}),
				);

				return {
					wasAdjusted: true,
					adjustment: {
						breakMinutes: deficitResult.deficit,
						breakInsertedAt: breakStartDate.toISOString(),
						regulationName: deficitResult.regulationName!,
						originalDurationMinutes,
						adjustedDurationMinutes: firstDurationMinutes + secondDurationMinutes,
					},
				};
			});

		return BreakEnforcementService.of({
			calculateBreakDeficit: (params) => calculateBreakDeficitInternal(params),

			enforceBreaksAfterClockOut: (input) => enforceBreaksAfterClockOutInternal(input),

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
								where: and(...conditions),
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
						if (input.organizationId && period.employee?.organizationId !== input.organizationId) {
							continue;
						}

						result.processedCount++;

						const enforcementResultEffect = enforceBreaksAfterClockOutInternal({
							employeeId: period.employeeId,
							organizationId: period.employee?.organizationId || "",
							workPeriodId: period.id,
							sessionDurationMinutes: period.durationMinutes || 0,
							timezone: period.employee?.userSettings?.timezone || "UTC",
							createdBy: "system-cron",
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
	Layer.provide(TimeRegulationServiceLive),
	Layer.provide(DatabaseServiceLive),
);

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
	mockRegulationService: {
		getEffectiveRegulation: (
			employeeId: string,
		) => Effect.Effect<
			{
				regulationId: string;
				regulationName: string;
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
		const regulation = yield* _(
			mockRegulationService.getEffectiveRegulation(params.employeeId),
		);

		if (!regulation) {
			return {
				deficit: 0,
				applicableRule: null,
				regulationId: null,
				regulationName: null,
				maxUninterruptedMinutes: null,
			};
		}

		// Find the applicable break rule (highest threshold that applies)
		const applicableRule = regulation.breakRules
			.filter((rule) => params.sessionDurationMinutes > rule.workingMinutesThreshold)
			.sort((a, b) => b.workingMinutesThreshold - a.workingMinutesThreshold)[0];

		if (!applicableRule) {
			return {
				deficit: 0,
				applicableRule: null,
				regulationId: regulation.regulationId,
				regulationName: regulation.regulationName,
				maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
			};
		}

		const deficit = Math.max(
			0,
			applicableRule.requiredBreakMinutes - params.breaksTakenMinutes,
		);

		return {
			deficit,
			applicableRule: {
				workingMinutesThreshold: applicableRule.workingMinutesThreshold,
				requiredBreakMinutes: applicableRule.requiredBreakMinutes,
			},
			regulationId: regulation.regulationId,
			regulationName: regulation.regulationName,
			maxUninterruptedMinutes: regulation.maxUninterruptedMinutes,
		};
	});
