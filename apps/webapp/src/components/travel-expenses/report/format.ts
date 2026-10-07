import type { useTranslate } from "@tolgee/react";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { signedAmount } from "@/lib/travel-expenses/money";

type Translate = ReturnType<typeof useTranslate>["t"];

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

/**
 * A recorded instant (submission, decision) shown in UTC with its zone, like
 * the claim history: never in the viewer's zone.
 */
export function formatRecordedInstant(locale: string, iso: string): string {
	try {
		return `${parseInstant(iso)
			.toZonedDateTimeISO("UTC")
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} UTC`;
	} catch {
		return iso;
	}
}

/** Translated label of an expense category, falling back to the stored value. */
export function categoryLabel(t: Translate, category: string) {
	const labels: Record<string, string> = {
		transport: t("travelExpenses.report.categories.transport", "Transport"),
		accommodation: t("travelExpenses.report.categories.accommodation", "Accommodation"),
		meals: t("travelExpenses.report.categories.meals", "Meals"),
		parking: t("travelExpenses.report.categories.parking", "Parking"),
		other: t("travelExpenses.report.categories.other", "Other"),
	};
	return labels[category] ?? category;
}

export { formatCountry } from "@/lib/travel-expenses/country-name";
