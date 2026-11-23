import { perDiemLocationName } from "@/lib/travel-expenses/per-diem-location-name";
import { type LocalizedTextTranslate, resolveReviewText } from "./summary-text";
import type {
	ApprovalInboxDetailChange,
	ApprovalInboxLocalizedText,
	ApprovalInboxValue,
} from "./types";

export { formatApprovalInboxValue, type LocalizedTextTranslate } from "./summary-text";

/** Whether a detail row's value is an original/requested change rather than a text. */
export function isApprovalInboxDetailChange(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue | ApprovalInboxDetailChange,
): value is ApprovalInboxDetailChange {
	return typeof value !== "string" && "kind" in value && value.kind === "change";
}

/**
 * Renders a review text: plain strings as they are, localized texts through
 * `translate`, translating nested parameter texts first, joining a list
 * parameter with "; " and naming per diem locations for `locale`. Typed
 * values are formatted in `locale`, or kept canonical without one (per diem
 * locations are then named in English). The inbox UI and tests share it.
 */
export function resolveLocalizedText(
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue,
	translate: LocalizedTextTranslate,
	locale?: string,
): string {
	return resolveReviewText(value, translate, locale, (location) =>
		perDiemLocationName(location, locale ?? "en", translate),
	);
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
