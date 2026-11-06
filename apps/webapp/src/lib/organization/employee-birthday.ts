import { Temporal } from "temporal-polyfill";

/** How a save changed an employee's birthday, as its audit entry records it (#1579). */
export type BirthdayChange = "set" | "changed" | "cleared";

/** The earliest birthday an employee record accepts. */
export const EARLIEST_BIRTHDAY = Temporal.PlainDate.from("1900-01-01");

/**
 * The latest birthday an employee record accepts: today in UTC, the zone
 * birthdays are stored in, so the date input and the server agree.
 */
export function latestBirthday(): Temporal.PlainDate {
	return Temporal.Now.plainDateISO("UTC");
}

/** A stored birthday's calendar date; birthdays are kept at UTC midnight. */
export function birthdayCalendarDate(value: Date): Temporal.PlainDate {
	return Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO("UTC").toPlainDate();
}

/**
 * How saving `next` changes the stored `previous` birthday, or null when it
 * changes nothing. `next` undefined means the save did not carry a birthday.
 */
export function birthdayChange(
	previous: Date | null | undefined,
	next: Date | null | undefined,
): BirthdayChange | null {
	if (next === undefined) return null;
	const before = previous ? birthdayCalendarDate(previous) : null;
	const after = next ? birthdayCalendarDate(next) : null;
	if (before && after) return before.equals(after) ? null : "changed";
	if (before) return "cleared";
	return after ? "set" : null;
}
