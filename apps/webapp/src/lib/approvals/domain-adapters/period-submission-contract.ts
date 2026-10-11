import type {
	PeriodSubmissionClosedCause,
	PeriodSubmissionStatus,
} from "@/lib/time-tracking/period-submissions/submission-status";

/** Source and workflow kind of period submissions (#1059): one workflow per submission row. */
export const PERIOD_SUBMISSION_WORKFLOW_TYPE = "period_submission" as const;
export const PERIOD_SUBMISSION_SOURCE_TYPE = "period_submission" as const;

/**
 * The only cancel reasons the period submission adapter accepts (#1060): a pending submission is
 * cancelled solely by the withdrawal entry point, which names why. Any other cancel is refused,
 * so no withdrawal can bypass its audit entry.
 */
export const PERIOD_SUBMISSION_CANCEL_REASONS = {
	employee: "period_submission_withdrawn_by_employee",
	change: "period_submission_withdrawn_after_change",
} as const satisfies Record<PeriodSubmissionClosedCause, string>;

/** The closed cause a cancel reason names, or null for a reason the adapter refuses. */
export function periodSubmissionClosedCauseOf(
	reason: string | null,
): PeriodSubmissionClosedCause | null {
	if (reason === PERIOD_SUBMISSION_CANCEL_REASONS.employee) return "employee";
	if (reason === PERIOD_SUBMISSION_CANCEL_REASONS.change) return "change";
	return null;
}

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
