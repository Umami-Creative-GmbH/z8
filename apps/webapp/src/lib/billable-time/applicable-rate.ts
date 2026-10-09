import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { type ElapsedInterval, splitElapsedTime } from "./elapsed-split";
import {
	type AccruedAmount,
	accrueAmount,
	addAccruedAmounts,
	type RateUnits,
	roundAccruedAmount,
} from "./money";

/**
 * The applicable-rate resolver (#898). Pure: callers load the rate periods
 * (`billable-rate-store.ts`) and pass them in.
 *
 * Rate levels in precedence order: the most specific level with a rate in
 * effect wins (Billable Time glossary, "Rate level").
 */
export const RATE_LEVELS = ["employee_project", "project", "customer", "employee"] as const;

export type RateLevel = (typeof RATE_LEVELS)[number];

export function isRateLevel(value: unknown): value is RateLevel {
	return typeof value === "string" && (RATE_LEVELS as readonly string[]).includes(value);
}

/** One billable rate period of one rate level and target. */
export interface BillableRatePeriod {
	id: string;
	level: RateLevel;
	/** Set for `employee_project` and `employee`. */
	employeeId: string | null;
	/** Set for `employee_project` and `project`. */
	projectId: string | null;
	/** Set for `customer`. */
	customerId: string | null;
	from: PlainDate;
	/** Exclusive; null while open. */
	to: PlainDate | null;
	rate: RateUnits;
}

/** Who did the work, and on which project and customer. */
export interface RatedWork {
	employeeId: string;
	projectId: string | null;
	/** The project's current customer; null when the project has none. */
	customerId: string | null;
}

export interface RatedWorkStart extends RatedWork {
	startedAt: Instant;
	/** The UTC offset captured on the work's start entry. */
	startOffsetMinutes: number;
}

export type ApplicableRate =
	| { kind: "priced"; rate: RateUnits; level: RateLevel; ratePeriodId: string }
	| { kind: "unpriced" };

const UNPRICED: ApplicableRate = { kind: "unpriced" };

/**
 * The employee-local day an instant falls on, at the offset captured with the
 * work (never the viewer's time zone; `docs/refs/timekeeping.md`).
 */
export function workDayOf(instant: Instant, offsetMinutes: number): PlainDate {
	return instant.toZonedDateTimeISO(offsetMinutesToTimeZoneId(offsetMinutes)).toPlainDate();
}

function matches(rate: BillableRatePeriod, work: RatedWork): boolean {
	switch (rate.level) {
		case "employee_project":
			return (
				work.projectId !== null &&
				rate.employeeId === work.employeeId &&
				rate.projectId === work.projectId
			);
		case "project":
			return work.projectId !== null && rate.projectId === work.projectId;
		case "customer":
			// The customer comes from the work's project: no project, no customer.
			return (
				work.projectId !== null && work.customerId !== null && rate.customerId === work.customerId
			);
		case "employee":
			return rate.employeeId === work.employeeId;
	}
}

function inEffectOn(rate: BillableRatePeriod, date: PlainDate): boolean {
	return (
		Temporal.PlainDate.compare(rate.from, date) <= 0 &&
		(rate.to === null || Temporal.PlainDate.compare(date, rate.to) < 0)
	);
}

/** The applicable rate for work on one employee-local day. */
export function resolveApplicableRateOnDay(
	work: RatedWork,
	date: PlainDate,
	rates: readonly BillableRatePeriod[],
): ApplicableRate {
	for (const level of RATE_LEVELS) {
		const winner = rates.find(
			(rate) => rate.level === level && matches(rate, work) && inEffectOn(rate, date),
		);
		if (winner) {
			return { kind: "priced", rate: winner.rate, level, ratePeriodId: winner.id };
		}
	}
	return UNPRICED;
}

/**
 * The applicable rate of a piece of work: the winning level's rate in effect on
 * the employee-local day the work started, or unpriced.
 */
export function resolveApplicableRate(
	work: RatedWorkStart,
	rates: readonly BillableRatePeriod[],
): ApplicableRate {
	return resolveApplicableRateOnDay(
		work,
		workDayOf(work.startedAt, work.startOffsetMinutes),
		rates,
	);
}

export interface RatedWorkPeriod extends RatedWorkStart {
	endedAt: Instant;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
}

export interface PricedShare {
	applicable: ApplicableRate;
	start: Instant;
	end: Instant;
	durationMs: number;
	/** Zero for unpriced shares. */
	accrued: AccruedAmount;
}

export interface PricedWorkPeriod {
	shares: PricedShare[];
	pricedMs: number;
	unpricedMs: number;
	/** Exact; sum these across a report before rounding (`roundAccruedAmount`). */
	accrued: AccruedAmount;
	/** This period alone, rounded half up to the cent. */
	amountCents: bigint;
}

/**
 * The applicable rate of each local day a work period touches, as instant
 * intervals at the work's start offset (consecutive days with the same rate
 * period are merged).
 */
export function applicableRateIntervals(
	work: RatedWorkPeriod,
	rates: readonly BillableRatePeriod[],
): ElapsedInterval<ApplicableRate>[] {
	const timeZone = offsetMinutesToTimeZoneId(work.startOffsetMinutes);
	const lastDay = workDayOf(work.endedAt, work.startOffsetMinutes);
	const intervals: ElapsedInterval<ApplicableRate>[] = [];
	for (
		let date = workDayOf(work.startedAt, work.startOffsetMinutes);
		Temporal.PlainDate.compare(date, lastDay) <= 0;
		date = date.add({ days: 1 })
	) {
		const applicable = resolveApplicableRateOnDay(work, date, rates);
		const start = date.toZonedDateTime({ timeZone }).toInstant();
		const end = date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
		const previous = intervals.at(-1);
		if (previous && sameRate(previous.value, applicable)) {
			previous.end = end;
		} else {
			intervals.push({ start, end, value: applicable });
		}
	}
	return intervals;
}

function sameRate(left: ApplicableRate, right: ApplicableRate): boolean {
	if (left.kind === "unpriced" || right.kind === "unpriced") return left.kind === right.kind;
	return left.ratePeriodId === right.ratePeriodId;
}

/**
 * Prices one completed work period: its recorded duration is split by elapsed
 * time across the applicable rates of the local days it spans (the
 * hourly-earnings convention), and each share is priced at its rate. Unpriced
 * shares add no amount and are counted apart.
 */
export function priceWorkPeriod(
	work: RatedWorkPeriod,
	rates: readonly BillableRatePeriod[],
): PricedWorkPeriod {
	const shares = splitElapsedTime(
		{ start: work.startedAt, end: work.endedAt, durationMinutes: work.durationMinutes },
		applicableRateIntervals(work, rates),
	).map((share): PricedShare => {
		const applicable = share.value ?? UNPRICED;
		return {
			applicable,
			start: share.start,
			end: share.end,
			durationMs: share.durationMs,
			accrued:
				applicable.kind === "priced" ? accrueAmount(applicable.rate, share.durationMs) : BigInt(0),
		};
	});
	const accrued = addAccruedAmounts(shares.map((share) => share.accrued));
	const unpricedMs = shares
		.filter((share) => share.applicable.kind === "unpriced")
		.reduce((sum, share) => sum + share.durationMs, 0);
	const totalMs = shares.reduce((sum, share) => sum + share.durationMs, 0);
	return {
		shares,
		pricedMs: totalMs - unpricedMs,
		unpricedMs,
		accrued,
		amountCents: roundAccruedAmount(accrued),
	};
}
