import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxLocalizedText } from "../inbox/types";

const ITEM_TYPES: Record<TravelExpenseReportSubmittedItem["type"], ApprovalInboxLocalizedText> = {
	receipt: { key: "approvals:approvals.evidence.claimTypeReceipt", fallback: "Receipt" },
	mileage: { key: "approvals:approvals.evidence.claimTypeMileage", fallback: "Mileage" },
	per_diem: { key: "approvals:approvals.evidence.claimTypePerDiem", fallback: "Per diem" },
};

/**
 * A frozen expense item as the inbox names it (#688): its type and running
 * number in position order, then what the employee entered, such as
 * "Receipt 1: Hotel Hamburg". A per diem's fixed description is left out.
 */
export function reportItemTitle(
	item: Pick<TravelExpenseReportSubmittedItem, "type" | "description">,
	index: number,
): ApprovalInboxLocalizedText {
	const params = { type: ITEM_TYPES[item.type], number: index + 1 };
	return item.type === "per_diem"
		? {
				key: "approvals:approvals.evidence.reportItemNumbered",
				fallback: "{type} {number}",
				params,
			}
		: {
				key: "approvals:approvals.evidence.reportItemTitle",
				fallback: "{type} {number}: {description}",
				params: { ...params, description: item.description },
			};
}
