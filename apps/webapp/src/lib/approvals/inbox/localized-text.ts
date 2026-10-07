import { perDiemLocationName } from "@/lib/travel-expenses/per-diem-location-name";
import type { ApprovalInboxLocalizedText, ApprovalInboxTextParam } from "./types";

/** A Tolgee-style translate function: key, English default, interpolation values. */
export type LocalizedTextTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

function resolveParam(
	param: ApprovalInboxTextParam,
	translate: LocalizedTextTranslate,
	locale: string,
): string | number {
	if (Array.isArray(param)) {
		return param.map((entry) => resolveLocalizedText(entry, translate, locale)).join("; ");
	}
	if (typeof param !== "object") return param;
	if ("perDiemLocation" in param) {
		return perDiemLocationName(param.perDiemLocation, locale, translate);
	}
	return resolveLocalizedText(param, translate, locale);
}

/**
 * Renders a review text: plain strings as they are, localized texts through
 * `translate`, translating nested parameter texts first, joining a list
 * parameter with "; " and naming per diem locations for `locale`. The inbox
 * detail panel and tests share it.
 */
export function resolveLocalizedText(
	value: string | ApprovalInboxLocalizedText,
	translate: LocalizedTextTranslate,
	locale: string,
): string {
	if (typeof value === "string") return value;
	if (!value.params) return translate(value.key, value.fallback);
	const params: Record<string, string | number> = {};
	for (const [name, param] of Object.entries(value.params)) {
		params[name] = resolveParam(param, translate, locale);
	}
	return translate(value.key, value.fallback, params);
}

/** The English default of a review text, interpolated (tests, logs). */
export function localizedTextFallback(value: string | ApprovalInboxLocalizedText): string {
	return resolveLocalizedText(
		value,
		(_key, fallback, params) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
		"en",
	);
}
