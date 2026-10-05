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
