import type {
	ApprovalAssignmentSnapshot,
	ApprovalStageSnapshot,
	ApprovalWorkflowSnapshot,
} from "../workflow/ports";

/**
 * A decision attempted through an assignment that escalation replaced. The
 * former holder lost authority through it; the response explains that the
 * approval moved instead of silently invoking any management override.
 */
export class ApprovalAssignmentReassignedError extends Error {
	readonly code = "assignment_reassigned";

	constructor() {
		super("This approval was reassigned to another approver");
		this.name = "ApprovalAssignmentReassignedError";
	}
}

function isEscalationReplacement(assignment: ApprovalAssignmentSnapshot) {
	return (
		assignment.reassignedFromAssignmentId !== null &&
		assignment.reassignmentMetadata?.kind === "escalation"
	);
}

/** Whether an escalation replaced any assignment on this assignment's lineage. */
export function lineageContainsEscalation(
	stage: ApprovalStageSnapshot,
	assignmentId: string,
): boolean {
	const byId = new Map(stage.assignments.map((assignment) => [assignment.id, assignment]));
	const visited = new Set<string>();
	let current = byId.get(assignmentId);
	while (current && !visited.has(current.id)) {
		if (isEscalationReplacement(current)) return true;
		visited.add(current.id);
		current = current.reassignedFromAssignmentId
			? byId.get(current.reassignedFromAssignmentId)
			: undefined;
	}
	return false;
}

/** The employee held an assignment in this stage that escalation replaced. */
export function wasReplacedByEscalation(stage: ApprovalStageSnapshot, employeeId: string): boolean {
	return stage.assignments.some(
		(held) =>
			held.approverEmployeeId === employeeId &&
			held.status === "cancelled" &&
			stage.assignments.some(
				(replacement) =>
					replacement.reassignedFromAssignmentId === held.id &&
					isEscalationReplacement(replacement),
			),
	);
}

function notUnique(): never {
	throw new Error("Canonical absence decision target is not unique");
}

/**
 * Resolves the canonical assignment a web decision addresses. A legacy
 * request ID names a stage, whose history can hold replaced assignments;
 * cancelled history is never a target. Single-assignment stages resolve
 * exactly as before, so historical receipts keep their command fingerprints.
 */
export function selectCanonicalDecisionTarget(input: {
	workflow: ApprovalWorkflowSnapshot;
	approvalRequestId: string;
	actorEmployeeId: string;
}): { stage: ApprovalStageSnapshot; assignment: ApprovalAssignmentSnapshot } {
	const exact = input.workflow.stages.flatMap((stage) =>
		stage.assignments
			.filter((assignment) => assignment.id === input.approvalRequestId)
			.map((assignment) => ({ stage, assignment })),
	);
	const stages = input.workflow.stages.filter(
		(stage) => stage.legacyApprovalRequestId === input.approvalRequestId,
	);
	if (exact.length + stages.length !== 1) notUnique();
	const addressed = exact[0];
	if (addressed) return addressed;

	const stage = stages[0];
	if (!stage) return notUnique();
	const only = stage.assignments.length === 1 ? stage.assignments[0] : null;
	if (only) return { stage, assignment: only };

	const pending = stage.assignments.filter((assignment) => assignment.status === "pending");
	const own = pending.filter(
		(assignment) => assignment.approverEmployeeId === input.actorEmployeeId,
	);
	if (own.length === 1 && own[0]) return { stage, assignment: own[0] };
	if (pending.length === 0) {
		// Exact retries of a committed decision address the deciding assignment.
		const decided = stage.assignments.filter(
			(assignment) => assignment.status === "approved" || assignment.status === "rejected",
		);
		if (decided.length === 1 && decided[0]) {
			return { stage, assignment: decided[0] };
		}
		return notUnique();
	}
	if (wasReplacedByEscalation(stage, input.actorEmployeeId)) {
		throw new ApprovalAssignmentReassignedError();
	}
	if (pending.length === 1 && pending[0]) {
		return { stage, assignment: pending[0] };
	}
	return notUnique();
}
