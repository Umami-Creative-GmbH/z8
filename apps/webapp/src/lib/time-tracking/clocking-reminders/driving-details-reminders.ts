import {
	compareInstants,
	type Instant,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { clockingReminderOccasionKey, type DueClockingReminder } from "./occasion";

/** The local hour of the morning after at which the reminder becomes due (#1127). */
export const DRIVING_DETAILS_REMINDER_HOUR = 8;
/**
 * How long after the morning after the reminder may still be sent; kept under the 7-day
 * occasion retention, so an occasion is never forgotten while it could be sent again.
 */
export const DRIVING_DETAILS_REMINDER_DUE_DAYS = 3;

/** 08:00 on the employee's local day after the work ended, in their timezone. */
export function drivingDetailsReminderAt(endedAt: Instant, timezone: string): Instant {
	return plainDateAt(endedAt, timezone)
		.add({ days: 1 })
		.toZonedDateTime({ timeZone: timezone, plainTime: { hour: DRIVING_DETAILS_REMINDER_HOUR } })
		.toInstant();
}

/**
 * The driving details reminder occasions due now (#1127): one per flagged work period, from the
 * morning after it ended until its due window closes. The work passed in is already flagged as
 * driving details missing; the delivery claims each occasion at most once and sends an
 * employee's newly due occasions as one reminder (#807 decision 8).
 */
export function evaluateDrivingDetailsReminders(input: {
	now: Instant;
	/** The employee's timezone, in which "the morning after" is judged. */
	timezone: string;
	work: readonly { workPeriodId: string; workDay: string; endedAt: string }[];
}): DueClockingReminder[] {
	return input.work.flatMap((work): DueClockingReminder[] => {
		const expectedAt = drivingDetailsReminderAt(parseInstant(work.endedAt), input.timezone);
		const closesAt = expectedAt.add({ hours: DRIVING_DETAILS_REMINDER_DUE_DAYS * 24 });
		if (compareInstants(input.now, expectedAt) < 0 || compareInstants(input.now, closesAt) >= 0) {
			return [];
		}
		const workDay = parsePlainDate(work.workDay);
		return [
			{
				type: "driving_details_missing_reminder",
				occasionKey: clockingReminderOccasionKey("driving_details_missing_reminder", {
					kind: "work_period",
					workPeriodId: work.workPeriodId,
				}),
				day: workDay,
				expectedAt,
				shift: null,
				drivingWork: { workPeriodId: work.workPeriodId, workDay },
			},
		];
	});
}
