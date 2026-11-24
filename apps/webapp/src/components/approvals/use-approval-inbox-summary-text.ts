"use client";

import { useTranslate } from "@tolgee/react";
import { resolveReviewText } from "@/lib/approvals/inbox/summary-text";
import type { ApprovalInboxLocalizedText } from "@/lib/approvals/inbox/types";

/**
 * Renders inbox list texts (summaries, warnings) for the viewer, like `useApprovalInboxText`
 * but without naming per diem places (#1978): list texts never name one, so a list surface
 * (the Dashboard, /today) does not load the travel expense catalog. Typed values are formatted
 * in `locale`, or kept canonical without one.
 */
export function useApprovalInboxSummaryText(locale?: string) {
	const { t } = useTranslate();
	return (value: string | ApprovalInboxLocalizedText) =>
		resolveReviewText(
			value,
			(key, fallback, params) => (params ? t(key, fallback, params) : t(key, fallback)),
			locale,
		);
}
