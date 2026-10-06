import {
	appliedConversion,
	type ConversionResult,
	type ItemConversion,
} from "@/lib/travel-expenses/currency-conversion";
import { ApprovalEvidenceError } from "./errors";

/**
 * Frozen conversion facts of a foreign-currency report expense (#607,
 * evidence schema version 2). The original money stays in `original`; the
 * applied basis, its inputs and the rounded result are frozen beside it, so a
 * later rate, policy or correction never changes a submitted revision.
 */

/** Schema version that introduced `conversion` on submitted items. */
export const CONVERSION_FACTS_SCHEMA_VERSION = 2;

/** `reimbursement` is the amount the expense counts with, in the reimbursement currency. */
export type TravelExpenseReportSubmittedConversion = ConversionResult;

/** A saved conversion row of one report item, already mapped from the database. */
export interface TravelExpenseReportConversionRow {
	organizationId: string;
	reportId: string;
	itemId: string;
	conversion: ItemConversion;
}

/** Every conversion must belong to an item of this report in this organization. */
export function assertConversionScope(
	rows: readonly TravelExpenseReportConversionRow[],
	report: { id: string; organizationId: string },
	itemIds: ReadonlySet<string>,
): void {
	for (const row of rows) {
		if (
			row.organizationId !== report.organizationId ||
			row.reportId !== report.id ||
			!itemIds.has(row.itemId)
		) {
			throw new ApprovalEvidenceError("invariant", { field: "conversion_scope" });
		}
	}
}

/**
 * The `conversion` key of a submitted item, as a spread: empty when the facts
 * are built below version 2 or the expense is in the reimbursement currency,
 * so older revisions stay byte-identical. In submit mode a card charge must be
 * evidenced by one of the expense's own frozen receipts.
 */
export function submittedConversionFacts(input: {
	schemaVersion: number;
	enforce: boolean;
	original: { amount: string | null; currency: string | null };
	reimbursementCurrency: string;
	conversion: ItemConversion | null;
	receiptIds: readonly string[];
}): { conversion?: TravelExpenseReportSubmittedConversion } {
	if (input.schemaVersion < CONVERSION_FACTS_SCHEMA_VERSION) return {};
	const applied = appliedConversion(input.original, input.reimbursementCurrency, input.conversion);
	if (!applied) return {};
	if (
		input.enforce &&
		applied.basis === "card_charge" &&
		(!applied.evidenceReceiptId || !input.receiptIds.includes(applied.evidenceReceiptId))
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "conversion_evidence" });
	}
	return { conversion: applied };
}
