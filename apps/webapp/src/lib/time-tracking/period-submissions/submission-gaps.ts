import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import {
	latestSubmissionByPeriod,
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
	type PeriodSubmissionViewStatus,
	periodSubmissionViewStatus,
} from "./submission-status";

/**
 * Missing or unapproved period submissions (#1065, spec #805): the warnings of the close screen
 * and of payroll readiness. Pure and client-safe; never blocks anything.
 */

/**
 * Every view status but `approved`: what a gap shows. `running` is a period that has started but
 * not ended (in the employee's zone) and has no submission yet: not missing, just not due.
 */
export type PeriodSubmissionGapStatus = Exclude<PeriodSubmissionViewStatus, "approved"> | "running";

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
 * The expected periods that have started by `today` (in the employee's zone) whose latest
 * submission is not approved, in order. A period still running without a submission is not due:
 * it shows as `running`, never as missing. A period not started yet is no gap.
 */
export function periodSubmissionGaps(input: {
	periods: readonly ExpectedSubmissionPeriod[];
	submissions: readonly PeriodSubmissionGapSubmission[];
	today: PlainDate;
}): PeriodSubmissionGap[] {
	const latest = latestSubmissionByPeriod(input.submissions);
	const gaps: PeriodSubmissionGap[] = [];
	for (const period of input.periods) {
		if (comparePlainDates(period.startDate, input.today) > 0) continue;
		const running = comparePlainDates(period.endDate, input.today) >= 0;
		const startDate = period.startDate.toString();
		const status = periodSubmissionViewStatus(latest.get(startDate) ?? null);
		if (status === "approved") continue;
		gaps.push({
			startDate,
			endDate: period.endDate.toString(),
			status: running && status === "awaiting_submission" ? "running" : status,
		});
	}
	return gaps;
}
