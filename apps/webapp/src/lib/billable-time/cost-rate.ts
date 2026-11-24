import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { workDayOf } from "./applicable-rate";
import {
	type ContractorCosts,
	contractorCostOf,
	hasContractorCost,
	NO_CONTRACTOR_COSTS,
} from "./contractor-cost";
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
	/** The work period; contractor cost (#1999) is looked up by it. */
	id?: string;
	employeeId: string;
	startedAt: Instant;
	endedAt: Instant;
	/** The UTC offset captured on the work's start entry. */
	startOffsetMinutes: number;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
}

/**
 * A share costed from the contractor's terms (#1999): its part of the day's
 * contractor fee, when no explicit cost rate is in effect on that day.
 */
export interface ContractorShareCost {
	kind: "contractor";
	date: PlainDate;
}

export interface CostShare {
	cost: CostRate | ContractorShareCost;
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

const MS_PER_HOUR = BigInt(3_600_000);

/**
 * `costRateIntervals`, with the days that have no cost rate but a contractor
 * cost (#1999) as one interval each.
 */
function costIntervals(
	work: CostedWorkPeriod,
	rates: readonly CostRatePeriod[],
	contractor: ContractorCosts,
): ElapsedInterval<CostRate | ContractorShareCost>[] {
	const workId = work.id;
	if (workId === undefined || contractor.byWorkDay.size === 0) {
		return costRateIntervals(work, rates);
	}
	const timeZone = offsetMinutesToTimeZoneId(work.startOffsetMinutes);
	return costRateIntervals(work, rates).flatMap((interval) => {
		if (interval.value.kind === "known" || interval.start === null || interval.end === null) {
			return [interval];
		}
		// An unknown interval covers whole local days: cost each one on its own.
		const days: ElapsedInterval<CostRate | ContractorShareCost>[] = [];
		const end = interval.end;
		for (
			let date = workDayOf(interval.start, work.startOffsetMinutes);
			Temporal.Instant.compare(date.toZonedDateTime({ timeZone }).toInstant(), end) < 0;
			date = date.add({ days: 1 })
		) {
			days.push({
				start: date.toZonedDateTime({ timeZone }).toInstant(),
				end: date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant(),
				value: hasContractorCost(contractor, workId, date) ? { kind: "contractor", date } : UNKNOWN,
			});
		}
		return days;
	});
}

/**
 * The cost of one completed work period, the counterpart of
 * `priceWorkPeriod`: the recorded duration is split by elapsed time across the
 * cost rates of the local days it spans, and each share is costed at its rate.
 *
 * An explicit cost rate always wins (Billable Time ADR 0001). On a local day
 * without one, an External Contractor's work is costed at its part of the
 * day's contractor fee from `contractor` (#1999). Shares with neither add
 * nothing and are counted as unknown.
 */
export function costWorkPeriod(
	work: CostedWorkPeriod,
	rates: readonly CostRatePeriod[],
	contractor: ContractorCosts = NO_CONTRACTOR_COSTS,
): WorkPeriodCost {
	const shares = splitElapsedTime(
		{ start: work.startedAt, end: work.endedAt, durationMinutes: work.durationMinutes },
		costIntervals(work, rates, contractor),
	).map((share): CostShare => {
		const value = share.value ?? UNKNOWN;
		const base = { start: share.start, end: share.end, durationMs: share.durationMs };
		if (value.kind === "known") {
			return { ...base, cost: value, accrued: accrueAmount(value.rate, share.durationMs) };
		}
		const cents =
			value.kind === "contractor" && work.id !== undefined
				? contractorCostOf(contractor, {
						workId: work.id,
						date: value.date,
						start: share.start,
						end: share.end,
					})
				: null;
		if (cents === null) return { ...base, cost: UNKNOWN, accrued: BigInt(0) };
		return { ...base, cost: value, accrued: cents * MS_PER_HOUR };
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
