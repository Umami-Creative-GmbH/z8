import {
	appliedConversion,
	type ConversionResult,
	type ItemConversion,
} from "@/lib/travel-expenses/currency-conversion";
import { ApprovalEvidenceError } from "./errors";

/**
 * Frozen conversion facts of a foreign-currency report expense (#607,
 * evidence schema version 3). The original money stays in `original`; the
 * applied basis, its inputs and the rounded result are frozen beside it, so a
 * later rate, policy or correction never changes a submitted revision.
 */

/** Schema version that introduced `conversion` on submitted items. */
export const CONVERSION_FACTS_SCHEMA_VERSION = 3;

/**
 * Schema version that admits the `reference_rate` basis (#608): the applied
 * ECB publication (id, version, content hash, fetch time), the approval it
 * relied on, the expense date it was chosen for and the rounded result.
 */
export const REFERENCE_RATE_FACTS_SCHEMA_VERSION = 6;

/**
 * Schema version that freezes an authorized manual rate's `evidence`
 * reference (spec #598 review, migration 0133). Below it the key is omitted,
 * so older revisions stay byte-identical.
 */
export const MANUAL_RATE_EVIDENCE_FACTS_SCHEMA_VERSION = 11;

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
 * are built below version 3 or the expense is in the reimbursement currency,
 * so older revisions stay byte-identical. In submit mode a card charge must be
 * evidenced by one of the expense's own frozen receipts, and (from version 11)
 * a manual rate by its evidence reference.
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
		applied.basis === "reference_rate" &&
		input.schemaVersion < REFERENCE_RATE_FACTS_SCHEMA_VERSION
	) {
		return {};
	}
	if (
		input.enforce &&
		applied.basis === "card_charge" &&
		(!applied.evidenceReceiptId || !input.receiptIds.includes(applied.evidenceReceiptId))
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "conversion_evidence" });
	}
	if (applied.basis === "manual_rate") {
		const { evidence, ...withoutEvidence } = applied;
		if (input.schemaVersion < MANUAL_RATE_EVIDENCE_FACTS_SCHEMA_VERSION) {
			return { conversion: withoutEvidence };
		}
		if (input.enforce && !evidence?.trim()) {
			throw new ApprovalEvidenceError("evidence_incomplete", { field: "conversion_evidence" });
		}
	}
	return { conversion: applied };
}
