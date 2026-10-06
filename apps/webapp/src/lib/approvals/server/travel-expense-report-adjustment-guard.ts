import { ConflictError } from "@/lib/effect/errors";
import { sameAdjustmentBaseline } from "@/lib/travel-expenses/adjustment";
import { loadAdjustmentBaseline } from "@/lib/travel-expenses/adjustment-read";
import type { TravelExpenseReportSubmittedRevisionRecord } from "../evidence/travel-expense-report-store";
import type { ApprovalAction, ApprovalDatabase } from "./types";

/**
 * Approving an adjustment report (#615) applies its frozen delta to the
 * original report's entitlement. That delta was calculated against the
 * baseline in force at submission; if another adjustment of the same report
 * was approved since (or the original is no longer approved), approving would
 * apply a delta calculated against a stale baseline. The original report row
 * is locked (the settlement account lock), so two adjustments of one report
 * are decided one after the other and the second sees the first. Rejecting
 * or returning a stale adjustment stays possible.
 */
export async function assertAdjustmentBaselineCurrent(
	database: ApprovalDatabase,
	revision: Pick<TravelExpenseReportSubmittedRevisionRecord, "organizationId" | "facts">,
	action: ApprovalAction,
): Promise<void> {
	const adjustment = revision.facts.adjustment;
	if (action !== "approve" || !adjustment) return;
	const current = await loadAdjustmentBaseline(
		database,
		{ organizationId: revision.organizationId, originalReportId: adjustment.originalReportId },
		{ lock: true },
	);
	if (current.status === "ok" && sameAdjustmentBaseline(current.baseline, adjustment.baseline)) {
		return;
	}
	throw new ConflictError({
		message:
			"The approved amount this adjustment corrects changed after it was submitted. Return it so the employee can resubmit it against the current amount.",
		conflictType: "travel_expense_adjustment_baseline",
	});
}
