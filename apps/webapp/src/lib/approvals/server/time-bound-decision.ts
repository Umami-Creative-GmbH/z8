import { and, eq } from "drizzle-orm";
import { Cause, Effect, Runtime } from "effect";
import { member } from "@/db/auth-schema";
import { approvalWorkflow, employee } from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { kickApprovalDelivery } from "../delivery/kick";
import { TimeCorrectionApprovalAdapterError } from "../domain-adapters/time-correction.adapter";
import { OrdinaryWorkPeriodApprovalAdapterError } from "../domain-adapters/work-period.adapter";
import { ApprovalAssignmentReassignedError } from "../escalation/decision-authority";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	ApprovalInvocationNotAdmittedError,
	BoundAssignmentNotCurrentError,
	findCommittedInvocationDecision,
	requireCanonicalInvocationDecision,
	requireLegacyInvocationDecision,
} from "../evidence/invocation";
import {
	type DecisionEvidenceRecord,
	type LegacyDecisionEvidenceRecord,
	loadLegacyReviewBinding,
	loadLegacySubmittedRevisionSource,
	loadReviewBinding,
} from "../evidence/store";
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import {
	type BoundTimeInvocation,
	type BoundTimeInvocationOutcome,
	BoundTimeInvocationReplay,
	boundTimeInvocationCommand,
} from "./bound-time-invocation";
import {
	completeTimeCorrectionDecisionAfterCommit,
	createLegacyTimeCorrectionDecisionProcessor,
	deleteCancelledTimeCorrectionsInTransaction,
	dispatchTimeCorrectionDecisionPostCommit,
	executeTimeCorrectionDecisionInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "./time-correction-approvals";
import type { ApprovalAction, ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";
import {
	completeOrdinaryWorkPeriodDecisionAfterCommit,
	executeOrdinaryWorkPeriodDecisionInTransaction,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	isOrdinaryWorkPeriodDecisionRefusal,
	notifyWorkPeriodApprovalAfterCommit,
	reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
} from "./work-period-approvals";

const logger = createLogger("BoundTimeDecision");

type BoundTimeRefusal =
	| {
			status: "review_required";
			reason: "binding" | "stale" | "reassigned" | "material_change" | "evidence" | "not_admitted";
	  }
	| { status: "conflict" }
	| { status: "not_found" };

export type BoundTimeInvocationResult =
	| {
			status: "decided";
			/** True when this invocation had already committed (exact replay). */
			replayed: boolean;
			evidence: DecisionEvidenceRecord;
	  }
	| BoundTimeRefusal;

export type BoundLegacyTimeInvocationResult =
	| {
			status: "decided";
			/** True when this invocation had already committed (exact replay). */
			replayed: boolean;
			evidence: LegacyDecisionEvidenceRecord;
	  }
	| BoundTimeRefusal;

type BoundTimeDecisionInput = {
	database: ApprovalDatabase;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: ApprovalAction;
	reason?: string;
	invocation: BoundTimeInvocation["invocation"];
};

/**
 * The owners' runtime for a card decision: only the current assignee (checked
 * by the engine first) may decide; a card never reaches management or
 * eligible-manager authority.
 */
function boundTimeRuntime(database: ApprovalDatabase) {
	return createProductionApprovalWorkflowRuntime({
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
		canManageApproval: async () => {
			throw new BoundAssignmentNotCurrentError();
		},
		clock: systemClock,
	});
}

/** The approved organization member and active employee a card resolves to. */
async function loadBoundActor(input: BoundTimeDecisionInput): Promise<CurrentApprover | null> {
	const { database } = input;
	const [memberships, actors] = await Promise.all([
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
	return memberships.length === 1 && actors.length === 1 && actor ? actor : null;
}

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
export async function decideBoundTimeInvocation(
	input: BoundTimeDecisionInput,
): Promise<BoundTimeInvocationResult> {
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
		return canonicalOutcome(classifyBoundTimeError(error));
	}
	const [actor, binding] = await Promise.all([
		loadBoundActor(input),
		loadReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
	]);
	if (!actor || !binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
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
	const runtime = boundTimeRuntime(database);
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
			return {
				status: "decided",
				replayed: false,
				evidence: requireCanonicalInvocationDecision(execution.invocation.evidence),
			};
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
		return {
			status: "decided",
			replayed: false,
			evidence: requireCanonicalInvocationDecision(execution.invocation.evidence),
		};
	} catch (error) {
		return canonicalOutcome(classifyBoundTimeError(error));
	}
}

/**
 * A legacy reviewed-binding decision on a legacy-authoritative manual time
 * submission, policy clock-out or time correction from an authenticated bot
 * invocation (#432): the legacy counterpart of `decideBoundTimeInvocation`.
 * An exact committed invocation replays first, before any current state is
 * read. Otherwise the legacy branch of the kind's decision owner decides only
 * the exact bound legacy request, for its current approver, under the rollout
 * gate: neither eligible-manager fallback nor organization management is
 * reachable from a card, and a request escalation transferred (#439) refuses
 * its former holders. The after-commit effects are those of a web decision.
 * Infrastructure errors propagate.
 */
export async function decideBoundLegacyTimeInvocation(
	input: BoundTimeDecisionInput,
): Promise<BoundLegacyTimeInvocationResult> {
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
				evidence: requireLegacyInvocationDecision(committed),
			};
		}
	} catch (error) {
		return legacyOutcome(classifyBoundLegacyTimeError(error));
	}
	const [actor, binding] = await Promise.all([
		loadBoundActor(input),
		loadLegacyReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
	]);
	if (!actor || !binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
		return { status: "not_found" };
	}
	// The revision survives ordinary cancellation, so it names the work period
	// and the kind even after the pending request is gone.
	const source = await loadLegacySubmittedRevisionSource(database, {
		organizationId: input.organizationId,
		submittedRevisionId: binding.submittedRevisionId,
	});
	if (
		!source ||
		!isTimeApprovalWorkflowType(source.workflowType) ||
		source.sourceType !== "time_entry"
	) {
		return { status: "not_found" };
	}
	const runtime = boundTimeRuntime(database);
	const dbService: ApprovalDbService = {
		db: database as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
	// Only the exact request's current approver: no management authority.
	const canManageOrganizationApproval = async () => false;
	let outcome: BoundTimeInvocationOutcome | undefined;
	let deliveryIntent = false;
	try {
		if (source.workflowType === "time_correction") {
			const execution = await completeTimeCorrectionDecisionAfterCommit({
				execute: () =>
					executeTimeCorrectionDecisionInTransaction({
						runtime,
						bound,
						organizationId: input.organizationId,
						actorEmployeeId: input.actorEmployeeId,
						actorUserId: input.actorUserId,
						// The exact bound legacy request; never re-selected.
						approvalRequestId: binding.legacyApprovalRequestId,
						action: input.action,
						...(input.reason === undefined ? {} : { reason: input.reason }),
						query: dbService.query,
						canManageOrganizationApproval,
						processLegacy: createLegacyTimeCorrectionDecisionProcessor({
							approvalRequestId: binding.legacyApprovalRequestId,
							action: input.action,
							reason: input.reason,
						}),
						processOrdinary: async () => {
							throw new ApprovalEvidenceError("binding_mismatch");
						},
					}),
				// The same after-commit effects as a web decision (notifications,
				// work-balance dirty mark); never on replay.
				dispatch: (effects) =>
					dispatchTimeCorrectionDecisionPostCommit({
						dbService,
						actor,
						approvalRequestId: binding.legacyApprovalRequestId,
						effects,
						reason: input.reason,
					}),
				onDispatchError: (error) =>
					logger.error(
						{ error, organizationId: input.organizationId, workPeriodId: source.sourceId },
						"Time correction card decision after-commit work failed",
					),
			});
			outcome = "invocation" in execution ? execution.invocation : undefined;
			deliveryIntent = "deliveryIntent" in execution && execution.deliveryIntent === true;
		} else {
			const execution = await completeOrdinaryWorkPeriodDecisionAfterCommit({
				execute: () =>
					executeOrdinaryWorkPeriodDecisionInTransaction({
						dbService,
						runtime,
						bound,
						organizationId: input.organizationId,
						approvalRequestId: binding.legacyApprovalRequestId,
						workPeriodId: source.sourceId,
						actor,
						canManageOrganizationApproval,
						decision:
							input.action === "approve"
								? { kind: "approve", reason: null }
								: { kind: "reject", reason: input.reason ?? "" },
					}),
				// The same after-commit effects as a web decision; never on replay.
				dispatch: async (execution) => {
					await Effect.runPromise(
						notifyWorkPeriodApprovalAfterCommit(execution.result, actor, dbService),
					);
				},
				maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
				onDispatchError: (error) => {
					logger.error(
						{ error, organizationId: input.organizationId, workPeriodId: source.sourceId },
						"Ordinary work-period card decision after-commit work failed",
					);
				},
				onMaintenanceError: (error) => {
					logger.error(
						{ error, organizationId: input.organizationId, workPeriodId: source.sourceId },
						"Ordinary work-period maintenance after a bound decision failed",
					);
				},
			});
			outcome = execution.invocation;
			deliveryIntent = execution.deliveryIntent === true;
		}
	} catch (error) {
		return legacyOutcome(classifyBoundLegacyTimeError(error));
	}
	if (!outcome) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	}
	if (deliveryIntent) {
		// The cycle's intent committed with the decision; this only runs the
		// delivery owner sooner.
		kickApprovalDelivery({ organizationId: input.organizationId });
	}
	return {
		status: "decided",
		replayed: outcome.replayed,
		evidence: requireLegacyInvocationDecision(outcome.evidence),
	};
}

type ClassifiedBoundTimeResult =
	| {
			status: "decided";
			replayed: boolean;
			evidence: DecisionEvidenceRecord | LegacyDecisionEvidenceRecord;
	  }
	| BoundTimeRefusal;

function canonicalOutcome(result: ClassifiedBoundTimeResult): BoundTimeInvocationResult {
	return result.status === "decided"
		? { ...result, evidence: requireCanonicalInvocationDecision(result.evidence) }
		: result;
}

function legacyOutcome(result: ClassifiedBoundTimeResult): BoundLegacyTimeInvocationResult {
	return result.status === "decided"
		? { ...result, evidence: requireLegacyInvocationDecision(result.evidence) }
		: result;
}

function classifyBoundLegacyTimeError(error: unknown): ClassifiedBoundTimeResult {
	// The legacy owners' own refusals arrive as Effect failures.
	const failure = Runtime.isFiberFailure(error)
		? Cause.squash(error[Runtime.FiberFailureCauseId])
		: error;
	// No longer the approver, already decided or withdrawn, or no longer a
	// classifiable time request: nothing is decided.
	if (failure instanceof AuthorizationError || failure instanceof ValidationError) {
		return { status: "review_required", reason: "stale" };
	}
	return classifyBoundTimeError(failure);
}

function classifyBoundTimeError(error: unknown): ClassifiedBoundTimeResult {
	if (error instanceof BoundTimeInvocationReplay) {
		return { status: "decided", replayed: true, evidence: error.evidence };
	}
	if (error instanceof BoundAssignmentNotCurrentError) {
		return { status: "review_required", reason: "stale" };
	}
	if (error instanceof ApprovalAssignmentReassignedError) {
		// Escalation replaced the card's recipient (#326, #439): nothing is decided.
		return { status: "review_required", reason: "reassigned" };
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
