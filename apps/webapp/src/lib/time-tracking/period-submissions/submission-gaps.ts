import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import {
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
	type PeriodSubmissionViewStatus,
	periodSubmissionViewStatus,
} from "./submission-status";

/**
 * Missing or unapproved period submissions (#1065, spec #805): the warnings of the close screen
 * and of payroll readiness. Pure and client-safe; never blocks anything.
 */

/** Every view status but `approved`: what a gap shows. */
export type PeriodSubmissionGapStatus = Exclude<PeriodSubmissionViewStatus, "approved">;

/** One expected period of one employee without an approved submission. */
export interface PeriodSubmissionGap {
	startDate: string;
	endDate: string;
	status: PeriodSubmissionGapStatus;
}

export interface PeriodSubmissionGapSubmission {
	startDate: string;
	status: PeriodSubmissionStatus;
	closedCause: PeriodSubmissionClosedCause | null;
	submittedAt: Date;
}

/**
 * The expected periods that ended before `today` (in the employee's zone) whose latest
 * submission is not approved, in order. A period still running is not due, so it is no gap.
 */
export function periodSubmissionGaps(input: {
	periods: readonly ExpectedSubmissionPeriod[];
	submissions: readonly PeriodSubmissionGapSubmission[];
	today: PlainDate;
}): PeriodSubmissionGap[] {
	const latest = new Map<string, PeriodSubmissionGapSubmission>();
	for (const submission of input.submissions) {
		const current = latest.get(submission.startDate);
		if (!current || submission.submittedAt.getTime() > current.submittedAt.getTime()) {
			latest.set(submission.startDate, submission);
		}
	}
	const gaps: PeriodSubmissionGap[] = [];
	for (const period of input.periods) {
		if (comparePlainDates(period.endDate, input.today) >= 0) continue;
		const startDate = period.startDate.toString();
		const status = periodSubmissionViewStatus(latest.get(startDate) ?? null);
		if (status === "approved") continue;
		gaps.push({ startDate, endDate: period.endDate.toString(), status });
	}
	return gaps;
}
