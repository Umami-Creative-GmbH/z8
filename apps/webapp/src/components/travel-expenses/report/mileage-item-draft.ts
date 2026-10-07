import type { MileageItemDraft } from "@/lib/travel-expenses/mileage";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";

/** The entered mileage facts of a saved item. */
export function mileageDraftOf(item: ReportItemView): MileageItemDraft {
	return {
		expenseDate: item.expenseDate,
		route: item.mileage?.route ?? null,
		distanceKm: item.mileage?.distanceKm ?? null,
		vehicle: item.mileage?.vehicle ?? null,
		accountingReference: item.accountingReference,
	};
}

const DRAFT_FIELDS = [
	"expenseDate",
	"route",
	"distanceKm",
	"vehicle",
	"accountingReference",
] as const satisfies readonly (keyof MileageItemDraft)[];

/** Whether entered mileage facts equal the saved item, so its calculation applies to them. */
export function mileageDraftMatches(draft: MileageItemDraft, item: ReportItemView): boolean {
	const saved = mileageDraftOf(item);
	return DRAFT_FIELDS.every((field) => draft[field] === saved[field]);
}
