import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { db as appDb } from "@/db";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	travelExpenseReport,
	travelExpenseReportCycleClosure,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { ReportOwner } from "@/lib/travel-expenses/report-store";
import { acquireApprovalWriteGate } from "../authority";
import { kickApprovalDelivery } from "../delivery/kick";
import { ApprovalEvidenceError } from "../evidence/errors";
import { isLegacyRequestInRevisionLifecycle } from "../evidence/store";
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
} from "../evidence/travel-expense-report-store";
import { recordTravelExpenseReportDeliveryIntent } from "./travel-expense-report-delivery";
import { recordTravelExpenseReportCycleClosure } from "./travel-expense-report-return";
import type { ApprovalDbService } from "./types";

/**
 * Withdrawal owner of travel expense reports (#603). The employee takes back a
 * pending submission: under the `travel_expense` rollout gate and the report
 * row lock (the lock saves, uploads and submission take) the cycle's pending
 * legacy request is retired without a decision, its chain is cancelled, and the
 * report returns to an editable draft. The frozen revision stays, so the
 * withdrawn submission remains in the report's history. A retired request is
 * no longer pending, so no inbox action, card binding or retry can decide it.
 */

type Database = typeof appDb;
const ENTITY_TYPE = TRAVEL_EXPENSE_REPORT_SOURCE_TYPE;
const logger = createLogger("TravelExpenseReportWithdrawal");

export type WithdrawTravelExpenseReportResult =
	| { kind: "withdrawn"; submissionCycle: number; replayed: boolean }
	| { kind: "not_found" }
	/** The named submission is no longer pending: decided, returned or already superseded. */
	| { kind: "not_pending" }
	| { kind: "authority_unsupported" };

class WithdrawalRefused extends Error {
	constructor(readonly result: Exclude<WithdrawTravelExpenseReportResult, { kind: "withdrawn" }>) {
		super(result.kind);
	}
}

export async function withdrawTravelExpenseReport(
	database: Database,
	input: { owner: ReportOwner; reportId: string; submissionCycle: number },
	now: Instant = systemClock.nowInstant(),
): Promise<WithdrawTravelExpenseReportResult> {
	const { owner } = input;
	const at = dateFromInstant(now);
	let deliveryIntent = false;
	try {
		const result = await database.transaction(async (tx) => {
			const dbService: ApprovalDbService = {
				db: tx,
				query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
			};
			const gate = await acquireApprovalWriteGate(dbService, {
				organizationId: owner.organizationId,
				workflowType: "travel_expense",
			});
			if (gate.authority !== "legacy") {
				throw new WithdrawalRefused({ kind: "authority_unsupported" });
			}
			const ownReport = and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
			);
			const readReport = () =>
				tx
					.select({
						status: travelExpenseReport.status,
						submissionCount: travelExpenseReport.submissionCount,
					})
					.from(travelExpenseReport)
					.where(ownReport);
			const [unlocked] = await readReport();
			if (!unlocked) throw new WithdrawalRefused({ kind: "not_found" });
			// Decisions lock the request before the report; so does a withdrawal,
			// so the two serialize on the request instead of deadlocking. A chain
			// stage decided meanwhile replaces the pending request: look again.
			let pending: Array<{ id: string; metadata: Record<string, unknown> | null }> = [];
			for (let attempt = 0; attempt < 3; attempt += 1) {
				pending = await tx
					.select({ id: approvalRequest.id, metadata: approvalRequest.metadata })
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.organizationId, owner.organizationId),
							eq(approvalRequest.entityType, ENTITY_TYPE),
							eq(approvalRequest.entityId, input.reportId),
							eq(approvalRequest.status, "pending"),
						),
					)
					.limit(2)
					.for("update");
				if (pending.length > 0) break;
				const [current] = await readReport();
				if (current?.status !== "submitted") break;
			}
			const [report] = await readReport().for("update");
			if (!report) throw new WithdrawalRefused({ kind: "not_found" });
			if (report.submissionCount !== input.submissionCycle) {
				throw new WithdrawalRefused({ kind: "not_pending" });
			}
			if (report.status !== "submitted") {
				// An exact retry of a committed withdrawal of this cycle.
				const [closure] = await tx
					.select({
						kind: travelExpenseReportCycleClosure.kind,
						actorEmployeeId: travelExpenseReportCycleClosure.actorEmployeeId,
					})
					.from(travelExpenseReportCycleClosure)
					.where(
						and(
							eq(travelExpenseReportCycleClosure.organizationId, owner.organizationId),
							eq(travelExpenseReportCycleClosure.reportId, input.reportId),
							eq(travelExpenseReportCycleClosure.submissionCycle, input.submissionCycle),
						),
					)
					.limit(1);
				if (
					report.status === "draft" &&
					closure?.kind === "withdrawn" &&
					closure.actorEmployeeId === owner.employeeId
				) {
					return {
						kind: "withdrawn",
						submissionCycle: input.submissionCycle,
						replayed: true,
					} as const;
				}
				throw new WithdrawalRefused({ kind: "not_pending" });
			}

			const revision = await loadTravelExpenseReportSubmittedRevision(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
				submissionCycle: input.submissionCycle,
			});
			if (!revision) throw new ApprovalEvidenceError("evidence_required");
			const request = pending[0];
			if (
				pending.length !== 1 ||
				!request ||
				!(await isLegacyRequestInRevisionLifecycle(tx, {
					organizationId: owner.organizationId,
					approvalRequestId: request.id,
					revision: { sourceType: ENTITY_TYPE, sourceId: input.reportId, legacy: revision.legacy },
				}))
			) {
				throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_lifecycle" });
			}

			const chainInstanceId = revision.legacy.chainInstanceId;
			if (chainInstanceId) {
				await tx
					.update(approvalChainStageInstance)
					.set({ status: "cancelled", updatedAt: at })
					.where(
						and(
							eq(approvalChainStageInstance.organizationId, owner.organizationId),
							eq(approvalChainStageInstance.chainInstanceId, chainInstanceId),
							eq(approvalChainStageInstance.status, "pending"),
						),
					);
				const chains = await tx
					.update(approvalChainInstance)
					.set({ status: "cancelled", completedAt: at, updatedAt: at })
					.where(
						and(
							eq(approvalChainInstance.id, chainInstanceId),
							eq(approvalChainInstance.organizationId, owner.organizationId),
							eq(approvalChainInstance.entityType, ENTITY_TYPE),
							eq(approvalChainInstance.entityId, input.reportId),
							eq(approvalChainInstance.status, "pending"),
						),
					)
					.returning({ id: approvalChainInstance.id });
				if (chains.length !== 1) {
					throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_chain" });
				}
			}
			// Retired, not deleted: the request stays the history of whom the
			// withdrawn cycle was routed to, and is no longer decidable.
			const retired = await tx
				.update(approvalRequest)
				.set({
					status: "rejected",
					rejectionReason: null,
					metadata: {
						...(request.metadata ?? {}),
						travelExpenseReportWithdrawal: {
							submissionCycle: input.submissionCycle,
							employeeId: owner.employeeId,
							withdrawnAt: at.toISOString(),
						},
					},
					updatedAt: at,
				})
				.where(
					and(
						eq(approvalRequest.id, request.id),
						eq(approvalRequest.organizationId, owner.organizationId),
						eq(approvalRequest.entityType, ENTITY_TYPE),
						eq(approvalRequest.entityId, input.reportId),
						eq(approvalRequest.status, "pending"),
					),
				)
				.returning({ id: approvalRequest.id });
			if (retired.length !== 1) throw new WithdrawalRefused({ kind: "not_pending" });

			const [withdrawn] = await tx
				.update(travelExpenseReport)
				.set({ status: "draft", decidedAt: null, updatedAt: at, updatedBy: owner.userId })
				.where(
					and(
						eq(travelExpenseReport.id, input.reportId),
						eq(travelExpenseReport.organizationId, owner.organizationId),
						eq(travelExpenseReport.status, "submitted"),
					),
				)
				.returning({ id: travelExpenseReport.id });
			if (!withdrawn) throw new WithdrawalRefused({ kind: "not_pending" });
			await recordTravelExpenseReportCycleClosure(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
				submissionCycle: input.submissionCycle,
				kind: "withdrawn",
				submittedRevisionId: revision.id,
				approvalRequestId: request.id,
				decisionEvidenceId: null,
				actor: { employeeId: owner.employeeId, userId: owner.userId },
				returned: null,
				at,
			});
			// Written only while a delivery control exists: lets the delivery owner
			// retire the cycle's sent cards (#623), keyed by the cycle's revision.
			deliveryIntent = await recordTravelExpenseReportDeliveryIntent(tx, {
				organizationId: owner.organizationId,
				reportId: input.reportId,
				approvalRequestId: request.id,
				revision: revision.legacy,
				event: "withdrawn",
			});
			return {
				kind: "withdrawn",
				submissionCycle: input.submissionCycle,
				replayed: false,
			} as const;
		});
		if (deliveryIntent) {
			try {
				kickApprovalDelivery({ organizationId: owner.organizationId });
			} catch (error) {
				logger.warn({ error }, "Delivery kick after report withdrawal failed");
			}
		}
		return result;
	} catch (error) {
		if (error instanceof WithdrawalRefused) return error.result;
		throw error;
	}
}
