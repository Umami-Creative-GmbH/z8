"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { resolveLocalizedText } from "@/lib/approvals/inbox/localized-text";
import type {
	ApprovalInboxLocalizedText,
	ApprovalInboxSummary,
	ApprovalInboxValue,
} from "@/lib/approvals/inbox/types";

/** A list row's title, subtitle or detail: its localized form when the source sends one. */
export function summaryField(
	summary: ApprovalInboxSummary,
	field: "title" | "subtitle" | "detail",
): string | ApprovalInboxLocalizedText {
	return summary.localized?.[field] ?? summary[field];
}

/**
 * Renders inbox texts for the viewer: localized texts translated, typed values
 * (dates, amounts, countries) formatted in the viewer's locale like the report
 * pages (#687), plain strings as they are.
 */
export function useApprovalInboxText() {
	const { t } = useTranslate();
	const locale = useLocale();
	return (value: string | ApprovalInboxLocalizedText | ApprovalInboxValue) =>
		// Nested texts (e.g. a per diem day's basis inside its line) are translated first.
		resolveLocalizedText(
			value,
			(key, fallback, params) => (params ? t(key, fallback, params) : t(key, fallback)),
			locale,
		);
}
