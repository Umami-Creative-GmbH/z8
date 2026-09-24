import type { Instant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalCommandResult,
	ApprovalEventActorIdentity,
	ApprovalWorkflowStatus,
} from "../workflow/ports";
import type { ApprovalWorkflowCommand } from "../workflow/state-machine";
import { ApprovalEvidenceError } from "./errors";

export interface CommandDecisionOutcome {
	stageId: string;
	assignmentId: string;
	/** This approver's own outcome. */
	assignmentOutcome: "approved" | "rejected";
	/** The whole request as of this operation; an approval can leave it pending. */
	requestOutcome: ApprovalWorkflowStatus;
	actor: Extract<ApprovalEventActorIdentity, { kind: "employee" }>;
	/** Persisted assignment resolution time, never render or retry time. */
	decidedAt: Instant;
	eventIds: string[];
}

/**
 * Reads the committed outcome of one approve/reject command from the exact
 * persisted transition result. It does not infer success from the requested
 * action: the assignment and request statuses come from the resulting graph.
 */
export function deriveCommandDecisionOutcome(input: {
	command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
	result: ApprovalCommandResult;
}): CommandDecisionOutcome {
	const expected = input.command.type === "approve" ? "approved" : "rejected";
	const assignments = input.result.snapshot.stages.flatMap((stage) =>
		stage.id === input.command.stageId
			? stage.assignments.filter(
					(assignment) => assignment.id === input.command.assignmentId,
				)
			: [],
	);
	const assignment = assignments[0];
	if (
		assignments.length !== 1 ||
		!assignment ||
		assignment.status !== expected ||
		!assignment.resolvedAt
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "assignment_outcome",
		});
	}
	const eventType = `assignment.${expected}` as const;
	const referenced = input.result.events.filter(
		(event) =>
			event.eventType === eventType &&
			event.references?.assignmentId === assignment.id,
	);
	const candidates =
		referenced.length > 0
			? referenced
			: input.result.events.filter((event) => event.eventType === eventType);
	const event = candidates[0];
	if (candidates.length !== 1 || !event || event.actor.kind !== "employee") {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "decision_event",
		});
	}
	return {
		stageId: input.command.stageId,
		assignmentId: assignment.id,
		assignmentOutcome: expected,
		requestOutcome: input.result.snapshot.status,
		actor: event.actor,
		decidedAt: assignment.resolvedAt,
		eventIds: input.result.events.map((candidate) => candidate.id),
	};
}
