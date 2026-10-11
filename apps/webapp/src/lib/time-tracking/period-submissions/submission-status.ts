/**
 * The status model of period submissions (#805), shared by the store, the employee period view
 * (#1059), the overview (#1063), reminders (#1064) and closed months (#1065). Pure and
 * client-safe.
 *
 * A `period_submission` row is one submission of one period. Its stored status is:
 * - `pending`: waiting for the approver. Live.
 * - `approved`: accepted. Live; it locks nothing (only a closed month does).
 * - `rejected`: refused with a reason. The period returns to the employee.
 * - `withdrawn`: a pending submission taken back, by the employee (`closedCause: "employee"`,
 *   #1060) or automatically after a change (`closedCause: "change"`, #1062).
 * - `outdated`: an approved submission whose period changed afterwards (`closedCause: "change"`,
 *   #1062). The approval stays as history.
 *
 * At most one row per employee and period is live; a period is submitted again with a new row.
 */

export const PERIOD_SUBMISSION_STATUSES = [
	"pending",
	"approved",
	"rejected",
	"withdrawn",
	"outdated",
] as const;

export type PeriodSubmissionStatus = (typeof PERIOD_SUBMISSION_STATUSES)[number];

/** Why a submission was closed without a decision of its own. */
export const PERIOD_SUBMISSION_CLOSED_CAUSES = ["employee", "change"] as const;

export type PeriodSubmissionClosedCause = (typeof PERIOD_SUBMISSION_CLOSED_CAUSES)[number];

export const LIVE_PERIOD_SUBMISSION_STATUSES = [
	"pending",
	"approved",
] as const satisfies readonly PeriodSubmissionStatus[];

/** What an expected period shows: the status of its latest submission, as the employee sees it. */
export type PeriodSubmissionViewStatus =
	| "awaiting_submission"
	| "submitted"
	| "approved"
	| "rejected"
	| "sent_back_after_change";

export interface LatestPeriodSubmission {
	status: PeriodSubmissionStatus;
	closedCause: PeriodSubmissionClosedCause | null;
}

/** The view status of a period from its latest submission (null when never submitted). */
export function periodSubmissionViewStatus(
	latest: LatestPeriodSubmission | null,
): PeriodSubmissionViewStatus {
	if (!latest) return "awaiting_submission";
	switch (latest.status) {
		case "pending":
			return "submitted";
		case "approved":
			return "approved";
		case "rejected":
			return "rejected";
		case "withdrawn":
			return latest.closedCause === "change" ? "sent_back_after_change" : "awaiting_submission";
		case "outdated":
			return "sent_back_after_change";
	}
}

/** Whether a period in this view status may be submitted (again), leaving the date rule aside. */
export function isPeriodSubmittable(status: PeriodSubmissionViewStatus): boolean {
	return status !== "submitted" && status !== "approved";
}
