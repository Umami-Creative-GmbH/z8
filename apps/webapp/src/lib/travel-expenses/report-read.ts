import "server-only";
import "@/lib/approvals/init";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	travelExpenseReport,
	travelExpenseReportAdjustment,
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
	loadTravelExpenseReportRevisionsByRequest,
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "@/lib/approvals/evidence/travel-expense-report-store";
import { loadAuthorizedApprovalDetail } from "@/lib/approvals/inbox/authorized-detail";
import { getAuthContext } from "@/lib/auth-helpers";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { loadFinanceActor } from "./finance-access";
import { sortHistoryByInstant } from "./report-history";

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
	| {
			status: "found";
			report: ReportRow;
			access: ReportAccess;
			/**
			 * A reviewer reads only the submission cycles whose request the inbox
			 * authorizes them for (spec #598 review): a past reviewer of a returned
			 * cycle never reads a later cycle routed to someone else. Absent means
			 * no cycle restriction (owner, finance, adjustment reviewer).
			 */
			reviewerCycles?: number[];
	  };

/**
 * The cycle a reader may see: the named one, or by default the latest. A
 * reviewer restricted to some cycles defaults to the latest of those and is
 * refused any other (null).
 */
export function authorizedReportCycle(
	authorized: { report: Pick<ReportRow, "submissionCount">; reviewerCycles?: number[] },
	cycle: number | undefined,
): number | undefined | null {
	const allowed = authorized.reviewerCycles;
	if (!allowed) return cycle;
	if (cycle !== undefined) return allowed.includes(cycle) ? cycle : null;
	return allowed.length > 0 ? Math.max(...allowed) : null;
}

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
	const reviewer = { userId: actor.user.id, organizationId };
	const reviewerCycles = await reviewedCyclesOf(reviewer, report.id);
	if (reviewerCycles.length > 0) {
		return { status: "found", report, access: "reviewer", reviewerCycles };
	}
	// The reviewer of an adjustment (#615) reads the report it corrects (#617):
	// the adjustment's own facts are a copy of it, so this reveals no other expense.
	const adjustments = await db
		.select({ reportId: travelExpenseReportAdjustment.reportId })
		.from(travelExpenseReportAdjustment)
		.where(
			and(
				eq(travelExpenseReportAdjustment.organizationId, organizationId),
				eq(travelExpenseReportAdjustment.originalReportId, report.id),
			),
		);
	if (
		adjustments.length > 0 &&
		(await reviewsAnyRequestOf(
			reviewer,
			adjustments.map((adjustment) => adjustment.reportId),
		))
	) {
		return { status: "found", report, access: "reviewer" };
	}
	if (report.status === "approved" && (await loadFinanceActor())?.canRead) {
		return { status: "found", report, access: "finance" };
	}
	return { status: "not_found" };
}

/** The report requests the Approvals inbox authorizes the actor for. */
async function authorizedRequestsOf(
	actor: { userId: string; organizationId: string },
	reportIds: string[],
): Promise<string[]> {
	const requests = await db
		.select({ id: approvalRequest.id, entityId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, actor.organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				inArray(approvalRequest.entityId, reportIds),
			),
		);
	const authorized: string[] = [];
	for (const request of requests) {
		const review = await loadAuthorizedApprovalDetail({
			userId: actor.userId,
			organizationId: actor.organizationId,
			approvalId: request.id,
			kind: "compatibility",
		});
		if (
			review.status === "found" &&
			review.detail.item.entityId === request.entityId &&
			review.detail.item.type === TRAVEL_EXPENSE_REPORT_SOURCE_TYPE
		) {
			authorized.push(request.id);
		}
	}
	return authorized;
}

async function reviewsAnyRequestOf(
	actor: { userId: string; organizationId: string },
	reportIds: string[],
): Promise<boolean> {
	return (await authorizedRequestsOf(actor, reportIds)).length > 0;
}

/** The submission cycles of a report whose request the actor is authorized to review. */
async function reviewedCyclesOf(
	actor: { userId: string; organizationId: string },
	reportId: string,
): Promise<number[]> {
	const requestIds = await authorizedRequestsOf(actor, [reportId]);
	if (requestIds.length === 0) return [];
	const revisions = await loadTravelExpenseReportRevisionsByRequest(db, {
		organizationId: actor.organizationId,
		approvalRequestIds: requestIds,
	});
	return [...new Set([...revisions.values()].map((revision) => revision.submissionCycle))].sort(
		(left, right) => left - right,
	);
}

export interface SubmittedReportItemView
	extends Omit<TravelExpenseReportSubmittedItem, "receipts"> {
	receipts: Array<Pick<TravelExpenseReportReceiptManifestItem, "receiptId"> & { fileName: string }>;
}

/**
 * How one submission cycle ended, or `pending` while it is under review (#603).
 * `reopened` (#614): approved, then reopened for correction before export or payment.
 */
export type SubmittedCycleOutcome =
	| "pending"
	| "approved"
	| "rejected"
	| "returned"
	| "withdrawn"
	| "reopened";

export type SubmittedReportHistoryLabel =
	| "submitted"
	| "approval_recorded"
	| "approved"
	| "rejected"
	| "returned"
	| "withdrawn"
	| "reopened";

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
	/** Why and by whom this approved cycle was reopened for correction (#614). */
	reopened?: { reason: string; reopenedAt: string; actorName: string | null } | null;
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

	const closureActorNames = await loadReopenActorNames(report.organizationId, closures);

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
		if (cycleClosure?.kind === "reopened") {
			events.push({
				id: cycleClosure.id,
				cycle: submissionCycle,
				label: "reopened",
				at: cycleClosure.createdAt.toISOString(),
				actorName: closureActorNames.get(cycleClosure.actorEmployeeId ?? "") ?? null,
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
		reopened:
			closure?.kind === "reopened" && closure.note
				? {
						reason: closure.note,
						reopenedAt: closure.createdAt.toISOString(),
						actorName: closureActorNames.get(closure.actorEmployeeId ?? "") ?? null,
					}
				: null,
		cycles: revisions.map((candidate) => ({
			cycle: candidate.submissionCycle,
			submittedAt: instantToCanonicalString(candidate.submittedAt),
			outcome: outcomeOf(candidate.submissionCycle),
		})),
		history: sortHistoryByInstant(history),
		facts: {
			reportKind: revision.facts.reportKind,
			reimbursementCurrency: revision.facts.reimbursementCurrency,
			trip: revision.facts.trip,
			totals: revision.facts.totals,
			items: revision.facts.items.map((item) => itemView(item, revision)),
		},
	};
}

/** Names of the approvers who reopened approved cycles (#614), by employee id. */
async function loadReopenActorNames(
	organizationId: string,
	closures: Array<typeof travelExpenseReportCycleClosure.$inferSelect>,
): Promise<Map<string, string | null>> {
	const actorIds = [
		...new Set(
			closures
				.filter((closure) => closure.kind === "reopened")
				// A deleted reopener leaves no name behind (0130).
				.flatMap((closure) => (closure.actorEmployeeId ? [closure.actorEmployeeId] : [])),
		),
	];
	if (actorIds.length === 0) return new Map();
	const rows = await db
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, actorIds)));
	return new Map(rows.map((row) => [row.id, row.name]));
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
