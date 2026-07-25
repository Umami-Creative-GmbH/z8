import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	type SurchargeCalculationDetails,
	surchargeCalculation,
	type surchargeModel,
	surchargeModelAssignment,
	type surchargeRule,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	instantFromDate,
	isInstant,
	parseInstant,
	parsePlainDate,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import type {
	PolicyClockOutSurchargeRuleSnapshot,
	PolicyClockOutSurchargeSnapshot,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import { isValidIanaTimezone } from "@/lib/time-tracking/timezone-capture";
import { DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export type EffectiveSurchargeModel = {
	modelId: string;
	modelName: string;
	rules: Array<{
		id: string;
		name: string;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: string; // decimal string e.g., "0.5000"
		dayOfWeek?: string | null;
		windowStartTime?: string | null;
		windowEndTime?: string | null;
		specificDate?: Date | null;
		dateRangeStart?: Date | null;
		dateRangeEnd?: Date | null;
		priority: number;
		validFrom?: Date | null;
		validUntil?: Date | null;
	}>;
	assignmentType: "organization" | "team" | "employee";
	assignedVia: string;
};

export type SurchargeCalculationResult = {
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
	totalCreditedMinutes: number;
	appliedRules: Array<{
		ruleId: string;
		ruleName: string;
		ruleType: string;
		percentage: number;
		qualifyingMinutes: number;
		surchargeMinutes: number;
	}>;
};

export type SurchargeSummary = {
	employeeId: string;
	period: { start: Date; end: Date };
	baseMinutes: number;
	totalSurchargeMinutes: number;
	totalCreditedMinutes: number;
	byRuleType: Record<string, { minutes: number; count: number }>;
};

export interface ReconcileSurchargeWorkPeriodsInput {
	organizationId: string;
	employeeId: string;
	surchargePeriodIds: string[];
	staleSurchargePeriodIds: string[];
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a given timestamp falls within a time window.
 * Handles windows that span midnight (e.g., 22:00-06:00).
 */
function isWithinTimeWindow(
	timestamp: DateTime,
	windowStart: string,
	windowEnd: string,
): boolean {
	const [startHour, startMin] = windowStart.split(":").map(Number);
	const [endHour, endMin] = windowEnd.split(":").map(Number);

	const currentMinutes = timestamp.hour * 60 + timestamp.minute;
	const startMinutes = startHour * 60 + startMin;
	const endMinutes = endHour * 60 + endMin;

	if (startMinutes <= endMinutes) {
		// Normal window (e.g., 09:00-17:00)
		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	} else {
		// Spans midnight (e.g., 22:00-06:00)
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}
}

/**
 * Check if a rule applies to a given minute timestamp.
 */
function ruleAppliesToMinute(
	rule: EffectiveSurchargeModel["rules"][0],
	minute: DateTime,
): boolean {
	// Check validity period
	if (rule.validFrom && minute.toJSDate() < rule.validFrom) return false;
	if (rule.validUntil && minute.toJSDate() > rule.validUntil) return false;

	switch (rule.ruleType) {
		case "day_of_week": {
			const dayMap: Record<string, number> = {
				monday: 1,
				tuesday: 2,
				wednesday: 3,
				thursday: 4,
				friday: 5,
				saturday: 6,
				sunday: 7,
			};
			return rule.dayOfWeek ? minute.weekday === dayMap[rule.dayOfWeek] : false;
		}

		case "time_window": {
			if (!rule.windowStartTime || !rule.windowEndTime) return false;
			return isWithinTimeWindow(
				minute,
				rule.windowStartTime,
				rule.windowEndTime,
			);
		}

		case "date_based": {
			const minuteDate = minute.startOf("day");
			if (rule.specificDate) {
				const ruleDate = DateTime.fromJSDate(rule.specificDate).startOf("day");
				return minuteDate.equals(ruleDate);
			}
			if (rule.dateRangeStart && rule.dateRangeEnd) {
				const rangeStart = DateTime.fromJSDate(rule.dateRangeStart).startOf(
					"day",
				);
				const rangeEnd = DateTime.fromJSDate(rule.dateRangeEnd).startOf("day");
				return minuteDate >= rangeStart && minuteDate <= rangeEnd;
			}
			return false;
		}

		default:
			return false;
	}
}

/**
 * Calculate surcharges for a work period using "max wins" overlap policy.
 * For each minute, the highest applicable percentage wins.
 */
function calculateSurchargesInternal(
	startTime: Date,
	endTime: Date,
	rules: EffectiveSurchargeModel["rules"],
	timezone: string = "UTC",
): SurchargeCalculationResult {
	const start = DateTime.fromJSDate(startTime, { zone: timezone });
	const end = DateTime.fromJSDate(endTime, { zone: timezone });
	const totalMinutes = Math.floor(end.diff(start, "minutes").minutes);

	if (totalMinutes <= 0 || rules.length === 0) {
		return {
			baseMinutes: Math.max(0, totalMinutes),
			qualifyingMinutes: 0,
			surchargeMinutes: 0,
			totalCreditedMinutes: Math.max(0, totalMinutes),
			appliedRules: [],
		};
	}

	// Track qualifying minutes per rule
	const ruleQualifyingMinutes: Map<string, number> = new Map();

	// For each minute in the work period
	for (let i = 0; i < totalMinutes; i++) {
		const currentMinute = start.plus({ minutes: i });

		// Find all applicable rules for this minute
		const applicableRules = rules.filter((rule) =>
			ruleAppliesToMinute(rule, currentMinute),
		);

		if (applicableRules.length > 0) {
			// "Max wins" - use highest percentage
			const maxRule = applicableRules.reduce((max, rule) =>
				parseFloat(rule.percentage) > parseFloat(max.percentage) ? rule : max,
			);

			ruleQualifyingMinutes.set(
				maxRule.id,
				(ruleQualifyingMinutes.get(maxRule.id) ?? 0) + 1,
			);
		}
	}

	// Calculate surcharge minutes per rule
	const appliedRules: SurchargeCalculationResult["appliedRules"] = [];
	let totalQualifyingMinutes = 0;
	let totalSurchargeMinutes = 0;

	for (const rule of rules) {
		const qualifyingMinutes = ruleQualifyingMinutes.get(rule.id) ?? 0;
		if (qualifyingMinutes > 0) {
			const percentage = parseFloat(rule.percentage);
			const surchargeMinutes = Math.round(qualifyingMinutes * percentage);

			appliedRules.push({
				ruleId: rule.id,
				ruleName: rule.name,
				ruleType: rule.ruleType,
				percentage,
				qualifyingMinutes,
				surchargeMinutes,
			});

			totalQualifyingMinutes += qualifyingMinutes;
			totalSurchargeMinutes += surchargeMinutes;
		}
	}

	return {
		baseMinutes: totalMinutes,
		qualifyingMinutes: totalQualifyingMinutes,
		surchargeMinutes: totalSurchargeMinutes,
		totalCreditedMinutes: totalMinutes + totalSurchargeMinutes,
		appliedRules,
	};
}

export interface SurchargeEndpointCapture {
	instant: Instant;
	utcOffsetMinutes: number;
	timezone: string;
}

function isValidSurchargeUtcOffset(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= -840 &&
		value <= 840
	);
}

function validateSurchargeEndpointCapture(
	capture: SurchargeEndpointCapture,
): void {
	if (
		!isInstant(capture.instant) ||
		!isValidSurchargeUtcOffset(capture.utcOffsetMinutes) ||
		!isValidIanaTimezone(capture.timezone)
	) {
		throw new Error("Surcharge endpoint capture is invalid");
	}
}

function localBoundaryToInstant(
	date: ReturnType<typeof parsePlainDate>,
	time: ReturnType<typeof parsePlainTimeMinute>,
	utcOffsetMinutes: number,
): Instant {
	return date
		.toPlainDateTime(time)
		.toZonedDateTime(offsetMinutesToTimeZoneId(utcOffsetMinutes))
		.toInstant();
}

function snapshotRuleIsValidAt(
	rule: PolicyClockOutSurchargeRuleSnapshot,
	minute: Instant,
): boolean {
	if (
		rule.validFrom &&
		compareInstants(minute, parseInstant(rule.validFrom)) < 0
	)
		return false;
	if (
		rule.validUntil &&
		compareInstants(minute, parseInstant(rule.validUntil)) > 0
	)
		return false;
	return true;
}

function localDateMatchesRule(
	rule: PolicyClockOutSurchargeRuleSnapshot,
	date: ReturnType<typeof parsePlainDate>,
): boolean {
	switch (rule.ruleType) {
		case "day_of_week": {
			const day = [
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
				"sunday",
			][date.dayOfWeek - 1];
			return rule.dayOfWeek === day;
		}
		case "time_window":
			return true;
		case "date_based": {
			if (rule.specificDate)
				return date.equals(parsePlainDate(rule.specificDate));
			return Boolean(
				rule.dateRangeStart &&
					rule.dateRangeEnd &&
					date.since(parsePlainDate(rule.dateRangeStart)).sign >= 0 &&
					date.until(parsePlainDate(rule.dateRangeEnd)).sign >= 0,
			);
		}
	}
}

function snapshotRuleIntervals(input: {
	rule: PolicyClockOutSurchargeRuleSnapshot;
	start: SurchargeEndpointCapture;
	end: SurchargeEndpointCapture;
}): Array<{ start: Instant; end: Instant }> {
	// Endpoint offsets are the audit evidence: openings use clock-in and
	// closings use clock-out. Never infer an unrecorded transition between them.
	const windowOpening =
		input.rule.ruleType === "time_window" && input.rule.windowStartTime
			? parsePlainTimeMinute(input.rule.windowStartTime)
			: null;
	const windowClosing =
		input.rule.ruleType === "time_window" && input.rule.windowEndTime
			? parsePlainTimeMinute(input.rule.windowEndTime)
			: null;
	if (windowOpening && windowClosing && windowOpening.equals(windowClosing)) {
		return [];
	}
	if (
		input.rule.ruleType === "date_based" &&
		input.rule.dateRangeStart &&
		input.rule.dateRangeEnd
	) {
		const midnight = parsePlainTimeMinute("00:00");
		const opening = localBoundaryToInstant(
			parsePlainDate(input.rule.dateRangeStart),
			midnight,
			input.start.utcOffsetMinutes,
		);
		const closing = localBoundaryToInstant(
			parsePlainDate(input.rule.dateRangeEnd).add({ days: 1 }),
			midnight,
			input.end.utcOffsetMinutes,
		);
		return compareInstants(opening, closing) < 0
			? [{ start: opening, end: closing }]
			: [];
	}
	const startOffset = offsetMinutesToTimeZoneId(input.start.utcOffsetMinutes);
	const endOffset = offsetMinutesToTimeZoneId(input.end.utcOffsetMinutes);
	const startLocalDate = input.start.instant
		.toZonedDateTimeISO(startOffset)
		.toPlainDate();
	const endLocalDate = input.end.instant
		.toZonedDateTimeISO(endOffset)
		.toPlainDate();
	let date =
		comparePlainDates(startLocalDate, endLocalDate) <= 0
			? startLocalDate.subtract({ days: 1 })
			: endLocalDate.subtract({ days: 1 });
	const finalDate =
		comparePlainDates(startLocalDate, endLocalDate) >= 0
			? startLocalDate.add({ days: 1 })
			: endLocalDate.add({ days: 1 });
	const intervals: Array<{ start: Instant; end: Instant }> = [];
	while (comparePlainDates(date, finalDate) <= 0) {
		if (localDateMatchesRule(input.rule, date)) {
			const openingTime = windowOpening ?? parsePlainTimeMinute("00:00");
			const closingTime = windowClosing ?? parsePlainTimeMinute("00:00");
			const closingDate =
				input.rule.ruleType !== "time_window" ||
				closingTime.hour * 60 + closingTime.minute <=
					openingTime.hour * 60 + openingTime.minute
					? date.add({ days: 1 })
					: date;
			const opening = localBoundaryToInstant(
				date,
				openingTime,
				input.start.utcOffsetMinutes,
			);
			const closing = localBoundaryToInstant(
				closingDate,
				closingTime,
				input.end.utcOffsetMinutes,
			);
			if (compareInstants(opening, closing) < 0) {
				intervals.push({ start: opening, end: closing });
			}
		}
		date = date.add({ days: 1 });
	}
	return intervals;
}

export function evaluateSurchargeSnapshot(input: {
	snapshot: PolicyClockOutSurchargeSnapshot;
	start: SurchargeEndpointCapture;
	end: SurchargeEndpointCapture;
}): SurchargeCalculationResult {
	validateSurchargeEndpointCapture(input.start);
	validateSurchargeEndpointCapture(input.end);
	const totalMinutes = Math.floor(
		input.end.instant.since(input.start.instant).total({ unit: "minutes" }),
	);
	const rules =
		input.snapshot.resolution.kind === "surcharge_model"
			? input.snapshot.resolution.rules
			: [];
	if (totalMinutes <= 0 || rules.length === 0) {
		return {
			baseMinutes: Math.max(0, totalMinutes),
			qualifyingMinutes: 0,
			surchargeMinutes: 0,
			totalCreditedMinutes: Math.max(0, totalMinutes),
			appliedRules: [],
		};
	}
	const intervals = new Map(
		rules.map((rule) => [
			rule.id,
			snapshotRuleIntervals({ rule, start: input.start, end: input.end }),
		]),
	);
	const qualifying = new Map<string, number>();
	for (let minuteIndex = 0; minuteIndex < totalMinutes; minuteIndex += 1) {
		const minute = input.start.instant.add({ minutes: minuteIndex });
		const applicable = rules.filter(
			(rule) =>
				snapshotRuleIsValidAt(rule, minute) &&
				(intervals.get(rule.id) ?? []).some(
					(interval) =>
						compareInstants(minute, interval.start) >= 0 &&
						compareInstants(minute, interval.end) < 0,
				),
		);
		if (applicable.length === 0) continue;
		const winner = applicable.reduce((highest, rule) =>
			Number(rule.percentage) > Number(highest.percentage) ? rule : highest,
		);
		qualifying.set(winner.id, (qualifying.get(winner.id) ?? 0) + 1);
	}
	const appliedRules: SurchargeCalculationResult["appliedRules"] = [];
	let qualifyingMinutes = 0;
	let surchargeMinutes = 0;
	for (const rule of rules) {
		const ruleMinutes = qualifying.get(rule.id) ?? 0;
		if (ruleMinutes === 0) continue;
		const percentage = Number(rule.percentage);
		const ruleSurchargeMinutes = Math.round(ruleMinutes * percentage);
		appliedRules.push({
			ruleId: rule.id,
			ruleName: rule.name,
			ruleType: rule.ruleType,
			percentage,
			qualifyingMinutes: ruleMinutes,
			surchargeMinutes: ruleSurchargeMinutes,
		});
		qualifyingMinutes += ruleMinutes;
		surchargeMinutes += ruleSurchargeMinutes;
	}
	return {
		baseMinutes: totalMinutes,
		qualifyingMinutes,
		surchargeMinutes,
		totalCreditedMinutes: totalMinutes + surchargeMinutes,
		appliedRules,
	};
}

export async function reconcileSurchargeWorkPeriodsWithDatabase(
	database: typeof db,
	input: ReconcileSurchargeWorkPeriodsInput,
): Promise<void> {
	try {
		const targetIds = [...new Set(input.surchargePeriodIds)];
		const staleIds = [...new Set(input.staleSurchargePeriodIds)];
		if (
			!input.organizationId ||
			!input.employeeId ||
			targetIds.length !== input.surchargePeriodIds.length ||
			staleIds.length !== input.staleSurchargePeriodIds.length ||
			(targetIds.length > 0 && input.surchargeSnapshot === null)
		) {
			throw new Error("invalid reconciliation input");
		}
		const allIds = [...new Set([...targetIds, ...staleIds])];
		await database.transaction(async (tx) => {
			if (allIds.length === 0) return;
			const periods = await tx.query.workPeriod.findMany({
				where: and(
					inArray(workPeriod.id, allIds),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, input.employeeId),
				),
				columns: {
					id: true,
					organizationId: true,
					employeeId: true,
					startTime: true,
					endTime: true,
					approvalStatus: true,
				},
				with: {
					clockIn: {
						columns: {
							timestamp: true,
							timezone: true,
							utcOffsetMinutes: true,
						},
					},
					clockOut: {
						columns: {
							timestamp: true,
							timezone: true,
							utcOffsetMinutes: true,
						},
					},
				},
			});
			const foundIds = new Set(periods.map((period) => period.id));
			if (
				periods.length !== allIds.length ||
				allIds.some((id) => !foundIds.has(id)) ||
				periods.some(
					(period) =>
						period.organizationId !== input.organizationId ||
						period.employeeId !== input.employeeId,
				)
			) {
				throw new Error("period ownership mismatch");
			}
			if (
				periods.some(
					(period) =>
						targetIds.includes(period.id) &&
						(period.approvalStatus !== "approved" || !period.endTime),
				)
			) {
				throw new Error("target period is not approved");
			}
			if (
				periods.some(
					(period) =>
						targetIds.includes(period.id) &&
						(!period.clockIn ||
							!period.clockOut ||
							period.clockIn.timestamp.getTime() !==
								period.startTime.getTime() ||
							period.clockOut.timestamp.getTime() !==
								period.endTime?.getTime() ||
							!isValidSurchargeUtcOffset(period.clockIn.utcOffsetMinutes) ||
							!isValidSurchargeUtcOffset(period.clockOut.utcOffsetMinutes) ||
							!isValidIanaTimezone(period.clockIn.timezone) ||
							!isValidIanaTimezone(period.clockOut.timezone)),
				)
			) {
				throw new Error("period timezone evidence mismatch");
			}
			await tx
				.delete(surchargeCalculation)
				.where(
					and(
						eq(surchargeCalculation.organizationId, input.organizationId),
						eq(surchargeCalculation.employeeId, input.employeeId),
						inArray(surchargeCalculation.workPeriodId, allIds),
					),
				);
			if (targetIds.length === 0) return;

			const calculatedAt = new Date();
			for (const period of periods) {
				if (!targetIds.includes(period.id) || !period.endTime) continue;
				if (
					!period.clockIn ||
					!period.clockOut ||
					period.clockIn.timestamp.getTime() !== period.startTime.getTime() ||
					period.clockOut.timestamp.getTime() !== period.endTime.getTime() ||
					!Number.isInteger(period.clockIn.utcOffsetMinutes) ||
					!Number.isInteger(period.clockOut.utcOffsetMinutes) ||
					!isValidIanaTimezone(period.clockIn.timezone) ||
					!isValidIanaTimezone(period.clockOut.timezone)
				) {
					throw new Error("period timezone evidence mismatch");
				}
				const result = evaluateSurchargeSnapshot({
					snapshot: input.surchargeSnapshot as PolicyClockOutSurchargeSnapshot,
					start: {
						instant: instantFromDate(period.clockIn.timestamp),
						utcOffsetMinutes: period.clockIn.utcOffsetMinutes,
						timezone: period.clockIn.timezone,
					},
					end: {
						instant: instantFromDate(period.clockOut.timestamp),
						utcOffsetMinutes: period.clockOut.utcOffsetMinutes,
						timezone: period.clockOut.timezone,
					},
				});
				if (result.surchargeMinutes === 0) continue;
				const primaryRule = result.appliedRules[0];
				await tx.insert(surchargeCalculation).values({
					employeeId: input.employeeId,
					organizationId: input.organizationId,
					workPeriodId: period.id,
					surchargeRuleId: null,
					surchargeModelId: null,
					calculationDate: calculatedAt,
					baseMinutes: result.baseMinutes,
					qualifyingMinutes: result.qualifyingMinutes,
					surchargeMinutes: result.surchargeMinutes,
					appliedPercentage: primaryRule?.percentage.toString() ?? "0",
					calculationDetails: {
						workPeriodStartTime: period.startTime.toISOString(),
						workPeriodEndTime: period.endTime.toISOString(),
						rulesApplied: result.appliedRules,
						overlapPolicy: "max_wins",
						calculatedAt: calculatedAt.toISOString(),
					},
				});
			}
		});
	} catch (error) {
		throw new Error("Surcharge reconciliation failed", { cause: error });
	}
}

// ============================================
// SERVICE INTERFACE
// ============================================

export class SurchargeService extends Context.Tag("SurchargeService")<
	SurchargeService,
	{
		/**
		 * Get the effective surcharge model for an employee.
		 * Resolves hierarchical assignments: employee > team > organization.
		 */
		readonly getEffectiveSurchargeModel: (
			employeeId: string,
		) => Effect.Effect<
			EffectiveSurchargeModel | null,
			NotFoundError | DatabaseError
		>;

		/**
		 * Calculate surcharges for a completed work period.
		 * Returns calculation results without persisting.
		 */
		readonly calculateSurcharges: (
			workPeriodId: string,
		) => Effect.Effect<
			SurchargeCalculationResult | null,
			NotFoundError | DatabaseError
		>;

		/**
		 * Calculate and persist surcharge calculation for a work period.
		 * Called on clock-out.
		 */
		readonly persistSurchargeCalculation: (
			workPeriodId: string,
		) => Effect.Effect<
			SurchargeCalculationResult | null,
			NotFoundError | DatabaseError
		>;

		/**
		 * Recalculate surcharges for a work period (e.g., after correction).
		 * Replaces existing calculation.
		 */
		readonly recalculateSurcharges: (
			workPeriodId: string,
		) => Effect.Effect<
			SurchargeCalculationResult | null,
			NotFoundError | DatabaseError
		>;

		readonly reconcileWorkPeriods: (
			input: ReconcileSurchargeWorkPeriodsInput,
		) => Effect.Effect<void, DatabaseError>;

		/**
		 * Get surcharge credits for an employee in a date range.
		 */
		readonly getSurchargeCreditsForPeriod: (
			employeeId: string,
			startDate: Date,
			endDate: Date,
		) => Effect.Effect<SurchargeSummary, DatabaseError>;

		/**
		 * Check if surcharges are enabled for an organization.
		 */
		readonly isSurchargesEnabled: (
			organizationId: string,
		) => Effect.Effect<boolean, DatabaseError>;
	}
>() {}

interface SurchargeCalculationOperations {
	readonly isSurchargesEnabled: (
		organizationId: string,
	) => Effect.Effect<boolean, DatabaseError>;
	readonly persistSurchargeCalculation: (
		workPeriodId: string,
	) => Effect.Effect<
		SurchargeCalculationResult | null,
		NotFoundError | DatabaseError
	>;
	readonly reconcileWorkPeriods: (
		input: ReconcileSurchargeWorkPeriodsInput,
	) => Effect.Effect<void, DatabaseError>;
}

export function calculateSurchargeForWorkPeriod(
	surchargeService: SurchargeCalculationOperations,
	input: {
		workPeriodId: string;
		organizationId: string;
		immutableEvidence?: {
			employeeId: string;
			snapshot: PolicyClockOutSurchargeSnapshot;
		};
	},
) {
	if (input.immutableEvidence) {
		return surchargeService.reconcileWorkPeriods({
			organizationId: input.organizationId,
			employeeId: input.immutableEvidence.employeeId,
			surchargePeriodIds: [input.workPeriodId],
			staleSurchargePeriodIds: [],
			surchargeSnapshot: input.immutableEvidence.snapshot,
		});
	}

	return Effect.gen(function* (_) {
		const isEnabled = yield* _(
			surchargeService.isSurchargesEnabled(input.organizationId),
		);
		if (!isEnabled) return;
		yield* _(surchargeService.persistSurchargeCalculation(input.workPeriodId));
	});
}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const SurchargeServiceLive = Layer.effect(
	SurchargeService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Helper to map raw model + rules to EffectiveSurchargeModel
		const mapToEffective = (
			model: typeof surchargeModel.$inferSelect & {
				rules: (typeof surchargeRule.$inferSelect)[];
			},
			assignmentType: "organization" | "team" | "employee",
			assignedVia: string,
		): EffectiveSurchargeModel => ({
			modelId: model.id,
			modelName: model.name,
			rules: model.rules
				.filter((rule) => rule.isActive)
				.sort((a, b) => b.priority - a.priority) // Higher priority first
				.map((rule) => ({
					id: rule.id,
					name: rule.name,
					ruleType: rule.ruleType,
					percentage: rule.percentage,
					dayOfWeek: rule.dayOfWeek,
					windowStartTime: rule.windowStartTime,
					windowEndTime: rule.windowEndTime,
					specificDate: rule.specificDate,
					dateRangeStart: rule.dateRangeStart,
					dateRangeEnd: rule.dateRangeEnd,
					priority: rule.priority,
					validFrom: rule.validFrom,
					validUntil: rule.validUntil,
				})),
			assignmentType,
			assignedVia,
		});

		return SurchargeService.of({
			reconcileWorkPeriods: (input) =>
				Effect.tryPromise({
					try: () =>
						reconcileSurchargeWorkPeriodsWithDatabase(dbService.db, input),
					catch: (error) =>
						new DatabaseError({
							message: "Surcharge reconciliation failed",
							operation: "reconcileWorkPeriods",
							cause: error,
						}),
				}),
			getEffectiveSurchargeModel: (employeeId) =>
				Effect.gen(function* (_) {
					// 1. Get employee with team info
					const emp = yield* _(
						dbService.query("getEmployeeForSurcharge", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
								with: {
									team: true,
								},
							});
						}),
					);

					if (!emp) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
						return null;
					}

					const now = new Date();

					// 2. Check employee-level assignment (priority 2 - highest)
					const employeeAssignment = yield* _(
						dbService.query("getEmployeeSurchargeAssignment", async () => {
							return await dbService.db.query.surchargeModelAssignment.findFirst(
								{
									where: and(
										eq(surchargeModelAssignment.employeeId, employeeId),
										eq(surchargeModelAssignment.assignmentType, "employee"),
										eq(surchargeModelAssignment.isActive, true),
										or(
											isNull(surchargeModelAssignment.effectiveFrom),
											lte(surchargeModelAssignment.effectiveFrom, now),
										),
										or(
											isNull(surchargeModelAssignment.effectiveUntil),
											gte(surchargeModelAssignment.effectiveUntil, now),
										),
									),
									with: {
										model: {
											with: {
												rules: true,
											},
										},
									},
								},
							);
						}),
					);

					if (employeeAssignment?.model?.isActive) {
						return mapToEffective(
							employeeAssignment.model,
							"employee",
							"Individual",
						);
					}

					// 3. Check team-level assignment (priority 1)
					if (emp.teamId) {
						const teamId = emp.teamId;
						const teamAssignment = yield* _(
							dbService.query("getTeamSurchargeAssignment", async () => {
								return await dbService.db.query.surchargeModelAssignment.findFirst(
									{
										where: and(
											eq(surchargeModelAssignment.teamId, teamId),
											eq(surchargeModelAssignment.assignmentType, "team"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: {
												with: {
													rules: true,
												},
											},
											team: true,
										},
									},
								);
							}),
						);

						if (teamAssignment?.model?.isActive) {
							return mapToEffective(
								teamAssignment.model,
								"team",
								teamAssignment.team?.name ?? "Team",
							);
						}
					}

					// 4. Check organization-level assignment (priority 0 - lowest)
					const orgAssignment = yield* _(
						dbService.query("getOrgSurchargeAssignment", async () => {
							return await dbService.db.query.surchargeModelAssignment.findFirst(
								{
									where: and(
										eq(
											surchargeModelAssignment.organizationId,
											emp.organizationId,
										),
										eq(surchargeModelAssignment.assignmentType, "organization"),
										eq(surchargeModelAssignment.isActive, true),
										or(
											isNull(surchargeModelAssignment.effectiveFrom),
											lte(surchargeModelAssignment.effectiveFrom, now),
										),
										or(
											isNull(surchargeModelAssignment.effectiveUntil),
											gte(surchargeModelAssignment.effectiveUntil, now),
										),
									),
									with: {
										model: {
											with: {
												rules: true,
											},
										},
									},
								},
							);
						}),
					);

					if (orgAssignment?.model?.isActive) {
						return mapToEffective(
							orgAssignment.model,
							"organization",
							"Organization Default",
						);
					}

					// No surcharge model assigned
					return null;
				}),

			calculateSurcharges: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Get work period with employee info
					const period = yield* _(
						dbService.query("getWorkPeriodForSurcharge", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period) {
						yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Work period not found",
									entityType: "workPeriod",
									entityId: workPeriodId,
								}),
							),
						);
						return null;
					}

					// Work period must be completed (have endTime)
					if (!period.endTime) {
						return null; // Cannot calculate surcharges for active period
					}

					const periodEmployee = period.employee;
					if (!periodEmployee) {
						return null;
					}

					// Get effective surcharge model
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								// Inline resolution to avoid recursive call issues
								const emp = period.employee;
								if (!emp) return null;

								const now = new Date();

								// Employee-level
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (employeeAssignment?.model?.isActive) {
									return mapToEffective(
										employeeAssignment.model,
										"employee",
										"Individual",
									);
								}

								// Team-level
								if (emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst(
											{
												where: and(
													eq(surchargeModelAssignment.teamId, emp.teamId),
													eq(surchargeModelAssignment.assignmentType, "team"),
													eq(surchargeModelAssignment.isActive, true),
													or(
														isNull(surchargeModelAssignment.effectiveFrom),
														lte(surchargeModelAssignment.effectiveFrom, now),
													),
													or(
														isNull(surchargeModelAssignment.effectiveUntil),
														gte(surchargeModelAssignment.effectiveUntil, now),
													),
												),
												with: {
													model: { with: { rules: true } },
													team: true,
												},
											},
										);

									if (teamAssignment?.model?.isActive) {
										return mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								// Org-level
								const orgAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(
												surchargeModelAssignment.organizationId,
												emp.organizationId,
											),
											eq(
												surchargeModelAssignment.assignmentType,
												"organization",
											),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (orgAssignment?.model?.isActive) {
									return mapToEffective(
										orgAssignment.model,
										"organization",
										"Organization Default",
									);
								}

								return null;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "calculateSurcharges",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					// Get organization timezone
					const org = yield* _(
						dbService.query("getOrgTimezone", async () => {
							return await dbService.db.query.organization.findFirst({
								where: eq(organization.id, periodEmployee.organizationId),
								columns: { timezone: true },
							});
						}),
					);
					const timezone = org?.timezone ?? "UTC";

					// Calculate surcharges
					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						timezone,
					);

					return result;
				}),

			persistSurchargeCalculation: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Get work period with employee info
					const period = yield* _(
						dbService.query("getWorkPeriodForPersist", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period?.endTime || !period.employee) {
						return null;
					}

					// Check if calculation already exists
					const existing = yield* _(
						dbService.query("checkExistingSurchargeCalc", async () => {
							return await dbService.db.query.surchargeCalculation.findFirst({
								where: eq(surchargeCalculation.workPeriodId, workPeriodId),
							});
						}),
					);

					if (existing) {
						// Already calculated, return existing data
						return {
							baseMinutes: existing.baseMinutes,
							qualifyingMinutes: existing.qualifyingMinutes,
							surchargeMinutes: existing.surchargeMinutes,
							totalCreditedMinutes:
								existing.baseMinutes + existing.surchargeMinutes,
							appliedRules:
								(
									existing.calculationDetails as SurchargeCalculationDetails | null
								)?.rulesApplied ?? [],
						};
					}

					// Get effective model using Effect.tryPromise to wrap async calls
					const emp = period.employee;
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								const now = new Date();

								// Employee-level
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (employeeAssignment?.model?.isActive) {
									return mapToEffective(
										employeeAssignment.model,
										"employee",
										"Individual",
									);
								}

								// Team-level
								if (emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst(
											{
												where: and(
													eq(surchargeModelAssignment.teamId, emp.teamId),
													eq(surchargeModelAssignment.assignmentType, "team"),
													eq(surchargeModelAssignment.isActive, true),
													or(
														isNull(surchargeModelAssignment.effectiveFrom),
														lte(surchargeModelAssignment.effectiveFrom, now),
													),
													or(
														isNull(surchargeModelAssignment.effectiveUntil),
														gte(surchargeModelAssignment.effectiveUntil, now),
													),
												),
												with: {
													model: { with: { rules: true } },
													team: true,
												},
											},
										);

									if (teamAssignment?.model?.isActive) {
										return mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								// Org-level
								const orgAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(
												surchargeModelAssignment.organizationId,
												emp.organizationId,
											),
											eq(
												surchargeModelAssignment.assignmentType,
												"organization",
											),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: {
											model: { with: { rules: true } },
										},
									});

								if (orgAssignment?.model?.isActive) {
									return mapToEffective(
										orgAssignment.model,
										"organization",
										"Organization Default",
									);
								}

								return null;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "persistSurchargeCalculation",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					// Get organization timezone
					const org = yield* _(
						dbService.query("getOrgTimezoneForPersist", async () => {
							return await dbService.db.query.organization.findFirst({
								where: eq(organization.id, emp.organizationId),
								columns: { timezone: true },
							});
						}),
					);
					const timezone = org?.timezone ?? "UTC";

					// Calculate surcharges
					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						timezone,
					);

					if (result.surchargeMinutes === 0) {
						return result; // No surcharges to persist
					}

					// Persist calculation
					const primaryRule = result.appliedRules[0];
					const calculationDetails: SurchargeCalculationDetails = {
						workPeriodStartTime: period.startTime.toISOString(),
						workPeriodEndTime: period.endTime.toISOString(),
						rulesApplied: result.appliedRules,
						overlapPolicy: "max_wins",
						calculatedAt: new Date().toISOString(),
					};

					yield* _(
						dbService.query("insertSurchargeCalculation", async () => {
							await dbService.db.insert(surchargeCalculation).values({
								employeeId: emp.id,
								organizationId: emp.organizationId,
								workPeriodId: workPeriodId,
								surchargeRuleId: primaryRule?.ruleId ?? null,
								surchargeModelId: effectiveModel.modelId,
								calculationDate: new Date(),
								baseMinutes: result.baseMinutes,
								qualifyingMinutes: result.qualifyingMinutes,
								surchargeMinutes: result.surchargeMinutes,
								appliedPercentage: primaryRule?.percentage?.toString() ?? "0",
								calculationDetails: calculationDetails,
							});
						}),
					);

					return result;
				}),

			recalculateSurcharges: (workPeriodId) =>
				Effect.gen(function* (_) {
					// Delete existing calculation
					yield* _(
						dbService.query("deleteExistingSurchargeCalc", async () => {
							await dbService.db
								.delete(surchargeCalculation)
								.where(eq(surchargeCalculation.workPeriodId, workPeriodId));
						}),
					);

					// Re-calculate and persist
					// Use inline calculation to avoid recursive service calls
					const period = yield* _(
						dbService.query("getWorkPeriodForRecalc", async () => {
							return await dbService.db.query.workPeriod.findFirst({
								where: eq(workPeriod.id, workPeriodId),
								with: {
									employee: true,
								},
							});
						}),
					);

					if (!period?.endTime || !period.employee) {
						return null;
					}

					const emp = period.employee;

					// Resolve effective model using hierarchical lookup
					const effectiveModel = yield* _(
						Effect.tryPromise({
							try: async () => {
								const now = new Date();
								let model: EffectiveSurchargeModel | null = null;

								// Same resolution logic as persistSurchargeCalculation
								const employeeAssignment =
									await dbService.db.query.surchargeModelAssignment.findFirst({
										where: and(
											eq(surchargeModelAssignment.employeeId, emp.id),
											eq(surchargeModelAssignment.assignmentType, "employee"),
											eq(surchargeModelAssignment.isActive, true),
											or(
												isNull(surchargeModelAssignment.effectiveFrom),
												lte(surchargeModelAssignment.effectiveFrom, now),
											),
											or(
												isNull(surchargeModelAssignment.effectiveUntil),
												gte(surchargeModelAssignment.effectiveUntil, now),
											),
										),
										with: { model: { with: { rules: true } } },
									});

								if (employeeAssignment?.model?.isActive) {
									model = mapToEffective(
										employeeAssignment.model,
										"employee",
										"Individual",
									);
								}

								if (!model && emp.teamId) {
									const teamAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst(
											{
												where: and(
													eq(surchargeModelAssignment.teamId, emp.teamId),
													eq(surchargeModelAssignment.assignmentType, "team"),
													eq(surchargeModelAssignment.isActive, true),
													or(
														isNull(surchargeModelAssignment.effectiveFrom),
														lte(surchargeModelAssignment.effectiveFrom, now),
													),
													or(
														isNull(surchargeModelAssignment.effectiveUntil),
														gte(surchargeModelAssignment.effectiveUntil, now),
													),
												),
												with: {
													model: { with: { rules: true } },
													team: true,
												},
											},
										);

									if (teamAssignment?.model?.isActive) {
										model = mapToEffective(
											teamAssignment.model,
											"team",
											teamAssignment.team?.name ?? "Team",
										);
									}
								}

								if (!model) {
									const orgAssignment =
										await dbService.db.query.surchargeModelAssignment.findFirst(
											{
												where: and(
													eq(
														surchargeModelAssignment.organizationId,
														emp.organizationId,
													),
													eq(
														surchargeModelAssignment.assignmentType,
														"organization",
													),
													eq(surchargeModelAssignment.isActive, true),
													or(
														isNull(surchargeModelAssignment.effectiveFrom),
														lte(surchargeModelAssignment.effectiveFrom, now),
													),
													or(
														isNull(surchargeModelAssignment.effectiveUntil),
														gte(surchargeModelAssignment.effectiveUntil, now),
													),
												),
												with: { model: { with: { rules: true } } },
											},
										);

									if (orgAssignment?.model?.isActive) {
										model = mapToEffective(
											orgAssignment.model,
											"organization",
											"Organization Default",
										);
									}
								}

								return model;
							},
							catch: (error) =>
								new DatabaseError({
									message: "Failed to resolve surcharge model",
									operation: "recalculateSurcharges",
									cause: error,
								}),
						}),
					);

					if (!effectiveModel || effectiveModel.rules.length === 0) {
						return null;
					}

					// Get organization timezone
					const org = yield* _(
						dbService.query("getOrgTimezoneForRecalc", async () => {
							return await dbService.db.query.organization.findFirst({
								where: eq(organization.id, emp.organizationId),
								columns: { timezone: true },
							});
						}),
					);
					const timezone = org?.timezone ?? "UTC";

					const result = calculateSurchargesInternal(
						period.startTime,
						period.endTime,
						effectiveModel.rules,
						timezone,
					);

					if (result.surchargeMinutes > 0) {
						const primaryRule = result.appliedRules[0];
						const calculationDetails: SurchargeCalculationDetails = {
							workPeriodStartTime: period.startTime.toISOString(),
							workPeriodEndTime: period.endTime.toISOString(),
							rulesApplied: result.appliedRules,
							overlapPolicy: "max_wins",
							calculatedAt: new Date().toISOString(),
						};

						yield* _(
							dbService.query("insertRecalculatedSurcharge", async () => {
								await dbService.db.insert(surchargeCalculation).values({
									employeeId: emp.id,
									organizationId: emp.organizationId,
									workPeriodId: workPeriodId,
									surchargeRuleId: primaryRule?.ruleId ?? null,
									surchargeModelId: effectiveModel.modelId,
									calculationDate: new Date(),
									baseMinutes: result.baseMinutes,
									qualifyingMinutes: result.qualifyingMinutes,
									surchargeMinutes: result.surchargeMinutes,
									appliedPercentage: primaryRule?.percentage?.toString() ?? "0",
									calculationDetails: calculationDetails,
								});
							}),
						);
					}

					return result;
				}),

			getSurchargeCreditsForPeriod: (employeeId, startDate, endDate) =>
				Effect.gen(function* (_) {
					const calculations = yield* _(
						dbService.query("getSurchargeCreditsForPeriod", async () => {
							return await dbService.db.query.surchargeCalculation.findMany({
								where: and(
									eq(surchargeCalculation.employeeId, employeeId),
									gte(surchargeCalculation.calculationDate, startDate),
									lte(surchargeCalculation.calculationDate, endDate),
								),
							});
						}),
					);

					let baseMinutes = 0;
					let totalSurchargeMinutes = 0;
					const byRuleType: Record<string, { minutes: number; count: number }> =
						{};

					for (const calc of calculations) {
						baseMinutes += calc.baseMinutes;
						totalSurchargeMinutes += calc.surchargeMinutes;

						// Aggregate by rule type from details
						const details =
							calc.calculationDetails as SurchargeCalculationDetails | null;
						if (details?.rulesApplied) {
							for (const rule of details.rulesApplied) {
								if (!byRuleType[rule.ruleType]) {
									byRuleType[rule.ruleType] = { minutes: 0, count: 0 };
								}
								byRuleType[rule.ruleType].minutes += rule.surchargeMinutes;
								byRuleType[rule.ruleType].count += 1;
							}
						}
					}

					return {
						employeeId,
						period: { start: startDate, end: endDate },
						baseMinutes,
						totalSurchargeMinutes,
						totalCreditedMinutes: baseMinutes + totalSurchargeMinutes,
						byRuleType,
					};
				}),

			isSurchargesEnabled: (organizationId) =>
				Effect.gen(function* (_) {
					const org = yield* _(
						dbService.query("checkSurchargesEnabled", async () => {
							return await dbService.db.query.organization.findFirst({
								where: eq(organization.id, organizationId),
								columns: {
									surchargesEnabled: true,
								},
							});
						}),
					);

					return org?.surchargesEnabled ?? false;
				}),
		});
	}),
);
