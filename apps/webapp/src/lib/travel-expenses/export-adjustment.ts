import { ADJUSTMENT_FACTS_SCHEMA_VERSION } from "@/lib/approvals/evidence/travel-expense-report-adjustment";
import type { TravelExpenseReportSubmittedFacts } from "@/lib/approvals/evidence/travel-expense-report-facts";
import { adjustmentDelta, composeAdjustmentBaseline } from "./adjustment";

/**
 * Export columns of adjustment reports (#615). An approved adjustment is
 * exported as its own revision (once, like every revision) and stays
 * separately identifiable from the original: `record_type` is `adjustment`,
 * `adjusts_report_id` names the original report, and `adjustment_delta` is the
 * signed amount that changes the original's entitlement.
 *
 * Summable money never double counts an original and its adjustment:
 * - `reports.csv` `reimbursable_total` is the frozen total of an original and
 *   the signed delta of an adjustment, so summing it per currency gives the
 *   net entitlement of the batch. `company_paid_total` is empty for an
 *   adjustment (company-paid costs are never owed).
 * - `expenses.csv` `reimbursement_amount` / `company_paid_amount` are empty on
 *   an adjustment's rows: its items are the full corrected report, shown for
 *   reference in `corrected_reimbursement_amount` / `corrected_company_paid_amount`
 *   (a delta is not attributable to single items). Summing the expense rows
 *   therefore gives the originals only; deltas live on `reports.csv`.
 * - `corrected_reimbursable_total` / `corrected_company_paid_total` on
 *   `reports.csv` keep the corrected report's own frozen totals.
 */

export const ADJUSTMENT_EXPENSE_COLUMNS = [
	"record_type",
	"adjusts_report_id",
	"corrected_reimbursement_amount",
	"corrected_company_paid_amount",
] as const;

export const ADJUSTMENT_REPORT_COLUMNS = [
	"record_type",
	"adjusts_report_id",
	"adjustment_reason",
	"adjustment_baseline_revision_id",
	"adjustment_baseline_entitlement",
	"adjustment_delta",
	"corrected_reimbursable_total",
	"corrected_company_paid_total",
] as const;

type Cells = {
	text: (value: string | null | undefined) => string;
	decimal: (value: string) => string;
};

/** Item money cells already formatted as stored decimals. */
type ItemMoneyCells = { reimbursement: string; companyPaid: string };

/**
 * The summable `reimbursement_amount` and `company_paid_amount` cells of an
 * expense row: empty on an adjustment (see the module comment).
 */
export function summableItemMoneyCells(
	facts: TravelExpenseReportSubmittedFacts,
	money: ItemMoneyCells,
): [string, string] {
	return facts.adjustment ? ["", ""] : [money.reimbursement, money.companyPaid];
}

/**
 * The summable `reimbursable_total` and `company_paid_total` cells of a
 * report row: an adjustment's signed delta and no company-paid total.
 */
export function summableReportTotalCells(
	facts: TravelExpenseReportSubmittedFacts,
	cells: Cells,
): [string, string] {
	return facts.adjustment
		? [cells.decimal(facts.adjustment.delta.amount), ""]
		: [cells.decimal(facts.totals.reimbursable), cells.decimal(facts.totals.companyPaid)];
}

export function adjustmentExpenseCells(
	facts: TravelExpenseReportSubmittedFacts,
	cells: Cells,
	money: ItemMoneyCells,
) {
	const { adjustment } = facts;
	return [
		cells.text(adjustment ? "adjustment" : "original"),
		cells.text(adjustment?.originalReportId),
		adjustment ? money.reimbursement : "",
		adjustment ? money.companyPaid : "",
	];
}

export function adjustmentReportCells(facts: TravelExpenseReportSubmittedFacts, cells: Cells) {
	const { adjustment } = facts;
	if (!adjustment)
		return [
			cells.text("original"),
			...ADJUSTMENT_REPORT_COLUMNS.slice(1, 6).map(() => cells.text(null)),
			"",
			"",
		];
	return [
		cells.text("adjustment"),
		cells.text(adjustment.originalReportId),
		cells.text(adjustment.reason),
		cells.text(adjustment.baseline.revisionId),
		cells.decimal(adjustment.baseline.entitlement),
		cells.decimal(adjustment.delta.amount),
		cells.decimal(facts.totals.reimbursable),
		cells.decimal(facts.totals.companyPaid),
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
