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
} from "../evidence/invocation";
import { LEGACY_TIME_ACTIONABLE_PROVIDERS } from "../evidence/legacy-time";
import {
	type DecisionEvidenceRecord,
	findDecisionEvidenceByReceipt,
	type LegacyDecisionEvidenceRecord,
	loadLegacyReviewBinding,
	loadReviewBindingAuthority,
} from "../evidence/store";
import type { ApprovalWorkflowType } from "../workflow/ports";
import type { ApprovalDatabase } from "./types";

/**
 * A reviewed-binding card action of a time approval: the opaque handle the
 * card carried and the authenticated provider invocation. A canonical binding
 * decides only under canonical authority, against the exact bound assignment
 * (#325); a legacy binding only under legacy authority, against the exact
 * bound legacy request (#432).
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

/**
 * The committed decision an invocation is associated with: canonical evidence,
 * or legacy evidence for a legacy binding (#432).
 */
export interface BoundTimeInvocationOutcome {
	replayed: boolean;
	evidence: DecisionEvidenceRecord | LegacyDecisionEvidenceRecord;
}

/**
 * Raised inside a decision transaction that found the invocation already
 * committed, before anything was written. The owner rethrows it; the bound
 * entry returns the original evidence as an exact replay.
 */
export class BoundTimeInvocationReplay extends Error {
	constructor(readonly evidence: DecisionEvidenceRecord | LegacyDecisionEvidenceRecord) {
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
 * state is never consulted. The command fingerprint includes the binding,
 * whose authority is fixed, so the committed evidence belongs to that
 * authority.
 */
export async function replayCommittedTimeInvocation(
	database: ApprovalDatabase,
	input: { bound: BoundTimeInvocation; command: ApprovalInvocationCommand },
): Promise<void> {
	const committed = await findCommittedInvocationDecision(database, {
		identity: input.bound.invocation.identity,
		command: input.command,
	});
	if (committed) throw new BoundTimeInvocationReplay(committed);
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

/**
 * Cutover safety, read under the rollout gate: a binding decides only under
 * the authority it was issued for, so a legacy binding never decides under
 * canonical authority, nor the other way round. A legacy card decision is
 * admitted only for providers verified under legacy authority (#432).
 */
export async function assertTimeBindingAuthority(
	database: ApprovalDatabase,
	input: { organizationId: string; bound: BoundTimeInvocation; legacyAuthority: boolean },
): Promise<void> {
	const authority = await loadReviewBindingAuthority(database, {
		organizationId: input.organizationId,
		bindingId: input.bound.reviewedBindingId,
	});
	if (authority !== (input.legacyAuthority ? "legacy" : "canonical")) {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "authority" });
	}
	if (
		input.legacyAuthority &&
		!LEGACY_TIME_ACTIONABLE_PROVIDERS.includes(
			approvalInvocationProvider(input.bound.invocation.identity.scheme),
		)
	) {
		throw new ApprovalInvocationNotAdmittedError();
	}
}

/**
 * A legacy binding (#432) must name this organization, the deciding actor as
 * its recipient, the exact legacy request being decided and the current
 * legacy submitted revision of its cycle. Checked before any authority
 * question; without a current revision it names nothing.
 */
export async function assertLegacyTimeBinding(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		bound: BoundTimeInvocation;
		actorEmployeeId: string;
		approvalRequestId: string;
		currentRevisionId: string | null;
	},
): Promise<void> {
	const binding = await loadLegacyReviewBinding(database, {
		organizationId: input.organizationId,
		bindingId: input.bound.reviewedBindingId,
	});
	if (
		!binding ||
		binding.recipientEmployeeId !== input.actorEmployeeId ||
		binding.legacyApprovalRequestId !== input.approvalRequestId
	) {
		throw new ApprovalEvidenceError("binding_mismatch");
	}
	if (!input.currentRevisionId || binding.submittedRevisionId !== input.currentRevisionId) {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "revision" });
	}
}

/**
 * Associates a legacy card decision's invocation with the legacy decision
 * evidence the owner recorded under the invocation's receipt, in the same
 * transaction as the legacy mutation (#432).
 */
export async function recordLegacyTimeInvocationDecision(
	database: ApprovalDatabase,
	input: {
		bound: BoundTimeInvocation;
		command: ApprovalInvocationCommand;
		approvalRequestId: string;
		evidence: LegacyDecisionEvidenceRecord | null;
	},
): Promise<BoundTimeInvocationOutcome> {
	if (
		!input.evidence ||
		input.evidence.reviewedBindingId !== input.bound.reviewedBindingId ||
		input.evidence.legacy.approvalRequestId !== input.approvalRequestId
	) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	}
	await recordApprovalInvocation(database, {
		identity: input.bound.invocation.identity,
		deliveryId: input.bound.invocation.deliveryId,
		command: input.command,
		legacyApprovalRequestId: input.approvalRequestId,
		receiptIdempotencyKey: boundTimeInvocationKey(input.bound),
		decisionEvidenceId: input.evidence.id,
	});
	return { replayed: false, evidence: input.evidence };
}
