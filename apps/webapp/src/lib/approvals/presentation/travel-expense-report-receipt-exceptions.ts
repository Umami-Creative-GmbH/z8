import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";
import { reportItemTitle } from "./travel-expense-report-item-title";

/**
 * Review presentation of missing-receipt exceptions (#604): conspicuous on the
 * expense itself, never shown as an attached receipt, and listed once for the
 * reviewer's explicit acceptance.
 */

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key,
	fallback,
});

/** Receipt rows of an expense frozen with an exception instead of receipts. */
export function receiptExceptionRows(exception: { reason: string }): Row[] {
	return [
		{
			label: text("approvals:approvals.evidence.receipts", "Receipts"),
			value: text(
				"approvals:approvals.evidence.receiptMissingException",
				"Missing — exception requested",
			),
			tone: "warning",
		},
		{
			label: text(
				"approvals:approvals.evidence.receiptExceptionReason",
				"Why the receipt is missing",
			),
			value: exception.reason,
			tone: "warning",
		},
	];
}

/** The acceptance section; none when the revision has no exception. */
export function receiptExceptionAcceptanceSections(
	facts: Pick<TravelExpenseReportSubmittedFacts, "items">,
): ApprovalInboxDetailSection[] {
	const items = facts.items.flatMap((item: TravelExpenseReportSubmittedItem, index) =>
		item.receiptException
			? [
					{
						itemId: item.itemId,
						label: reportItemTitle(item, index),
						reason: item.receiptException.reason,
					},
				]
			: [],
	);
	if (items.length === 0) return [];
	return [
		{
			type: "receipt_exception_acceptance",
			title: text("approvals:approvals.evidence.receiptExceptionsTitle", "Missing receipts"),
			items,
		},
	];
}
