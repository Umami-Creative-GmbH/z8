import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import {
	isPeriodSubmittable,
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
	type PeriodSubmissionViewStatus,
	periodSubmissionViewStatus,
} from "./submission-status";

/** One period of the employee's period view (#1059). Plain data; crosses to the client. */
export interface EmployeePeriodViewRow {
	/** Identifies the period; what Submit sends. */
	startDate: string;
	endDate: string;
	status: PeriodSubmissionViewStatus;
	/** Set for a rejected period. */
	rejectionReason: string | null;
	/** ISO instant of the latest submission, if any. */
	submittedAt: string | null;
	canSubmit: boolean;
	/** The first day Submit is offered: the period's last day. */
	opensOn: string;
}

export interface PeriodViewSubmission {
	startDate: string;
	endDate: string;
	status: PeriodSubmissionStatus;
	decisionReason: string | null;
	closedCause: PeriodSubmissionClosedCause | null;
	submittedAt: Date;
}

/**
 * The employee's periods that have started by `today` (in their zone), newest first: every
 * expected period, plus any period with a submission that is no longer expected (a cadence
 * switched off keeps pending and past submissions). A submitted period shows its fixed range.
 */
export function buildEmployeePeriodView(input: {
	periods: readonly ExpectedSubmissionPeriod[];
	submissions: readonly PeriodViewSubmission[];
	today: PlainDate;
}): EmployeePeriodViewRow[] {
	const latest = new Map<string, PeriodViewSubmission>();
	for (const submission of input.submissions) {
		const current = latest.get(submission.startDate);
		if (!current || submission.submittedAt.getTime() > current.submittedAt.getTime()) {
			latest.set(submission.startDate, submission);
		}
	}
	const expected = new Map(input.periods.map((period) => [period.startDate.toString(), period]));
	const starts = new Set([...expected.keys(), ...latest.keys()]);
	const rows: EmployeePeriodViewRow[] = [];
	for (const startDate of starts) {
		if (comparePlainDates(parsePlainDate(startDate), input.today) > 0) continue;
		const period = expected.get(startDate);
		const submission = latest.get(startDate) ?? null;
		const status = periodSubmissionViewStatus(submission);
		const endDate =
			submission && status !== "awaiting_submission" && status !== "sent_back_after_change"
				? submission.endDate
				: (period?.endDate.toString() ?? submission?.endDate ?? startDate);
		rows.push({
			startDate,
			endDate,
			status,
			rejectionReason: status === "rejected" ? (submission?.decisionReason ?? null) : null,
			submittedAt: submission ? submission.submittedAt.toISOString() : null,
			canSubmit:
				period !== undefined &&
				isPeriodSubmittable(status) &&
				comparePlainDates(input.today, period.endDate) >= 0,
			opensOn: period?.endDate.toString() ?? endDate,
		});
	}
	return rows.toSorted((left, right) => right.startDate.localeCompare(left.startDate));
}
