/**
 * Exact money arithmetic for travel expenses (#598). The arithmetic itself is
 * the shared `@/lib/money/exact-decimal` (bigint units at a fixed scale, no
 * floats); this module adds the travel expense storage scale and limit.
 * `formatMoney` in the report components formats amounts for display.
 */

export {
	currencyMinorUnitDigits,
	type DecimalInput,
	divideToUnits,
	formatUnits,
	multiplyToUnits,
	normalizeDecimalInput,
	parseUnits,
	type RoundingMode,
	roundToScale,
	type ScaledUnits,
	signedAmount,
	sumUnits,
} from "@/lib/money/exact-decimal";

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
