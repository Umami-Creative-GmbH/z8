import type { ApprovalInboxLocalizedText } from "./types";

/** A Tolgee-style translate function: key, English default, interpolation values. */
export type LocalizedTextTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string | number>,
) => string;

/**
 * Renders a review text: plain strings as they are, localized texts through
 * `translate`, translating nested parameter texts first and joining a list
 * parameter with "; ". The inbox detail panel and tests share it.
 */
export function resolveLocalizedText(
	value: string | ApprovalInboxLocalizedText,
	translate: LocalizedTextTranslate,
): string {
	if (typeof value === "string") return value;
	if (!value.params) return translate(value.key, value.fallback);
	const params: Record<string, string | number> = {};
	for (const [name, param] of Object.entries(value.params)) {
		params[name] = Array.isArray(param)
			? param.map((entry) => resolveLocalizedText(entry, translate)).join("; ")
			: typeof param === "object"
				? resolveLocalizedText(param, translate)
				: param;
	}
	return translate(value.key, value.fallback, params);
}

/** The English default of a review text, interpolated (tests, logs). */
export function localizedTextFallback(value: string | ApprovalInboxLocalizedText): string {
	return resolveLocalizedText(value, (_key, fallback, params) =>
		fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
			params && name in params ? String(params[name]) : match,
		),
	);
}
