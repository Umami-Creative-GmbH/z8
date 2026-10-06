import "server-only";
import "@/lib/approvals/init";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	travelExpenseReport,
	travelExpenseReportCycleClosure,
	travelExpenseReportReviewNote,
} from "@/db/schema";
import {
	type LegacyDecisionEvidenceRecord,
	listLegacyDecisionEvidence,
} from "@/lib/approvals/evidence/store";
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

/** How one submission cycle ended, or `pending` while it is under review (#603). */
export type SubmittedCycleOutcome = "pending" | "approved" | "rejected" | "returned" | "withdrawn";

export type SubmittedReportHistoryLabel =
	| "submitted"
	| "approval_recorded"
	| "approved"
	| "rejected"
	| "returned"
	| "withdrawn";

export interface SubmittedReportView {
	reportId: string;
	status: ReportRow["status"];
	access: ReportAccess;
	/** The submission cycle shown; earlier cycles stay readable (#603). */
	submissionCycle: number;
	latestCycle: number;
	cycleOutcome: SubmittedCycleOutcome;
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
	/** The reviewer's note and item comments when this cycle was returned. */
	returned: {
		note: string;
		returnedAt: string;
		reviewerName: string | null;
		itemComments: Array<{ itemId: string; number: number; description: string; body: string }>;
	} | null;
	cycles: Array<{ cycle: number; submittedAt: string; outcome: SubmittedCycleOutcome }>;
	/** Every cycle's events, oldest first. */
	history: Array<{
		id: string;
		cycle: number;
		label: SubmittedReportHistoryLabel;
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

/** A non-approving return records legacy evidence that names the returned report. */
function isReturnEvidence(decision: LegacyDecisionEvidenceRecord): boolean {
	return decision.result.reportStatus === "returned";
}

/** Every frozen submission of the report, cycle 1 first; a missing cycle is skipped. */
async function loadSubmittedRevisions(
	report: ReportRow,
): Promise<TravelExpenseReportSubmittedRevisionRecord[]> {
	const cycles = Array.from({ length: report.submissionCount }, (_, index) => index + 1);
	const revisions = await Promise.all(
		cycles.map((submissionCycle) =>
			loadTravelExpenseReportSubmittedRevision(db, {
				organizationId: report.organizationId,
				reportId: report.id,
				submissionCycle,
			}),
		),
	);
	return revisions.filter((revision) => revision !== null);
}

/**
 * One submission of an authorized report, the latest unless `cycle` names an
 * earlier one, with the history of all its cycles; null for a report never
 * submitted or a cycle it does not have.
 */
export async function loadSubmittedReportView(
	report: ReportRow,
	access: ReportAccess,
	cycle: number = report.submissionCount,
): Promise<SubmittedReportView | null> {
	if (!Number.isInteger(cycle) || cycle < 1 || cycle > report.submissionCount) return null;
	// Finance (#612) is authorized for the approved current submission only.
	if (access === "finance" && cycle !== report.submissionCount) return null;
	const revisions = await loadSubmittedRevisions(report);
	const revision = revisions.find((candidate) => candidate.submissionCycle === cycle);
	if (!revision) return null;
	const [requests, decisionsByRevision, closures] = await Promise.all([
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
		Promise.all(
			revisions.map((candidate) =>
				listLegacyDecisionEvidence(db, {
					organizationId: report.organizationId,
					submittedRevisionId: candidate.id,
				}),
			),
		),
		db
			.select()
			.from(travelExpenseReportCycleClosure)
			.where(
				and(
					eq(travelExpenseReportCycleClosure.organizationId, report.organizationId),
					eq(travelExpenseReportCycleClosure.reportId, report.id),
				),
			),
	]);
	const closureOf = (submissionCycle: number) =>
		closures.find((closure) => closure.submissionCycle === submissionCycle);
	const decisionsOf = (submissionCycle: number) =>
		decisionsByRevision[revisions.findIndex((rev) => rev.submissionCycle === submissionCycle)] ??
		[];
	const finalOf = (submissionCycle: number) =>
		decisionsOf(submissionCycle).find(
			(decision) =>
				!isReturnEvidence(decision) &&
				(decision.requestOutcome === "approved" || decision.requestOutcome === "rejected"),
		);
	const outcomeOf = (submissionCycle: number): SubmittedCycleOutcome => {
		const closure = closureOf(submissionCycle);
		if (closure) return closure.kind;
		const final = finalOf(submissionCycle);
		return final?.requestOutcome === "approved" || final?.requestOutcome === "rejected"
			? final.requestOutcome
			: "pending";
	};

	const final = finalOf(cycle);
	const finalRequest = final
		? requests.find((request) => request.id === final.legacy.approvalRequestId)
		: undefined;
	const pending = requests.find((request) => request.status === "pending");
	const closure = closureOf(cycle);
	const returnEvidence =
		closure?.kind === "returned"
			? decisionsOf(cycle).find((decision) => decision.id === closure.decisionEvidenceId)
			: undefined;
	const notes =
		closure?.kind === "returned"
			? await db
					.select({
						itemId: travelExpenseReportReviewNote.itemId,
						body: travelExpenseReportReviewNote.body,
					})
					.from(travelExpenseReportReviewNote)
					.where(
						and(
							eq(travelExpenseReportReviewNote.organizationId, report.organizationId),
							eq(travelExpenseReportReviewNote.closureId, closure.id),
						),
					)
			: [];

	const history: SubmittedReportView["history"] = revisions.flatMap((candidate) => {
		const submissionCycle = candidate.submissionCycle;
		const cycleClosure = closureOf(submissionCycle);
		const events: SubmittedReportView["history"] = [
			{
				id: `submitted-${candidate.id}`,
				cycle: submissionCycle,
				label: "submitted",
				at: instantToCanonicalString(candidate.submittedAt),
				actorName: candidate.labels.submitterName,
			},
			...decisionsOf(submissionCycle).map((decision) => ({
				id: decision.id,
				cycle: submissionCycle,
				label: isReturnEvidence(decision)
					? ("returned" as const)
					: decision.requestOutcome === "approved" || decision.requestOutcome === "rejected"
						? decision.requestOutcome
						: ("approval_recorded" as const),
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		];
		if (cycleClosure?.kind === "withdrawn") {
			events.push({
				id: cycleClosure.id,
				cycle: submissionCycle,
				label: "withdrawn",
				at: cycleClosure.createdAt.toISOString(),
				actorName: candidate.labels.submitterName,
			});
		}
		return events;
	});

	return {
		reportId: report.id,
		status: report.status,
		access,
		submissionCycle: cycle,
		latestCycle: report.submissionCount,
		cycleOutcome: outcomeOf(cycle),
		submittedAt: instantToCanonicalString(revision.submittedAt),
		reviewerName:
			report.status === "submitted" && cycle === report.submissionCount
				? (pending?.approverName ?? null)
				: null,
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
		returned:
			closure?.kind === "returned" && closure.note
				? {
						note: closure.note,
						returnedAt: closure.createdAt.toISOString(),
						reviewerName: returnEvidence?.labels.actorName ?? null,
						itemComments: revision.facts.items.flatMap((item, index) => {
							const note = notes.find((candidate) => candidate.itemId === item.itemId);
							return note
								? [
										{
											itemId: item.itemId,
											number: index + 1,
											description: item.description,
											body: note.body,
										},
									]
								: [];
						}),
					}
				: null,
		cycles: revisions.map((candidate) => ({
			cycle: candidate.submissionCycle,
			submittedAt: instantToCanonicalString(candidate.submittedAt),
			outcome: outcomeOf(candidate.submissionCycle),
		})),
		history: history.toSorted((left, right) => left.at.localeCompare(right.at)),
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
 * A frozen receipt of one submission (the latest unless `cycle` names an
 * earlier one), identified by the exact stored object and checksum that were
 * submitted. Earlier cycles keep their receipts after the report was corrected.
 */
export async function loadSubmittedReportReceipt(
	report: ReportRow,
	receiptId: string,
	cycle: number = report.submissionCount,
): Promise<(TravelExpenseReportReceiptManifestItem & { fileName: string }) | null> {
	if (!Number.isInteger(cycle) || cycle < 1 || cycle > report.submissionCount) return null;
	const revision = await loadTravelExpenseReportSubmittedRevision(db, {
		organizationId: report.organizationId,
		reportId: report.id,
		submissionCycle: cycle,
	});
	const receipt = revision?.facts.items
		.flatMap((item) => item.receipts)
		.find((candidate) => candidate.receiptId === receiptId);
	if (!revision || !receipt) return null;
	return { ...receipt, fileName: revision.labels.receiptFileNames[receiptId] ?? "receipt" };
}
