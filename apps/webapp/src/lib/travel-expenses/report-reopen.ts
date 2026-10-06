import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";
import { RETURN_NOTE_MAX_LENGTH } from "./report-return";

/**
 * Pure rules for reopening an approved travel expense report (#614). An
 * authorized approver can send an approved report back for correction with a
 * reason, as long as no money was recorded and no export completed. Once the
 * report has been exported or reimbursed, a correction needs a linked
 * adjustment instead (#615), so the original approval, export and payment
 * records stay as they are.
 */

export const REOPEN_REASON_MAX_LENGTH = RETURN_NOTE_MAX_LENGTH;

export type ReopenReasonError = "reason_required" | "reason_too_long";

export function parseReopenReason(
	reason: string,
): { ok: true; value: string } | { ok: false; error: ReopenReasonError } {
	const value = reason.trim();
	if (!value) return { ok: false, error: "reason_required" };
	if (value.length > REOPEN_REASON_MAX_LENGTH) return { ok: false, error: "reason_too_long" };
	return { ok: true, value };
}

/** Why an approved report can no longer be reopened and needs an adjustment (#615). */
export type ReopenAdjustmentReason = "reimbursed" | "exported";

export type ReopenDecision =
	| { kind: "allowed" }
	/** The current submission is not approved (any more), or its approval is not on record. */
	| { kind: "not_approved" }
	/** The actor's own report, or not an approver of it. */
	| { kind: "forbidden" }
	| { kind: "adjustment_required"; reason: ReopenAdjustmentReason };

export interface ReopenFacts {
	status: TravelExpenseReportStatus;
	/** Decision evidence records the approval of the current submission. */
	approvalRecorded: boolean;
	ownReport: boolean;
	/** An approver of the report: of its approving request, or of its latest one. */
	authorized: boolean;
	/** Any reimbursement or recovery was recorded for the report. */
	reimbursed: boolean;
	/** A completed export batch holds a revision of the report. */
	exported: boolean;
}

/**
 * Whether the report can be reopened. Authorization is decided before the
 * report's status or any export or payment fact is revealed.
 */
export function decideReopen(facts: ReopenFacts): ReopenDecision {
	if (facts.ownReport || !facts.authorized) return { kind: "forbidden" };
	if (facts.status !== "approved" || !facts.approvalRecorded) return { kind: "not_approved" };
	if (facts.reimbursed) return { kind: "adjustment_required", reason: "reimbursed" };
	if (facts.exported) return { kind: "adjustment_required", reason: "exported" };
	return { kind: "allowed" };
}
