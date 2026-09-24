import type {
	ApprovalEscalationAttentionAttempt,
	ApprovalEscalationAttentionReason,
	ApprovalEscalationChannel,
} from "@/db/schema";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";

export const ESCALATION_ATTENTION_REASONS: readonly ApprovalEscalationAttentionReason[] =
	[
		"no_eligible_backup",
		"replacement_overdue",
		"unsupported_route",
		"ambiguous_history",
		"delivery_exhausted",
		"delivery_unavailable",
	];

/**
 * The assignment an incident concerns. Canonical approvals name their
 * workflow assignment; legacy-authoritative approvals have no assignment row,
 * so the approval request plus current approver stands in for it.
 */
export type EscalationAttentionSubject =
	| { kind: "assignment"; assignmentId: string }
	| {
			kind: "legacy_assignment";
			approvalRequestId: string;
			approverEmployeeId: string;
	  };

export interface EscalationAttentionInput {
	organizationId: string;
	reason: ApprovalEscalationAttentionReason;
	subject: EscalationAttentionSubject;
	/** Required for `ambiguous_history`, whose incident spans the whole lineage. */
	lineageRootAssignmentId?: string;
	/** Required for `delivery_exhausted`, which is tracked per intended channel. */
	deliveryChannel?: ApprovalEscalationChannel;
	approvalType?: string;
	approvalRequestId?: string;
	workflowId?: string;
	currentApproverEmployeeId?: string;
	policyRevision?: number;
	evidence: Record<string, unknown>;
	attempts?: ApprovalEscalationAttentionAttempt[];
}

function subjectKey(subject: EscalationAttentionSubject): string {
	return subject.kind === "assignment"
		? `assignment:${subject.assignmentId}`
		: `approval:${subject.approvalRequestId}:approver:${subject.approverEmployeeId}`;
}

/**
 * Deterministic incident identity. Repeated observations of the same
 * unresolved condition deduplicate onto one open incident; alert delivery
 * plays no part in identity.
 */
export function escalationAttentionDedupeKey(
	input: EscalationAttentionInput,
): string {
	switch (input.reason) {
		case "ambiguous_history":
			return input.lineageRootAssignmentId
				? `${input.reason}:lineage:${input.lineageRootAssignmentId}`
				: `${input.reason}:${subjectKey(input.subject)}`;
		case "delivery_exhausted":
			if (!input.deliveryChannel) {
				throw new Error(
					"delivery_exhausted attention requires a delivery channel",
				);
			}
			return `${input.reason}:${subjectKey(input.subject)}:channel:${input.deliveryChannel}`;
		default:
			return `${input.reason}:${subjectKey(input.subject)}`;
	}
}

export function escalationAttentionAssignmentId(
	input: EscalationAttentionInput,
): string | null {
	return input.subject.kind === "assignment"
		? input.subject.assignmentId
		: null;
}

export function escalationAttentionApprovalRequestId(
	input: EscalationAttentionInput,
): string | null {
	if (input.approvalRequestId) return input.approvalRequestId;
	return input.subject.kind === "legacy_assignment"
		? input.subject.approvalRequestId
		: null;
}

export function escalationAttentionCurrentApproverId(
	input: EscalationAttentionInput,
): string | null {
	if (input.currentApproverEmployeeId) return input.currentApproverEmployeeId;
	return input.subject.kind === "legacy_assignment"
		? input.subject.approverEmployeeId
		: null;
}

const INBOX_TYPE_BY_APPROVAL_TYPE: Readonly<Record<string, ApprovalInboxType>> =
	{
		absence: "absence_entry",
		absence_entry: "absence_entry",
		time_correction: "time_entry",
		manual_time_submission: "time_entry",
		policy_clock_out: "time_entry",
		time_entry: "time_entry",
		travel_expense: "travel_expense_claim",
		travel_expense_claim: "travel_expense_claim",
	};

/** Web inbox link for the approval an incident concerns. */
export function escalationAttentionApprovalHref(
	approvalType: string | null,
): string {
	const inboxType = approvalType
		? INBOX_TYPE_BY_APPROVAL_TYPE[approvalType]
		: undefined;
	return inboxType ? `/approvals/inbox?types=${inboxType}` : "/approvals/inbox";
}

export interface EscalationAttentionRecheckIncident {
	reason: ApprovalEscalationAttentionReason;
	assignmentId: string | null;
	currentApproverEmployeeId: string | null;
}

/**
 * Current authoritative state of an incident's subject. `undefined` means the
 * incident does not reference that record; `null` means it could not be found.
 */
export interface EscalationAttentionSubjectState {
	workflowStatus?: string | null;
	approvalStatus?: string | null;
	approvalApproverEmployeeId?: string | null;
	assignmentStatus?: string | null;
}

export type EscalationAttentionRecheckResult =
	| { kind: "persisting" }
	| {
			kind: "recovered";
			cause:
				| "approval_no_longer_pending"
				| "assignment_no_longer_pending"
				| "assignment_moved";
	  };

const isSettled = (status: string | null | undefined) =>
	typeof status === "string" && status !== "pending";

/**
 * Generic recovery check shared by every reason: an incident is resolved once
 * the approval is no longer pending, or (except for lineage-wide history
 * ambiguity) once the specific assignment it concerns is no longer current.
 * Missing records are not evidence of recovery. Reason-specific recovery, such
 * as a backup becoming eligible, belongs to the escalation processors that
 * raise the incident. Alert delivery never counts as recovery.
 */
export function classifyEscalationAttentionRecheck(
	incident: EscalationAttentionRecheckIncident,
	state: EscalationAttentionSubjectState,
): EscalationAttentionRecheckResult {
	if (isSettled(state.workflowStatus) || isSettled(state.approvalStatus)) {
		return { kind: "recovered", cause: "approval_no_longer_pending" };
	}
	if (incident.reason === "ambiguous_history") return { kind: "persisting" };
	if (isSettled(state.assignmentStatus)) {
		return { kind: "recovered", cause: "assignment_no_longer_pending" };
	}
	if (
		!incident.assignmentId &&
		incident.currentApproverEmployeeId &&
		state.approvalApproverEmployeeId &&
		state.approvalApproverEmployeeId !== incident.currentApproverEmployeeId
	) {
		return { kind: "recovered", cause: "assignment_moved" };
	}
	return { kind: "persisting" };
}
