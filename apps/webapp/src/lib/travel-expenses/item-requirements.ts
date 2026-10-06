import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";
import type { ItemConversion } from "./currency-conversion";
import {
	type MileageItemRequirement,
	type MileageItemView,
	mileageItemMissingRequirements,
} from "./mileage";
import type { ReceiptExceptionContext } from "./receipt-exception";
import {
	type ReceiptItemDraft,
	type ReceiptItemRequirement,
	receiptItemMissingRequirements,
} from "./receipt-report";

/**
 * What still keeps one expense item of a report from being submittable, per
 * item type (#606). Report-level checks (trip requirements, the submission
 * check, the frozen facts builder and the editor) ask here instead of
 * assuming every item is a receipt.
 */

export type ReportItemRequirement = ReceiptItemRequirement | MileageItemRequirement;

export interface RequirementItem {
	/** Receipts when absent. */
	type?: TravelExpenseReportItemType;
	/** Shared facts; a mileage item uses only its date and accounting reference. */
	draft: ReceiptItemDraft;
	receiptCount: number;
	/** Mileage facts and the server calculation of a mileage item. */
	mileage?: MileageItemView | null;
	/** Missing-receipt exception of a receipt item (#604); absent means none. */
	receiptException?: ReceiptExceptionContext;
	/** Currency conversion of a foreign receipt item (#607); absent means none. */
	conversion?: ItemConversion | null;
}

export function reportItemMissingRequirements(
	item: RequirementItem,
	context: { reimbursementCurrency: string },
): ReportItemRequirement[] {
	if (item.type === "mileage") {
		const mileage = item.mileage;
		return mileageItemMissingRequirements(
			{
				expenseDate: item.draft.expenseDate,
				route: mileage?.route ?? null,
				distanceKm: mileage?.distanceKm ?? null,
				vehicle: mileage?.vehicle ?? null,
				accountingReference: item.draft.accountingReference,
			},
			mileage?.calculation ?? { status: "incomplete" },
		);
	}
	return receiptItemMissingRequirements(item.draft, {
		receiptCount: item.receiptCount,
		reimbursementCurrency: context.reimbursementCurrency,
		receiptException: item.receiptException,
		conversion: item.conversion,
	});
}
