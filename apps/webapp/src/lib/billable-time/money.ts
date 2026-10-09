/**
 * Money in the billable currency (#898): billable rates now, cost rates (#899),
 * revenue and margin (#902) and hand-off lines (#903) later. Built on the shared
 * exact decimal arithmetic: amounts are `bigint` units, never floats.
 *
 * Every billable currency (EUR, CHF, USD, GBP) has two minor-unit digits, so a
 * rate and an amount are both integer cents (`RATE_SCALE`).
 *
 * Amounts for elapsed time are accrued exactly as `rate cents × milliseconds`
 * (`AccruedAmount`), summed exactly, and rounded once per displayed aggregate:
 * half up to the cent (`roundAccruedAmount`). Never round a line and then sum
 * the rounded lines into a total shown next to them.
 *
 * Client-safe: rate forms parse and format with it.
 */

import {
	divideToUnits,
	formatUnits,
	normalizeDecimalInput,
	parseUnits,
	type RoundingMode,
	sumUnits,
} from "@/lib/money/exact-decimal";

/** Decimals of a rate and an amount: cents in every billable currency. */
export const RATE_SCALE = 2;

/**
 * The largest hourly rate, 999 999.99, in cents. Rates are stored as
 * `numeric(12, 2)`; the limit keeps products with long durations well inside it.
 */
export const MAX_RATE_UNITS = BigInt(99_999_999);

/** An hourly rate in cents of the billable currency. */
export type RateUnits = bigint;

/** `rate cents × elapsed milliseconds`: an exact amount before rounding. */
export type AccruedAmount = bigint;

export const ZERO_ACCRUED: AccruedAmount = BigInt(0);

const MILLISECONDS_PER_HOUR = BigInt(3_600_000);

export type ParsedRate =
	| { ok: true; units: RateUnits }
	| { ok: false; reason: "invalid" | "not_positive" | "too_large" };

/**
 * Reads an entered hourly rate ("85.50", "85,5", "95"). A billable rate is a
 * positive price: "no rate" is unpriced work, never a rate of zero.
 */
export function parseRate(input: string): ParsedRate {
	const units = parseUnits(normalizeDecimalInput(input), RATE_SCALE);
	if (units === null) return { ok: false, reason: "invalid" };
	if (units <= BigInt(0)) return { ok: false, reason: "not_positive" };
	if (units > MAX_RATE_UNITS) return { ok: false, reason: "too_large" };
	return { ok: true, units };
}

/**
 * Reads a stored rate (a `numeric(12, 2)` column value). Throws on anything a
 * rate column cannot hold, which would be a schema error, not user input.
 */
export function rateFromStored(value: string): RateUnits {
	const units = parseUnits(value, RATE_SCALE);
	if (units === null) throw new RangeError(`Not a stored rate: ${value}`);
	return units;
}

/** A rate or amount in cents as a two-decimal string: 8550 is "85.50". */
export function formatRate(units: bigint): string {
	return formatUnits(units, RATE_SCALE);
}

/** The exact amount for `durationMs` whole milliseconds at an hourly rate. */
export function accrueAmount(rate: RateUnits, durationMs: number | bigint): AccruedAmount {
	if (typeof durationMs === "number" && !Number.isSafeInteger(durationMs)) {
		throw new RangeError(`Not a whole number of milliseconds: ${durationMs}`);
	}
	const milliseconds = BigInt(durationMs);
	if (milliseconds < BigInt(0)) throw new RangeError("A duration cannot be negative");
	return rate * milliseconds;
}

export function addAccruedAmounts(amounts: Iterable<AccruedAmount>): AccruedAmount {
	return sumUnits(amounts);
}

/**
 * An accrued amount in cents, rounded once with `mode` (half up by default, the
 * documented rule for every displayed Billable Time aggregate).
 */
export function roundAccruedAmount(amount: AccruedAmount, mode: RoundingMode = "half_up"): bigint {
	return divideToUnits(
		{ units: amount, scale: 0 },
		{ units: MILLISECONDS_PER_HOUR, scale: 0 },
		0,
		mode,
	);
}
