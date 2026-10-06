import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";
import { withoutOverriddenRequirements } from "./allowance-override";
import type { ItemConversion } from "./currency-conversion";
import {
	type MileageItemRequirement,
	type MileageItemView,
	mileageItemMissingRequirements,
} from "./mileage";
import {
	emptyPerDiemItinerary,
	type PerDiemItemView,
	type PerDiemRequirement,
	perDiemMissingRequirements,
} from "./per-diem";
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

export type ReportItemRequirement =
	| ReceiptItemRequirement
	| MileageItemRequirement
	| PerDiemRequirement;

export interface RequirementItem {
	/** Receipts when absent. */
	type?: TravelExpenseReportItemType;
	/** Shared facts; a mileage item uses only its date and accounting reference. */
	draft: ReceiptItemDraft;
	receiptCount: number;
	/** Mileage facts and the server calculation of a mileage item. */
	mileage?: MileageItemView | null;
	/** Per diem itinerary and the server calculation of a per diem item (#609). */
	perDiem?: PerDiemItemView | null;
	/** Missing-receipt exception of a receipt item (#604); absent means none. */
	receiptException?: ReceiptExceptionContext;
	/** Currency conversion of a foreign receipt item (#607); absent means none. */
	conversion?: ItemConversion | null;
}

export function reportItemMissingRequirements(
	item: RequirementItem,
	context: {
		reimbursementCurrency: string;
		/** The trip's travel dates, which a per diem's itinerary must match (#609). */
		trip?: { startDate: string | null; endDate: string | null };
	},
): ReportItemRequirement[] {
	if (item.type === "per_diem") {
		// An applying override (#610) resolves the calculation, never missing facts.
		return withoutOverriddenRequirements(
			perDiemMissingRequirements(
				item.perDiem?.itinerary ?? emptyPerDiemItinerary(null),
				item.perDiem?.calculation ?? { status: "incomplete" },
				context.trip ?? { startDate: null, endDate: null },
			),
			item.perDiem?.override,
		);
	}
	if (item.type === "mileage") {
		const mileage = item.mileage;
		return withoutOverriddenRequirements(mileageItemRequirements(item, mileage), mileage?.override);
	}
	return receiptItemMissingRequirements(item.draft, {
		receiptCount: item.receiptCount,
		reimbursementCurrency: context.reimbursementCurrency,
		receiptException: item.receiptException,
		conversion: item.conversion,
	});
}

function mileageItemRequirements(
	item: RequirementItem,
	mileage: MileageItemView | null | undefined,
): MileageItemRequirement[] {
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
