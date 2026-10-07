/**
 * Exact money arithmetic for travel expenses (#598). There is no decimal
 * library and floats are never used: an amount is an integer count of units
 * at a fixed decimal scale (`89.90` at scale 2 is 8990 units), held as a
 * `bigint` so sums, signed balances and products can never overflow or drift.
 * Decimal strings are the boundary format (database `decimal` columns, frozen
 * facts); `formatMoney` in the report components formats them for display.
 */

const ZERO = BigInt(0);
/** Longer input is refused instead of parsed; no amount or rate needs it. */
const MAX_DECIMAL_LENGTH = 40;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function pow10(exponent: number): bigint {
	// Built from digits: a down-levelled `**` would call Math.pow on bigints.
	return BigInt(`1${"0".repeat(exponent)}`);
}

/**
 * Parses a plain decimal string ("89.90", "-0.05", "12") into integer units of
 * `scale` decimals. Trailing zeros beyond the scale are accepted ("100.00" at
 * scale 0); a significant digit beyond it is refused, never rounded away.
 * Returns null for anything else (blank, exponent, comma, sign "+", ".5").
 */
export function parseUnits(value: string, scale: number): bigint | null {
	if (value.length > MAX_DECIMAL_LENGTH) return null;
	const match = DECIMAL.exec(value);
	if (!match) return null;
	const [, sign, whole = "", rawFraction = ""] = match;
	const fraction = rawFraction.replace(/0+$/, "");
	if (fraction.length > scale) return null;
	const units = BigInt(whole) * pow10(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
	return sign ? -units : units;
}

/**
 * An entered decimal with a decimal comma ("257,30") as a plain decimal
 * ("257.30"), like every amount field accepts it. Input that already has a
 * point is only trimmed, so grouping such as "1.234,50" stays invalid.
 */
export function normalizeDecimalInput(value: string): string {
	const trimmed = value.trim();
	return trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
}

/**
 * How a result between two representable values is rounded, applied exactly
 * once at the end of a calculation (never to intermediate products):
 * - `half_up`: a half rounds away from zero (0.125 → 0.13, -0.125 → -0.13),
 *   the usual commercial rounding ("kaufmännisches Runden").
 * - `half_even`: a half rounds to the even neighbour (0.125 → 0.12,
 *   0.135 → 0.14), the banker's rounding that does not bias sums.
 * Anything other than an exact half rounds to the nearest value.
 */
export type RoundingMode = "half_up" | "half_even";

/** An exact decimal: `units × 10^-scale`. */
export interface ScaledUnits {
	units: bigint;
	scale: number;
}

/** A decimal operand: a plain decimal string or already parsed units. */
export type DecimalInput = string | ScaledUnits;

function toScaled(value: DecimalInput): ScaledUnits {
	if (typeof value !== "string") return value;
	const match = DECIMAL.exec(value);
	const scale = match ? (match[3]?.length ?? 0) : 0;
	const units = match ? parseUnits(value, scale) : null;
	if (units === null) throw new RangeError(`Not a plain decimal: ${value}`);
	return { units, scale };
}

/** Rounds `numerator / denominator` to an integer with `mode`. */
function roundQuotient(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
	if (denominator === ZERO) throw new RangeError("Division by zero");
	const n = denominator < ZERO ? -numerator : numerator;
	const d = denominator < ZERO ? -denominator : denominator;
	const quotient = n / d;
	const remainder = n % d;
	if (remainder === ZERO) return quotient;
	const twice = (remainder < ZERO ? -remainder : remainder) * BigInt(2);
	const awayFromZero = n < ZERO ? quotient - BigInt(1) : quotient + BigInt(1);
	if (twice > d) return awayFromZero;
	if (twice < d) return quotient;
	if (mode === "half_up") return awayFromZero;
	return quotient % BigInt(2) === ZERO ? quotient : awayFromZero;
}

/** Re-expresses an exact decimal at `scale`, rounding with `mode` when digits are lost. */
function rescale(value: ScaledUnits, scale: number, mode: RoundingMode): bigint {
	if (scale >= value.scale) return value.units * pow10(scale - value.scale);
	return roundQuotient(value.units, pow10(value.scale - scale), mode);
}

/** Signed exact sum of units of one scale; an empty list is zero. */
export function sumUnits(values: Iterable<bigint>): bigint {
	let sum = ZERO;
	for (const value of values) sum += value;
	return sum;
}

/**
 * `left × right` as units of `scale`, computed exactly and rounded once with
 * `mode`: distance × rate per km (mileage), amount × exchange rate
 * (conversion), days × daily rate (per diem). Throws a RangeError when an
 * operand is not a plain decimal; validate user input before calling.
 */
export function multiplyToUnits(
	left: DecimalInput,
	right: DecimalInput,
	scale: number,
	mode: RoundingMode,
): bigint {
	const a = toScaled(left);
	const b = toScaled(right);
	return rescale({ units: a.units * b.units, scale: a.scale + b.scale }, scale, mode);
}

/**
 * `dividend ÷ divisor` as units of `scale`, computed exactly and rounded once
 * with `mode`, e.g. an amount divided by a rate quoted per reimbursement
 * unit. Throws a RangeError for a zero divisor or a malformed operand.
 */
export function divideToUnits(
	dividend: DecimalInput,
	divisor: DecimalInput,
	scale: number,
	mode: RoundingMode,
): bigint {
	const a = toScaled(dividend);
	const b = toScaled(divisor);
	return roundQuotient(a.units * pow10(b.scale + scale), b.units * pow10(a.scale), mode);
}

/** A decimal as units of `scale`, rounding with `mode` only when digits are lost. */
export function roundToScale(value: DecimalInput, scale: number, mode: RoundingMode): bigint {
	return rescale(toScaled(value), scale, mode);
}

/**
 * Scale of every stored amount: the `decimal(12, 2)` columns and the frozen
 * facts strings ("89.90") use two decimals for every currency. A currency with
 * fewer minor units (JPY) is stored as "1500.00"; validate against
 * `currencyMinorUnitDigits` instead of storing more precision.
 */
export const STORED_AMOUNT_SCALE = 2;

/**
 * The largest single amount in units of `STORED_AMOUNT_SCALE`: 999 999 999.99
 * (99 999 999 999 units), one digit below what a `decimal(12, 2)` column holds,
 * so report sums of many such amounts still fit. Every entered or derived
 * amount is checked against it.
 */
export const MAX_AMOUNT_UNITS = BigInt("99999999999");

/**
 * A signed difference as text: "+12.30" when positive, "-12.30" when negative
 * and the plain amount for zero ("0.00", never "+0.00"). Non-decimal input is
 * returned unchanged.
 */
export function signedAmount(amount: string): string {
	const scale = DECIMAL.exec(amount)?.[3]?.length ?? 0;
	const units = parseUnits(amount, scale);
	return units !== null && units > ZERO ? `+${amount}` : amount;
}

/** ISO 4217 minor-unit exponent of a currency: 2 for EUR, 0 for JPY, 3 for KWD. */
export function currencyMinorUnitDigits(currency: string): number {
	return (
		new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
			.maximumFractionDigits ?? 2
	);
}

/** Formats integer units as a fixed-scale decimal string: 8990 at scale 2 is "89.90". */
export function formatUnits(units: bigint, scale: number): string {
	const sign = units < ZERO ? "-" : "";
	const digits = (units < ZERO ? -units : units).toString().padStart(scale + 1, "0");
	if (scale === 0) return `${sign}${digits}`;
	return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
