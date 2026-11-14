import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { monthClosedError } from "@/lib/time-tracking/closed-months/refusal";
import { monthClosedMessage } from "@/lib/time-tracking/closed-months/refusal-message";
import type { DecisionRight } from "../decision-right";
import { FOUR_EYES_REFUSAL } from "../deputy/deputy-decision";
import type { ApprovalActionOptions } from "../domain/types";
import {
	ApprovalAssignmentReassignedError,
	approvalReassignedConflict,
} from "../escalation/decision-authority";
import { WORK_PERIOD_EVIDENCE_MESSAGES } from "../evidence/work-period-evidence";
import type {
	TimeApprovalDecisionRefusal,
	TimeApprovalDecisionRefusalReason,
} from "../server/time-approval-decision";
import type { PersistedApprovalRequestForDecision } from "./decision-service";
import type { ApprovalInboxDecisionFailure, ApprovalInboxDecisionSuccess } from "./types";

export type InboxTimeApprovalDecision =
	| { status: "decided"; success: ApprovalInboxDecisionSuccess }
	/** A single decision throws `inboxErrorOfTimeRefusal(refusal)` to its route. */
	| {
			status: "refused";
			failure: ApprovalInboxDecisionFailure;
			refusal: Omit<TimeApprovalDecisionRefusal, "status">;
	  };

/**
 * Decides one time approval from the inbox through the time approval decision
 * (#1673): claims one right from the visibility inputs and maps a refusal to
 * the inbox's failure by its reason and typed detail. Infrastructure failures
 * throw.
 */
export async function decideInboxTimeApproval(input: {
	request: PersistedApprovalRequestForDecision;
	actorEmployeeId: string;
	decision: { kind: "approve" } | { kind: "reject"; reason: string };
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
	coveredApproverIds?: string[];
	fastLaneGuard?: ApprovalActionOptions["shortcutGuard"];
}): Promise<InboxTimeApprovalDecision> {
	const { request } = input;
	const right = inboxDecisionRight(input);
	const actor = right
		? await db.query.employee.findFirst({
				where: and(
					eq(employee.id, input.actorEmployeeId),
					eq(employee.organizationId, request.organizationId),
				),
				columns: { userId: true },
			})
		: undefined;
	if (!right || !actor) {
		const refusal = { reason: "not_found" } as const;
		return {
			status: "refused",
			failure: await inboxFailureOfTimeRefusal(request.id, refusal),
			refusal,
		};
	}
	const { decideTimeApproval } = await import("../server/time-approval-decision");
	const result = await decideTimeApproval({
		organizationId: request.organizationId,
		approvalId: request.id,
		actor: { employeeId: input.actorEmployeeId, userId: actor.userId },
		right,
		decision: input.decision,
		...(input.fastLaneGuard ? { fastLaneGuard: input.fastLaneGuard } : {}),
	});
	if (result.status === "refused") {
		return {
			status: "refused",
			failure: await inboxFailureOfTimeRefusal(request.id, result),
			refusal: result,
		};
	}
	return {
		status: "decided",
		success: {
			id: request.id,
			type: "time_entry",
			status: input.decision.kind === "approve" ? "approved" : "rejected",
		},
	};
}

const STALE = "This request changed or was already decided. Refresh and review it again.";
const FORBIDDEN = "You are not authorized to decide this request";
const FAST_LANE_CHANGED =
	"This fast-lane assessment changed. Refresh or open the request for manual review.";

/** Each refusal of the time approval decision as one inbox failure. */
const TIME_REFUSAL_FAILURES: Record<
	TimeApprovalDecisionRefusalReason,
	Omit<ApprovalInboxDecisionFailure, "id">
> = {
	not_found: { code: "not_found", message: "Approval not found" },
	already_decided: { code: "stale", message: "This request was already decided" },
	right_not_held: { code: "forbidden", message: FORBIDDEN },
	reassigned: {
		code: "stale",
		message: "This approval was reassigned. Refresh to see who decides it now.",
	},
	own_request: { code: "forbidden", message: "You cannot decide your own request" },
	changed: { code: "stale", message: STALE },
	evidence_required: {
		code: "stale",
		message: "This request needs its review evidence before it can be decided. Open it to review.",
	},
	month_closed: { code: "validation_failed", message: "This month is closed" },
	unclassified: {
		code: "validation_failed",
		message:
			"This legacy time approval could not be classified. Reconcile it before making a decision.",
	},
	guard_failed: { code: "stale", message: FAST_LANE_CHANGED },
	// Card refusals; the inbox never sends a card, so they only mean the request moved on.
	binding_mismatch: { code: "stale", message: STALE },
	not_admitted: { code: "stale", message: STALE },
	invocation_conflict: { code: "stale", message: STALE },
};

type Refusal = Omit<TimeApprovalDecisionRefusal, "status">;

/**
 * The inbox failure of a time approval refusal, by its reason; its typed
 * detail words the closed month and a deputy's four-eyes refusal.
 */
export async function inboxFailureOfTimeRefusal(
	id: string,
	refusal: Refusal,
): Promise<ApprovalInboxDecisionFailure> {
	const failure = { id, ...TIME_REFUSAL_FAILURES[refusal.reason] };
	switch (refusal.detail?.kind) {
		case "month_closed":
			return { ...failure, message: await monthClosedMessage(refusal.detail.month) };
		case "deputy_four_eyes":
			return { ...failure, message: FOUR_EYES_REFUSAL };
		default:
			return failure;
	}
}

/**
 * The error a single decision's route translates by its class, built from the
 * refusal's reason and typed detail, so the route keeps its 409 details
 * (overlaps, evidence code, reassignment).
 */
export function inboxErrorOfTimeRefusal(refusal: Refusal): AnyAppError {
	const { detail } = refusal;
	switch (refusal.reason) {
		case "not_found":
			return new NotFoundError({ message: "Approval not found", entityType: "approval_request" });
		case "already_decided":
			return new ConflictError({
				message: TIME_REFUSAL_FAILURES.already_decided.message,
				conflictType: "approval_status",
			});
		case "right_not_held":
			return new AuthorizationError({
				message: detail?.kind === "deputy_four_eyes" ? FOUR_EYES_REFUSAL : FORBIDDEN,
				resource: "Approval",
				action: "decide",
			});
		case "own_request":
			return new AuthorizationError({
				message: TIME_REFUSAL_FAILURES.own_request.message,
				resource: "Approval",
				action: "decide",
			});
		case "reassigned":
			return approvalReassignedConflict(new ApprovalAssignmentReassignedError());
		case "month_closed":
			return detail?.kind === "month_closed"
				? monthClosedError(detail.month)
				: new ValidationError({ message: TIME_REFUSAL_FAILURES.month_closed.message });
		case "unclassified":
			return new ValidationError({
				message: TIME_REFUSAL_FAILURES.unclassified.message,
				field: "approvalRequest.metadata.timeRequest.kind",
			});
		case "guard_failed":
			return new ConflictError({ message: FAST_LANE_CHANGED, conflictType: "approval_triage" });
		case "evidence_required":
			return changedConflict(
				detail?.kind === "evidence" ? detail : { kind: "evidence", code: "evidence_required" },
			);
		case "changed":
			return changedConflict(detail);
		case "binding_mismatch":
		case "not_admitted":
		case "invocation_conflict":
			return new ConflictError({ message: STALE, conflictType: "approval_transition" });
	}
}

function changedConflict(detail: Refusal["detail"]): ConflictError {
	switch (detail?.kind) {
		case "evidence":
			return new ConflictError({
				message: WORK_PERIOD_EVIDENCE_MESSAGES[detail.code],
				conflictType: "approval_evidence",
				details: { code: detail.code },
			});
		case "work_overlap":
			return new ConflictError({
				message: "The time range overlaps other recorded work",
				conflictType: "work_interval_occupied",
				details: { overlaps: detail.overlaps },
			});
		case "work_collision":
			return new ConflictError({
				message:
					"This change conflicts with an earlier request or changed work. Please refresh and try again.",
				conflictType: "completed_work_collision",
			});
		case "work_review_required":
			return new ConflictError({
				message: "This work needs review before it can be changed",
				conflictType: "completed_work_review_required",
			});
		default:
			return new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
			});
	}
}

type EligibleApprovalScope = {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
};

/**
 * The one decision right the inbox claims for a time approval, from the
 * visibility inputs it already has. Own rights win: approver; else manager of
 * approvals; else eligible manager; else covering deputy for the request's
 * approver. The decision verifies the right again in its transaction.
 *
 * Temporary: resolving the right once per actor in the inbox replaces it.
 */
export function inboxDecisionRight(input: {
	request: { approverId: string; requesterEmployeeId: string };
	actorEmployeeId: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
	coveredApproverIds?: string[];
}): DecisionRight | null {
	const { request, actorEmployeeId } = input;
	if (request.approverId === actorEmployeeId) return { as: "approver" };
	if (input.includeAllApprovers === true) return { as: "approval_manager" };
	const eligible = input.eligibleApprovalScopes?.some(
		(scope) =>
			scope.requesterEmployeeId === request.requesterEmployeeId &&
			scope.eligibleApproverIds.includes(actorEmployeeId) &&
			scope.eligibleApproverIds.includes(request.approverId),
	);
	if (eligible) return { as: "eligible_manager" };
	if (input.coveredApproverIds?.includes(request.approverId)) {
		return { as: "covering_deputy", forEmployeeId: request.approverId };
	}
	return null;
}
