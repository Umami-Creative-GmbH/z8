import { Temporal } from "temporal-polyfill";

/** How a save changed an employee's birthday, as its audit entry records it (#1579). */
export type BirthdayChange = "set" | "changed" | "cleared";

/** A stored birthday's calendar date; birthdays are kept at UTC midnight. */
function birthdayKey(value: Date | null): string | null {
	return value
		? Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO("UTC").toPlainDate().toString()
		: null;
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
	const before = birthdayKey(previous ?? null);
	const after = birthdayKey(next);
	if (before === after) return null;
	if (before === null) return "set";
	return after === null ? "cleared" : "changed";
}
