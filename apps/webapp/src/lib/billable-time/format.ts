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
