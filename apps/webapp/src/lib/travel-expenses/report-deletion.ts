import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";

/**
 * Deleting a draft report (#684). Only a draft that was never submitted can be
 * deleted; a withdrawn or returned report keeps its submission history and is
 * edited or withdrawn instead. `report-deletion-store.ts` enforces it.
 */
export function isDeletableDraftReport(report: {
	status: TravelExpenseReportStatus;
	submissionCount: number;
}): boolean {
	return report.status === "draft" && report.submissionCount === 0;
}
