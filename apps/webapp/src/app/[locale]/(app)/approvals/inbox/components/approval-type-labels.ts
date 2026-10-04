import type { useTranslate } from "@tolgee/react";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";

export function getApprovalTypeLabels(
	t: ReturnType<typeof useTranslate>["t"],
): Record<ApprovalInboxType, string> {
	return {
		absence_entry: t("approvals:approvals.types.absence_entry", "Absence Requests"),
		time_entry: t("approvals:approvals.types.time_entry", "Time Corrections"),
		travel_expense_claim: t("approvals:approvals.types.travel_expense_claim", "Travel Expenses"),
	};
}
