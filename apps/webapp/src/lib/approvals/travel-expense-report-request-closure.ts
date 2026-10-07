import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { approvalRequest, travelExpenseReportCycleClosure } from "@/db/schema";
import type { ApprovalDatabase } from "./server/types";

/**
 * A travel expense report's legacy approval request that closed without a
 * decision (#603). A return and a withdrawal both retire the cycle's request
 * with the legacy status `rejected`, because the legacy request has no other
 * non-pending status. Every reader that shows or counts request outcomes must
 * consult the cycle closure instead of treating that status as a rejection.
 * A reopened approval (#614) keeps its approved request and is not listed.
 */
export type TravelExpenseReportRequestClosure = "returned" | "withdrawn";

const NON_DECISION_KINDS: TravelExpenseReportRequestClosure[] = ["returned", "withdrawn"];

/** The non-decision closures of the given requests, keyed by request id. */
export async function loadTravelExpenseReportRequestClosures(
	database: Pick<ApprovalDatabase, "select">,
	organizationId: string,
	approvalRequestIds: readonly string[],
): Promise<Map<string, TravelExpenseReportRequestClosure>> {
	if (approvalRequestIds.length === 0) return new Map();
	const rows = await database
		.select({
			approvalRequestId: travelExpenseReportCycleClosure.approvalRequestId,
			kind: travelExpenseReportCycleClosure.kind,
		})
		.from(travelExpenseReportCycleClosure)
		.where(
			and(
				eq(travelExpenseReportCycleClosure.organizationId, organizationId),
				inArray(travelExpenseReportCycleClosure.approvalRequestId, [...approvalRequestIds]),
				inArray(travelExpenseReportCycleClosure.kind, NON_DECISION_KINDS),
			),
		);
	return new Map(
		rows.map((row) => [row.approvalRequestId, row.kind as TravelExpenseReportRequestClosure]),
	);
}

/**
 * SQL condition on `approval_request`: the request was not closed as a return
 * or withdrawal, so its `rejected` status really is a rejection.
 */
export function isNotTravelExpenseReportNonDecision(): SQL {
	// The closure table is named literally: relational queries alias every
	// column reference to the root table, which only the request columns are.
	return sql`not exists (
		select 1 from travel_expense_report_cycle_closure closure
		where closure.organization_id = ${approvalRequest.organizationId}
			and closure.approval_request_id = ${approvalRequest.id}
			and closure.kind in ('returned', 'withdrawn')
	)`;
}
