/**
 * Deputy decisions (#1016, spec #802, Approvals ADR 0002): may actor Y decide
 * an assignment of approver X as X's covering deputy? This is the one rule the
 * inbox listing, detail, decision service and every legacy and canonical
 * decision re-check share. Pure: covering itself comes from
 * `covering-store.ts`, judged at decision time inside the decision's
 * transaction.
 *
 * Order of checks at every seam:
 * 1. The self-decision refusal (#697) runs first and wins.
 * 2. Own rights win (orchestrator default 8): the approver, an eligible
 *    manager or a holder of `manage Approval` decides as themselves, with no
 *    "acting for" and no four-eyes check from this path.
 * 3. Only then this rule: Y covers for the assignment's *current* approver.
 *    An escalation transfer moves the assignment to someone else, so Y loses
 *    it by itself; a request transferred *to* X is X's and covered (default 9).
 * 4. Four-eyes: Y never makes a deputy decision on a request where Y already
 *    decided an earlier stage.
 */

import { AuthorizationError } from "@/lib/effect/errors";
import type { ApprovalWorkflowSnapshot } from "../workflow/ports";

/**
 * Who a deputy decision was made for, and why: the absent approver X and the
 * absence that made Y X's deputy. Stored with every deputy decision (the
 * acting-for record, canonical event metadata, evidence and audit).
 */
export interface ActingFor {
	/** The absent approver X (employee id). */
	approverEmployeeId: string;
	/** X's absence naming Y as deputy that made the cover. */
	absenceId: string;
}

export type DeputyDecisionEntityType = "absence_entry" | "time_entry" | "travel_expense_report";

/**
 * The approval kinds a covering deputy may list and decide (spec #802):
 * absences, time approvals (corrections, manual submissions, policy
 * clock-outs) and travel expense reports. Never expense claims.
 */
export const DEPUTY_DECISION_ENTITY_TYPES: readonly DeputyDecisionEntityType[] = [
	"absence_entry",
	"time_entry",
	"travel_expense_report",
];

export function isDeputyDecisionEntityType(value: string): value is DeputyDecisionEntityType {
	return (DEPUTY_DECISION_ENTITY_TYPES as readonly string[]).includes(value);
}

export type DeputyDecisionRefusalReason = "not_covering" | "four_eyes";

export type DeputyDecisionRight =
	| { kind: "deputy"; actingFor: ActingFor }
	| { kind: "refused"; reason: DeputyDecisionRefusalReason };

export function decideDeputyRight(input: {
	actorEmployeeId: string;
	/** The assignment's current approver. */
	approverEmployeeId: string;
	/** The actor's cover for that approver at decision time, if any. */
	cover: { approverId: string; absenceId: string } | null;
	/** The actor already decided an earlier stage of the same request. */
	actorDecidedEarlierStage: boolean;
}): DeputyDecisionRight {
	if (
		!input.cover ||
		input.cover.approverId !== input.approverEmployeeId ||
		input.actorEmployeeId === input.approverEmployeeId
	) {
		return { kind: "refused", reason: "not_covering" };
	}
	if (input.actorDecidedEarlierStage) return { kind: "refused", reason: "four_eyes" };
	return {
		kind: "deputy",
		actingFor: { approverEmployeeId: input.approverEmployeeId, absenceId: input.cover.absenceId },
	};
}

const FOUR_EYES_REFUSAL =
	"You already decided an earlier stage of this request, so you cannot decide it as a deputy";
const NOT_AUTHORIZED = "You are not authorized to decide this request";

/** Whether a failure message is a deputy refusal that is safe to show as is. */
export function isDeputyDecisionRefusal(message: string): boolean {
	return message === FOUR_EYES_REFUSAL;
}

export function deputyDecisionRefusalError(
	reason: DeputyDecisionRefusalReason,
	input: { actorEmployeeId: string; resource: string; action: string },
): AuthorizationError {
	return new AuthorizationError({
		message: reason === "four_eyes" ? FOUR_EYES_REFUSAL : NOT_AUTHORIZED,
		userId: input.actorEmployeeId,
		resource: input.resource,
		action: input.action,
	});
}

/**
 * Whether the actor approved or rejected an earlier stage (lower sequence) of
 * this canonical workflow than the stage being decided.
 */
export function decidedEarlierStage(
	workflow: Pick<ApprovalWorkflowSnapshot, "stages">,
	stageId: string,
	actorEmployeeId: string,
): boolean {
	const target = workflow.stages.find((stage) => stage.id === stageId);
	if (!target) return false;
	return workflow.stages.some(
		(stage) =>
			stage.sequence < target.sequence &&
			stage.assignments.some(
				(assignment) =>
					(assignment.status === "approved" || assignment.status === "rejected") &&
					assignment.resolvedBy?.kind === "employee" &&
					assignment.resolvedBy.employeeId === actorEmployeeId,
			),
	);
}

/**
 * A deputy card (#1017) decides through the engine's covering-deputy grant,
 * never through management: true only while the card's bound assignment is
 * the command's and still pending with the absent approver the card acts for.
 * Anything else is refused by the bound decision owners as not current.
 */
export function isDeputyCardAssignmentPending(
	binding: { actingForEmployeeId?: string | null; assignmentId: string },
	workflow: Pick<ApprovalWorkflowSnapshot, "stages">,
	command: { type: string; stageId?: string; assignmentId?: string },
): boolean {
	if (!binding.actingForEmployeeId || command.assignmentId !== binding.assignmentId) return false;
	return workflow.stages.some(
		(stage) =>
			stage.status === "pending" &&
			stage.assignments.some(
				(assignment) =>
					assignment.id === binding.assignmentId &&
					assignment.status === "pending" &&
					assignment.approverEmployeeId === binding.actingForEmployeeId,
			),
	);
}

/**
 * The English decider label for requester-facing text that has no
 * translation yet (notification messages, email props): "Y (deputy for X)".
 */
export function deputyActorLabel(actorName: string, actingForName: string | null | undefined) {
	return actingForName ? `${actorName} (deputy for ${actingForName})` : actorName;
}
