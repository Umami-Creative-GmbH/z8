import { ConflictError } from "@/lib/effect/errors";
import { sameAdjustmentBaseline } from "@/lib/travel-expenses/adjustment";
import {
	effectiveAdjustmentSource,
	loadAdjustmentBaseline,
	loadAdjustmentSource,
} from "@/lib/travel-expenses/adjustment-read";
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
 *
 * The adjustment must also still be a copy of the approved facts in force: one
 * copied before another adjustment was approved still holds what that
 * correction changed, so approving it would silently undo the correction even
 * with a current baseline. It is refused (`source_superseded`); the employee
 * starts a fresh adjustment instead.
 */
export async function assertAdjustmentBaselineCurrent(
	database: ApprovalDatabase,
	revision: Pick<
		TravelExpenseReportSubmittedRevisionRecord,
		"organizationId" | "reportId" | "facts"
	>,
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
		const source = await loadAdjustmentSource(database, {
			organizationId: revision.organizationId,
			reportId: revision.reportId,
		});
		if (source && effectiveAdjustmentSource(current).revisionId === source.sourceRevisionId) return;
		throw new ConflictError({
			message:
				"Another adjustment of this report was approved after this one was started, and this one does not include that correction. Reject or return it; the employee starts a new adjustment from the current facts.",
			conflictType: "travel_expense_adjustment_baseline",
			details: { code: "source_superseded" },
		});
	}
	throw new ConflictError({
		message:
			"The approved amount this adjustment corrects changed after it was submitted. Reject or return it; the employee starts a new adjustment from the current facts.",
		conflictType: "travel_expense_adjustment_baseline",
		details: { code: "baseline_changed" },
	});
}
