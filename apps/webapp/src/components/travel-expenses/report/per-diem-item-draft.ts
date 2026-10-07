import {
	emptyPerDiemItinerary,
	type PerDiemItinerary,
	samePerDiemItinerary,
} from "@/lib/travel-expenses/per-diem";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";

/** The entered per diem facts of a saved item. */
export function perDiemDraftOf(item: ReportItemView): PerDiemItinerary {
	return item.perDiem?.itinerary ?? emptyPerDiemItinerary(null);
}

/** Whether entered per diem facts equal the saved item, so its calculation applies to them. */
export function perDiemDraftMatches(draft: PerDiemItinerary, item: ReportItemView): boolean {
	return samePerDiemItinerary(draft, perDiemDraftOf(item));
}
