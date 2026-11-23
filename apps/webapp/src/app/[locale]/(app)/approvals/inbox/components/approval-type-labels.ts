import type { useTranslate } from "@tolgee/react";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";

/** One approval's type, in the singular: a card's or list row's badge (#1978). */
export function getApprovalItemTypeLabels(
	t: ReturnType<typeof useTranslate>["t"],
): Record<ApprovalInboxType, string> {
	return {
		absence_entry: t("approvals:sprint.types.absenceEntry", "Absence request"),
		absence_change_request: t(
			"approvals:sprint.types.absenceChangeRequest",
			"Absence change request",
		),
		// Corrections, manual submissions and clock-outs alike.
		time_entry: t("approvals:sprint.types.timeEntry", "Time entry"),
		travel_expense_claim: t("approvals:sprint.types.travelExpenseClaim", "Travel expense claim"),
		travel_expense_report: t("approvals:sprint.types.travelExpenseReport", "Expense report"),
		period_submission: t("approvals:sprint.types.periodSubmission", "Period submission"),
		compliance_exception: t("approvals:sprint.types.complianceException", "Compliance exception"),
	};
}

/** Approval types as filter categories, in the plural: pills, filters, counts. */
export function getApprovalTypeLabels(
	t: ReturnType<typeof useTranslate>["t"],
): Record<ApprovalInboxType, string> {
	return {
		absence_entry: t("approvals:approvals.types.absence_entry", "Absence Requests"),
		absence_change_request: t(
			"approvals:approvals.types.absence_change_request",
			"Absence Changes",
		),
		time_entry: t("approvals:approvals.types.time_entry", "Time Corrections"),
		travel_expense_claim: t("approvals:approvals.types.travel_expense_claim", "Travel Expenses"),
		travel_expense_report: t(
			"approvals:approvals.types.travel_expense_report",
			"Expense Reports"
		),
		period_submission: t("approvals:approvals.types.period_submission", "Period Submissions"),
		compliance_exception: t(
			"approvals:approvals.types.compliance_exception",
			"Compliance Exceptions",
		),
	};
}
