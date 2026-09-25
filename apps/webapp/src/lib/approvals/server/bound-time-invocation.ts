import { ApprovalEvidenceError } from "../evidence/errors";
import {
	type ApprovalInvocationCommand,
	type ApprovalInvocationIdentity,
	ApprovalInvocationNotAdmittedError,
	approvalInvocationIdempotencyKey,
	approvalInvocationProvider,
	findCommittedInvocationDecision,
	lockApprovalInvocation,
	readApprovalPresentationMode,
	recordApprovalInvocation,
	requireCanonicalInvocationDecision,
} from "../evidence/invocation";
import { type DecisionEvidenceRecord, findDecisionEvidenceByReceipt } from "../evidence/store";
import type { ApprovalWorkflowType } from "../workflow/ports";
import type { ApprovalDatabase } from "./types";

/**
 * A reviewed-binding card action of a time approval (#325): the opaque handle
 * the card carried and the authenticated provider invocation. Decided only
 * under canonical authority, against the exact bound assignment.
 */
export interface BoundTimeInvocation {
	reviewedBindingId: string;
	invocation: {
		identity: ApprovalInvocationIdentity;
		/** Transport delivery identity (e.g. Telegram update_id); not identity. */
		deliveryId: string | null;
		providerActorId: string;
	};
}

/** The committed decision an exact invocation replay returns. */
export interface BoundTimeInvocationOutcome {
	replayed: boolean;
	evidence: DecisionEvidenceRecord;
}

/**
 * Raised inside a decision transaction that found the invocation already
 * committed, before anything was written. The owner rethrows it; the bound
 * entry returns the original evidence as an exact replay.
 */
export class BoundTimeInvocationReplay extends Error {
	constructor(readonly evidence: DecisionEvidenceRecord) {
		super("Bound time invocation replay");
		this.name = "BoundTimeInvocationReplay";
	}
}

export function boundTimeInvocationCommand(input: {
	bound: BoundTimeInvocation;
	actorEmployeeId: string;
	actorUserId: string;
	action: "approve" | "reject";
	reason: string | null;
}): ApprovalInvocationCommand {
	return {
		actorEmployeeId: input.actorEmployeeId,
		actorUserId: input.actorUserId,
		providerActorId: input.bound.invocation.providerActorId,
		reviewedBindingId: input.bound.reviewedBindingId,
		action: input.action,
		reason: input.reason,
	};
}

export function boundTimeInvocationKey(bound: BoundTimeInvocation): string {
	return approvalInvocationIdempotencyKey(bound.invocation.identity);
}

/**
 * Receipt before fresh checks: an exact committed invocation throws its
 * replay; the same invocation with another command is a mismatch. Current
 * state is never consulted.
 */
export async function replayCommittedTimeInvocation(
	database: ApprovalDatabase,
	input: { bound: BoundTimeInvocation; command: ApprovalInvocationCommand },
): Promise<void> {
	const committed = await findCommittedInvocationDecision(database, {
		identity: input.bound.invocation.identity,
		command: input.command,
	});
	if (committed) {
		throw new BoundTimeInvocationReplay(requireCanonicalInvocationDecision(committed));
	}
}

/**
 * Under the owner's coordination (rollout gate held): serializes concurrent
 * deliveries of the invocation, replays a committed one, and requires current
 * admission of the provider for the kind, so pausing stops sent cards.
 */
export async function admitFreshTimeInvocation(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
		bound: BoundTimeInvocation;
		command: ApprovalInvocationCommand;
	},
): Promise<void> {
	const { identity } = input.bound.invocation;
	if (identity.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation" });
	}
	await lockApprovalInvocation(database, identity);
	await replayCommittedTimeInvocation(database, input);
	const mode = await readApprovalPresentationMode(database, {
		organizationId: input.organizationId,
		workflowType: input.workflowType,
		provider: approvalInvocationProvider(identity.scheme),
	});
	if (mode !== "actionable") throw new ApprovalInvocationNotAdmittedError();
}

/**
 * Associates the invocation with the decision evidence the engine recorded
 * under its receipt, in the same transaction. Time-kind evidence keeps only a
 * digest of the receipt key.
 */
export async function recordTimeInvocationDecision(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowId: string;
		bound: BoundTimeInvocation;
		command: ApprovalInvocationCommand;
		receiptKeyDigest: string;
	},
): Promise<BoundTimeInvocationOutcome> {
	const evidence = await findDecisionEvidenceByReceipt(database, {
		organizationId: input.organizationId,
		workflowId: input.workflowId,
		idempotencyKey: input.receiptKeyDigest,
	});
	if (!evidence || evidence.reviewedBindingId !== input.bound.reviewedBindingId) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	}
	await recordApprovalInvocation(database, {
		identity: input.bound.invocation.identity,
		deliveryId: input.bound.invocation.deliveryId,
		command: input.command,
		workflowId: input.workflowId,
		receiptIdempotencyKey: boundTimeInvocationKey(input.bound),
		decisionEvidenceId: evidence.id,
	});
	return { replayed: false, evidence };
}
