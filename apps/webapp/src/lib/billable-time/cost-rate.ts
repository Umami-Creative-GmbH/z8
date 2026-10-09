import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { workDayOf } from "./applicable-rate";
import { type ElapsedInterval, splitElapsedTime } from "./elapsed-split";
import {
	type AccruedAmount,
	accrueAmount,
	addAccruedAmounts,
	type RateUnits,
	roundAccruedAmount,
} from "./money";
import type { BillableRatePeriodView } from "./rate-target";

/**
 * The cost-rate resolver (#899). Pure and client-safe: callers load the cost
 * rate periods (`cost-rates.ts` `listCostRatesForWork`) and pass them in.
 *
 * A cost rate is an employee's fully loaded internal cost per hour, in the
 * organization's billable currency. It is separate from the wage: nothing here
 * reads or writes wage history, payroll or hourly earnings.
 *
 * Like billable rates, cost rate periods are half-open calendar-date ranges;
 * a date is the employee-local day of the work start, at the offset captured
 * with the work (`docs/refs/timekeeping.md`).
 */

/** A cost rate period as the settings UI shows it (wire-safe); same shape as a billable one. */
export type CostRatePeriodView = BillableRatePeriodView;

/**
 * An hourly employee's wage in effect, offered as a starting value for a cost
 * rate. Only a suggestion: nothing copies it into a cost rate.
 */
export interface SuggestedWage {
	/** Two-decimal string in the billable currency. */
	hourlyRate: string;
}

/** One cost rate period of one employee. */
export interface CostRatePeriod {
	id: string;
	employeeId: string;
	from: PlainDate;
	/** Exclusive; null while open. */
	to: PlainDate | null;
	rate: RateUnits;
}

export type CostRate =
	| { kind: "known"; rate: RateUnits; costRatePeriodId: string }
	| { kind: "unknown" };

const UNKNOWN: CostRate = { kind: "unknown" };

function inEffectOn(period: CostRatePeriod, date: PlainDate): boolean {
	return (
		Temporal.PlainDate.compare(period.from, date) <= 0 &&
		(period.to === null || Temporal.PlainDate.compare(date, period.to) < 0)
	);
}

/** An employee's cost rate on one employee-local day, or unknown. */
export function resolveCostRateOnDay(
	employeeId: string,
	date: PlainDate,
	rates: readonly CostRatePeriod[],
): CostRate {
	const period = rates.find((rate) => rate.employeeId === employeeId && inEffectOn(rate, date));
	return period ? { kind: "known", rate: period.rate, costRatePeriodId: period.id } : UNKNOWN;
}

/**
 * An employee's cost rate at an instant: the rate in effect on the
 * employee-local day of `at`, at `offsetMinutes` (for work, the UTC offset
 * captured on its start entry). Unknown without one.
 */
export function resolveCostRate(
	input: { employeeId: string; at: Instant; offsetMinutes: number },
	rates: readonly CostRatePeriod[],
): CostRate {
	return resolveCostRateOnDay(input.employeeId, workDayOf(input.at, input.offsetMinutes), rates);
}

export interface CostedWorkPeriod {
	employeeId: string;
	startedAt: Instant;
	endedAt: Instant;
	/** The UTC offset captured on the work's start entry. */
	startOffsetMinutes: number;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
}

export interface CostShare {
	cost: CostRate;
	start: Instant;
	end: Instant;
	durationMs: number;
	/** Zero for unknown shares. */
	accrued: AccruedAmount;
}

export interface WorkPeriodCost {
	shares: CostShare[];
	knownMs: number;
	/** Time without a cost rate: any is enough to make a margin unknown (#902). */
	unknownMs: number;
	/** Exact; sum these across a report before rounding (`roundAccruedAmount`). */
	accrued: AccruedAmount;
	/** This period alone, rounded half up to the cent. Excludes unknown shares. */
	amountCents: bigint;
}

function sameCost(left: CostRate, right: CostRate): boolean {
	if (left.kind === "unknown" || right.kind === "unknown") return left.kind === right.kind;
	return left.costRatePeriodId === right.costRatePeriodId;
}

/**
 * The cost rate of each local day a work period touches, as instant intervals
 * at the work's start offset (consecutive days with the same period merged).
 */
export function costRateIntervals(
	work: CostedWorkPeriod,
	rates: readonly CostRatePeriod[],
): ElapsedInterval<CostRate>[] {
	const timeZone = offsetMinutesToTimeZoneId(work.startOffsetMinutes);
	const lastDay = workDayOf(work.endedAt, work.startOffsetMinutes);
	const intervals: ElapsedInterval<CostRate>[] = [];
	for (
		let date = workDayOf(work.startedAt, work.startOffsetMinutes);
		Temporal.PlainDate.compare(date, lastDay) <= 0;
		date = date.add({ days: 1 })
	) {
		const cost = resolveCostRateOnDay(work.employeeId, date, rates);
		const start = date.toZonedDateTime({ timeZone }).toInstant();
		const end = date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
		const previous = intervals.at(-1);
		if (previous && sameCost(previous.value, cost)) {
			previous.end = end;
		} else {
			intervals.push({ start, end, value: cost });
		}
	}
	return intervals;
}

/**
 * The cost of one completed work period, the counterpart of
 * `priceWorkPeriod`: the recorded duration is split by elapsed time across the
 * cost rates of the local days it spans, and each share is costed at its rate.
 * Shares without a cost rate add nothing and are counted as unknown.
 */
export function costWorkPeriod(
	work: CostedWorkPeriod,
	rates: readonly CostRatePeriod[],
): WorkPeriodCost {
	const shares = splitElapsedTime(
		{ start: work.startedAt, end: work.endedAt, durationMinutes: work.durationMinutes },
		costRateIntervals(work, rates),
	).map((share): CostShare => {
		const cost = share.value ?? UNKNOWN;
		return {
			cost,
			start: share.start,
			end: share.end,
			durationMs: share.durationMs,
			accrued: cost.kind === "known" ? accrueAmount(cost.rate, share.durationMs) : BigInt(0),
		};
	});
	const accrued = addAccruedAmounts(shares.map((share) => share.accrued));
	const unknownMs = shares
		.filter((share) => share.cost.kind === "unknown")
		.reduce((sum, share) => sum + share.durationMs, 0);
	const totalMs = shares.reduce((sum, share) => sum + share.durationMs, 0);
	return {
		shares,
		knownMs: totalMs - unknownMs,
		unknownMs,
		accrued,
		amountCents: roundAccruedAmount(accrued),
	};
}
