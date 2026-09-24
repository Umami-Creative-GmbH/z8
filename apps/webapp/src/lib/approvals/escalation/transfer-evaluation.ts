import { createHash } from "node:crypto";
import type {
	ApprovalEscalationActionableEvidence,
	ApprovalEscalationAttentionReason,
	ApprovalEscalationTransferInitiator,
} from "@/db/schema";
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalAssignmentSnapshot,
	ApprovalStageSnapshot,
	JsonObject,
} from "../workflow/ports";
import {
	type EscalationDeadlineEvaluation,
	type EscalationPolicySnapshot,
	evaluateEscalationDeadline,
} from "./deadline";

/** A committed journal transfer, as far as lineage classification needs it. */
export interface EscalationJournalTransferFact {
	sourceAssignmentId: string;
	replacementAssignmentId: string;
	initiator: ApprovalEscalationTransferInitiator;
}

export type CanonicalAssignmentEvidence =
	| {
			kind: "established";
			lineageRootAssignmentId: string;
			/** Root first, source last. */
			lineageAssignmentIds: string[];
			actionableAt: Instant;
			actionableEvidence: ApprovalEscalationActionableEvidence;
			/** A proven automatic transfer already used this lineage's allowance. */
			automaticTransferConsumed: boolean;
	  }
	| {
			kind: "ambiguous";
			lineageRootAssignmentId: string | null;
			cause:
				| "lineage_source_missing"
				| "lineage_cycle"
				| "unknown_lineage_metadata"
				| "unjournaled_escalation"
				| "journal_lineage_mismatch"
				| "compatibility_approver_mismatch"
				| "actionable_instant_unproven";
			evidence: JsonObject;
	  };

const OBSERVED_RESOLVER_KINDS = new Set(["legacy_direct", "legacy_chain"]);

/**
 * Observed stages were reconstructed from legacy rows; their assignment
 * `assignedAt` is not evidence of the actionable instant (#255 §4).
 */
export function isObservedLegacyStage(stage: ApprovalStageSnapshot): boolean {
	const kind = stage.resolverSnapshot.kind;
	return typeof kind === "string" && OBSERVED_RESOLVER_KINDS.has(kind);
}

function laterInstant(left: Instant, right: Instant): Instant {
	return compareInstants(left, right) >= 0 ? left : right;
}

/**
 * Classifies the provenance-bearing evidence of one pending canonical
 * assignment: its lineage root, how its actionable instant is known, and
 * whether a proven automatic transfer already consumed the lineage allowance.
 * Missing or contradictory evidence is never read as an unused allowance.
 */
export function classifyCanonicalAssignmentEvidence(input: {
	stage: ApprovalStageSnapshot;
	source: ApprovalAssignmentSnapshot;
	transfers: readonly EscalationJournalTransferFact[];
	rolloutFallbackAt: Instant | null;
}): CanonicalAssignmentEvidence {
	const byId = new Map(input.stage.assignments.map((assignment) => [assignment.id, assignment]));
	const lineage: ApprovalAssignmentSnapshot[] = [input.source];
	const visited = new Set([input.source.id]);
	let current = input.source;
	while (current.reassignedFromAssignmentId !== null) {
		const parent = byId.get(current.reassignedFromAssignmentId);
		if (!parent) {
			return {
				kind: "ambiguous",
				lineageRootAssignmentId: null,
				cause: "lineage_source_missing",
				evidence: {
					assignmentId: current.id,
					missingAssignmentId: current.reassignedFromAssignmentId,
				},
			};
		}
		if (visited.has(parent.id)) {
			return {
				kind: "ambiguous",
				lineageRootAssignmentId: null,
				cause: "lineage_cycle",
				evidence: { assignmentId: parent.id },
			};
		}
		visited.add(parent.id);
		lineage.unshift(parent);
		current = parent;
	}
	const root = lineage[0] ?? input.source;
	const ambiguous = (
		cause: Exclude<
			Extract<CanonicalAssignmentEvidence, { kind: "ambiguous" }>["cause"],
			"lineage_source_missing" | "lineage_cycle"
		>,
		evidence: JsonObject,
	): CanonicalAssignmentEvidence => ({
		kind: "ambiguous",
		lineageRootAssignmentId: root.id,
		cause,
		evidence,
	});

	const transferByReplacement = new Map(
		input.transfers.map((transfer) => [transfer.replacementAssignmentId, transfer]),
	);
	let automaticTransferConsumed = false;
	for (const member of lineage.slice(1)) {
		const kind = member.reassignmentMetadata?.kind;
		if (kind === "reassignment") continue;
		if (kind !== "escalation") {
			return ambiguous("unknown_lineage_metadata", {
				assignmentId: member.id,
			});
		}
		const transfer = transferByReplacement.get(member.id);
		if (!transfer) {
			// An escalation without committed journal evidence (for example an
			// older channel-specific mutation) cannot prove how the allowance
			// was used.
			return ambiguous("unjournaled_escalation", { assignmentId: member.id });
		}
		if (transfer.sourceAssignmentId !== member.reassignedFromAssignmentId) {
			return ambiguous("journal_lineage_mismatch", {
				assignmentId: member.id,
			});
		}
		if (transfer.initiator === "scheduled") automaticTransferConsumed = true;
	}
	const lineageIds = new Set(lineage.map((assignment) => assignment.id));
	for (const transfer of input.transfers) {
		if (
			lineageIds.has(transfer.sourceAssignmentId) !==
			lineageIds.has(transfer.replacementAssignmentId)
		) {
			return ambiguous("journal_lineage_mismatch", {
				sourceAssignmentId: transfer.sourceAssignmentId,
				replacementAssignmentId: transfer.replacementAssignmentId,
			});
		}
	}

	const nativeAssignment =
		input.source.reassignedFromAssignmentId !== null || !isObservedLegacyStage(input.stage);
	let actionableAt: Instant;
	let actionableEvidence: ApprovalEscalationActionableEvidence;
	if (nativeAssignment) {
		actionableAt = input.source.assignedAt;
		actionableEvidence = "assignment_assigned_at";
	} else if (input.rolloutFallbackAt) {
		// A full response window from the recorded rollout; never shorter than
		// what the reconstructed timestamp would allow.
		actionableAt = laterInstant(input.rolloutFallbackAt, input.source.assignedAt);
		actionableEvidence = "rollout_fallback";
	} else {
		return ambiguous("actionable_instant_unproven", {
			assignmentId: input.source.id,
			reconstructedAssignedAt: input.source.assignedAt.toString(),
		});
	}

	return {
		kind: "established",
		lineageRootAssignmentId: root.id,
		lineageAssignmentIds: lineage.map((assignment) => assignment.id),
		actionableAt,
		actionableEvidence,
		automaticTransferConsumed,
	};
}

export interface EscalationCandidateFact {
	employeeId: string;
	/** Primary manager relationship to the requester. */
	isPrimary: boolean;
	/** Start of the requester-manager relationship; null when unrecorded. */
	relationshipSince: Instant | null;
	/** Active, approved member with an authenticated web inbox/decision path. */
	hasDecisionPath: boolean;
}

/**
 * Eligible backups in deterministic order (#251 §1.3–1.4): requester,
 * current and sibling assignees excluded; primary manager first, then the
 * longest-standing relationship, then the stable identifier.
 */
export function orderEscalationCandidates(input: {
	candidates: readonly EscalationCandidateFact[];
	requesterEmployeeId: string;
	currentApproverEmployeeId: string;
	pendingSiblingApproverIds: readonly string[];
}): EscalationCandidateFact[] {
	const excluded = new Set([
		input.requesterEmployeeId,
		input.currentApproverEmployeeId,
		...input.pendingSiblingApproverIds,
	]);
	const seen = new Set<string>();
	return input.candidates
		.filter((candidate) => {
			if (
				excluded.has(candidate.employeeId) ||
				!candidate.hasDecisionPath ||
				seen.has(candidate.employeeId)
			) {
				return false;
			}
			seen.add(candidate.employeeId);
			return true;
		})
		.toSorted((left, right) => {
			if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
			if (left.relationshipSince && right.relationshipSince) {
				const tenure = compareInstants(left.relationshipSince, right.relationshipSince);
				if (tenure !== 0) return tenure;
			} else if (left.relationshipSince || right.relationshipSince) {
				return left.relationshipSince ? -1 : 1;
			}
			return left.employeeId.localeCompare(right.employeeId);
		});
}

export type AutomaticEscalationDecision =
	| {
			kind: "not_due";
			deadline: Extract<EscalationDeadlineEvaluation, { kind: "not_due" | "disabled" }>;
	  }
	| {
			kind: "hold";
			reason: ApprovalEscalationAttentionReason;
			evidence: JsonObject;
	  }
	| {
			kind: "transfer";
			recipientEmployeeId: string;
			deadlineAt: Instant;
			policyRevision: number;
	  };

/**
 * One automatic decision for a pending canonical assignment. Holds are
 * committed attention outcomes; a missing backup never broadens authority.
 */
export function decideAutomaticEscalation(input: {
	evidence: CanonicalAssignmentEvidence;
	policy: EscalationPolicySnapshot;
	now: Instant;
	/** Why the replacement could not reach an inbox/decision path, if so. */
	unsupportedRoute: string | null;
	orderedCandidates: readonly EscalationCandidateFact[];
}): AutomaticEscalationDecision {
	if (input.evidence.kind === "ambiguous") {
		return {
			kind: "hold",
			reason: "ambiguous_history",
			evidence: { cause: input.evidence.cause, ...input.evidence.evidence },
		};
	}
	const deadline = evaluateEscalationDeadline({
		actionableAt: input.evidence.actionableAt,
		policy: input.policy,
		now: input.now,
	});
	if (deadline.kind !== "due") return { kind: "not_due", deadline };
	const timing: JsonObject = {
		actionableAt: input.evidence.actionableAt.toString(),
		actionableEvidence: input.evidence.actionableEvidence,
		deadline: deadline.deadline.toString(),
		policyRevision: deadline.policyRevision,
	};
	if (input.evidence.automaticTransferConsumed) {
		return { kind: "hold", reason: "replacement_overdue", evidence: timing };
	}
	if (input.unsupportedRoute) {
		return {
			kind: "hold",
			reason: "unsupported_route",
			evidence: { ...timing, route: input.unsupportedRoute },
		};
	}
	const recipient = input.orderedCandidates[0];
	if (!recipient) {
		return { kind: "hold", reason: "no_eligible_backup", evidence: timing };
	}
	return {
		kind: "transfer",
		recipientEmployeeId: recipient.employeeId,
		deadlineAt: deadline.deadline,
		policyRevision: deadline.policyRevision,
	};
}

/**
 * Stable automatic identity: organization (through the journal's scoped
 * unique index) plus the original source assignment in its stage/lineage.
 * Never wall-clock invocation time or the newly selected replacement.
 */
export function automaticEscalationOperationKey(input: {
	workflowId: string;
	stageId: string;
	lineageRootAssignmentId: string;
	sourceAssignmentId: string;
}): string {
	return [
		"escalation",
		"auto",
		"v1",
		input.workflowId,
		input.stageId,
		input.lineageRootAssignmentId,
		input.sourceAssignmentId,
	].join(":");
}

export function humanEscalationOperationKey(input: {
	actorUserId: string;
	idempotencyKey: string;
}): string {
	return ["escalation", "human", "v1", input.actorUserId, input.idempotencyKey].join(":");
}

/** Identifies the requested operation behind an idempotency key. */
export function escalationRequestFingerprint(input: {
	initiator: ApprovalEscalationTransferInitiator;
	actorUserId: string | null;
	sourceAssignmentId: string;
	requestedRecipientEmployeeId: string | null;
	reason: string | null;
}): string {
	return `v1:${createHash("sha256")
		.update(
			JSON.stringify([
				input.initiator,
				input.actorUserId,
				input.sourceAssignmentId,
				input.requestedRecipientEmployeeId,
				input.reason,
			]),
		)
		.digest("hex")}`;
}
