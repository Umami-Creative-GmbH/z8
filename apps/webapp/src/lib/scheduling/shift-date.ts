import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/**
 * `shift.date` stores the organization-local midnight of the shift's calendar date as a UTC
 * instant (Berlin 2026-10-09 is stored as 2026-10-08T22:00Z). Read it back as a calendar date in
 * the organization's zone, never as the UTC date.
 */
export function shiftCalendarDate(storedDate: Date, organizationTimezone: string): PlainDate {
	return plainDateAt(instantFromDate(storedDate), organizationTimezone);
}

/**
 * Half-open `shift.date` bounds of the organization-local calendar day `date` (`YYYY-MM-DD`):
 * match shifts with `gte(shift.date, from)` and `lt(shift.date, until)`.
 */
export function shiftDateBounds(
	date: string,
	organizationTimezone: string,
): { from: Date; until: Date } {
	const day = localDayRange(date, organizationTimezone);
	return { from: dateFromInstant(day.start), until: dateFromInstant(day.endExclusive) };
}
