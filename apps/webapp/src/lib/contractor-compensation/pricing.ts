import { Temporal } from "temporal-polyfill";
import { splitElapsedTime } from "@/lib/billable-time/elapsed-split";
import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId, workDayOf } from "@/lib/datetime/temporal-format";
import type { ContractorCompensation } from "./terms";

/**
 * The contractor pricing engine (#1998, spec #1935): the one read-only
 * calculator that turns an External Contractor's completed work into billed
 * units and amounts. Billable Time margin (#1999) and the Contractor Time & Fee
 * Statement (#2000) both price through it. Pure and client-safe: callers load
 * work and terms (`pricing-loader.ts`) and pass them in.
 *
 * **Local days.** Work is grouped by the contractor's local calendar day at the
 * UTC offset captured on its start entry (`docs/refs/timekeeping.md`), as a
 * fixed-offset Temporal zone, the same convention as Billable Time's rates.
 * Work that crosses local midnight is split across the days it touches by
 * elapsed time (`splitElapsedTime`), so its recorded duration (net of breaks)
 * adds up exactly.
 *
 * **Terms.** Each (contractor, local day) is priced by the terms in force on
 * that day: the period whose `[from, to)` contains the day. Should two contain
 * it (the last day of one engagement and the first of the next), the later
 * `from` wins. A day without terms is unpriced, never priced at zero.
 *
 * **Units and amounts.** `hourly`: hours = worked time ÷ 1 h. `daily`: the
 * day-unit rule on the day's total worked time (`any_work_full_day` 1.0,
 * `half_and_full_day` 0.5 up to and including the threshold and 1.0 above it,
 * `prorated_by_standard_day` worked ÷ standard day, at most 1.0 when capped).
 * Units are exact fractions. A day's amount is `rate × units`, rounded half up
 * once to the currency's minor unit; it is the unit of billing, so a period's
 * total is the sum of its days and a statement's lines always add up.
 *
 * **Allocation.** A day's amount is allocated to the work shares of that day
 * in proportion to their duration (largest remainder, ties in time order), so
 * a daily rate spread over several projects is never counted twice.
 */

/** Completed work of one contractor, as Billable Time reads it. */
export interface ContractorWork {
	id: string;
	employeeId: string;
	startedAt: Instant;
	/** Exclusive end. */
	endedAt: Instant;
	/** The UTC offset captured on the work's start entry. */
	startOffsetMinutes: number;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
}

/** One effective-dated set of terms of one contractor employment period. */
export interface ContractorTermsPeriod {
	id: string;
	employeeId: string;
	employmentPeriodId: string;
	from: PlainDate;
	/** Exclusive; null while open. */
	to: PlainDate | null;
	compensation: ContractorCompensation;
}

/** An exact, non-negative quantity of hours or days: `numerator / denominator`. */
export interface ContractorUnits {
	unit: "hour" | "day";
	numerator: bigint;
	denominator: bigint;
}

/** The part of one work period that falls on one local day. */
export interface ContractorWorkShare {
	workId: string;
	start: Instant;
	end: Instant;
	durationMs: number;
}

export interface ContractorWorkAllocation {
	workId: string;
	durationMs: number;
	/** This share's part of the day's amount; the day's allocations sum to its amount. */
	amountMinor: bigint;
}

export type ContractorDayPricing =
	| {
			kind: "priced";
			termsId: string;
			employmentPeriodId: string;
			compensation: ContractorCompensation;
			units: ContractorUnits;
			/** In minor units of `compensation.currency`, rounded half up once. */
			amountMinor: bigint;
			allocations: ContractorWorkAllocation[];
	  }
	| { kind: "unpriced" };

export interface ContractorDay {
	employeeId: string;
	/** The contractor-local calendar day. */
	date: PlainDate;
	workedMs: number;
	shares: ContractorWorkShare[];
	pricing: ContractorDayPricing;
}

/** One contractor's priced days in one currency. */
export interface ContractorTotal {
	employeeId: string;
	currency: string;
	amountMinor: bigint;
	/** Hours of hourly-priced days. */
	hourUnits: ContractorUnits;
	/** Billed days of daily-priced days. */
	dayUnits: ContractorUnits;
	pricedMs: number;
}

export interface ContractorPricing {
	/** Ordered by contractor, then day. */
	days: ContractorDay[];
	/** Ordered by contractor, then currency. */
	totals: ContractorTotal[];
	/** Worked time on days without terms, per contractor. */
	unpriced: { employeeId: string; workedMs: number; days: number }[];
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = BigInt(3_600_000);

function gcd(left: bigint, right: bigint): bigint {
	let a = left < ZERO ? -left : left;
	let b = right < ZERO ? -right : right;
	while (b !== ZERO) [a, b] = [b, a % b];
	return a === ZERO ? ONE : a;
}

function units(unit: ContractorUnits["unit"], numerator: bigint, denominator: bigint): ContractorUnits {
	const divisor = gcd(numerator, denominator);
	return { unit, numerator: numerator / divisor, denominator: denominator / divisor };
}

function addUnits(left: ContractorUnits, right: ContractorUnits): ContractorUnits {
	return units(
		left.unit,
		left.numerator * right.denominator + right.numerator * left.denominator,
		left.denominator * right.denominator,
	);
}

/** `numerator / denominator` rounded half up (both non-negative). */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
	const quotient = numerator / denominator;
	return (numerator % denominator) * BigInt(2) >= denominator ? quotient + ONE : quotient;
}

/** Units as a decimal string with `scale` digits, rounded half up: 7/8 day at 2 is "0.88". */
export function unitsToDecimal(value: ContractorUnits, scale: number): string {
	const factor = BigInt(`1${"0".repeat(scale)}`);
	const scaled = roundHalfUp(value.numerator * factor, value.denominator).toString();
	if (scale === 0) return scaled;
	const digits = scaled.padStart(scale + 1, "0");
	return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** The billed units of one local day's worked time under `compensation`. */
export function dayUnits(compensation: ContractorCompensation, workedMs: number): ContractorUnits {
	const worked = BigInt(workedMs);
	if (compensation.basis === "hourly") return units("hour", worked, MS_PER_HOUR);
	if (worked <= ZERO) return units("day", ZERO, ONE);
	const rule = compensation.dayUnitRule;
	switch (rule.kind) {
		case "any_work_full_day":
			return units("day", ONE, ONE);
		case "half_and_full_day":
			return worked <= BigInt(rule.halfDayThresholdMinutes * MS_PER_MINUTE)
				? units("day", ONE, BigInt(2))
				: units("day", ONE, ONE);
		case "prorated_by_standard_day": {
			const standard = BigInt(rule.standardDayMinutes * MS_PER_MINUTE);
			return rule.capAtOneDay && worked >= standard
				? units("day", ONE, ONE)
				: units("day", worked, standard);
		}
	}
}

/** `rate × units` in minor units, rounded half up once. */
export function amountForUnits(rateMinor: bigint, value: ContractorUnits): bigint {
	return roundHalfUp(rateMinor * value.numerator, value.denominator);
}

/**
 * Splits `amountMinor` over the shares in proportion to their duration with
 * the largest-remainder method; ties go to the earlier share.
 */
export function allocateDayAmount(
	amountMinor: bigint,
	shares: readonly ContractorWorkShare[],
): ContractorWorkAllocation[] {
	const total = shares.reduce((sum, share) => sum + BigInt(share.durationMs), ZERO);
	if (total === ZERO) return shares.map((share) => ({ ...pick(share), amountMinor: ZERO }));
	const exact = shares.map((share) => amountMinor * BigInt(share.durationMs));
	const allocated = exact.map((numerator) => numerator / total);
	let spare = amountMinor - allocated.reduce((sum, value) => sum + value, ZERO);
	const byRemainder = exact
		.map((numerator, index) => ({ index, remainder: numerator % total }))
		.sort((left, right) =>
			left.remainder === right.remainder
				? left.index - right.index
				: left.remainder > right.remainder
					? -1
					: 1,
		);
	for (const { index } of byRemainder) {
		if (spare <= ZERO) break;
		allocated[index] += ONE;
		spare -= ONE;
	}
	return shares.map((share, index) => ({ ...pick(share), amountMinor: allocated[index] }));
}

function pick(share: ContractorWorkShare) {
	return { workId: share.workId, durationMs: share.durationMs };
}

const compareDates = Temporal.PlainDate.compare;

/** The terms in force on `date`; of two, the later-starting. */
export function termsInForceOn(
	employeeId: string,
	date: PlainDate,
	terms: readonly ContractorTermsPeriod[],
): ContractorTermsPeriod | null {
	let found: ContractorTermsPeriod | null = null;
	for (const candidate of terms) {
		if (candidate.employeeId !== employeeId) continue;
		if (compareDates(candidate.from, date) > 0) continue;
		if (candidate.to !== null && compareDates(date, candidate.to) >= 0) continue;
		if (
			found === null ||
			compareDates(candidate.from, found.from) > 0 ||
			(compareDates(candidate.from, found.from) === 0 && candidate.id > found.id)
		) {
			found = candidate;
		}
	}
	return found;
}

/** The shares of one work period per local day at its start offset. */
function sharesByDay(item: ContractorWork): { date: PlainDate; share: ContractorWorkShare }[] {
	const timeZone = offsetMinutesToTimeZoneId(item.startOffsetMinutes);
	const firstDay = workDayOf(item.startedAt, item.startOffsetMinutes);
	const lastDay = workDayOf(item.endedAt, item.startOffsetMinutes);
	const intervals: { start: Instant; end: Instant; value: PlainDate }[] = [];
	for (let date = firstDay; compareDates(date, lastDay) <= 0; date = date.add({ days: 1 })) {
		intervals.push({
			start: date.toZonedDateTime({ timeZone }).toInstant(),
			end: date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant(),
			value: date,
		});
	}
	return splitElapsedTime(
		{ start: item.startedAt, end: item.endedAt, durationMinutes: item.durationMinutes },
		intervals,
	).flatMap((share) =>
		share.value === null
			? []
			: [
					{
						date: share.value,
						share: {
							workId: item.id,
							start: share.start,
							end: share.end,
							durationMs: share.durationMs,
						},
					},
				],
	);
}

function inRange(date: PlainDate, range: { fromDay: PlainDate; toDay: PlainDate } | undefined) {
	return (
		!range || (compareDates(range.fromDay, date) <= 0 && compareDates(date, range.toDay) <= 0)
	);
}

/**
 * Prices contractors' completed work per local day. With `range`, only days
 * from `fromDay` through `toDay` (inclusive) are priced; the parts of work on
 * other days are left out.
 */
export function priceContractorWork(input: {
	work: readonly ContractorWork[];
	terms: readonly ContractorTermsPeriod[];
	range?: { fromDay: PlainDate; toDay: PlainDate };
}): ContractorPricing {
	const byDay = new Map<string, { employeeId: string; date: PlainDate; shares: ContractorWorkShare[] }>();
	for (const item of input.work) {
		for (const { date, share } of sharesByDay(item)) {
			if (!inRange(date, input.range)) continue;
			const key = `${item.employeeId}|${date.toString()}`;
			const entry = byDay.get(key) ?? { employeeId: item.employeeId, date, shares: [] };
			entry.shares.push(share);
			byDay.set(key, entry);
		}
	}

	const days: ContractorDay[] = [...byDay.values()]
		.sort((left, right) =>
			left.employeeId === right.employeeId
				? compareDates(left.date, right.date)
				: left.employeeId < right.employeeId
					? -1
					: 1,
		)
		.map((entry) => {
			const shares = entry.shares.sort(
				(left, right) =>
					compareInstants(left.start, right.start) ||
					(left.workId < right.workId ? -1 : left.workId > right.workId ? 1 : 0),
			);
			const workedMs = shares.reduce((sum, share) => sum + share.durationMs, 0);
			const inForce = termsInForceOn(entry.employeeId, entry.date, input.terms);
			if (!inForce) {
				return { ...entry, shares, workedMs, pricing: { kind: "unpriced" } as const };
			}
			const billed = dayUnits(inForce.compensation, workedMs);
			const amountMinor = amountForUnits(inForce.compensation.rateMinor, billed);
			return {
				...entry,
				shares,
				workedMs,
				pricing: {
					kind: "priced" as const,
					termsId: inForce.id,
					employmentPeriodId: inForce.employmentPeriodId,
					compensation: inForce.compensation,
					units: billed,
					amountMinor,
					allocations: allocateDayAmount(amountMinor, shares),
				},
			};
		});

	const totals = new Map<string, ContractorTotal>();
	const unpriced = new Map<string, { employeeId: string; workedMs: number; days: number }>();
	for (const entry of days) {
		if (entry.pricing.kind === "unpriced") {
			const current = unpriced.get(entry.employeeId) ?? {
				employeeId: entry.employeeId,
				workedMs: 0,
				days: 0,
			};
			current.workedMs += entry.workedMs;
			current.days += 1;
			unpriced.set(entry.employeeId, current);
			continue;
		}
		const { currency } = entry.pricing.compensation;
		const key = `${entry.employeeId}|${currency}`;
		const total = totals.get(key) ?? {
			employeeId: entry.employeeId,
			currency,
			amountMinor: ZERO,
			hourUnits: units("hour", ZERO, ONE),
			dayUnits: units("day", ZERO, ONE),
			pricedMs: 0,
		};
		total.amountMinor += entry.pricing.amountMinor;
		total.pricedMs += entry.workedMs;
		if (entry.pricing.units.unit === "hour") {
			total.hourUnits = addUnits(total.hourUnits, entry.pricing.units);
		} else {
			total.dayUnits = addUnits(total.dayUnits, entry.pricing.units);
		}
		totals.set(key, total);
	}

	return {
		days,
		totals: [...totals.values()].sort((left, right) =>
			left.employeeId === right.employeeId
				? left.currency.localeCompare(right.currency)
				: left.employeeId < right.employeeId
					? -1
					: 1,
		),
		unpriced: [...unpriced.values()],
	};
}
