import { and, eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { approvalWorkflow, employee } from "@/db/schema";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	ApprovalInvocationNotAdmittedError,
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
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import { type BoundTimeInvocation, boundTimeInvocationCommand } from "./bound-time-invocation";
import {
	type CardDecisionRight,
	decideTimeApproval,
	type TimeApprovalDecisionReceipt,
	type TimeApprovalDecisionRefusal,
} from "./time-approval-decision";
import type { ApprovalAction, ApprovalDatabase, CurrentApprover } from "./types";

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
 * The exact committed decision of this invocation, read before any current
 * state; null when it never committed. A card's own failure is classified.
 */
async function replayOf(
	input: BoundTimeDecisionInput,
): Promise<
	| { status: "decided"; replayed: true; evidence: TimeApprovalDecisionReceipt }
	| BoundTimeRefusal
	| null
> {
	const bound: BoundTimeInvocation = {
		reviewedBindingId: input.bindingId,
		invocation: input.invocation,
	};
	try {
		const committed = await findCommittedInvocationDecision(input.database, {
			identity: input.invocation.identity,
			command: boundTimeInvocationCommand({
				bound,
				actorEmployeeId: input.actorEmployeeId,
				actorUserId: input.actorUserId,
				action: input.action,
				reason: input.reason ?? null,
			}),
		});
		return committed ? { status: "decided", replayed: true, evidence: committed } : null;
	} catch (error) {
		return cardRefusalOfError(error);
	}
}

/**
 * The card press, decided by the time approval decision under the
 * recipient's own right: as approver, or for a deputy card as covering deputy
 * for the absent approver it names. The binding's exact approval is decided.
 */
async function pressCard(
	input: BoundTimeDecisionInput,
	binding: { approvalId: string; actingForEmployeeId?: string },
) {
	const right: CardDecisionRight = binding.actingForEmployeeId
		? { as: "covering_deputy", forEmployeeId: binding.actingForEmployeeId }
		: { as: "approver" };
	return decideTimeApproval({
		database: input.database,
		organizationId: input.organizationId,
		approvalId: binding.approvalId,
		actor: { employeeId: input.actorEmployeeId, userId: input.actorUserId },
		right,
		decision:
			input.action === "approve"
				? { kind: "approve" }
				: { kind: "reject", reason: input.reason ?? "" },
		card: { reviewedBindingId: input.bindingId, invocation: input.invocation },
	});
}

/**
 * A reviewed-binding decision on a canonical manual time submission, policy
 * clock-out or time correction from an authenticated bot invocation (#325).
 * An exact committed invocation replays first, before any current state is
 * read. Otherwise the time approval decision decides the exact bound
 * assignment under the invocation's own receipt and the recipient's own right
 * (#1681): a card never reaches eligible-manager or management rights.
 * Infrastructure errors propagate.
 */
export async function decideBoundTimeInvocation(
	input: BoundTimeDecisionInput,
): Promise<BoundTimeInvocationResult> {
	const replay = await replayOf(input);
	if (replay) return canonicalOutcome(replay);
	const [actor, binding] = await Promise.all([
		loadBoundActor(input),
		loadReviewBinding(input.database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
	]);
	if (!actor || !binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
		return { status: "not_found" };
	}
	const [workflow] = await input.database
		.select({
			workflowType: approvalWorkflow.workflowType,
			sourceType: approvalWorkflow.sourceType,
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
	const result = await pressCard(input, {
		approvalId: binding.assignmentId,
		...(binding.actingForEmployeeId ? { actingForEmployeeId: binding.actingForEmployeeId } : {}),
	});
	return canonicalOutcome(
		result.status === "decided"
			? decidedCard(result.replayed, result.receipt)
			: cardRefusal(result),
	);
}

/**
 * A legacy reviewed-binding decision on a legacy-authoritative manual time
 * submission, policy clock-out or time correction from an authenticated bot
 * invocation (#432): the legacy counterpart of `decideBoundTimeInvocation`.
 * An exact committed invocation replays first, before any current state is
 * read. Otherwise the time approval decision decides only the exact bound
 * legacy request, under the recipient's own right; a request escalation
 * transferred (#439) refuses its former holders. The after-commit work is the
 * time approval decision's. Infrastructure errors propagate.
 */
export async function decideBoundLegacyTimeInvocation(
	input: BoundTimeDecisionInput,
): Promise<BoundLegacyTimeInvocationResult> {
	const replay = await replayOf(input);
	if (replay) return legacyOutcome(replay);
	const [actor, binding] = await Promise.all([
		loadBoundActor(input),
		loadLegacyReviewBinding(input.database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
	]);
	if (!actor || !binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
		return { status: "not_found" };
	}
	// The revision survives ordinary cancellation, so it names the work period
	// and the kind even after the pending request is gone.
	const source = await loadLegacySubmittedRevisionSource(input.database, {
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
	const result = await pressCard(input, {
		approvalId: binding.legacyApprovalRequestId,
		...(binding.actingForEmployeeId ? { actingForEmployeeId: binding.actingForEmployeeId } : {}),
	});
	return legacyOutcome(
		result.status === "decided"
			? decidedCard(result.replayed, result.receipt)
			: cardRefusal(result),
	);
}

type ClassifiedBoundTimeResult =
	| { status: "decided"; replayed: boolean; evidence: TimeApprovalDecisionReceipt }
	| BoundTimeRefusal;

function decidedCard(
	replayed: boolean,
	receipt: TimeApprovalDecisionReceipt | undefined,
): ClassifiedBoundTimeResult {
	if (!receipt) throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
	return { status: "decided", replayed, evidence: receipt };
}

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

/** What a card shows for a refused press: nothing was decided. */
function cardRefusal(refusal: TimeApprovalDecisionRefusal): BoundTimeRefusal {
	switch (refusal.reason) {
		case "binding_mismatch":
			return { status: "review_required", reason: "binding" };
		case "not_admitted":
			return { status: "review_required", reason: "not_admitted" };
		case "invocation_conflict":
			return { status: "conflict" };
		case "reassigned":
			// Escalation replaced the card's recipient (#326, #439).
			return { status: "review_required", reason: "reassigned" };
		case "evidence_required":
			return { status: "review_required", reason: "evidence" };
		case "changed":
			// The submitted evidence found the work changed since it was submitted.
			return refusal.detail?.kind === "evidence" && refusal.detail.code === "material_change"
				? { status: "review_required", reason: "material_change" }
				: { status: "review_required", reason: "stale" };
		// Decided elsewhere, removed, no longer the recipient's, or otherwise no
		// longer the reviewed request: a stale card.
		case "not_found":
		case "already_decided":
		case "right_not_held":
		case "own_request":
		case "month_closed":
		case "unclassified":
		case "guard_failed":
			return { status: "review_required", reason: "stale" };
	}
}

/** The exact-replay lookup's own refusals; anything else is a failure. */
function cardRefusalOfError(error: unknown): BoundTimeRefusal {
	if (error instanceof ApprovalInvocationNotAdmittedError) {
		return { status: "review_required", reason: "not_admitted" };
	}
	if (error instanceof ApprovalEvidenceError && error.code === "invocation_mismatch") {
		return { status: "conflict" };
	}
	if (error instanceof ApprovalTransitionEngineError && error.code === "idempotency_mismatch") {
		return { status: "conflict" };
	}
	throw error;
}
