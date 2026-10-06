import { and, eq } from "drizzle-orm";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	travelExpenseReport,
	travelExpenseReportItem,
	travelExpenseReportReceipt,
} from "@/db/schema";
import { loadReportConversionRows } from "@/lib/travel-expenses/conversion-read";
import { loadReportPerDiemRows } from "@/lib/travel-expenses/per-diem-pricing";
import type { ResolvePolicyAndCreateApprovalResult } from "../policies/chain-service";
import type { ApprovalDatabase } from "../server/types";
import { ApprovalEvidenceError } from "./errors";
import {
	compareLiveTravelExpenseReportWithRevision,
	type TravelExpenseReportFactsInput,
	type TravelExpenseReportRevisionComparison,
} from "./travel-expense-report-facts";
import {
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "./travel-expense-report-store";

/**
 * The organization-scoped report with every item and receipt row linked to it.
 * Receipt and item rows are read by report alone so that a row of another
 * organization is refused by the facts builder instead of silently left out.
 */
export async function loadTravelExpenseReportFactsInput(
	database: ApprovalDatabase,
	scope: { organizationId: string; reportId: string },
): Promise<
	| (Omit<TravelExpenseReportFactsInput, "items"> & {
			items: (typeof travelExpenseReportItem.$inferSelect)[];
			fileNames: Record<string, string>;
	  })
	| null
> {
	const [reports, items, receipts, conversions, perDiems] = await Promise.all([
		database
			.select()
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, scope.reportId),
					eq(travelExpenseReport.organizationId, scope.organizationId),
				),
			)
			.limit(2),
		database
			.select()
			.from(travelExpenseReportItem)
			.where(eq(travelExpenseReportItem.reportId, scope.reportId)),
		database
			.select()
			.from(travelExpenseReportReceipt)
			.where(eq(travelExpenseReportReceipt.reportId, scope.reportId)),
		loadReportConversionRows(database, scope.reportId),
		loadReportPerDiemRows(database, scope.reportId),
	]);
	const report = reports[0];
	if (reports.length !== 1 || !report) return null;
	return {
		report: {
			id: report.id,
			organizationId: report.organizationId,
			employeeId: report.employeeId,
			kind: report.kind,
			reimbursementCurrency: report.reimbursementCurrency,
			submissionCount: report.submissionCount,
			tripPurpose: report.tripPurpose,
			tripStartDate: report.tripStartDate,
			tripEndDate: report.tripEndDate,
			tripTimeZone: report.tripTimeZone,
			tripDestinations: report.tripDestinations,
			projectId: report.projectId,
		},
		items,
		receipts,
		conversions,
		perDiems,
		fileNames: Object.fromEntries(receipts.map((receipt) => [receipt.id, receipt.fileName])),
	};
}

/**
 * The legacy rows routing created for this submission: exactly one request of
 * the report in the expected state, and its chain when a policy matched.
 */
export async function verifyTravelExpenseReportLifecycle(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		reportId: string;
		routing: ResolvePolicyAndCreateApprovalResult;
	},
): Promise<{ chainInstanceId: string | null; approverEmployeeId: string }> {
	const requests = await database
		.select({
			id: approvalRequest.id,
			status: approvalRequest.status,
			approverId: approvalRequest.approverId,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.routing.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				eq(approvalRequest.entityId, input.reportId),
			),
		)
		.limit(2);
	const request = requests[0];
	if (requests.length !== 1 || request?.status !== "pending") {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_lifecycle" });
	}
	const approverEmployeeId = request.approverId;
	const chainInstanceId =
		input.routing.kind === "chain_created" ? input.routing.chainInstanceId : null;
	if (!chainInstanceId) return { chainInstanceId: null, approverEmployeeId };
	const [chains, stages] = await Promise.all([
		database
			.select({ id: approvalChainInstance.id })
			.from(approvalChainInstance)
			.where(
				and(
					eq(approvalChainInstance.id, chainInstanceId),
					eq(approvalChainInstance.organizationId, input.organizationId),
					eq(approvalChainInstance.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
					eq(approvalChainInstance.entityId, input.reportId),
				),
			)
			.limit(2),
		database
			.select({ id: approvalChainStageInstance.id })
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.chainInstanceId, chainInstanceId),
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.routing.approvalRequestId),
				),
			)
			.limit(2),
	]);
	if (chains.length !== 1 || stages.length !== 1) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_lifecycle" });
	}
	return { chainInstanceId, approverEmployeeId };
}

/**
 * Fresh check before a decision: the live report, items and receipts must still
 * equal the frozen revision of its current submission cycle.
 */
export async function compareTravelExpenseReportWithSubmittedRevision(
	database: ApprovalDatabase,
	revision: TravelExpenseReportSubmittedRevisionRecord,
): Promise<TravelExpenseReportRevisionComparison> {
	const live = await loadTravelExpenseReportFactsInput(database, {
		organizationId: revision.organizationId,
		reportId: revision.reportId,
	});
	if (!live) return { kind: "material_change", changedFields: ["unverifiable:report"] };
	return compareLiveTravelExpenseReportWithRevision(revision.facts, live);
}
