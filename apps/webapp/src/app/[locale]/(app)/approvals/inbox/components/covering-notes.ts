import type { useTranslate } from "@tolgee/react";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The "Covering for" section heading of an absent approver (#1016). */
export function getCoveringForTitle(t: Translate, name: string): string {
	return t("approvals:approvals.coveringFor", "Covering for {name}", { name });
}

export function getCoveringForDescription(t: Translate, name: string): string {
	return t(
		"approvals:approvals.coveringForDescription",
		"{name} is away and named you as deputy. You can decide their pending approvals; {name} can still decide them too.",
		{ name },
	);
}

/** Shown instead of decisions when the deputy decided an earlier stage (four-eyes). */
export function getDecidedEarlierStageNote(t: Translate): string {
	return t(
		"approvals:approvals.decidedEarlierStageNote",
		"You already decided an earlier stage of this request, so another approver decides this one.",
	);
}
