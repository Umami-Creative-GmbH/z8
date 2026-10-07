import { comparePlainDates, type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * Calendar dates that may not have happened yet (#685). An expense date or a
 * trip end is plain, without a zone, so "today" is the latest calendar date
 * anywhere on earth: a date that is already today somewhere is never refused,
 * at the cost of letting through a date at most about a day ahead. The
 * viewer's zone is never used for meaning. Recorded reimbursements (#612) use
 * the same date as their latest allowed payment date.
 */

/** The zone whose calendar date is the latest anywhere on earth (UTC+14). */
const LATEST_ZONE = "Pacific/Kiritimati";

/** Today's latest calendar date anywhere. */
export function latestCalendarDate(now: Instant): string {
	return now.toZonedDateTimeISO(LATEST_ZONE).toPlainDate().toString();
}

/** Whether a calendar date (YYYY-MM-DD) is still ahead of today everywhere. */
export function isFutureDated(date: string, now: Instant): boolean {
	return comparePlainDates(parsePlainDate(date), parsePlainDate(latestCalendarDate(now))) > 0;
}

/** The instant a calendar date becomes today somewhere, so it is no longer future-dated. */
export function submittableFrom(date: string): Instant {
	return parsePlainDate(date).toZonedDateTime({ timeZone: LATEST_ZONE }).toInstant();
}

/** What may still be future-dated on screen: calendar dates, and exact instants such as a per diem return. */
export interface SubmissionDeadlines {
	dates: readonly string[];
	instants: readonly Instant[];
}

/**
 * The earliest moment after `now` at which one of the deadlines stops
 * blocking submission; null when none lies ahead.
 */
export function nextSubmissionChange(now: Instant, deadlines: SubmissionDeadlines): Instant | null {
	let next: Instant | null = null;
	for (const moment of [...deadlines.dates.map(submittableFrom), ...deadlines.instants]) {
		if (moment.epochNanoseconds <= now.epochNanoseconds) continue;
		if (!next || moment.epochNanoseconds < next.epochNanoseconds) next = moment;
	}
	return next;
}
