import {
	formatCountry,
	formatMoney,
	formatPlainDate,
	formatPlainDateRange,
	formatRecordedInstant,
	formatSignedMoney,
} from "@/lib/travel-expenses/format";
import { signedAmount } from "@/lib/travel-expenses/money";
import type {
	ApprovalInboxDetailChange,
	ApprovalInboxLocalizedText,
	ApprovalInboxValue,
} from "./types";

/** A Tolgee-style translate function: key, English default, interpolation values. */
export type LocalizedTextTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/** A typed value in the viewer's locale, as the report pages show it (#687). */
export function formatApprovalInboxValue(locale: string, value: ApprovalInboxValue): string {
	switch (value.kind) {
		case "plain_date":
			return formatPlainDate(locale, value.date);
		case "plain_date_range":
			return value.start === value.end
				? formatPlainDate(locale, value.start)
				: (formatPlainDateRange(locale, value.start, value.end) ?? "");
		case "instant":
			return formatRecordedInstant(locale, value.at);
		case "money":
			return value.signed
				? formatSignedMoney(locale, value.amount, value.currency)
				: formatMoney(locale, value.amount, value.currency);
		case "country":
			return formatCountry(locale, value.code);
	}
}

/** A typed value as stored: ISO dates, the decimal with its currency code, the country code. */
function canonicalValue(value: ApprovalInboxValue): string {
	switch (value.kind) {
		case "plain_date":
			return value.date;
		case "plain_date_range":
			return value.start === value.end ? value.start : `${value.start} – ${value.end}`;
		case "instant":
			return value.at;
		case "money":
			return `${value.signed ? signedAmount(value.amount) : value.amount} ${value.currency}`;
		case "country":
			return value.code;
	}
}

function isValue(
	value: ApprovalInboxLocalizedText | ApprovalInboxValue,
): value is ApprovalInboxValue {
	return "kind" in value;
}

/** Whether a detail row's value is an original/requested change rather than a text. */
export function isApprovalInboxDetailChange(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue | ApprovalInboxDetailChange,
): value is ApprovalInboxDetailChange {
	return typeof value !== "string" && "kind" in value && value.kind === "change";
}

/**
 * Renders a review text: plain strings as they are, localized texts through
 * `translate`, translating nested parameter texts first and joining a list
 * parameter with "; ". Typed values are formatted in `locale`, or kept
 * canonical without one. The inbox UI and tests share it.
 */
export function resolveLocalizedText(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue,
	translate: LocalizedTextTranslate,
	locale?: string,
): string {
	if (typeof value === "string") return value;
	if (isValue(value)) {
		return locale ? formatApprovalInboxValue(locale, value) : canonicalValue(value);
	}
	if (!value.params) return translate(value.key, value.fallback);
	const params: Record<string, string | number> = {};
	for (const [name, param] of Object.entries(value.params)) {
		params[name] = Array.isArray(param)
			? param.map((entry) => resolveLocalizedText(entry, translate, locale)).join("; ")
			: typeof param === "object"
				? resolveLocalizedText(param, translate, locale)
				: param;
	}
	return translate(value.key, value.fallback, params);
}

/** The English default of a review text, interpolated, with canonical values (tests, logs). */
export function localizedTextFallback(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue,
): string {
	return resolveLocalizedText(value, (_key, fallback, params) =>
		fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
			params && name in params ? String(params[name]) : match,
		),
	);
}
