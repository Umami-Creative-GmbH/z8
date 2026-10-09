import { Temporal } from "temporal-polyfill";

/**
 * Display formatting for Billable Time amounts and rate dates. Client-safe.
 * The decimal string itself is formatted, so no binary float can change a digit.
 */
export function formatBillableAmount(locale: string, amount: string, currency: string): string {
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
			amount as Intl.StringNumericLiteral,
		);
	} catch {
		return `${amount} ${currency}`;
	}
}

/**
 * Hours (a number, or a decimal string such as "12.50") with a fixed number of
 * decimals in the viewer's locale, without a unit.
 */
export function formatBillableHours(
	locale: string,
	hours: number | string,
	fractionDigits: number,
): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(typeof hours === "string" ? (hours as Intl.StringNumericLiteral) : hours);
}

/**
 * A two-decimal rate (`"95.00"`) as the viewer types it, e.g. "95,00" in
 * German: no currency and no grouping, so it can be entered back as is.
 */
export function formatRateInput(locale: string, rate: string): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		useGrouping: false,
	}).format(rate as Intl.StringNumericLiteral);
}

/** A calendar day (`YYYY-MM-DD`) as a medium date, with no time zone conversion. */
export function formatBillableDay(locale: string, value: string): string {
	return formatRateDate(locale, value);
}

/** A rate date (`YYYY-MM-DD`) as a medium date, with no time zone conversion. */
export function formatRateDate(locale: string, value: string): string {
	try {
		return Temporal.PlainDate.from(value).toLocaleString(locale, { dateStyle: "medium" });
	} catch {
		return value;
	}
}

/** The last day of a half-open period ending before `effectiveTo`. */
export function lastDayBefore(effectiveTo: string): string {
	return Temporal.PlainDate.from(effectiveTo).subtract({ days: 1 }).toString();
}

/** Whether `[effectiveFrom, effectiveTo)` contains `day`. */
export function periodContains(
	period: { effectiveFrom: string; effectiveTo: string | null },
	day: string,
): boolean {
	return period.effectiveFrom <= day && (period.effectiveTo === null || day < period.effectiveTo);
}
