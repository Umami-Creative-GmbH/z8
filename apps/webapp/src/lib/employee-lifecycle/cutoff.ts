import { Temporal } from "temporal-polyfill";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";

export type DepartureCutoff = {
	lastWorkingDay: string;
	timezone: string;
	cutoff: Instant;
};

/**
 * The cutoff is the start of the day after the last working day in the
 * organization zone. Only a missing zone falls back to UTC; an invalid
 * configured zone throws so the departure date is never silently shifted.
 */
export function departureCutoff(input: {
	lastWorkingDay: string;
	timezone: string | null;
	now: Instant;
}): DepartureCutoff {
	const timezone = input.timezone ?? "UTC";
	const date = parsePlainDate(input.lastWorkingDay);
	const today = input.now.toZonedDateTimeISO(timezone).toPlainDate();
	if (Temporal.PlainDate.compare(date, today) < 0) {
		throw new Error("departure_date_in_past");
	}

	// A PlainDate converts at the zone's actual start of day, which is not
	// always 00:00 across offset transitions.
	const cutoff = date.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
	return { lastWorkingDay: date.toString(), timezone, cutoff };
}
