import { ADJUSTMENT_FACTS_SCHEMA_VERSION } from "@/lib/approvals/evidence/travel-expense-report-adjustment";
import type { TravelExpenseReportSubmittedFacts } from "@/lib/approvals/evidence/travel-expense-report-facts";
import { adjustmentDelta, composeAdjustmentBaseline } from "./adjustment";

/**
 * Export columns of adjustment reports (#615). An approved adjustment is
 * exported as its own revision (once, like every revision) and stays
 * separately identifiable from the original: `record_type` is `adjustment`,
 * `adjusts_report_id` names the original report, and `adjustment_delta` is the
 * signed amount that changes the original's entitlement. Its expense rows are
 * the full corrected report for reference; accounting applies the delta.
 */

export const ADJUSTMENT_EXPENSE_COLUMNS = ["record_type", "adjusts_report_id"] as const;

export const ADJUSTMENT_REPORT_COLUMNS = [
	"record_type",
	"adjusts_report_id",
	"adjustment_reason",
	"adjustment_baseline_revision_id",
	"adjustment_baseline_entitlement",
	"adjustment_delta",
] as const;

type Cells = {
	text: (value: string | null | undefined) => string;
	decimal: (value: string) => string;
};

export function adjustmentExpenseCells(facts: TravelExpenseReportSubmittedFacts, cells: Cells) {
	const { adjustment } = facts;
	return [
		cells.text(adjustment ? "adjustment" : "original"),
		cells.text(adjustment?.originalReportId),
	];
}

export function adjustmentReportCells(facts: TravelExpenseReportSubmittedFacts, cells: Cells) {
	const { adjustment } = facts;
	if (!adjustment) return [cells.text("original"), ...ADJUSTMENT_REPORT_COLUMNS.slice(1).map(() => cells.text(null))];
	return [
		cells.text("adjustment"),
		cells.text(adjustment.originalReportId),
		cells.text(adjustment.reason),
		cells.text(adjustment.baseline.revisionId),
		cells.decimal(adjustment.baseline.entitlement),
		cells.decimal(adjustment.delta.amount),
	];
}

/**
 * An adjustment is exported only when its frozen facts are self-consistent:
 * frozen at a version that has adjustments, its baseline adds up and its delta
 * is exactly the corrected total minus that baseline. Returns a reason when not.
 */
export function adjustmentManifestProblem(facts: TravelExpenseReportSubmittedFacts): string | null {
	const { adjustment } = facts;
	if (!adjustment) return null;
	if (facts.schemaVersion < ADJUSTMENT_FACTS_SCHEMA_VERSION) {
		return `Adjustment in facts schema version ${facts.schemaVersion}`;
	}
	try {
		const { adjustments, entitlement: _entitlement, ...original } = adjustment.baseline;
		const baseline = composeAdjustmentBaseline(original, adjustments);
		const delta = adjustmentDelta(
			{ amount: facts.totals.reimbursable, currency: facts.totals.currency },
			baseline,
		);
		if (
			baseline.entitlement !== adjustment.baseline.entitlement ||
			delta.amount !== adjustment.delta.amount ||
			delta.currency !== adjustment.delta.currency
		) {
			return "Adjustment delta does not match its baseline";
		}
	} catch {
		return "Adjustment baseline is malformed";
	}
	return null;
}
