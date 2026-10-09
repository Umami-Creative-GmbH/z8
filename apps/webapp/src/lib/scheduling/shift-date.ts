import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolveScheduleWallTime } from "./schedule-local-input";

/**
 * `shift.date` stores the organization-local midnight of the shift's calendar date as a UTC
 * instant (Berlin 2026-10-09 is stored as 2026-10-08T22:00Z). Read it back as a calendar date in
 * the organization's zone, never as the UTC date.
 */
export function shiftCalendarDate(storedDate: Date, organizationTimezone: string): PlainDate {
	return plainDateAt(instantFromDate(storedDate), organizationTimezone);
}

/**
 * The `shift.date` value to store for the organization-local calendar day `date` (`YYYY-MM-DD`).
 * Throws where that day's local midnight doesn't exist.
 */
export function shiftStoredDate(date: string, organizationTimezone: string): Date {
	return dateFromInstant(
		resolveScheduleWallTime({ date, time: "00:00" }, organizationTimezone).toInstant(),
	);
}

/** The `shift.date` bounds of the organization-local calendar day `date` (`YYYY-MM-DD`). */
export function shiftDateBounds(
	date: string,
	organizationTimezone: string,
): { start: Date; endExclusive: Date } {
	const day = localDayRange(date, organizationTimezone);
	return { start: dateFromInstant(day.start), endExclusive: dateFromInstant(day.endExclusive) };
}
