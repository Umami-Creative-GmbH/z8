import { createHash } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
	type ApprovalEscalationAttentionReason,
	approvalRequest,
	approvalWorkflow,
	approvalWorkflowRollout,
	auditLog,
	teamsEscalation,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	AbsenceLegacyStateCaptureError,
	captureAbsenceLegacyApprovalState,
} from "../domain-adapters/absence-legacy-state";
import {
	createLegacyApprovalWriteCoordinator,
	LegacyApprovalWriteBoundaryError,
} from "../domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { getCutoverBehavior } from "../workflow/cutover";
import { appendLegacyEscalationLineage } from "../workflow/legacy-escalation-lineage";
import { LegacyApprovalObservationPlannerError } from "../workflow/legacy-observation-planner";
import {
	APPROVAL_ESCALATION_SYSTEM_ID,
	type ApprovalCommandActor,
	type ApprovalEventActorIdentity,
	type ApprovalWorkflowLifecycleMode,
	type ApprovalWriteGateResult,
	type JsonObject,
	type ObservedLegacyTransitionResult,
	type VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { ApprovalWorkflowRepositoryError } from "../workflow/repository";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import type { EscalationAttentionSubject } from "./attention";
import {
	raiseEscalationAttention,
	resolveRecoveredEscalationAttentionCondition,
} from "./attention-store";
import { loadEscalationCandidateFacts } from "./candidates";
import { type EscalationPolicySnapshot, evaluateEscalationDeadline } from "./deadline";
import { listLegacyRequestTransferFacts } from "./legacy-transfer-store";
import {
	type DatabaseTransaction,
	type EscalationOwnership,
	type EscalationRuntime,
	fixedGateContext,
	readEscalationOwnership,
	readEscalationPolicy,
	SUPPORTED_WORKFLOW_TYPE,
} from "./transfer-context";
import {
	classifyLegacyAssignmentEvidence,
	decideAutomaticEscalation,
	type EscalationCandidateFact,
	type LegacyAssignmentEvidence,
	type LegacyJournalTransferFact,
	legacyAutomaticEscalationOperationKey,
	orderEscalationCandidates,
} from "./transfer-evaluation";
import {
	type EscalationTransferRow,
	findEscalationTransferByOperationKey,
	recordEscalationTransfer,
} from "./transfer-store";

/**
 * Legacy-authoritative escalation transfer (#299, #255 §1–§3).
 *
 * While an organization's absences are decided by the legacy owners
 * (`legacy`, `shadow`, `ready`), the authority is the pending
 * `approval_request`. A transfer moves that request to the replacement in
 * place, records the lineage it replaced on the request, mirrors the change
 * into any shadow observation, and journals the transfer with its delivery
 * event — all in one transaction. The journal row is the operation's replay
 * receipt; no canonical workflow is invented for it and no human is
 * fabricated for the scheduled capability.
 */

/** A lost race: the request was decided or moved after it was locked for reading. */
export class LegacyTransferRaceError extends Error {
	readonly code = "legacy_transfer_race";

	constructor() {
		super("The legacy approval request changed during the transfer");
		this.name = "LegacyTransferRaceError";
	}
}

/**
 * The shadow observation or the verified legacy state refused the transfer.
 * The transaction rolls back and the caller records a durable hold instead.
 */
export function isLegacyObservationRejection(error: unknown): boolean {
	return (
		error instanceof LegacyApprovalObservationPlannerError ||
		error instanceof LegacyApprovalWriteBoundaryError ||
		error instanceof AbsenceLegacyStateCaptureError ||
		// Evidence the observation refused; persistence/CAS invariants stay
		// infrastructure failures and are retried, never recorded as history.
		(error instanceof ApprovalWorkflowRepositoryError &&
			(error.code === "malformed" || error.code === "source_conflict"))
	);
}

const LEGACY_AUTHORITY_MODES = new Set<ApprovalWorkflowLifecycleMode>([
	"legacy",
	"shadow",
	"ready",
]);

/**
 * Discovery-time authority selection. The mode is re-read under the write
 * gate inside every transfer transaction, which is what actually decides.
 */
export async function readAbsenceAuthorityForDiscovery(
	executor: DatabaseTransaction | typeof db,
	organizationId: string,
): Promise<"canonical" | "legacy"> {
	const [rollout] = await executor
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, organizationId),
				eq(approvalWorkflowRollout.workflowType, SUPPORTED_WORKFLOW_TYPE),
			),
		)
		.limit(1);
	// A missing row is created as `legacy` by the write gate.
	const mode = rollout?.mode ?? "legacy";
	return getCutoverBehavior(mode).decideCanonical ? "canonical" : "legacy";
}

/**
 * Pending legacy absence requests old enough to possibly be due, oldest
 * first. Every actionable instant is at or after the request's creation, so
 * this prefilter never skips a due request. `created_at` keeps microseconds
 * while evaluation uses its millisecond floor, so the whole cutoff
 * millisecond is included.
 */
export async function listDueLegacyRequestCandidates(
	executor: DatabaseTransaction | typeof db,
	input: { organizationId: string; createdCutoff: Instant; limit: number },
): Promise<string[]> {
	const rows = await executor
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "absence_entry"),
				eq(approvalRequest.status, "pending"),
				lt(
					approvalRequest.createdAt,
					dateFromInstant(input.createdCutoff.add({ milliseconds: 1 })),
				),
			),
		)
		.orderBy(asc(approvalRequest.createdAt), asc(approvalRequest.id))
		.limit(input.limit);
	return rows.map((row) => row.id);
}

// ============================================
// SUBJECT
// ============================================

interface LegacySubject {
	request: {
		id: string;
		absenceId: string;
		requesterEmployeeId: string;
		approverEmployeeId: string;
		createdAt: Instant;
	};
	/** Verified legacy state before the transfer (also the observation's "before"). */
	state: VerifiedLegacyApprovalState & {
		approvalRequest: NonNullable<VerifiedLegacyApprovalState["approvalRequest"]>;
	};
	transfers: LegacyJournalTransferFact[];
	evidence: LegacyAssignmentEvidence;
	/** Observed workflow version to mirror against; null without a mirror. */
	expectedVersion: number | null;
	/** Why the replacement would have no working path, if so. */
	unsupportedRoute: string | null;
}

type LegacySubjectLoad =
	| { kind: "ready"; subject: LegacySubject }
	| { kind: "not_found" | "not_pending" | "canonical_authority" }
	| {
			kind: "unsupported";
			route: string;
			approverEmployeeId: string;
			/** The request's creation: when its current holder became actionable. */
			createdAt: Instant;
	  }
	| {
			kind: "unverifiable";
			approverEmployeeId: string;
			evidence: JsonObject;
	  };

function legacySubjectRef(
	approvalRequestId: string,
	approverEmployeeId: string,
): EscalationAttentionSubject {
	return { kind: "legacy_assignment", approvalRequestId, approverEmployeeId };
}

/**
 * Locks and loads one legacy absence request with everything a transfer
 * decision needs, inside the transfer transaction (after the write gate).
 */
async function loadLegacySubject(
	context: ApprovalWorkflowTransactionContext,
	gate: ApprovalWriteGateResult,
	input: { organizationId: string; approvalRequestId: string; now: Instant },
): Promise<LegacySubjectLoad> {
	const tx = context.dbService.db as unknown as DatabaseTransaction;
	if (!LEGACY_AUTHORITY_MODES.has(gate.mode) || gate.behavior.decideCanonical) {
		return { kind: "canonical_authority" };
	}
	const [request] = await tx
		.select({
			id: approvalRequest.id,
			entityType: approvalRequest.entityType,
			entityId: approvalRequest.entityId,
			requestedBy: approvalRequest.requestedBy,
			approverId: approvalRequest.approverId,
			status: approvalRequest.status,
			createdAt: approvalRequest.createdAt,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.id, input.approvalRequestId),
			),
		)
		.limit(1)
		.for("update");
	if (!request) return { kind: "not_found" };
	if (request.entityType !== "absence_entry") {
		return {
			kind: "unsupported",
			route: `entity_type:${request.entityType}`,
			approverEmployeeId: request.approverId,
			createdAt: instantFromDate(request.createdAt),
		};
	}
	if (request.status !== "pending") return { kind: "not_pending" };

	let state: VerifiedLegacyApprovalState;
	try {
		state = await captureAbsenceLegacyApprovalState({
			dbService: context.dbService,
			organizationId: input.organizationId,
			absenceId: request.entityId,
			capturedAt: input.now,
		});
	} catch (error) {
		if (!(error instanceof AbsenceLegacyStateCaptureError)) throw error;
		return {
			kind: "unverifiable",
			approverEmployeeId: request.approverId,
			evidence: { cause: "legacy_state_unverifiable", code: error.code },
		};
	}
	const captured = state.approvalRequest;
	if (state.chain !== null) {
		// Chain stages bind the approver on their stage row; moving the request
		// alone would contradict the chain (no working replacement path yet).
		return {
			kind: "unsupported",
			route: "legacy_chain_stage",
			approverEmployeeId: request.approverId,
			createdAt: instantFromDate(request.createdAt),
		};
	}
	if (
		!captured ||
		captured.id !== request.id ||
		captured.status !== "pending" ||
		captured.approverId !== request.approverId
	) {
		return {
			kind: "unverifiable",
			approverEmployeeId: request.approverId,
			evidence: { cause: "legacy_state_mismatch", approvalRequestId: request.id },
		};
	}

	const [teamsAttempt] = await tx
		.select({ id: teamsEscalation.id })
		.from(teamsEscalation)
		.where(
			and(
				eq(teamsEscalation.organizationId, input.organizationId),
				eq(teamsEscalation.approvalRequestId, request.id),
			),
		)
		.limit(1);
	const transfers = await listLegacyRequestTransferFacts(tx, {
		organizationId: input.organizationId,
		approvalRequestId: request.id,
	});
	const evidence = classifyLegacyAssignmentEvidence({
		request: {
			id: request.id,
			approverId: request.approverId,
			createdAt: instantFromDate(request.createdAt),
			metadata: captured.metadata,
		},
		transfers,
		teamsEscalationAttempted: teamsAttempt !== undefined,
	});

	let expectedVersion: number | null = null;
	let unsupportedRoute: string | null = null;
	if (gate.behavior.mirror === "legacy_to_canonical") {
		const [observed] = await tx
			.select({ version: approvalWorkflow.version })
			.from(approvalWorkflow)
			.where(
				and(
					eq(approvalWorkflow.organizationId, input.organizationId),
					eq(approvalWorkflow.workflowType, SUPPORTED_WORKFLOW_TYPE),
					eq(approvalWorkflow.sourceType, "absence_entry"),
					eq(approvalWorkflow.sourceId, request.entityId),
					eq(approvalWorkflow.status, "pending"),
				),
			)
			.limit(1);
		if (observed) expectedVersion = observed.version;
		// A request submitted before shadowing has no observation to mirror the
		// transfer into; skipping the mirror silently is not allowed.
		else unsupportedRoute = "legacy_observation_missing";
	}

	return {
		kind: "ready",
		subject: {
			request: {
				id: request.id,
				absenceId: request.entityId,
				requesterEmployeeId: request.requestedBy,
				approverEmployeeId: request.approverId,
				createdAt: instantFromDate(request.createdAt),
			},
			state: { ...state, approvalRequest: captured },
			transfers,
			evidence,
			expectedVersion,
			unsupportedRoute,
		},
	};
}

async function orderedLegacyCandidates(
	tx: DatabaseTransaction,
	organizationId: string,
	subject: LegacySubject,
): Promise<EscalationCandidateFact[]> {
	const candidates = await loadEscalationCandidateFacts(tx, {
		organizationId,
		requesterEmployeeId: subject.request.requesterEmployeeId,
	});
	// A legacy absence has exactly one pending request: there are no siblings.
	return orderEscalationCandidates({
		candidates,
		requesterEmployeeId: subject.request.requesterEmployeeId,
		currentApproverEmployeeId: subject.request.approverEmployeeId,
		pendingSiblingApproverIds: [],
	});
}

// ============================================
// ATOMIC TRANSFER
// ============================================

/** Versioned identity of the legacy authority change, for replay comparison. */
export function fingerprintLegacyTransferCommand(input: {
	approvalRequestId: string;
	sourceSequence: number;
	fromApproverEmployeeId: string;
	toApproverEmployeeId: string;
}): string {
	return `absence-legacy-transfer:v1:${createHash("sha256")
		.update(
			JSON.stringify([
				input.approvalRequestId,
				input.sourceSequence,
				input.fromApproverEmployeeId,
				input.toApproverEmployeeId,
			]),
		)
		.digest("hex")}`;
}

interface CommitLegacyTransferInput {
	organizationId: string;
	context: ApprovalWorkflowTransactionContext;
	gate: ApprovalWriteGateResult;
	subject: LegacySubject;
	sourceSequence: number;
	recipientEmployeeId: string;
	operationKey: string;
	requestFingerprint: string;
	initiator: "scheduled" | "human";
	commandActor: ApprovalCommandActor;
	scheduled: {
		actionableAt: Instant;
		actionableEvidence: "legacy_request_created_at" | "legacy_transfer_at";
		deadlineAt: Instant;
	} | null;
	policyRevision: number | null;
	reason: string | null;
}

/**
 * Moves the pending legacy request to the replacement, mirrors the change
 * into the shadow observation (shadow/ready), and journals it with its
 * delivery event, audit and attention recovery in the caller's transaction.
 * The conditional update keeps first-valid-committed semantics against a
 * concurrent decision or transfer.
 */
async function commitLegacyTransfer(
	input: CommitLegacyTransferInput,
): Promise<EscalationTransferRow> {
	const { organizationId, context, subject } = input;
	const tx = context.dbService.db as unknown as DatabaseTransaction;
	const request = subject.request;
	const fromApproverEmployeeId = request.approverEmployeeId;
	const transferredAt = systemClock.nowInstant();
	const metadata = appendLegacyEscalationLineage(subject.state.approvalRequest.metadata, {
		// The observed pending instant, so shadow history rebuilds identically.
		pendingSince: subject.state.approvalRequest.updatedAt,
		transfer: {
			fromApproverEmployeeId,
			toApproverEmployeeId: input.recipientEmployeeId,
			transferredAt,
			initiator: input.initiator,
			actorEmployeeId: input.commandActor.employeeId,
		},
	});
	const eventActor: ApprovalEventActorIdentity =
		input.commandActor.kind === "system"
			? { kind: "system", employeeId: null, userId: null }
			: {
					kind: "employee",
					employeeId: input.commandActor.employeeId,
					userId: input.commandActor.userId,
				};
	let observed: ObservedLegacyTransitionResult | null = null;
	const coordinator = createLegacyApprovalWriteCoordinator({
		writeGate: fixedGateContext(context, organizationId, input.gate).writeGate,
		compatibilityWriter: context.compatibilityWriter,
	});
	await coordinator.execute({
		organizationId,
		workflowType: SUPPORTED_WORKFLOW_TYPE,
		sourceIdentity: {
			organizationId,
			workflowType: SUPPORTED_WORKFLOW_TYPE,
			sourceType: "absence_entry",
			sourceId: request.absenceId,
		},
		actor: eventActor,
		idempotencyKey: input.operationKey,
		expectedVersion: subject.expectedVersion,
		captureState: () =>
			captureAbsenceLegacyApprovalState({
				dbService: context.dbService,
				organizationId,
				absenceId: request.absenceId,
				capturedAt: transferredAt,
			}),
		mutate: async () => {
			const moved = await tx
				.update(approvalRequest)
				.set({
					approverId: input.recipientEmployeeId,
					metadata,
					updatedAt: dateFromInstant(transferredAt),
				})
				.where(
					and(
						eq(approvalRequest.organizationId, organizationId),
						eq(approvalRequest.id, request.id),
						eq(approvalRequest.status, "pending"),
						eq(approvalRequest.approverId, fromApproverEmployeeId),
					),
				)
				.returning({ id: approvalRequest.id });
			if (moved.length !== 1) throw new LegacyTransferRaceError();
		},
		afterMirror: async (mirrored) => {
			observed = mirrored;
		},
	});
	const observation = observed as ObservedLegacyTransitionResult | null;
	const observedEvent = observation?.events.find(
		(event) => event.eventType === "assignment.escalated",
	);
	if (observation && !observedEvent) {
		throw new Error("Legacy transfer observation has no escalation event");
	}

	const transfer = await recordEscalationTransfer(tx, {
		transfer: {
			organizationId,
			operationKey: input.operationKey,
			initiator: input.initiator,
			authorityMode: "legacy",
			workflowType: SUPPORTED_WORKFLOW_TYPE,
			workflowId: null,
			stageId: null,
			sourceAssignmentId: null,
			replacementAssignmentId: null,
			legacyApprovalRequestId: request.id,
			legacySourceSequence: input.sourceSequence,
			observedWorkflowId: observation?.snapshot.id ?? null,
			observedEventId: observedEvent?.id ?? null,
			lineageRootAssignmentId: null,
			sourceApproverEmployeeId: fromApproverEmployeeId,
			replacementApproverEmployeeId: input.recipientEmployeeId,
			requesterEmployeeId: request.requesterEmployeeId,
			actionableAt: input.scheduled ? dateFromInstant(input.scheduled.actionableAt) : null,
			actionableEvidence: input.scheduled?.actionableEvidence ?? null,
			deadlineAt: input.scheduled ? dateFromInstant(input.scheduled.deadlineAt) : null,
			policyRevision: input.policyRevision,
			workflowEventId: null,
			receiptIdempotencyKey: input.operationKey,
			receiptActorFingerprint: fingerprintApprovalCommandActor(
				input.commandActor,
				input.commandActor.kind === "system" ? APPROVAL_ESCALATION_SYSTEM_ID : undefined,
			),
			receiptCommandFingerprint: fingerprintLegacyTransferCommand({
				approvalRequestId: request.id,
				sourceSequence: input.sourceSequence,
				fromApproverEmployeeId,
				toApproverEmployeeId: input.recipientEmployeeId,
			}),
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
			authorityMode: "legacy",
			workflowType: SUPPORTED_WORKFLOW_TYPE,
			workflowId: null,
			sourceType: "absence_entry",
			sourceId: request.absenceId,
			legacyApprovalRequestId: request.id,
			legacySourceSequence: input.sourceSequence,
			stageId: null,
			sourceAssignmentId: null,
			replacementAssignmentId: null,
			formerApproverEmployeeId: fromApproverEmployeeId,
			replacementApproverEmployeeId: input.recipientEmployeeId,
			requesterEmployeeId: request.requesterEmployeeId,
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
				approver: { from: fromApproverEmployeeId, to: input.recipientEmployeeId },
			}),
			metadata: JSON.stringify({
				authorityMode: "legacy",
				legacyApprovalRequestId: request.id,
				legacySourceSequence: input.sourceSequence,
				observedWorkflowId: transfer.observedWorkflowId,
				reason: input.reason,
			}),
		});
	}
	for (const reason of [
		"no_eligible_backup",
		"unsupported_route",
		"replacement_overdue",
	] as const) {
		await resolveRecoveredEscalationAttentionCondition(tx, {
			organizationId,
			reason,
			subject: legacySubjectRef(request.id, fromApproverEmployeeId),
			evidence: { recovery: "assignment_transferred", transferId: transfer.id },
		});
	}
	return transfer;
}

// ============================================
// SCHEDULED
// ============================================

export type LegacyDueOutcome =
	| { kind: "transferred"; disposition: "executed" | "replayed" }
	| { kind: "held"; reason: ApprovalEscalationAttentionReason }
	| { kind: "not_due" }
	| { kind: "not_pending" }
	| { kind: "canonical_authority" }
	| { kind: "suppressed" };

/**
 * One due legacy request in its own transaction: fresh ownership (share lock),
 * write gate, locked request and verified legacy state; exact committed replay
 * first; then policy, evidence, route and candidates. Holds commit as
 * attention. A rejected observation rolls back and is held separately.
 */
export async function processDueLegacyRequest(
	runtime: EscalationRuntime,
	input: { organizationId: string; approvalRequestId: string; now: Instant },
): Promise<LegacyDueOutcome> {
	try {
		return await runtime.repository.withTransaction((context) =>
			processDueLegacyRequestInTransaction(context, input),
		);
	} catch (error) {
		if (!isLegacyObservationRejection(error)) throw error;
		return holdRejectedObservation(input, error);
	}
}

async function processDueLegacyRequestInTransaction(
	context: ApprovalWorkflowTransactionContext,
	input: { organizationId: string; approvalRequestId: string; now: Instant },
): Promise<LegacyDueOutcome> {
	const { organizationId } = input;
	const tx = context.dbService.db as unknown as DatabaseTransaction;
	const ownership = await readEscalationOwnership(tx, organizationId, true);
	if (ownership.kind !== "owned" || ownership.paused) return { kind: "suppressed" };
	const gate = await context.writeGate.acquire({
		organizationId,
		workflowType: SUPPORTED_WORKFLOW_TYPE,
	});
	const loaded = await loadLegacySubject(context, gate, input);
	switch (loaded.kind) {
		case "not_found":
		case "not_pending":
			return { kind: "not_pending" };
		case "canonical_authority":
			return { kind: "canonical_authority" };
		case "unsupported":
		case "unverifiable": {
			const policy = await readEscalationPolicy(tx, organizationId);
			if (!policy?.enabled) return { kind: "not_due" };
			// Like canonical routes, an unsupported route is held only once due;
			// unverifiable history is held at once.
			if (
				loaded.kind === "unsupported" &&
				evaluateEscalationDeadline({
					actionableAt: loaded.createdAt,
					policy,
					now: input.now,
				}).kind !== "due"
			) {
				return { kind: "not_due" };
			}
			const reason = loaded.kind === "unsupported" ? "unsupported_route" : "ambiguous_history";
			await raiseEscalationAttention(tx, {
				organizationId,
				reason,
				subject: legacySubjectRef(input.approvalRequestId, loaded.approverEmployeeId),
				approvalType: SUPPORTED_WORKFLOW_TYPE,
				approvalRequestId: input.approvalRequestId,
				policyRevision: policy.revision,
				evidence: loaded.kind === "unsupported" ? { route: loaded.route } : loaded.evidence,
			});
			return { kind: "held", reason };
		}
		case "ready":
			break;
	}
	const { subject } = loaded;
	const { evidence } = subject;
	if (evidence.kind === "established") {
		// Exact committed replay precedes every fresh check.
		const committed = await findEscalationTransferByOperationKey(tx, {
			organizationId,
			operationKey: legacyAutomaticEscalationOperationKey({
				approvalRequestId: subject.request.id,
				sourceSequence: evidence.sourceSequence,
				sourceApproverEmployeeId: subject.request.approverEmployeeId,
			}),
		});
		if (committed) return { kind: "transferred", disposition: "replayed" };
	}
	const policy = await readEscalationPolicy(tx, organizationId);
	if (!policy?.enabled) return { kind: "not_due" };
	let decision = decideAutomaticEscalation({
		evidence,
		policy,
		now: input.now,
		unsupportedRoute: subject.unsupportedRoute,
		orderedCandidates: [],
	});
	if (decision.kind === "hold" && decision.reason === "no_eligible_backup") {
		decision = decideAutomaticEscalation({
			evidence,
			policy,
			now: input.now,
			unsupportedRoute: subject.unsupportedRoute,
			orderedCandidates: await orderedLegacyCandidates(tx, organizationId, subject),
		});
	}
	if (decision.kind === "not_due") return { kind: "not_due" };
	if (decision.kind === "hold") {
		await raiseEscalationAttention(tx, {
			organizationId,
			reason: decision.reason,
			subject: legacySubjectRef(subject.request.id, subject.request.approverEmployeeId),
			approvalType: SUPPORTED_WORKFLOW_TYPE,
			approvalRequestId: subject.request.id,
			policyRevision: policy.revision,
			evidence: decision.evidence,
		});
		return { kind: "held", reason: decision.reason };
	}
	if (evidence.kind !== "established") {
		throw new Error("Escalation decision transferred ambiguous evidence");
	}
	await commitLegacyTransfer({
		organizationId,
		context,
		gate,
		subject,
		sourceSequence: evidence.sourceSequence,
		recipientEmployeeId: decision.recipientEmployeeId,
		operationKey: legacyAutomaticEscalationOperationKey({
			approvalRequestId: subject.request.id,
			sourceSequence: evidence.sourceSequence,
			sourceApproverEmployeeId: subject.request.approverEmployeeId,
		}),
		requestFingerprint: legacyEscalationRequestFingerprint({
			initiator: "scheduled",
			actorUserId: null,
			approvalRequestId: subject.request.id,
			requestedRecipientEmployeeId: null,
			reason: null,
		}),
		initiator: "scheduled",
		commandActor: { kind: "system", employeeId: null, userId: null },
		scheduled: {
			actionableAt: evidence.actionableAt,
			actionableEvidence: evidence.actionableEvidence,
			deadlineAt: decision.deadlineAt,
		},
		policyRevision: decision.policyRevision,
		reason: null,
	});
	return { kind: "transferred", disposition: "executed" };
}

/**
 * The observation (or the verified legacy state) contradicted the transfer and
 * rolled it back. Commit a durable hold in a fresh transaction instead of a
 * success-shaped record (#255 §2).
 */
async function holdRejectedObservation(
	input: { organizationId: string; approvalRequestId: string },
	error: unknown,
): Promise<LegacyDueOutcome> {
	return db.transaction(async (tx) => {
		const [request] = await tx
			.select({
				approverId: approvalRequest.approverId,
				status: approvalRequest.status,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.id, input.approvalRequestId),
				),
			)
			.limit(1);
		if (request?.status !== "pending") return { kind: "not_pending" };
		// The same gates as the rolled-back transfer: no hold after ownership
		// moved, automation paused or the policy was disabled.
		const ownership = await readEscalationOwnership(tx, input.organizationId, true);
		if (ownership.kind !== "owned" || ownership.paused) return { kind: "suppressed" };
		const policy = await readEscalationPolicy(tx, input.organizationId);
		if (!policy?.enabled) return { kind: "not_due" };
		await raiseEscalationAttention(tx, {
			organizationId: input.organizationId,
			reason: "ambiguous_history",
			subject: legacySubjectRef(input.approvalRequestId, request.approverId),
			approvalType: SUPPORTED_WORKFLOW_TYPE,
			approvalRequestId: input.approvalRequestId,
			policyRevision: policy.revision,
			evidence: {
				cause: "legacy_observation_rejected",
				error: error instanceof Error ? error.name : "unknown",
				code:
					error && typeof error === "object" && "code" in error
						? String((error as { code: unknown }).code)
						: null,
			},
		});
		return { kind: "held", reason: "ambiguous_history" };
	});
}

/** Identifies the requested legacy operation behind an idempotency key. */
export function legacyEscalationRequestFingerprint(input: {
	initiator: "scheduled" | "human";
	actorUserId: string | null;
	approvalRequestId: string;
	requestedRecipientEmployeeId: string | null;
	reason: string | null;
}): string {
	return `v1:${createHash("sha256")
		.update(
			JSON.stringify([
				input.initiator,
				input.actorUserId,
				`legacy:${input.approvalRequestId}`,
				input.requestedRecipientEmployeeId,
				input.reason,
			]),
		)
		.digest("hex")}`;
}

// ============================================
// HUMAN
// ============================================

export type LegacyHumanPreparation =
	| {
			kind: "ready";
			gate: ApprovalWriteGateResult;
			subject: LegacySubject;
			sourceSequence: number;
			candidates: EscalationCandidateFact[];
	  }
	| { kind: "not_owner" | "not_found" | "not_pending" }
	| { kind: "unsupported"; route: string };

/**
 * Loads a legacy request for a management-authorized transfer. Explicit human
 * intervention may resolve a Teams-attempted request, but never one whose
 * lineage position cannot be established from consistent evidence.
 */
export async function prepareLegacyHumanEscalation(
	context: ApprovalWorkflowTransactionContext,
	input: { organizationId: string; approvalRequestId: string; ownership: EscalationOwnership },
): Promise<LegacyHumanPreparation> {
	if (input.ownership.kind !== "owned") return { kind: "not_owner" };
	const tx = context.dbService.db as unknown as DatabaseTransaction;
	const gate = await context.writeGate.acquire({
		organizationId: input.organizationId,
		workflowType: SUPPORTED_WORKFLOW_TYPE,
	});
	const loaded = await loadLegacySubject(context, gate, {
		organizationId: input.organizationId,
		approvalRequestId: input.approvalRequestId,
		now: systemClock.nowInstant(),
	});
	switch (loaded.kind) {
		case "not_found":
		case "not_pending":
			return { kind: loaded.kind };
		case "canonical_authority":
			return { kind: "unsupported", route: "canonical_authority" };
		case "unsupported":
			return { kind: "unsupported", route: loaded.route };
		case "unverifiable":
			return { kind: "unsupported", route: "legacy_state_unverifiable" };
		case "ready":
			break;
	}
	const { subject } = loaded;
	if (subject.unsupportedRoute) {
		return { kind: "unsupported", route: subject.unsupportedRoute };
	}
	const evidence = subject.evidence;
	if (evidence.kind === "ambiguous" && evidence.cause !== "teams_escalation_attempt") {
		return { kind: "unsupported", route: `legacy_lineage_${evidence.cause}` };
	}
	return {
		kind: "ready",
		gate,
		subject,
		sourceSequence:
			evidence.kind === "established" ? evidence.sourceSequence : subject.transfers.length,
		candidates: await orderedLegacyCandidates(tx, input.organizationId, subject),
	};
}

/** Commits a management-authorized legacy transfer prepared in this transaction. */
export async function commitLegacyHumanTransfer(input: {
	organizationId: string;
	context: ApprovalWorkflowTransactionContext;
	prepared: Extract<LegacyHumanPreparation, { kind: "ready" }>;
	recipientEmployeeId: string;
	operationKey: string;
	requestFingerprint: string;
	actor: { userId: string; employeeId: string };
	policy: EscalationPolicySnapshot | null;
	reason: string | null;
}): Promise<EscalationTransferRow> {
	return commitLegacyTransfer({
		organizationId: input.organizationId,
		context: input.context,
		gate: input.prepared.gate,
		subject: input.prepared.subject,
		sourceSequence: input.prepared.sourceSequence,
		recipientEmployeeId: input.recipientEmployeeId,
		operationKey: input.operationKey,
		requestFingerprint: input.requestFingerprint,
		initiator: "human",
		commandActor: {
			kind: "employee",
			employeeId: input.actor.employeeId,
			userId: input.actor.userId,
		},
		scheduled: null,
		policyRevision: input.policy?.revision ?? null,
		reason: input.reason,
	});
}
