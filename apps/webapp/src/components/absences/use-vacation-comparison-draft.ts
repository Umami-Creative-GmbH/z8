"use client";

import { useState } from "react";
import {
	type ComparisonDates,
	type ComparisonOption,
	comparisonDatesOf,
	resumeVacationComparison,
	startVacationComparison,
	type VacationComparison,
} from "@/lib/absences/vacation-comparison";

/**
 * The request form's vacation comparison (#1342): ephemeral, scoped to one organization and user,
 * and shared by every option through the draft's category.
 *
 * The comparison survives Back and applying an option, so reopening it resumes with the original
 * re-synced to the draft. Closing the form, a successful submission, another category, and another
 * organization or user discard it.
 */
export function useVacationComparisonDraft({
	contextKey,
	categoryId,
	readDraft,
	applyToDraft,
}: {
	/** `${organizationId}:${userId}`; another context discards the comparison. */
	contextKey: string;
	/** The draft's current category; a comparison of another category is never shown. */
	categoryId: string;
	readDraft: () => ComparisonDates & { categoryId: string };
	/** Sets an applied option's dates, duration and times on the draft. */
	applyToDraft: (dates: ComparisonDates) => void;
}) {
	const [comparison, setComparison] = useState<VacationComparison | null>(null);
	const [isComparing, setIsComparing] = useState(false);
	const [appliedOptionLabel, setAppliedOptionLabel] = useState<string | null>(null);
	// Focus returns to Compare dates once, right after leaving the comparison.
	const [focusCompareOnReturn, setFocusCompareOnReturn] = useState(false);

	const clear = () => {
		setComparison(null);
		setIsComparing(false);
		setAppliedOptionLabel(null);
		setFocusCompareOnReturn(false);
	};
	if (comparison && comparison.contextKey !== contextKey) {
		// Another organization or user: the comparison is discarded, never shown there.
		clear();
	}

	const current = comparison && comparison.categoryId === categoryId ? comparison : null;

	return {
		/** The comparison while it is open, else null. */
		activeComparison: isComparing ? current : null,
		appliedOptionLabel,
		focusCompareOnReturn,
		/** Called once focus has returned to Compare dates. */
		focusReturned: () => setFocusCompareOnReturn(false),
		/** A manual edit of the draft's dates makes the applied notice stale. */
		dismissAppliedNotice: () => setAppliedOptionLabel(null),
		clear,
		open: () => {
			const { categoryId: draftCategoryId, ...draft } = readDraft();
			setComparison(
				current
					? resumeVacationComparison(current, draft)
					: startVacationComparison({ contextKey, categoryId: draftCategoryId, draft }),
			);
			setAppliedOptionLabel(null);
			setFocusCompareOnReturn(false);
			setIsComparing(true);
		},
		change: (next: VacationComparison) => setComparison(next),
		back: () => {
			setIsComparing(false);
			setFocusCompareOnReturn(true);
		},
		/** Only dates, duration and times change; the alternatives stay for a later comparison. */
		apply: (option: ComparisonOption, label: string) => {
			applyToDraft(comparisonDatesOf(option));
			setIsComparing(false);
			setAppliedOptionLabel(label);
			setFocusCompareOnReturn(true);
		},
	};
}
