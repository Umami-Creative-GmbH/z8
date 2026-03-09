export type TimeRecordApprovalStatus = "draft" | "pending" | "approved" | "rejected";

export type TimeRecordApprovalDecision = "submit" | "approve" | "reject";

const APPROVAL_TRANSITIONS: Readonly<
	Record<TimeRecordApprovalStatus, Partial<Record<TimeRecordApprovalDecision, TimeRecordApprovalStatus>>>
> = {
	draft: {
		submit: "pending",
	},
	pending: {
		approve: "approved",
		reject: "rejected",
	},
	approved: {},
	rejected: {},
};

export class ApprovalTransitionError extends Error {
	readonly status: TimeRecordApprovalStatus;
	readonly decision: TimeRecordApprovalDecision;

	constructor(status: TimeRecordApprovalStatus, decision: TimeRecordApprovalDecision) {
		super(`Invalid approval transition: ${status} + ${decision}`);
		this.name = "ApprovalTransitionError";
		this.status = status;
		this.decision = decision;
	}
}

export function applyApprovalDecision(
	status: TimeRecordApprovalStatus,
	decision: TimeRecordApprovalDecision,
): TimeRecordApprovalStatus {
	const nextStatus = APPROVAL_TRANSITIONS[status][decision];

	if (!nextStatus) {
		throw new ApprovalTransitionError(status, decision);
	}

	return nextStatus;
}
