export const APPROVAL_WORKFLOW_TYPES = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"policy_clock_out",
	"travel_expense",
	"shift_request",
	"compliance_exception",
] as const;

export type ApprovalWorkflowType = (typeof APPROVAL_WORKFLOW_TYPES)[number];

export const APPROVAL_WORKFLOW_STATUSES = [
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
] as const;

export type ApprovalWorkflowStatus =
	(typeof APPROVAL_WORKFLOW_STATUSES)[number];

export const APPROVAL_STAGE_STATUSES = [
	"waiting",
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
] as const;

export type ApprovalStageStatus = (typeof APPROVAL_STAGE_STATUSES)[number];

export const APPROVAL_ASSIGNMENT_STATUSES = [
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
] as const;

export type ApprovalAssignmentStatus =
	(typeof APPROVAL_ASSIGNMENT_STATUSES)[number];

export const APPROVAL_ACTOR_KINDS = [
	"employee",
	"system",
	"legacy_unknown",
] as const;

export type ApprovalActorKind = (typeof APPROVAL_ACTOR_KINDS)[number];

export const APPROVAL_WORKFLOW_EVENT_TYPES = [
	"assignment.approved",
	"assignment.rejected",
	"assignment.cancelled",
	"assignment.expired",
	"assignment.reassigned",
	"assignment.escalated",
	"assignment.created",
	"stage.approved",
	"stage.rejected",
	"stage.cancelled",
	"stage.expired",
	"stage.activated",
	"stage.auto_approved",
	"workflow.activation_requested",
	"workflow.approved",
	"workflow.rejected",
	"workflow.cancelled",
	"workflow.expired",
] as const;

export type ApprovalWorkflowEventType =
	(typeof APPROVAL_WORKFLOW_EVENT_TYPES)[number];

export const APPROVAL_COMMAND_STATES = ["reserved", "completed"] as const;

export type ApprovalCommandState = (typeof APPROVAL_COMMAND_STATES)[number];

export const APPROVAL_OUTBOX_DISPOSITIONS = ["observe", "deliver"] as const;

export type ApprovalOutboxDisposition =
	(typeof APPROVAL_OUTBOX_DISPOSITIONS)[number];

export const APPROVAL_OUTBOX_STATUSES = [
	"pending",
	"processing",
	"delivered",
	"failed",
	"suppressed",
] as const;

export type ApprovalOutboxStatus = (typeof APPROVAL_OUTBOX_STATUSES)[number];

export const APPROVAL_OUTBOX_EXPANSION_STATUSES = [
	"pending",
	"expanded",
] as const;

export type ApprovalOutboxExpansionStatus =
	(typeof APPROVAL_OUTBOX_EXPANSION_STATUSES)[number];

export const APPROVAL_OUTBOX_CHANNELS = [
	"in_app",
	"push",
	"email",
	"webhook",
	"teams",
	"telegram",
	"discord",
	"slack",
] as const;

export type ApprovalOutboxChannel = (typeof APPROVAL_OUTBOX_CHANNELS)[number];
