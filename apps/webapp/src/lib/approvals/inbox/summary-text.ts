import { parseInstant } from "@/lib/datetime/temporal-core";
import { parseTimeZone } from "@/lib/timezone/validation";
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
	ApprovalInboxLocalizedText,
	ApprovalInboxPerDiemLocationParam,
	ApprovalInboxTextParam,
	ApprovalInboxValue,
} from "./types";

/**
 * Review texts without per diem place names (#1978). Inbox list summaries never name a per
 * diem place, so a list surface such as the Dashboard resolves them here without loading the
 * travel expense catalog; detail sections use `resolveLocalizedText`, which names the places.
 */

/** A Tolgee-style translate function: key, English default, interpolation values. */
export type LocalizedTextTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/** Names a per diem location parameter for the reader. */
export type PerDiemLocationNamer = (
	location: ApprovalInboxPerDiemLocationParam["perDiemLocation"],
) => string;

type ZonedInstantValue = Extract<ApprovalInboxValue, { kind: "zoned_instant" }>;

/** The instant's wall-clock time in its zone, or null for an unreadable instant or zone. */
function zonedDateTimeOf(value: ZonedInstantValue) {
	try {
		return parseInstant(value.at).toZonedDateTimeISO(parseTimeZone(value.timeZone));
	} catch {
		return null;
	}
}

/** An instant in its named zone, labelled with that zone: never the viewer's zone (#1977). */
function formatZonedInstant(locale: string, value: ZonedInstantValue): string {
	const zoned = zonedDateTimeOf(value);
	if (!zoned) return value.at;
	return `${zoned.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} ${zoned.timeZoneId}`;
}

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
		case "zoned_instant":
			return formatZonedInstant(locale, value);
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
		case "zoned_instant":
			return zonedDateTimeOf(value)?.toString({ smallestUnit: "minute" }) ?? value.at;
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

/**
 * Renders a review text: plain strings as they are, localized texts through `translate`,
 * translating nested parameter texts first and joining a list parameter with "; ". Typed
 * values are formatted in `locale`, or kept canonical without one. A per diem location is
 * named by `namePerDiemLocation`; without one, by its official label.
 */
export function resolveReviewText(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue,
	translate: LocalizedTextTranslate,
	locale?: string,
	namePerDiemLocation: PerDiemLocationNamer = (location) => location.label,
): string {
	if (typeof value === "string") return value;
	if (isValue(value)) {
		return locale ? formatApprovalInboxValue(locale, value) : canonicalValue(value);
	}
	if (!value.params) return translate(value.key, value.fallback);
	const resolveParam = (param: ApprovalInboxTextParam): string | number => {
		if (Array.isArray(param)) {
			return param
				.map((entry) => resolveReviewText(entry, translate, locale, namePerDiemLocation))
				.join("; ");
		}
		if (typeof param !== "object") return param;
		if ("perDiemLocation" in param) return namePerDiemLocation(param.perDiemLocation);
		return resolveReviewText(param, translate, locale, namePerDiemLocation);
	};
	const params: Record<string, string | number> = {};
	for (const [name, param] of Object.entries(value.params)) params[name] = resolveParam(param);
	return translate(value.key, value.fallback, params);
}
