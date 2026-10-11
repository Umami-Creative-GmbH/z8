import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";
import {
	clockingReminderOccasionKey,
	type DueClockingReminder,
	type SubmissionPeriodReminderStage,
} from "./occasion";

/**
 * How long a reminder stays due after it fell due. It must stay well under the occasion retention
 * (`CLOCKING_REMINDER_OCCASION_RETENTION_DAYS`, 7 days past the expected time), so the claim of a
 * sent reminder is still recorded for as long as the reminder could be found due again: re-running
 * the job never sends it twice. A reminder the job misses for longer is dropped.
 */
export const PERIOD_SUBMISSION_REMINDER_DUE_DAYS = 3;

/** A period to remind about: an expected submission period in the employee's zone. */
export interface PeriodSubmissionReminderPeriod {
	startDate: PlainDate;
	/** The period's last local day, inclusive. */
	endDate: PlainDate;
	timezone: string;
}

export interface PeriodSubmissionReminderInput {
	now: Instant;
	employeeId: string;
	periods: readonly PeriodSubmissionReminderPeriod[];
	/** Last days (YYYY-MM-DD) of the periods with a live (pending or approved) submission. */
	submittedEndDates: ReadonlySet<string>;
	/** The organization's delay before the second reminder, in days. */
	secondReminderDelayDays: number;
}

/** The start of the local day `days` after the period's last day, in the period's zone. */
function localMidnightAfter(period: PeriodSubmissionReminderPeriod, days: number): Instant {
	return period.endDate.add({ days }).toZonedDateTime({ timeZone: period.timezone }).toInstant();
}

function isWithin(now: Instant, from: Instant, until: Instant): boolean {
	return compareInstants(now, from) >= 0 && compareInstants(now, until) < 0;
}

/**
 * The period submission reminders due now (#1064). The first falls due when an unsubmitted
 * period ends (the local midnight after its last day); the second when the organization's delay
 * has passed after that. The first is no longer offered once the second is due, so a late run
 * sends one reminder, not two. Periods that are not expected never reach this function.
 */
export function evaluatePeriodSubmissionReminders(
	input: PeriodSubmissionReminderInput,
): DueClockingReminder[] {
	const due: DueClockingReminder[] = [];
	for (const period of input.periods) {
		if (input.submittedEndDates.has(period.endDate.toString())) continue;
		const ended = localMidnightAfter(period, 1);
		const delayed = localMidnightAfter(period, 1 + input.secondReminderDelayDays);
		const firstUntil = localMidnightAfter(
			period,
			1 + Math.min(PERIOD_SUBMISSION_REMINDER_DUE_DAYS, input.secondReminderDelayDays),
		);
		const secondUntil = localMidnightAfter(
			period,
			1 + input.secondReminderDelayDays + PERIOD_SUBMISSION_REMINDER_DUE_DAYS,
		);
		if (isWithin(input.now, ended, firstUntil)) {
			due.push(reminder(input.employeeId, period, "period_end", ended));
		} else if (isWithin(input.now, delayed, secondUntil)) {
			due.push(reminder(input.employeeId, period, "after_delay", delayed));
		}
	}
	return due;
}

function reminder(
	employeeId: string,
	period: PeriodSubmissionReminderPeriod,
	stage: SubmissionPeriodReminderStage,
	expectedAt: Instant,
): DueClockingReminder {
	return {
		type: "period_submission_reminder",
		occasionKey: clockingReminderOccasionKey("period_submission_reminder", {
			kind: "submission_period",
			employeeId,
			endDate: period.endDate,
			stage,
		}),
		day: period.endDate,
		expectedAt,
		shift: null,
		submissionPeriod: { startDate: period.startDate, endDate: period.endDate, stage },
	};
}
