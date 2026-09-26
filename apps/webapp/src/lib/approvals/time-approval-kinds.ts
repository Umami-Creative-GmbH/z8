import type { ApprovalWorkflowType } from "./workflow/ports";

/** Approval workflow kinds whose subject is a work period (#301/#302, #325). */
export const TIME_APPROVAL_WORKFLOW_TYPES = [
	"manual_time_submission",
	"policy_clock_out",
	"time_correction",
] as const satisfies readonly ApprovalWorkflowType[];

export type TimeApprovalWorkflowType = (typeof TIME_APPROVAL_WORKFLOW_TYPES)[number];

export function isTimeApprovalWorkflowType(value: unknown): value is TimeApprovalWorkflowType {
	return TIME_APPROVAL_WORKFLOW_TYPES.includes(value as TimeApprovalWorkflowType);
}
