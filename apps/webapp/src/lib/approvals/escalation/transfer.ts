import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	type ApprovalEscalationAttentionReason,
	approvalEscalationControl,
	approvalEscalationPolicy,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	auditLog,
	employee,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	APPROVAL_ESCALATION_SYSTEM_ID,
	type ApprovalAssignmentSnapshot,
	type ApprovalCommandActor,
	type ApprovalStageSnapshot,
	type ApprovalWorkflowPrincipal,
	type ApprovalWorkflowSnapshot,
	type ApprovalWriteGateResult,
	type JsonObject,
} from "../workflow/ports";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import {
	ApprovalStateMachineError,
	type ApprovalWorkflowCommand,
	fingerprintApprovalCommandActor,
} from "../workflow/state-machine";
import {
	ApprovalTransitionEngineError,
	fingerprintApprovalWorkflowCommand,
} from "../workflow/transition-engine";
import {
	raiseEscalationAttention,
	resolveRecoveredEscalationAttentionCondition,
} from "./attention-store";
import { loadEscalationCandidateFacts } from "./candidates";
import type { EscalationPolicySnapshot } from "./deadline";
import {
	automaticEscalationOperationKey,
	type CanonicalAssignmentEvidence,
	classifyCanonicalAssignmentEvidence,
	decideAutomaticEscalation,
	type EscalationCandidateFact,
	escalationRequestFingerprint,
	humanEscalationOperationKey,
	orderEscalationCandidates,
} from "./transfer-evaluation";
import {
	type EscalationTransferRow,
	findEscalationTransferByOperationKey,
	listWorkflowEscalationTransferFacts,
	recordEscalationTransfer,
} from "./transfer-store";

const logger = createLogger("ApprovalEscalationTransfer");

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Kinds this slice transfers; the others are held until their own slice. */
const SUPPORTED_WORKFLOW_TYPE = "absence" as const;
export const DEFAULT_ESCALATION_BATCH_LIMIT = 100;
export const MAX_ESCALATION_BATCH_LIMIT = 500;
export const MAX_ESCALATION_REASON_LENGTH = 500;

// ============================================
// SHARED VIEWS AND GATES
// ============================================

export interface EscalationTransferView {
	transferId: string;
	initiator: EscalationTransferRow["initiator"];
	workflowId: string;
	stageId: string;
	sourceAssignmentId: string;
	replacementAssignmentId: string;
	formerApproverEmployeeId: string;
	replacementApproverEmployeeId: string;
	transferredAt: string;
}

function toTransferView(row: EscalationTransferRow): EscalationTransferView {
	return {
		transferId: row.id,
		initiator: row.initiator,
		workflowId: row.workflowId,
		stageId: row.stageId,
		sourceAssignmentId: row.sourceAssignmentId,
		replacementAssignmentId: row.replacementAssignmentId,
		formerApproverEmployeeId: row.sourceApproverEmployeeId,
		replacementApproverEmployeeId: row.replacementApproverEmployeeId,
		transferredAt: row.transferredAt.toISOString(),
	};
}

export type EscalationOwnership =
	| { kind: "owned"; paused: boolean; ownedSince: Instant | null }
	| { kind: "not_owner" | "unrecognized_owner" };

/**
 * Fresh ownership read. Inside a transaction it takes a share lock so an
 * exclusive ownership switch cannot interleave with a transfer. It never
 * substitutes for the transition's own conditional writes.
 */
async function readEscalationOwnership(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
	lock: boolean,
): Promise<EscalationOwnership> {
	const query = executor
		.select({
			owner: approvalEscalationControl.owner,
			automationPaused: approvalEscalationControl.automationPaused,
			escalationOwnedSince: approvalEscalationControl.escalationOwnedSince,
		})
		.from(approvalEscalationControl)
		.where(eq(approvalEscalationControl.organizationId, organizationId))
		.limit(1);
	const [control] = lock ? await query.for("share") : await query;
	if (!control || control.owner === "legacy") return { kind: "not_owner" };
	if (control.owner !== "escalation") return { kind: "unrecognized_owner" };
	return {
		kind: "owned",
		paused: control.automationPaused,
		ownedSince: control.escalationOwnedSince ? instantFromDate(control.escalationOwnedSince) : null,
	};
}

async function readEscalationPolicy(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
): Promise<EscalationPolicySnapshot | null> {
	const [policy] = await executor
		.select({
			enabled: approvalEscalationPolicy.enabled,
			responseWindowHours: approvalEscalationPolicy.responseWindowHours,
			revision: approvalEscalationPolicy.revision,
		})
		.from(approvalEscalationPolicy)
		.where(eq(approvalEscalationPolicy.organizationId, organizationId))
		.limit(1);
	return policy ?? null;
}

function refuseFinalization(): never {
	throw new Error("Approval escalation never finalizes an approval");
}

/**
 * Workflow runtime for escalation commands. Escalation replaces an
 * assignment and never reaches terminal finalization, so every finalizer
 * refuses. Management authority is explicit, never eligible-manager fallback.
 */
function createEscalationRuntime(
	management: {
		organizationId: string;
		actorEmployeeId: string;
	} | null,
) {
	return createProductionApprovalWorkflowRuntime({
		db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => refuseFinalization(),
				deleteCancelledAbsence: async () => refuseFinalization(),
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal: async () => refuseFinalization(),
				deleteCancelledCorrections: async () => refuseFinalization(),
			},
			ordinaryWorkPeriod: {
				finalizeTerminal: async () => refuseFinalization(),
			},
		},
		canManageApproval: async (input) =>
			management !== null &&
			input.command.type === "escalate" &&
			input.organizationId === management.organizationId &&
			input.workflow.organizationId === management.organizationId &&
			input.actorEmployeeId === management.actorEmployeeId,
		clock: systemClock,
	});
}

type EscalationRuntime = ReturnType<typeof createEscalationRuntime>;

function fixedGateContext(
	context: ApprovalWorkflowTransactionContext,
	organizationId: string,
	gate: ApprovalWriteGateResult,
): ApprovalWorkflowTransactionContext {
	return {
		...context,
		writeGate: {
			acquire: async (scope) => {
				if (
					scope.organizationId !== organizationId ||
					scope.workflowType !== SUPPORTED_WORKFLOW_TYPE
				) {
					throw new Error("Escalation gate scope mismatch");
				}
				return gate;
			},
		},
	};
}

interface CurrentStageAssignment {
	snapshot: ApprovalWorkflowSnapshot;
	requesterEmployeeId: string;
	stage: ApprovalStageSnapshot;
	source: ApprovalAssignmentSnapshot;
}

/** The source must still be a pending assignment of the active human stage. */
function currentPendingAssignment(
	snapshot: ApprovalWorkflowSnapshot,
	organizationId: string,
	stageId: string,
	assignmentId: string,
): CurrentStageAssignment | null {
	const requesterEmployeeId = snapshot.requesterEmployeeId;
	if (
		snapshot.organizationId !== organizationId ||
		snapshot.workflowType !== SUPPORTED_WORKFLOW_TYPE ||
		snapshot.status !== "pending" ||
		requesterEmployeeId === null
	) {
		return null;
	}
	const stage = snapshot.stages.find((candidate) => candidate.id === stageId);
	const source = stage?.assignments.find((candidate) => candidate.id === assignmentId);
	if (
		!stage ||
		!source ||
		stage.sequence !== snapshot.currentStageOrder ||
		stage.status !== "pending" ||
		stage.activationMode !== "human" ||
		source.status !== "pending"
	) {
		return null;
	}
	return { snapshot, requesterEmployeeId, stage, source };
}

function pendingSiblings(current: CurrentStageAssignment) {
	return current.stage.assignments.filter(
		(assignment) => assignment.status === "pending" && assignment.id !== current.source.id,
	);
}

/**
 * The replacement's web inbox discovers canonical absences through the
 * canonical-to-legacy representative, which names exactly one approver.
 * Anything else has no actual replacement inbox path yet and must be held.
 */
function unsupportedReplacementRoute(
	current: CurrentStageAssignment,
	gate: ApprovalWriteGateResult,
): string | null {
	if (gate.behavior.mirror !== "canonical_to_legacy") {
		return "absence_inbox_requires_compatibility_mirror";
	}
	if (pendingSiblings(current).length > 0) {
		return "parallel_assignments_without_replacement_inbox";
	}
	return null;
}

/**
 * A pending compatibility request naming a different approver than the
 * authoritative assignment (for example after an older channel-specific
 * mutation) is contradictory history, never a transfer opportunity.
 */
async function compatibilityConflict(
	tx: DatabaseTransaction,
	current: CurrentStageAssignment,
	gate: ApprovalWriteGateResult,
): Promise<JsonObject | null> {
	const legacyId = current.stage.legacyApprovalRequestId;
	if (!legacyId || gate.behavior.mirror !== "canonical_to_legacy") return null;
	const [legacy] = await tx
		.select({
			approverId: approvalRequest.approverId,
			status: approvalRequest.status,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, legacyId),
				eq(approvalRequest.organizationId, current.snapshot.organizationId),
			),
		)
		.limit(1);
	if (
		legacy &&
		legacy.status === "pending" &&
		legacy.approverId !== current.source.approverEmployeeId
	) {
		return {
			legacyApprovalRequestId: legacyId,
			compatibilityApproverEmployeeId: legacy.approverId,
			assignmentApproverEmployeeId: current.source.approverEmployeeId,
		};
	}
	return null;
}

async function orderedCandidatesFor(
	tx: DatabaseTransaction,
	current: CurrentStageAssignment,
): Promise<EscalationCandidateFact[]> {
	const candidates = await loadEscalationCandidateFacts(tx, {
		organizationId: current.snapshot.organizationId,
		requesterEmployeeId: current.requesterEmployeeId,
	});
	return orderEscalationCandidates({
		candidates,
		requesterEmployeeId: current.requesterEmployeeId,
		currentApproverEmployeeId: current.source.approverEmployeeId,
		pendingSiblingApproverIds: pendingSiblings(current).map(
			(assignment) => assignment.approverEmployeeId,
		),
	});
}

// ============================================
// ATOMIC TRANSFER
// ============================================

interface CommitTransferInput {
	runtime: EscalationRuntime;
	context: ApprovalWorkflowTransactionContext;
	current: CurrentStageAssignment;
	recipientEmployeeId: string;
	operationKey: string;
	requestFingerprint: string;
	initiator: "scheduled" | "human";
	principal: ApprovalWorkflowPrincipal;
	commandActor: ApprovalCommandActor;
	lineageRootAssignmentId: string | null;
	scheduled: {
		actionableAt: Instant;
		actionableEvidence: "assignment_assigned_at" | "rollout_fallback";
		deadlineAt: Instant;
		policyRevision: number;
	} | null;
	policyRevision: number | null;
	reason: string | null;
}

type CommitTransferOutcome = {
	disposition: "executed" | "replayed";
	transfer: EscalationTransferRow;
};

/**
 * Delegates the replacement to the workflow `escalate` transition (which
 * cancels only the source assignment, preserves siblings, mirrors the
 * compatibility representative and completes the receipt) and journals the
 * transfer with its delivery event in the same transaction. Remote delivery
 * is not part of this commit.
 */
async function commitCanonicalTransfer(input: CommitTransferInput): Promise<CommitTransferOutcome> {
	const tx = input.context.dbService.db as unknown as DatabaseTransaction;
	const { snapshot, stage, source } = input.current;
	const organizationId = snapshot.organizationId;
	const command: ApprovalWorkflowCommand = {
		type: "escalate",
		stageId: stage.id,
		fromEmployeeId: source.approverEmployeeId,
		toEmployeeId: input.recipientEmployeeId,
	};
	const execution = await input.runtime.transitionEngine.executeInTransactionWithDisposition(
		input.context,
		{
			organizationId,
			workflowId: snapshot.id,
			expectedVersion: snapshot.version,
			idempotencyKey: input.operationKey,
			principal: input.principal,
			command,
		},
	);
	if (execution.disposition === "replayed") {
		const committed = await findEscalationTransferByOperationKey(tx, {
			organizationId,
			operationKey: input.operationKey,
		});
		if (!committed) {
			throw new Error("Escalation receipt exists without its journal entry");
		}
		return { disposition: "replayed", transfer: committed };
	}
	const event = execution.result.events.find(
		(candidate) =>
			candidate.eventType === "assignment.escalated" &&
			candidate.references?.sourceAssignmentId === source.id,
	);
	const replacementAssignmentId = event?.references?.targetAssignmentId;
	const replacement = execution.result.snapshot.stages
		.find((candidate) => candidate.id === stage.id)
		?.assignments.find((candidate) => candidate.id === replacementAssignmentId);
	if (
		!event ||
		!replacementAssignmentId ||
		replacement?.approverEmployeeId !== input.recipientEmployeeId ||
		replacement.status !== "pending"
	) {
		throw new Error("Escalation transition returned no replacement assignment");
	}
	const transferredAt = event.occurredAt;
	const transfer = await recordEscalationTransfer(tx, {
		transfer: {
			organizationId,
			operationKey: input.operationKey,
			initiator: input.initiator,
			authorityMode: "canonical",
			workflowType: SUPPORTED_WORKFLOW_TYPE,
			workflowId: snapshot.id,
			stageId: stage.id,
			sourceAssignmentId: source.id,
			replacementAssignmentId,
			lineageRootAssignmentId: input.lineageRootAssignmentId,
			sourceApproverEmployeeId: source.approverEmployeeId,
			replacementApproverEmployeeId: input.recipientEmployeeId,
			requesterEmployeeId: input.current.requesterEmployeeId,
			actionableAt: input.scheduled ? dateFromInstant(input.scheduled.actionableAt) : null,
			actionableEvidence: input.scheduled?.actionableEvidence ?? null,
			deadlineAt: input.scheduled ? dateFromInstant(input.scheduled.deadlineAt) : null,
			policyRevision: input.policyRevision,
			workflowEventId: event.id,
			receiptIdempotencyKey: input.operationKey,
			receiptActorFingerprint: fingerprintApprovalCommandActor(
				input.commandActor,
				input.principal.kind === "system" ? APPROVAL_ESCALATION_SYSTEM_ID : undefined,
			),
			receiptCommandFingerprint: fingerprintApprovalWorkflowCommand(command),
			requestFingerprint: input.requestFingerprint,
			actorKind: input.commandActor.kind === "system" ? "system" : "user",
			actorSystemId: input.commandActor.kind === "system" ? APPROVAL_ESCALATION_SYSTEM_ID : null,
			actorUserId: input.commandActor.userId,
			actorEmployeeId: input.commandActor.employeeId,
			reason: input.reason,
			transferredAt: dateFromInstant(transferredAt),
		},
		event: {
			schemaVersion: 1,
			workflowType: snapshot.workflowType,
			workflowId: snapshot.id,
			sourceType: snapshot.sourceType,
			sourceId: snapshot.sourceId,
			legacyApprovalRequestId: stage.legacyApprovalRequestId,
			stageId: stage.id,
			sourceAssignmentId: source.id,
			replacementAssignmentId,
			formerApproverEmployeeId: source.approverEmployeeId,
			replacementApproverEmployeeId: input.recipientEmployeeId,
			requesterEmployeeId: input.current.requesterEmployeeId,
			transferredAt: transferredAt.toString(),
			policyRevision: input.policyRevision,
		},
	});
	if (input.commandActor.kind === "employee") {
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "approval_escalation_transfer",
			entityId: transfer.id,
			action: AuditAction.APPROVAL_ESCALATION_TRANSFERRED,
			performedBy: input.commandActor.userId,
			employeeId: input.commandActor.employeeId,
			changes: JSON.stringify({
				approver: {
					from: source.approverEmployeeId,
					to: input.recipientEmployeeId,
				},
			}),
			metadata: JSON.stringify({
				workflowId: snapshot.id,
				stageId: stage.id,
				sourceAssignmentId: source.id,
				replacementAssignmentId,
				workflowEventId: event.id,
				reason: input.reason,
			}),
		});
	}
	// The transfer demonstrably resolves conditions about the source assignment.
	for (const reason of [
		"no_eligible_backup",
		"unsupported_route",
		"replacement_overdue",
	] as const) {
		await resolveRecoveredEscalationAttentionCondition(tx, {
			organizationId,
			reason,
			subject: { kind: "assignment", assignmentId: source.id },
			evidence: {
				recovery: "assignment_transferred",
				transferId: transfer.id,
				replacementAssignmentId,
			},
		});
	}
	return { disposition: "executed", transfer };
}

function isTransitionRace(error: unknown): boolean {
	return (
		(error instanceof ApprovalTransitionEngineError && error.code === "version_conflict") ||
		(error instanceof ApprovalStateMachineError &&
			(error.code === "REASSIGNMENT_CONFLICT" ||
				error.code === "STALE_STAGE" ||
				error.code === "TERMINAL_TRANSITION"))
	);
}

// ============================================
// SCHEDULED: PROCESS DUE ESCALATIONS
// ============================================

type DueAssignmentOutcome =
	| { kind: "transferred"; disposition: "executed" | "replayed" }
	| { kind: "held"; reason: ApprovalEscalationAttentionReason }
	| { kind: "not_due" }
	| { kind: "not_pending" }
	| { kind: "legacy_authority" }
	| { kind: "suppressed" };

export interface ProcessDueEscalationsSummary {
	organizationId: string;
	status:
		| "processed"
		| "not_owner"
		| "unrecognized_owner"
		| "automation_paused"
		| "ownership_changed"
		| "policy_not_prepared"
		| "policy_disabled";
	examined: number;
	transferred: number;
	replayed: number;
	held: Partial<Record<ApprovalEscalationAttentionReason, number>>;
	notDue: number;
	notPending: number;
	legacyAuthority: number;
	raced: number;
	failed: number;
}

function emptySummary(
	organizationId: string,
	status: ProcessDueEscalationsSummary["status"],
): ProcessDueEscalationsSummary {
	return {
		organizationId,
		status,
		examined: 0,
		transferred: 0,
		replayed: 0,
		held: {},
		notDue: 0,
		notPending: 0,
		legacyAuthority: 0,
		raced: 0,
		failed: 0,
	};
}

/**
 * Bounded, organization-scoped scheduled operation (#255 §1). The scheduler
 * supplies scope and limits only: this module discovers candidates, evaluates
 * the current policy against evidenced actionable instants, selects the
 * backup and commits transfers or durable holds. Each assignment commits in
 * its own transaction; a race lost to a decision or another transfer is an
 * explicit outcome, not an infrastructure failure.
 */
export async function processDueEscalations(input: {
	organizationId: string;
	limit?: number;
	now?: Instant;
}): Promise<ProcessDueEscalationsSummary> {
	const { organizationId } = input;
	if (!organizationId) {
		throw new Error("Escalation processing requires organization scope");
	}
	const limit = Math.min(
		Math.max(1, Math.trunc(input.limit ?? DEFAULT_ESCALATION_BATCH_LIMIT)),
		MAX_ESCALATION_BATCH_LIMIT,
	);
	const now = input.now ?? systemClock.nowInstant();

	const ownership = await readEscalationOwnership(db, organizationId, false);
	if (ownership.kind !== "owned") {
		return emptySummary(organizationId, ownership.kind);
	}
	if (ownership.paused) {
		return emptySummary(organizationId, "automation_paused");
	}
	const policy = await readEscalationPolicy(db, organizationId);
	if (!policy) return emptySummary(organizationId, "policy_not_prepared");
	if (!policy.enabled) return emptySummary(organizationId, "policy_disabled");

	// actionableAt >= assignedAt for every evidence kind, so this prefilter
	// never skips a due assignment.
	const assignedCutoff = dateFromInstant(now.subtract({ hours: policy.responseWindowHours }));
	const candidates = await db
		.select({
			assignmentId: approvalStageAssignment.id,
			workflowId: approvalStageAssignment.workflowId,
			stageId: approvalStageAssignment.stageId,
		})
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflowStage,
			and(
				eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
				eq(approvalWorkflowStage.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, organizationId),
				eq(approvalStageAssignment.status, "pending"),
				lte(approvalStageAssignment.assignedAt, assignedCutoff),
				eq(approvalWorkflow.workflowType, SUPPORTED_WORKFLOW_TYPE),
				eq(approvalWorkflow.status, "pending"),
				eq(approvalWorkflowStage.status, "pending"),
				eq(approvalWorkflowStage.activationMode, "human"),
				eq(approvalWorkflowStage.sequence, approvalWorkflow.currentStageOrder),
			),
		)
		.orderBy(asc(approvalStageAssignment.assignedAt), asc(approvalStageAssignment.id))
		.limit(limit);

	const summary = emptySummary(organizationId, "processed");
	const runtime = createEscalationRuntime(null);
	for (const candidate of candidates) {
		summary.examined += 1;
		try {
			const outcome = await processDueAssignment(runtime, {
				organizationId,
				...candidate,
				now,
			});
			switch (outcome.kind) {
				case "transferred":
					if (outcome.disposition === "executed") summary.transferred += 1;
					else summary.replayed += 1;
					break;
				case "held":
					summary.held[outcome.reason] = (summary.held[outcome.reason] ?? 0) + 1;
					break;
				case "not_due":
					summary.notDue += 1;
					break;
				case "not_pending":
					summary.notPending += 1;
					break;
				case "legacy_authority":
					summary.legacyAuthority += 1;
					break;
				case "suppressed":
					// Ownership moved or paused mid-run: stop without new transfers.
					summary.status = "ownership_changed";
					return summary;
			}
		} catch (error) {
			if (isTransitionRace(error)) {
				summary.raced += 1;
				continue;
			}
			summary.failed += 1;
			logger.error(
				{ error, organizationId, assignmentId: candidate.assignmentId },
				"Scheduled approval escalation failed",
			);
		}
	}
	return summary;
}

async function processDueAssignment(
	runtime: EscalationRuntime,
	input: {
		organizationId: string;
		workflowId: string;
		stageId: string;
		assignmentId: string;
		now: Instant;
	},
): Promise<DueAssignmentOutcome> {
	const { organizationId } = input;
	return runtime.repository.withTransaction(async (context) => {
		const tx = context.dbService.db as unknown as DatabaseTransaction;
		const ownership = await readEscalationOwnership(tx, organizationId, true);
		if (ownership.kind !== "owned" || ownership.paused) {
			return { kind: "suppressed" };
		}
		const gate = await context.writeGate.acquire({
			organizationId,
			workflowType: SUPPORTED_WORKFLOW_TYPE,
		});
		if (!gate.behavior.decideCanonical || !gate.behavior.writeCanonical) {
			// Legacy-authoritative absences transfer through their own path.
			return { kind: "legacy_authority" };
		}
		const snapshot = await context.repository.loadSnapshot({
			organizationId,
			workflowId: input.workflowId,
		});
		const current = currentPendingAssignment(
			snapshot,
			organizationId,
			input.stageId,
			input.assignmentId,
		);
		if (!current) return { kind: "not_pending" };

		const transfers = await listWorkflowEscalationTransferFacts(tx, {
			organizationId,
			workflowId: snapshot.id,
		});
		let evidence: CanonicalAssignmentEvidence = classifyCanonicalAssignmentEvidence({
			stage: current.stage,
			source: current.source,
			transfers,
			rolloutFallbackAt: ownership.ownedSince,
		});
		if (evidence.kind === "established") {
			// Exact committed replay precedes every fresh check.
			const committed = await findEscalationTransferByOperationKey(tx, {
				organizationId,
				operationKey: automaticEscalationOperationKey({
					workflowId: snapshot.id,
					stageId: current.stage.id,
					lineageRootAssignmentId: evidence.lineageRootAssignmentId,
					sourceAssignmentId: current.source.id,
				}),
			});
			if (committed) return { kind: "transferred", disposition: "replayed" };
			const conflict = await compatibilityConflict(tx, current, gate);
			if (conflict) {
				evidence = {
					kind: "ambiguous",
					lineageRootAssignmentId: evidence.lineageRootAssignmentId,
					cause: "compatibility_approver_mismatch",
					evidence: conflict,
				};
			}
		}
		const policy = await readEscalationPolicy(tx, organizationId);
		if (!policy?.enabled) return { kind: "not_due" };
		const unsupportedRoute = unsupportedReplacementRoute(current, gate);

		let decision = decideAutomaticEscalation({
			evidence,
			policy,
			now: input.now,
			unsupportedRoute,
			orderedCandidates: [],
		});
		if (decision.kind === "hold" && decision.reason === "no_eligible_backup") {
			// Only a due, routable, unconsumed lineage reaches candidate loading.
			decision = decideAutomaticEscalation({
				evidence,
				policy,
				now: input.now,
				unsupportedRoute,
				orderedCandidates: await orderedCandidatesFor(tx, current),
			});
		}

		if (decision.kind === "not_due") return { kind: "not_due" };
		if (decision.kind === "hold") {
			// A hold is a committed outcome of this transaction, never a throw.
			await raiseEscalationAttention(tx, {
				organizationId,
				reason: decision.reason,
				subject: { kind: "assignment", assignmentId: current.source.id },
				...(evidence.lineageRootAssignmentId
					? { lineageRootAssignmentId: evidence.lineageRootAssignmentId }
					: {}),
				approvalType: SUPPORTED_WORKFLOW_TYPE,
				...(current.stage.legacyApprovalRequestId
					? { approvalRequestId: current.stage.legacyApprovalRequestId }
					: {}),
				workflowId: snapshot.id,
				currentApproverEmployeeId: current.source.approverEmployeeId,
				policyRevision: policy.revision,
				evidence: decision.evidence,
			});
			return { kind: "held", reason: decision.reason };
		}
		if (evidence.kind !== "established") {
			throw new Error("Escalation decision transferred ambiguous evidence");
		}
		const operationKey = automaticEscalationOperationKey({
			workflowId: snapshot.id,
			stageId: current.stage.id,
			lineageRootAssignmentId: evidence.lineageRootAssignmentId,
			sourceAssignmentId: current.source.id,
		});
		const committed = await commitCanonicalTransfer({
			runtime,
			context: fixedGateContext(context, organizationId, gate),
			current,
			recipientEmployeeId: decision.recipientEmployeeId,
			operationKey,
			requestFingerprint: escalationRequestFingerprint({
				initiator: "scheduled",
				actorUserId: null,
				sourceAssignmentId: current.source.id,
				requestedRecipientEmployeeId: null,
				reason: null,
			}),
			initiator: "scheduled",
			principal: { kind: "system", systemId: APPROVAL_ESCALATION_SYSTEM_ID },
			commandActor: { kind: "system", employeeId: null, userId: null },
			lineageRootAssignmentId: evidence.lineageRootAssignmentId,
			scheduled: {
				actionableAt: evidence.actionableAt,
				actionableEvidence: evidence.actionableEvidence,
				deadlineAt: decision.deadlineAt,
				policyRevision: decision.policyRevision,
			},
			policyRevision: decision.policyRevision,
			reason: null,
		});
		return { kind: "transferred", disposition: committed.disposition };
	});
}

// ============================================
// HUMAN: MANAGEMENT-AUTHORIZED ESCALATION
// ============================================

export interface HumanEscalationActor {
	organizationId: string;
	userId: string;
	employeeId: string;
	/** Explicit organization-level approval-management permission. */
	canManageApprovals: boolean;
}

export type HumanEscalationOutcome =
	| {
			kind: "transferred";
			disposition: "executed" | "replayed";
			transfer: EscalationTransferView;
	  }
	| { kind: "forbidden" }
	| { kind: "not_owner" }
	| { kind: "not_found" }
	| { kind: "not_pending" }
	| { kind: "unsupported"; route: string }
	| { kind: "recipient_not_eligible" }
	| { kind: "no_eligible_backup" }
	| { kind: "idempotency_mismatch" }
	| { kind: "conflict" };

export interface EscalationCandidateView {
	employeeId: string;
	name: string;
	isPrimary: boolean;
	recommended: boolean;
}

export type EscalationCandidateListOutcome =
	| {
			kind: "ok";
			currentApprover: { employeeId: string; name: string };
			candidates: EscalationCandidateView[];
	  }
	| Extract<
			HumanEscalationOutcome,
			{
				kind: "forbidden" | "not_owner" | "not_found" | "not_pending" | "unsupported";
			}
	  >;

async function locateAssignment(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
	assignmentId: string,
) {
	const [row] = await executor
		.select({
			workflowId: approvalStageAssignment.workflowId,
			stageId: approvalStageAssignment.stageId,
		})
		.from(approvalStageAssignment)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, organizationId),
				eq(approvalStageAssignment.id, assignmentId),
			),
		)
		.limit(1);
	return row ?? null;
}

async function employeeNames(
	executor: typeof db | DatabaseTransaction,
	organizationId: string,
	employeeIds: string[],
): Promise<Map<string, string>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await executor
		.select({ id: employee.id, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));
	return new Map(rows.map((row) => [row.id, row.name]));
}

type HumanPreparation =
	| {
			kind: "ready";
			current: CurrentStageAssignment;
			gate: ApprovalWriteGateResult;
			candidates: EscalationCandidateFact[];
			lineageRootAssignmentId: string | null;
	  }
	| Exclude<EscalationCandidateListOutcome, { kind: "ok" } | { kind: "forbidden" }>;

async function prepareHumanEscalation(
	context: ApprovalWorkflowTransactionContext,
	actor: HumanEscalationActor,
	assignmentId: string,
): Promise<HumanPreparation> {
	const tx = context.dbService.db as unknown as DatabaseTransaction;
	const ownership = await readEscalationOwnership(tx, actor.organizationId, true);
	// A human transfer is allowed while automation is paused, never while
	// legacy channel automation still owns escalation.
	if (ownership.kind !== "owned") return { kind: "not_owner" };
	const located = await locateAssignment(tx, actor.organizationId, assignmentId);
	if (!located) return { kind: "not_found" };
	const gate = await context.writeGate.acquire({
		organizationId: actor.organizationId,
		workflowType: SUPPORTED_WORKFLOW_TYPE,
	});
	const snapshot = await context.repository.loadSnapshot({
		organizationId: actor.organizationId,
		workflowId: located.workflowId,
	});
	if (snapshot.workflowType !== SUPPORTED_WORKFLOW_TYPE) {
		return { kind: "unsupported", route: `workflow_type:${snapshot.workflowType}` };
	}
	if (!gate.behavior.decideCanonical || !gate.behavior.writeCanonical) {
		return { kind: "unsupported", route: "legacy_authority" };
	}
	const current = currentPendingAssignment(
		snapshot,
		actor.organizationId,
		located.stageId,
		assignmentId,
	);
	if (!current) return { kind: "not_pending" };
	const route = unsupportedReplacementRoute(current, gate);
	if (route) return { kind: "unsupported", route };
	const transfers = await listWorkflowEscalationTransferFacts(tx, {
		organizationId: actor.organizationId,
		workflowId: snapshot.id,
	});
	const evidence = classifyCanonicalAssignmentEvidence({
		stage: current.stage,
		source: current.source,
		transfers,
		rolloutFallbackAt: ownership.ownedSince,
	});
	return {
		kind: "ready",
		current,
		gate,
		candidates: await orderedCandidatesFor(tx, current),
		// Explicit human intervention is allowed on ambiguous history; the
		// journal records the lineage only when it is actually known.
		lineageRootAssignmentId: evidence.lineageRootAssignmentId,
	};
}

/** Eligible recipients for a management-authorized transfer, recommended first. */
export async function listHumanEscalationCandidates(input: {
	actor: HumanEscalationActor;
	assignmentId: string;
}): Promise<EscalationCandidateListOutcome> {
	if (!input.actor.canManageApprovals) return { kind: "forbidden" };
	const runtime = createEscalationRuntime(null);
	return runtime.repository.withTransaction(async (context) => {
		const prepared = await prepareHumanEscalation(context, input.actor, input.assignmentId);
		if (prepared.kind !== "ready") return prepared;
		const tx = context.dbService.db as unknown as DatabaseTransaction;
		const names = await employeeNames(tx, input.actor.organizationId, [
			prepared.current.source.approverEmployeeId,
			...prepared.candidates.map((candidate) => candidate.employeeId),
		]);
		return {
			kind: "ok",
			currentApprover: {
				employeeId: prepared.current.source.approverEmployeeId,
				name: names.get(prepared.current.source.approverEmployeeId) ?? "—",
			},
			candidates: prepared.candidates.map((candidate, index) => ({
				employeeId: candidate.employeeId,
				name: names.get(candidate.employeeId) ?? "—",
				isPrimary: candidate.isPrimary,
				recommended: index === 0,
			})),
		};
	});
}

/**
 * Separately authorized human escalation (#255 §1, §3). Requires explicit
 * approval-management permission (holding an assignment or being an eligible
 * manager is not enough) and a caller-supplied idempotency key. An exact
 * committed operation replays before any fresh check; a requested recipient
 * must satisfy the same eligible-recipient rules as automation. It does not
 * consume the lineage's automatic allowance.
 */
export async function escalateAssignmentByManager(input: {
	actor: HumanEscalationActor;
	assignmentId: string;
	idempotencyKey: string;
	recipientEmployeeId?: string;
	reason?: string;
}): Promise<HumanEscalationOutcome> {
	const { actor } = input;
	if (!actor.canManageApprovals) return { kind: "forbidden" };
	const reason = input.reason?.trim() || null;
	const operationKey = humanEscalationOperationKey({
		actorUserId: actor.userId,
		idempotencyKey: input.idempotencyKey,
	});
	const requestFingerprint = escalationRequestFingerprint({
		initiator: "human",
		actorUserId: actor.userId,
		sourceAssignmentId: input.assignmentId,
		requestedRecipientEmployeeId: input.recipientEmployeeId ?? null,
		reason,
	});
	const runtime = createEscalationRuntime({
		organizationId: actor.organizationId,
		actorEmployeeId: actor.employeeId,
	});
	try {
		return await runtime.repository.withTransaction(
			async (context): Promise<HumanEscalationOutcome> => {
				const tx = context.dbService.db as unknown as DatabaseTransaction;
				const committed = await findEscalationTransferByOperationKey(tx, {
					organizationId: actor.organizationId,
					operationKey,
				});
				if (committed) {
					return committed.requestFingerprint === requestFingerprint
						? {
								kind: "transferred",
								disposition: "replayed",
								transfer: toTransferView(committed),
							}
						: { kind: "idempotency_mismatch" };
				}
				const prepared = await prepareHumanEscalation(context, actor, input.assignmentId);
				if (prepared.kind !== "ready") return prepared;
				const recipient = input.recipientEmployeeId
					? prepared.candidates.find(
							(candidate) => candidate.employeeId === input.recipientEmployeeId,
						)
					: prepared.candidates[0];
				if (!recipient) {
					return input.recipientEmployeeId
						? { kind: "recipient_not_eligible" }
						: { kind: "no_eligible_backup" };
				}
				const policy = await readEscalationPolicy(tx, actor.organizationId);
				const outcome = await commitCanonicalTransfer({
					runtime,
					context: fixedGateContext(context, actor.organizationId, prepared.gate),
					current: prepared.current,
					recipientEmployeeId: recipient.employeeId,
					operationKey,
					requestFingerprint,
					initiator: "human",
					principal: { kind: "employee", userId: actor.userId },
					commandActor: {
						kind: "employee",
						employeeId: actor.employeeId,
						userId: actor.userId,
					},
					lineageRootAssignmentId: prepared.lineageRootAssignmentId,
					scheduled: null,
					policyRevision: policy?.revision ?? null,
					reason,
				});
				return {
					kind: "transferred",
					disposition: outcome.disposition,
					transfer: toTransferView(outcome.transfer),
				};
			},
		);
	} catch (error) {
		if (isTransitionRace(error)) return { kind: "conflict" };
		if (error instanceof ApprovalTransitionEngineError && error.code === "forbidden") {
			return { kind: "forbidden" };
		}
		if (error instanceof ApprovalTransitionEngineError && error.code === "idempotency_mismatch") {
			return { kind: "idempotency_mismatch" };
		}
		throw error;
	}
}
