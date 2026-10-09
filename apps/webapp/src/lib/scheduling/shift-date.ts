import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolveScheduleDateRange } from "./schedule-local-input";

/**
 * `shift.date` stores the organization-local midnight of the shift's calendar date as a UTC
 * instant (Berlin 2026-10-09 is stored as 2026-10-08T22:00Z). Read it back as a calendar date in
 * the organization's zone, never as the UTC date.
 */
export function shiftCalendarDate(storedDate: Date, organizationTimezone: string): PlainDate {
	return plainDateAt(instantFromDate(storedDate), organizationTimezone);
}

/** The `shift.date` bounds of the organization-local calendar day `date` (`YYYY-MM-DD`). */
export function shiftDateBounds(
	date: string,
	organizationTimezone: string,
): { start: Date; endExclusive: Date } {
	const day = localDayRange(date, organizationTimezone);
	return { start: dateFromInstant(day.start), endExclusive: dateFromInstant(day.endExclusive) };
}

/**
 * The `shift.date` bounds of the organization-local calendar days from `startDate` up to, not
 * including, `endDateExclusive`. Query them with `gte(start)` and `lt(endExclusive)`.
 */
export function shiftDateRangeBounds(
	startDate: string | PlainDate,
	endDateExclusive: string | PlainDate,
	organizationTimezone: string,
): { start: Date; endExclusive: Date } {
	const range = resolveScheduleDateRange(
		{ startDate: startDate.toString(), endDateExclusive: endDateExclusive.toString() },
		organizationTimezone,
	);
	return { start: dateFromInstant(range.start), endExclusive: dateFromInstant(range.endExclusive) };
}
