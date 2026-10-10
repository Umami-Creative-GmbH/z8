import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { db as appDb } from "@/db";
import {
	approvalRequest,
	employee,
	travelExpenseReport,
	travelExpenseReportCycleClosure,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { onTravelExpenseReportReturned } from "@/lib/notifications/triggers";
import { loadAdjustmentLink } from "@/lib/travel-expenses/adjustment-link";
import {
	cancelUncompletedTravelExpenseExportsForReport,
	loadTravelExpenseReportExportState,
} from "@/lib/travel-expenses/export-store";
import {
	decideReopen,
	parseReopenReason,
	type ReopenAdjustmentReason,
	type ReopenReasonError,
} from "@/lib/travel-expenses/report-reopen";
import {
	hasRecordedSettlement,
	loadSettlementAccount,
} from "@/lib/travel-expenses/settlement-store";
import { isCarriedByPayrollRun } from "@/lib/travel-expenses/payroll-run-inclusion-read";
import { acquireApprovalWriteGate } from "../authority";
import { kickApprovalDelivery } from "../delivery/kick";
import { type LegacyDecisionEvidenceRecord, listLegacyDecisionEvidence } from "../evidence/store";
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import { recordTravelExpenseReportDeliveryIntent } from "./travel-expense-report-delivery";
import { recordTravelExpenseReportCycleClosure } from "./travel-expense-report-return";
import type { ApprovalDbService } from "./types";

/**
 * Reopen owner of approved travel expense reports (#614). Before anything was
 * exported or paid, an authorized approver sends the approved report back for
 * correction with a reason; the employee corrects and resubmits it as a new
 * cycle that needs a fresh approval.
 *
 * Nothing of the approval is rewritten: the approved request, its decision
 * evidence and the frozen revision stay as they are. The cycle is closed as
 * `reopened` (reason, actor, and the reopened decision evidence by value), the
 * report becomes `returned`, so it leaves the finance queue, settlement and
 * export selection, which all require `approved`. The cycle's sent cards are
 * retired through a cycle-keyed `withdrawn` delivery intent (#623).
 *
 * Races: the report row lock (`loadSettlementAccount(..., {lock: true})`) is the
 * lock reimbursements and export creation take, so each either commits first
 * (and reopening is refused or sees its batch) or finds the report reopened.
 * Unfinished export batches are cancelled under that lock; a completed batch
 * or recorded money refuses reopening: the correction then needs a linked
 * adjustment (#615) instead. An approved adjustment report is judged by its
 * original report's account as well (money and exports of the original), with
 * the original row locked before the adjustment's own.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

const ENTITY_TYPE = TRAVEL_EXPENSE_REPORT_SOURCE_TYPE;
const logger = createLogger("TravelExpenseReportReopen");

export interface ReopenActor {
	employeeId: string;
	userId: string;
	name: string | null;
	/** Explicit organization approval management, checked by the trusted caller. */
	canManageApprovals: boolean;
}

export type ReopenTravelExpenseReportResult =
	| {
			kind: "reopened";
			submissionCycle: number;
			closureId: string;
			/** An exact retry of a committed reopen: nothing new was written. */
			replayed: boolean;
			cancelledExportBatchIds: string[];
	  }
	| { kind: "not_found" }
	/** The actor's own report, or not an approver of the approved submission. */
	| { kind: "forbidden" }
	/** The named submission is no longer the report's current one. */
	| { kind: "stale" }
	/** The current submission is not approved (any more): reopened, pending, decided otherwise. */
	| { kind: "not_approved" }
	| { kind: "invalid_reason"; error: ReopenReasonError }
	/** Exported or reimbursed: the correction needs a linked adjustment (#615). */
	| { kind: "adjustment_required"; reason: ReopenAdjustmentReason; exportBatchIds: string[] }
	| { kind: "authority_unsupported" };

export type TravelExpenseReportReopenState =
	| { status: "available"; submissionCycle: number }
	| { status: "adjustment_required"; reason: ReopenAdjustmentReason }
	| { status: "unavailable" };

/** The approval of a revision: its last approving legacy decision, never a return. */
function approvalOf(
	decisions: LegacyDecisionEvidenceRecord[],
): LegacyDecisionEvidenceRecord | null {
	return (
		decisions.findLast(
			(decision) =>
				decision.requestOutcome === "approved" && decision.result.reportStatus !== "returned",
		) ?? null
	);
}

async function isAuthorizedReopener(
	database: Executor,
	input: { organizationId: string; approvalRequestId: string; actor: ReopenActor },
): Promise<boolean> {
	const [request] = await database
		.select({ approverId: approvalRequest.approverId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, ENTITY_TYPE),
			),
		)
		.limit(1);
	if (!request) return false;
	// Who may reopen is who could have decided the approving request: its
	// assigned approver, an organization approval manager, or an eligible manager.
	if (request.approverId === input.actor.employeeId || input.actor.canManageApprovals) return true;
	return isEligibleManagerForApprovalRequest({
		db: database,
		approvalRequestId: input.approvalRequestId,
		managerEmployeeId: input.actor.employeeId,
		organizationId: input.organizationId,
	});
}

async function latestRequestId(
	database: Executor,
	input: { organizationId: string; reportId: string },
): Promise<string | null> {
	const [request] = await database
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, ENTITY_TYPE),
				eq(approvalRequest.entityId, input.reportId),
			),
		)
		.orderBy(desc(approvalRequest.createdAt), desc(approvalRequest.id))
		.limit(1);
	return request?.id ?? null;
}

interface ReopenEvaluation {
	report: { status: string; employeeId: string; submissionCount: number };
	revision: TravelExpenseReportSubmittedRevisionRecord | null;
	approval: LegacyDecisionEvidenceRecord | null;
	decision: ReturnType<typeof decideReopen>;
}

/** The facts reopening depends on; with `lock`, read under the report row lock. */
async function evaluateReopen(
	database: Executor,
	input: { organizationId: string; reportId: string; actor: ReopenActor },
	options: { lock: boolean },
): Promise<ReopenEvaluation | null> {
	const { organizationId, reportId, actor } = input;
	const source = { type: "report" as const, id: reportId };
	// #615: an adjustment's delta and its money belong to its original report's
	// account. The original row (that account's lock) is locked first, in the
	// order reimbursements and adjustment approvals take, so a reimbursement of
	// the original either committed (and is seen below) or waits for the reopen.
	// The link itself never changes.
	const adjustment = await loadAdjustmentLink(database, { organizationId, reportId });
	if (adjustment && options.lock) {
		await database
			.select({ id: travelExpenseReport.id })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, adjustment.originalReportId),
					eq(travelExpenseReport.organizationId, organizationId),
				),
			)
			.for("update");
	}
	const account = await loadSettlementAccount(
		database,
		{ organizationId, source },
		{ lock: options.lock },
	);
	if (!account) return null;
	const [report] = await database
		.select({
			status: travelExpenseReport.status,
			employeeId: travelExpenseReport.employeeId,
			submissionCount: travelExpenseReport.submissionCount,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, reportId),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!report) return null;
	const revision =
		report.status === "approved"
			? await loadTravelExpenseReportSubmittedRevision(database, {
					organizationId,
					reportId,
					submissionCycle: report.submissionCount,
				})
			: null;
	const approval = revision
		? approvalOf(
				await listLegacyDecisionEvidence(database, {
					organizationId,
					submittedRevisionId: revision.id,
				}),
			)
		: null;
	const approvalRecorded = Boolean(
		revision && approval && account.approved && account.basis?.revisionId === revision.id,
	);
	const ownReport = report.employeeId === actor.employeeId;
	// Authorized against the approving request; for a report that is not
	// approved (a retry, a stale view) against its latest request, so that
	// nobody else learns its state.
	const authorityRequestId =
		approval?.legacy.approvalRequestId ??
		(await latestRequestId(database, { organizationId, reportId }));
	const authorized =
		authorityRequestId && !ownReport
			? await isAuthorizedReopener(database, {
					organizationId,
					approvalRequestId: authorityRequestId,
					actor,
				})
			: false;
	// An adjustment is settled and exported through its original too: once the
	// original was paid or exported, reopening the adjustment would silently
	// take its approved delta out of that account, so it needs a further
	// adjustment instead.
	const settledReportIds = adjustment ? [reportId, adjustment.originalReportId] : [reportId];
	const [reimbursed, exported] =
		approvalRecorded && authorized
			? await Promise.all([
					Promise.all(
						settledReportIds.map((id) =>
							hasRecordedSettlement(database, { organizationId, source: { type: "report", id } }),
						),
					).then((found) => found.some(Boolean)),
					Promise.all([
						...settledReportIds.map((id) =>
							loadTravelExpenseReportExportState(database, { organizationId, reportId: id }).then(
								(state) => state.exported,
							),
						),
						// A payroll run's file carries it like an export (#853).
						isCarriedByPayrollRun(database, { organizationId, reportIds: settledReportIds }),
					]).then((found) => found.some(Boolean)),
				])
			: [false, false];
	return {
		report,
		revision,
		approval,
		decision: decideReopen({
			status: report.status,
			approvalRecorded,
			ownReport,
			authorized,
			reimbursed,
			exported,
		}),
	};
}

/** Whether the actor may reopen the report now, for the reviewer's report page. */
export async function loadTravelExpenseReportReopenState(
	database: Executor,
	input: { organizationId: string; reportId: string; actor: ReopenActor },
): Promise<TravelExpenseReportReopenState> {
	const evaluation = await evaluateReopen(database, input, { lock: false });
	if (!evaluation) return { status: "unavailable" };
	const { decision } = evaluation;
	if (decision.kind === "allowed") {
		return { status: "available", submissionCycle: evaluation.report.submissionCount };
	}
	if (decision.kind === "adjustment_required") {
		return { status: "adjustment_required", reason: decision.reason };
	}
	return { status: "unavailable" };
}

/**
 * Reopens the approved `submissionCycle` of a report in one transaction. A
 * refusal changes nothing; an exact retry by the same actor with the same
 * reason replays.
 */
export async function reopenTravelExpenseReport(
	database: Database,
	input: {
		organizationId: string;
		reportId: string;
		submissionCycle: number;
		reason: string;
		actor: ReopenActor;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<ReopenTravelExpenseReportResult> {
	const reason = parseReopenReason(input.reason);
	if (!reason.ok) return { kind: "invalid_reason", error: reason.error };
	const { organizationId, reportId, actor } = input;
	const at = dateFromInstant(now);
	let deliveryIntent = false;
	const result = await database.transaction(
		async (tx): Promise<ReopenTravelExpenseReportResult> => {
			const dbService: ApprovalDbService = {
				db: tx,
				query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			};
			const gate = await acquireApprovalWriteGate(dbService, {
				organizationId,
				workflowType: "travel_expense",
			});
			if (gate.authority !== "legacy") return { kind: "authority_unsupported" };
			const evaluation = await evaluateReopen(tx, input, { lock: true });
			if (!evaluation) return { kind: "not_found" };
			const { report, revision, approval, decision } = evaluation;
			if (decision.kind === "forbidden") return { kind: "forbidden" };
			if (report.submissionCount !== input.submissionCycle) return { kind: "stale" };
			if (report.status !== "approved") {
				const [closure] = await tx
					.select({
						id: travelExpenseReportCycleClosure.id,
						kind: travelExpenseReportCycleClosure.kind,
						note: travelExpenseReportCycleClosure.note,
						actorEmployeeId: travelExpenseReportCycleClosure.actorEmployeeId,
					})
					.from(travelExpenseReportCycleClosure)
					.where(
						and(
							eq(travelExpenseReportCycleClosure.organizationId, organizationId),
							eq(travelExpenseReportCycleClosure.reportId, reportId),
							eq(travelExpenseReportCycleClosure.submissionCycle, input.submissionCycle),
						),
					)
					.limit(1);
				if (
					report.status === "returned" &&
					closure?.kind === "reopened" &&
					closure.actorEmployeeId === actor.employeeId &&
					closure.note === reason.value
				) {
					return {
						kind: "reopened",
						submissionCycle: input.submissionCycle,
						closureId: closure.id,
						replayed: true,
						cancelledExportBatchIds: [],
					};
				}
				return { kind: "not_approved" };
			}
			if (decision.kind === "not_approved") return { kind: "not_approved" };
			if (decision.kind === "adjustment_required") {
				return { kind: "adjustment_required", reason: decision.reason, exportBatchIds: [] };
			}
			if (!revision || !approval) return { kind: "not_approved" };

			// Under the report lock: cancel every unfinished export of the report.
			// A batch that completed meanwhile refuses, and nothing changes.
			const exports = await cancelUncompletedTravelExpenseExportsForReport(
				tx,
				{ organizationId, reportId, cancelledByUserId: actor.userId },
				now,
			);
			if (exports.status === "exported") {
				return {
					kind: "adjustment_required",
					reason: "exported",
					exportBatchIds: exports.batchIds,
				};
			}
			const reopened = await tx
				.update(travelExpenseReport)
				.set({ status: "returned", decidedAt: at, updatedAt: at, updatedBy: actor.userId })
				.where(
					and(
						eq(travelExpenseReport.id, reportId),
						eq(travelExpenseReport.organizationId, organizationId),
						eq(travelExpenseReport.status, "approved"),
					),
				)
				.returning({ id: travelExpenseReport.id });
			if (reopened.length !== 1) throw new Error("Reopened report changed under its lock");
			const approvalRequestId = approval.legacy.approvalRequestId;
			const closureId = await recordTravelExpenseReportCycleClosure(tx, {
				organizationId,
				reportId,
				submissionCycle: revision.submissionCycle,
				kind: "reopened",
				submittedRevisionId: revision.id,
				approvalRequestId,
				decisionEvidenceId: approval.id,
				actor: { employeeId: actor.employeeId, userId: actor.userId },
				returned: { note: reason.value, itemComments: [] },
				at,
			});
			// Cards of the reopened cycle can no longer act on it (#623).
			deliveryIntent = await recordTravelExpenseReportDeliveryIntent(tx, {
				organizationId,
				reportId,
				approvalRequestId,
				revision: revision.legacy,
				event: "withdrawn",
			});
			return {
				kind: "reopened",
				submissionCycle: revision.submissionCycle,
				closureId,
				replayed: false,
				cancelledExportBatchIds: exports.cancelledBatchIds,
			};
		},
	);
	if (result.kind === "reopened" && !result.replayed) {
		if (deliveryIntent) {
			try {
				kickApprovalDelivery({ organizationId });
			} catch (error) {
				logger.warn({ error }, "Delivery kick after report reopen failed");
			}
		}
		await notifyEmployee(database, { organizationId, reportId, actor, reason: reason.value }).catch(
			(error) => logger.error({ error, reportId }, "Report reopen notification failed"),
		);
	}
	return result;
}

async function notifyEmployee(
	database: Database,
	input: { organizationId: string; reportId: string; actor: ReopenActor; reason: string },
) {
	const [owner] = await database
		.select({ userId: employee.userId })
		.from(travelExpenseReport)
		.innerJoin(
			employee,
			and(
				eq(employee.id, travelExpenseReport.employeeId),
				eq(employee.organizationId, travelExpenseReport.organizationId),
			),
		)
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!owner) return;
	// The employee is told exactly like after a return: the report needs changes.
	await onTravelExpenseReportReturned({
		reportId: input.reportId,
		requesterUserId: owner.userId,
		organizationId: input.organizationId,
		reviewerName: input.actor.name ?? "—",
		note: input.reason,
	});
}
