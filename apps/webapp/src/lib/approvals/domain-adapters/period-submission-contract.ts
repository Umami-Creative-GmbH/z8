import type { PeriodSubmissionStatus } from "@/lib/time-tracking/period-submissions/submission-status";

/** Source and workflow kind of period submissions (#1059): one workflow per submission row. */
export const PERIOD_SUBMISSION_WORKFLOW_TYPE = "period_submission" as const;
export const PERIOD_SUBMISSION_SOURCE_TYPE = "period_submission" as const;

/**
 * A period submission as the approval engine loads it, locked in the decision's transaction.
 * Dates are inclusive local dates in `timezone`; the instants are the fixed `[rangeStart,
 * rangeEnd)` of the submitted range.
 */
export interface PeriodSubmissionApprovalSource {
	id: string;
	organizationId: string;
	employeeId: string;
	approvalWorkflowId: string;
	status: PeriodSubmissionStatus;
	timezone: string;
	startDate: string;
	endDate: string;
	rangeStart: string;
	rangeEnd: string;
}

/** The workflow context a period submission starts with; the adapter re-checks it. */
export interface PeriodSubmissionWorkflowContext {
	periodSubmission: {
		id: string;
		employeeId: string;
		timezone: string;
		startDate: string;
		endDate: string;
	};
}
