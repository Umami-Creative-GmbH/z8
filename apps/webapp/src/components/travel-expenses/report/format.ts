import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { signedAmount } from "@/lib/travel-expenses/money";

/**
 * Formats a stored decimal amount; falls back to the raw value for unknown
 * currencies. The decimal string itself is formatted, so no binary float can
 * change a digit.
 */
export function formatMoney(locale: string, amount: string, currency: string) {
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
			amount as Intl.StringNumericLiteral,
		);
	} catch {
		return `${amount} ${currency}`;
	}
}

/** A signed difference (#615): "+" only when positive; zero carries no sign. */
export function formatSignedMoney(locale: string, amount: string, currency: string) {
	const formatted = formatMoney(locale, amount, currency);
	return signedAmount(amount).startsWith("+") ? `+${formatted}` : formatted;
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
