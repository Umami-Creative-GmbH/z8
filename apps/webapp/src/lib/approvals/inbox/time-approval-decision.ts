import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { monthClosedMessage } from "@/lib/time-tracking/closed-months/refusal-message";
import type { DecisionRight } from "../decision-right";
import type { ApprovalActionOptions } from "../domain/types";
import type { TimeApprovalDecisionRefusalReason } from "../server/time-approval-decision";
import type { PersistedApprovalRequestForDecision } from "./decision-service";
import type { ApprovalInboxDecisionFailure, ApprovalInboxDecisionSuccess } from "./types";

export type InboxTimeApprovalDecision =
	| { status: "decided"; success: ApprovalInboxDecisionSuccess }
	/** `cause` is the refusal's original error; a single decision throws it to its route. */
	| { status: "refused"; failure: ApprovalInboxDecisionFailure; cause: unknown };

/**
 * Decides one time approval from the inbox through the time approval decision
 * (#1673): claims one right from the visibility inputs and maps a refusal to
 * the inbox's failure by its reason. Infrastructure failures throw.
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
		return {
			status: "refused",
			failure: await inboxFailureOfTimeRefusal(request.id, "not_found", undefined),
			cause: new NotFoundError({
				message: "Approval not found",
				entityType: "approval_request",
				entityId: request.id,
			}),
		};
	}
	const { decideTimeApprovalWithCause } = await import("../server/time-approval-decision");
	const { result, cause } = await decideTimeApprovalWithCause({
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
			failure: await inboxFailureOfTimeRefusal(request.id, result.reason, cause),
			cause,
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
	guard_failed: {
		code: "stale",
		message: "This fast-lane assessment changed. Refresh or open the request for manual review.",
	},
	// Card refusals; the inbox never sends a card, so they only mean the request moved on.
	binding_mismatch: { code: "stale", message: STALE },
	not_admitted: { code: "stale", message: STALE },
	invocation_conflict: { code: "stale", message: STALE },
};

/**
 * The error a single decision's route translates by its class: the refusal's
 * original error, translated as the time correction wrapper translated it, so
 * the route keeps its 409 details (overlaps, evidence code, reassignment).
 */
export async function inboxErrorOfTimeRefusal(cause: unknown): Promise<unknown> {
	const [
		{ translateTimeCorrectionDecisionError },
		{ translateWorkPeriodEvidenceError },
		{ translateCorrectionWorkError },
	] = await Promise.all([
		import("../server/time-correction-approvals"),
		import("../evidence/work-period-evidence"),
		import("@/lib/time-tracking/correction-lifecycle-work"),
	]);
	return translateCorrectionWorkError(
		translateWorkPeriodEvidenceError(translateTimeCorrectionDecisionError(cause)),
	);
}

/**
 * The inbox failure of a time approval refusal. The cause is read only for
 * the closed month's name, from the typed refusal.
 */
export async function inboxFailureOfTimeRefusal(
	id: string,
	reason: TimeApprovalDecisionRefusalReason,
	cause: unknown,
): Promise<ApprovalInboxDecisionFailure> {
	const failure = { id, ...TIME_REFUSAL_FAILURES[reason] };
	const closed = reason === "month_closed" ? monthClosedRefusalOf(cause) : null;
	return closed ? { ...failure, message: await monthClosedMessage(closed.month) } : failure;
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
