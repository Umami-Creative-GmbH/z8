import "server-only";
import "@/lib/approvals/init";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { approvalRequest, employee, travelExpenseReport } from "@/db/schema";
import { listLegacyDecisionEvidence } from "@/lib/approvals/evidence/store";
import type {
	TravelExpenseReportReceiptManifestItem,
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "@/lib/approvals/evidence/travel-expense-report-store";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { loadFinanceActor } from "./finance-access";

/**
 * Reads of a submitted travel expense report (#602): its owner, or a reviewer
 * the Approvals inbox already authorizes for one of the report's requests.
 * Reading never creates a binding or changes authority, and every view shows
 * the frozen submission, never the live rows.
 */

type ReportRow = typeof travelExpenseReport.$inferSelect;

/** `finance` (#612): separately permissioned, approved reports only, frozen evidence only. */
export type ReportAccess = "owner" | "reviewer" | "finance";

export type AuthorizedReportResult =
	| { status: "unauthorized" }
	| { status: "not_found" }
	| { status: "found"; report: ReportRow; access: ReportAccess };

export async function loadAuthorizedTravelExpenseReport(
	reportId: string,
): Promise<AuthorizedReportResult> {
	const actor = await getAuthContext();
	if (!actor?.employee) return { status: "unauthorized" };
	if (!z.uuid().safeParse(reportId).success) return { status: "not_found" };
	const organizationId = actor.employee.organizationId;
	const [report] = await db
		.select()
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!report) return { status: "not_found" };
	if (report.employeeId === actor.employee.id) return { status: "found", report, access: "owner" };
	const requests = await db
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				eq(approvalRequest.entityId, report.id),
			),
		);
	for (const request of requests) {
		const review = await loadAuthorizedApprovalDetail({
			userId: actor.user.id,
			organizationId,
			approvalId: request.id,
			kind: "compatibility",
		});
		if (
			review.status === "found" &&
			review.detail.item.entityId === report.id &&
			review.detail.item.type === TRAVEL_EXPENSE_REPORT_SOURCE_TYPE
		) {
			return { status: "found", report, access: "reviewer" };
		}
	}
	if (report.status === "approved" && (await loadFinanceActor())?.canRead) {
		return { status: "found", report, access: "finance" };
	}
	return { status: "not_found" };
}

export interface SubmittedReportItemView
	extends Omit<TravelExpenseReportSubmittedItem, "receipts"> {
	receipts: Array<Pick<TravelExpenseReportReceiptManifestItem, "receiptId"> & { fileName: string }>;
}

export interface SubmittedReportView {
	reportId: string;
	status: ReportRow["status"];
	access: ReportAccess;
	submittedAt: string;
	/** Who currently holds the pending review; null once decided. */
	reviewerName: string | null;
	decision: {
		outcome: "approved" | "rejected";
		decidedAt: string;
		deciderName: string | null;
		/** Rejection reason as the reviewer recorded it. */
		reason: string | null;
	} | null;
	history: Array<{
		id: string;
		label: "submitted" | "approval_recorded" | "approved" | "rejected";
		at: string;
		actorName: string | null;
	}>;
	facts: Pick<
		TravelExpenseReportSubmittedFacts,
		"reportKind" | "reimbursementCurrency" | "trip" | "totals"
	> & { items: SubmittedReportItemView[] };
}

function itemView(
	item: TravelExpenseReportSubmittedItem,
	revision: TravelExpenseReportSubmittedRevisionRecord,
): SubmittedReportItemView {
	const { receipts, ...facts } = item;
	return {
		...facts,
		receipts: receipts.map((receipt) => ({
			receiptId: receipt.receiptId,
			fileName: revision.labels.receiptFileNames[receipt.receiptId] ?? receipt.receiptId,
		})),
	};
}

/** The latest submission of an authorized report; null for one never submitted. */
export async function loadSubmittedReportView(
	report: ReportRow,
	access: ReportAccess,
): Promise<SubmittedReportView | null> {
	const revision = await loadTravelExpenseReportSubmittedRevision(db, {
		organizationId: report.organizationId,
		reportId: report.id,
		submissionCycle: report.submissionCount,
	});
	if (!revision) return null;
	const [requests, decisions] = await Promise.all([
		db
			.select({
				id: approvalRequest.id,
				status: approvalRequest.status,
				rejectionReason: approvalRequest.rejectionReason,
				approverName: user.name,
			})
			.from(approvalRequest)
			.leftJoin(
				employee,
				and(
					eq(employee.id, approvalRequest.approverId),
					eq(employee.organizationId, approvalRequest.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(approvalRequest.organizationId, report.organizationId),
					eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
					eq(approvalRequest.entityId, report.id),
				),
			)
			.orderBy(asc(approvalRequest.createdAt)),
		listLegacyDecisionEvidence(db, {
			organizationId: report.organizationId,
			submittedRevisionId: revision.id,
		}),
	]);
	const final = decisions.find(
		(decision) => decision.requestOutcome === "approved" || decision.requestOutcome === "rejected",
	);
	const finalRequest = final
		? requests.find((request) => request.id === final.legacy.approvalRequestId)
		: undefined;
	const pending = requests.find((request) => request.status === "pending");
	return {
		reportId: report.id,
		status: report.status,
		access,
		submittedAt: instantToCanonicalString(revision.submittedAt),
		reviewerName: report.status === "submitted" ? (pending?.approverName ?? null) : null,
		decision:
			final && (final.requestOutcome === "approved" || final.requestOutcome === "rejected")
				? {
						outcome: final.requestOutcome,
						decidedAt: instantToCanonicalString(final.decidedAt),
						deciderName: final.labels.actorName,
						reason:
							final.requestOutcome === "rejected" ? (finalRequest?.rejectionReason ?? null) : null,
					}
				: null,
		history: [
			{
				id: `submitted-${revision.id}`,
				label: "submitted",
				at: instantToCanonicalString(revision.submittedAt),
				actorName: revision.labels.submitterName,
			},
			...decisions.map((decision) => ({
				id: decision.id,
				label:
					decision.requestOutcome === "approved" || decision.requestOutcome === "rejected"
						? decision.requestOutcome
						: ("approval_recorded" as const),
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		],
		facts: {
			reportKind: revision.facts.reportKind,
			reimbursementCurrency: revision.facts.reimbursementCurrency,
			trip: revision.facts.trip,
			totals: revision.facts.totals,
			items: revision.facts.items.map((item) => itemView(item, revision)),
		},
	};
}

/**
 * A reviewer's receipt: only one frozen in the report's current submission,
 * identified by the exact stored object and checksum that were submitted.
 */
export async function loadSubmittedReportReceipt(
	report: ReportRow,
	receiptId: string,
): Promise<(TravelExpenseReportReceiptManifestItem & { fileName: string }) | null> {
	const revision = await loadTravelExpenseReportSubmittedRevision(db, {
		organizationId: report.organizationId,
		reportId: report.id,
		submissionCycle: report.submissionCount,
	});
	const receipt = revision?.facts.items
		.flatMap((item) => item.receipts)
		.find((candidate) => candidate.receiptId === receiptId);
	if (!revision || !receipt) return null;
	return { ...receipt, fileName: revision.labels.receiptFileNames[receiptId] ?? "receipt" };
}
