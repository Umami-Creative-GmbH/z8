import { sql } from "drizzle-orm";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type ApprovalAuthorityScope,
	approvalRolloutLockScope,
	isCanonicalOnlyApprovalKind,
} from "../authority";
import type {
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowType,
} from "./ports";

/**
 * Cutover transitions: the forward-only lifecycle edges, their validation and
 * the exclusive rollout lock. What a lifecycle mode means for deciding and
 * mirroring belongs to `approvals/authority/`.
 */

export interface ApprovalCutoverTransitionInput {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	from: ApprovalWorkflowLifecycleMode;
	to: ApprovalWorkflowLifecycleMode;
	actor: ApprovalEventActorIdentity;
	evidence: {
		reason: string;
		recordedAt: Instant;
		reconciliation?: {
			passed: true;
			mismatchCount: 0;
			backfilledThrough: Instant;
			reconciledAt: Instant;
		};
	};
}

const NEXT_MODE: Partial<
	Record<ApprovalWorkflowLifecycleMode, ApprovalWorkflowLifecycleMode>
> = {
	legacy: "shadow",
	shadow: "ready",
	ready: "canonical",
	canonical: "complete",
};

export function validateCutoverTransition(
	input: ApprovalCutoverTransitionInput,
): ApprovalCutoverTransitionInput {
	if (!input.organizationId || !input.actor.kind || !input.evidence.reason) {
		throw new Error(
			"Cutover transition requires organization, actor, and evidence",
		);
	}
	// A canonical-only kind starts and stays in `complete` (Approvals ADR-0002).
	if (isCanonicalOnlyApprovalKind(input.workflowType)) {
		throw new Error(
			`Canonical-only approval kind ${input.workflowType} has no cutover (${input.from} -> ${input.to})`,
		);
	}
	if (NEXT_MODE[input.from] !== input.to) {
		throw new Error(
			`Invalid approval cutover transition ${input.from} -> ${input.to}`,
		);
	}
	if (
		input.to === "canonical" &&
		(!input.evidence.reconciliation?.passed ||
			input.evidence.reconciliation.mismatchCount !== 0)
	) {
		throw new Error(
			"Canonical cutover requires passing reconciliation evidence",
		);
	}
	return input;
}

export async function acquireApprovalCutoverLock(
	dbService: ApprovalDbService,
	input: ApprovalAuthorityScope,
): Promise<void> {
	const scope = approvalRolloutLockScope(
		input.organizationId,
		input.workflowType,
	);
	await dbService.db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
	);
}
