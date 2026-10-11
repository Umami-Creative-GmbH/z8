import {
	type Instant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/** A project's deadline day. Deadlines are stored as UTC midnight of that calendar day. */
export function projectDeadlineDay(deadline: Date): PlainDate {
	return plainDateAt(instantFromDate(deadline), "UTC");
}

/**
 * Calendar days from today to the deadline day: 0 on the deadline day,
 * negative once overdue. Today is the calendar date in the organization's
 * timezone, never the server's or the viewer's, so reports and deadline
 * notifications agree.
 */
export function daysUntilProjectDeadline({
	deadline,
	now,
	timeZone,
}: {
	deadline: Date;
	now: Instant;
	/** The organization's timezone. */
	timeZone: string;
}): number {
	return plainDateAt(now, timeZone).until(projectDeadlineDay(deadline), { largestUnit: "days" })
		.days;
}
