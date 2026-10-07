import {
	compareInstants,
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";

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

function latestPlainDate(now: Instant): PlainDate {
	return now.toZonedDateTimeISO(LATEST_ZONE).toPlainDate();
}

/** Today's latest calendar date anywhere. */
export function latestCalendarDate(now: Instant): string {
	return latestPlainDate(now).toString();
}

/** Whether a calendar date (YYYY-MM-DD) is still ahead of today everywhere. */
export function isFutureDated(date: string, now: Instant): boolean {
	return comparePlainDates(parsePlainDate(date), latestPlainDate(now)) > 0;
}

/** The instant a calendar date becomes today somewhere, so it is no longer future-dated. */
export function submittableFrom(date: string): Instant {
	return parsePlainDate(date).toZonedDateTime({ timeZone: LATEST_ZONE }).toInstant();
}

/**
 * What on screen may still be future-dated: calendar dates, and exact
 * instants such as a per diem return.
 */
export interface FutureDates {
	dates: readonly string[];
	instants: readonly Instant[];
}

/**
 * The earliest moment after `now` at which one of them has happened, so
 * submission may open; null when none lies ahead.
 */
export function nextSubmissionChange(now: Instant, future: FutureDates): Instant | null {
	let next: Instant | null = null;
	for (const moment of [...future.dates.map(submittableFrom), ...future.instants]) {
		if (compareInstants(moment, now) <= 0) continue;
		if (!next || compareInstants(moment, next) < 0) next = moment;
	}
	return next;
}
