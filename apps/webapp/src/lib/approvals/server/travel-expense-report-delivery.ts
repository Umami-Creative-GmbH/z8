import type { ApprovalDeliveryIntentEvent } from "@/db/schema";
import { legacyDeliveryCycleId, recordLegacyDeliveryIntent } from "../delivery/intents";
import type { LegacyLifecycleReference } from "../evidence/store";
import { TRAVEL_EXPENSE_REPORT_SOURCE_TYPE } from "../evidence/travel-expense-report-store";
import type { ApprovalDatabase } from "./types";

/**
 * The delivery lifecycle of one report submission cycle (#623). A report is
 * resubmitted (#603), so unlike an expense claim each cycle is its own
 * lifecycle: the legacy chain instance, or the single legacy request, that
 * the submission created, read from the cycle's frozen revision. The
 * submission, every decision and a later withdrawal or return of the same
 * cycle use this one key, so its cards version and refresh independently of
 * other cycles of the report.
 */
export function travelExpenseReportDeliveryCycleId(revision: LegacyLifecycleReference): string {
	return legacyDeliveryCycleId({
		chainInstanceId: revision.chainInstanceId,
		approvalRequestId: revision.approvalRequestId,
	});
}

/**
 * Writes a lifecycle intent of a report cycle in the caller's transaction, only
 * while a delivery control exists. Returns whether one was written, so the
 * caller kicks the delivery owner after commit.
 */
export function recordTravelExpenseReportDeliveryIntent(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		reportId: string;
		/** The request this event concerns: the submitted, decided or withdrawn one. */
		approvalRequestId: string;
		/** The legacy lifecycle of the cycle's frozen revision. */
		revision: LegacyLifecycleReference;
		event: ApprovalDeliveryIntentEvent;
	},
): Promise<boolean> {
	return recordLegacyDeliveryIntent(database, {
		organizationId: input.organizationId,
		workflowType: "travel_expense",
		sourceType: TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
		sourceId: input.reportId,
		approvalRequestId: input.approvalRequestId,
		cycleId: travelExpenseReportDeliveryCycleId(input.revision),
		event: input.event,
	});
}
