import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { approvalWorkflow, employee } from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { TimeCorrectionApprovalAdapterError } from "../domain-adapters/time-correction.adapter";
import { OrdinaryWorkPeriodApprovalAdapterError } from "../domain-adapters/work-period.adapter";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	ApprovalInvocationNotAdmittedError,
	BoundAssignmentNotCurrentError,
	findCommittedInvocationDecision,
	requireCanonicalInvocationDecision,
} from "../evidence/invocation";
import { type DecisionEvidenceRecord, loadReviewBinding } from "../evidence/store";
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import {
	type BoundTimeInvocation,
	BoundTimeInvocationReplay,
	boundTimeInvocationCommand,
} from "./bound-time-invocation";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	executeTimeCorrectionDecisionInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "./time-correction-approvals";
import type { ApprovalAction, ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";
import {
	completeOrdinaryWorkPeriodDecisionAfterCommit,
	executeOrdinaryWorkPeriodDecisionInTransaction,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	isOrdinaryWorkPeriodDecisionRefusal,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "./work-period-approvals";

const logger = createLogger("BoundTimeDecision");

export type BoundTimeInvocationResult =
	| {
			status: "decided";
			/** True when this invocation had already committed (exact replay). */
			replayed: boolean;
			evidence: DecisionEvidenceRecord;
	  }
	| {
			status: "review_required";
			reason: "binding" | "stale" | "material_change" | "evidence" | "not_admitted";
	  }
	| { status: "conflict" }
	| { status: "not_found" };

/**
 * A reviewed-binding decision on a canonical manual time submission, policy
 * clock-out or time correction from an authenticated bot invocation (#325).
 * An exact committed invocation replays first, before any current state is
 * read. Otherwise the existing decision owner decides the exact bound
 * assignment under the invocation's own receipt: neither eligible-manager
 * fallback nor organization management is ever invoked from a card, and the
 * binding, current submitted revision and provider admission are revalidated
 * in the transaction that commits. Infrastructure errors propagate.
 */
export async function decideBoundTimeInvocation(input: {
	database: ApprovalDatabase;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: ApprovalAction;
	reason?: string;
	invocation: BoundTimeInvocation["invocation"];
}): Promise<BoundTimeInvocationResult> {
	const { database } = input;
	const bound: BoundTimeInvocation = {
		reviewedBindingId: input.bindingId,
		invocation: input.invocation,
	};
	const command = boundTimeInvocationCommand({
		bound,
		actorEmployeeId: input.actorEmployeeId,
		actorUserId: input.actorUserId,
		action: input.action,
		reason: input.reason ?? null,
	});
	try {
		const committed = await findCommittedInvocationDecision(database, {
			identity: input.invocation.identity,
			command,
		});
		if (committed) {
			return {
				status: "decided",
				replayed: true,
				evidence: requireCanonicalInvocationDecision(committed),
			};
		}
	} catch (error) {
		return classifyBoundTimeError(error);
	}
	const [memberships, binding, actors] = await Promise.all([
		database
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		loadReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
		database.query.employee.findMany({
			where: and(
				eq(employee.id, input.actorEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.actorUserId),
				eq(employee.isActive, true),
			),
			with: { user: true },
			limit: 2,
		}),
	]);
	const actor = actors[0] as CurrentApprover | undefined;
	if (
		memberships.length !== 1 ||
		!binding ||
		binding.recipientEmployeeId !== input.actorEmployeeId ||
		actors.length !== 1 ||
		!actor
	) {
		return { status: "not_found" };
	}
	const [workflow] = await database
		.select({
			workflowType: approvalWorkflow.workflowType,
			sourceType: approvalWorkflow.sourceType,
			sourceId: approvalWorkflow.sourceId,
		})
		.from(approvalWorkflow)
		.where(
			and(
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.id, binding.workflowId),
			),
		)
		.limit(1);
	if (
		!workflow ||
		!isTimeApprovalWorkflowType(workflow.workflowType) ||
		workflow.sourceType !== "time_entry"
	) {
		return { status: "not_found" };
	}
	const runtime = createProductionApprovalWorkflowRuntime({
		db: database as never,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence finalization is outside this boundary");
				},
				deleteCancelledAbsence: async () => {
					throw new Error("Absence cancellation is outside this boundary");
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal: finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		// Only the current assignee (checked by the engine first) may decide;
		// a card never reaches management or eligible-manager authority.
		canManageApproval: async () => {
			throw new BoundAssignmentNotCurrentError();
		},
		clock: systemClock,
	});
	const reason = input.action === "reject" ? (input.reason ?? "") : null;
	try {
		if (workflow.workflowType === "time_correction") {
			const execution = await executeTimeCorrectionDecisionInTransaction({
				runtime,
				bound,
				organizationId: input.organizationId,
				actorEmployeeId: input.actorEmployeeId,
				actorUserId: input.actorUserId,
				// The exact bound assignment; never re-selected from the request.
				approvalRequestId: binding.assignmentId,
				action: input.action,
				...(input.reason === undefined ? {} : { reason: input.reason }),
				processLegacy: async () => {
					throw new ApprovalEvidenceError("binding_mismatch");
				},
				processOrdinary: async () => {
					throw new ApprovalEvidenceError("binding_mismatch");
				},
			});
			if (!("invocation" in execution) || !execution.invocation) {
				throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
			}
			return { status: "decided", replayed: false, evidence: execution.invocation.evidence };
		}
		const dbService: ApprovalDbService = {
			db: database as ApprovalDbService["db"],
			query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
		};
		const execution = await completeOrdinaryWorkPeriodDecisionAfterCommit({
			execute: () =>
				executeOrdinaryWorkPeriodDecisionInTransaction({
					dbService,
					runtime,
					bound,
					organizationId: input.organizationId,
					approvalRequestId: binding.assignmentId,
					workPeriodId: workflow.sourceId,
					actor,
					decision:
						input.action === "approve"
							? { kind: "approve", reason: null }
							: { kind: "reject", reason: reason ?? "" },
				}),
			// Canonical decisions dispatch through the workflow outbox.
			dispatch: async () => {},
			maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
			onDispatchError: () => {},
			onMaintenanceError: (error) => {
				logger.error(
					{ error, organizationId: input.organizationId, workPeriodId: workflow.sourceId },
					"Ordinary work-period maintenance after a bound decision failed",
				);
			},
		});
		if (!execution.invocation) {
			throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
		}
		return { status: "decided", replayed: false, evidence: execution.invocation.evidence };
	} catch (error) {
		return classifyBoundTimeError(error);
	}
}

function classifyBoundTimeError(error: unknown): BoundTimeInvocationResult {
	if (error instanceof BoundTimeInvocationReplay) {
		return { status: "decided", replayed: true, evidence: error.evidence };
	}
	if (error instanceof BoundAssignmentNotCurrentError) {
		return { status: "review_required", reason: "stale" };
	}
	if (error instanceof ApprovalInvocationNotAdmittedError) {
		return { status: "review_required", reason: "not_admitted" };
	}
	if (error instanceof ApprovalEvidenceError) {
		switch (error.code) {
			case "invocation_mismatch":
				return { status: "conflict" };
			case "binding_mismatch":
				return { status: "review_required", reason: "binding" };
			case "material_change":
				return { status: "review_required", reason: "material_change" };
			case "evidence_required":
			case "evidence_incomplete":
				return { status: "review_required", reason: "evidence" };
			case "invariant":
				throw error;
		}
	}
	if (error instanceof ApprovalTransitionEngineError) {
		switch (error.code) {
			case "idempotency_mismatch":
				return { status: "conflict" };
			case "forbidden":
			case "version_conflict":
				// A decided, replaced or reassigned assignment: nothing is decided.
				return { status: "review_required", reason: "stale" };
			default:
				throw error;
		}
	}
	// The owners' refusals of a request that is no longer the reviewed one
	// (decided elsewhere, removed, or its scope changed) decide nothing.
	// The adapters refuse a source that no longer matches its workflow before
	// anything is written: a stale card, like any other.
	if (
		error instanceof ConflictError ||
		error instanceof NotFoundError ||
		error instanceof TimeCorrectionApprovalAdapterError ||
		error instanceof OrdinaryWorkPeriodApprovalAdapterError ||
		isOrdinaryWorkPeriodDecisionRefusal(error)
	) {
		return { status: "review_required", reason: "stale" };
	}
	throw error;
}
