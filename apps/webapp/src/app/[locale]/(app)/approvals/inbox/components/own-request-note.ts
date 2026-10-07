import type { useTranslate } from "@tolgee/react";

/** Shown instead of decisions on the viewer's own request (#686). */
export function getOwnRequestNote(t: ReturnType<typeof useTranslate>["t"]): string {
	return t("approvals:approvals.ownRequestNote", "Your own request: another approver decides it.");
}
