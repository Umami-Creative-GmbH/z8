import { parsePlainDate } from "@/lib/datetime/temporal-core";

/** Formats a stored decimal amount; falls back to the raw value for unknown currencies. */
export function formatMoney(locale: string, amount: string, currency: string) {
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
	} catch {
		return `${amount} ${currency}`;
	}
}

/** Formats a calendar date (YYYY-MM-DD) without any timezone conversion. */
export function formatPlainDate(locale: string, value: string) {
	try {
		return parsePlainDate(value).toLocaleString(locale, { dateStyle: "medium" });
	} catch {
		return value;
	}
}

/** Formats first and last travel day as entered; either may still be missing. */
export function formatPlainDateRange(locale: string, start: string | null, end: string | null) {
	if (start && end) return `${formatPlainDate(locale, start)} – ${formatPlainDate(locale, end)}`;
	if (start) return formatPlainDate(locale, start);
	if (end) return formatPlainDate(locale, end);
	return null;
}

/** Localized country name of an ISO 3166 code, falling back to the code. */
export function formatCountry(locale: string, code: string) {
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}
