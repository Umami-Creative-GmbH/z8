import { Temporal } from "temporal-polyfill";
import { parseIanaTimeZone, parseTimeZone } from "../timezone/validation";
import {
	compareInstants,
	type Instant,
	parsePlainDate,
	parsePlainTimeMinute,
	type ZonedDateTime,
} from "./temporal-core";

export interface InstantRange {
	start: Instant;
	endExclusive: Instant;
}

export type WeekStartDay = "sunday" | "monday";
export type ManualDisambiguation = "reject" | "earlier" | "later";

interface ManualWallClockInput {
	date: string;
	time: string;
	timezone: string;
	disambiguation: ManualDisambiguation;
}

interface ScheduledWallClockInput {
	date: string;
	time: string;
	timezone: string;
}

export class NonexistentWallClockTimeError extends RangeError {
	constructor(date: string, time: string, timezone: string) {
		super(`Wall-clock time ${date} ${time} does not exist in ${timezone}`);
		this.name = "NonexistentWallClockTimeError";
	}
}

export class AmbiguousWallClockTimeError extends RangeError {
	constructor(date: string, time: string, timezone: string) {
		super(`Wall-clock time ${date} ${time} is ambiguous in ${timezone}`);
		this.name = "AmbiguousWallClockTimeError";
	}
}

function instantRange(
	startDate: ReturnType<typeof parsePlainDate>,
	endDate: ReturnType<typeof parsePlainDate>,
	timezone: string,
): InstantRange {
	return {
		start: startDate.toZonedDateTime(timezone).toInstant(),
		endExclusive: endDate.toZonedDateTime(timezone).toInstant(),
	};
}

export function localDayRange(date: string, timezone: string): InstantRange {
	const localDate = parsePlainDate(date);
	const parsedTimezone = parseTimeZone(timezone);

	return instantRange(localDate, localDate.add({ days: 1 }), parsedTimezone);
}

export function localWeekRange(
	date: string,
	timezone: string,
	weekStartDay: WeekStartDay,
): InstantRange {
	const localDate = parsePlainDate(date);
	const parsedTimezone = parseTimeZone(timezone);
	if (weekStartDay !== "sunday" && weekStartDay !== "monday") {
		throw new RangeError("Week start day must be sunday or monday");
	}

	const daysSinceStart =
		weekStartDay === "monday" ? localDate.dayOfWeek - 1 : localDate.dayOfWeek % 7;
	const startDate = localDate.subtract({ days: daysSinceStart });

	return instantRange(startDate, startDate.add({ days: 7 }), parsedTimezone);
}

export function localMonthRange(date: string, timezone: string): InstantRange {
	const localDate = parsePlainDate(date);
	const parsedTimezone = parseTimeZone(timezone);
	const startDate = localDate.with({ day: 1 });

	return instantRange(startDate, startDate.add({ months: 1 }), parsedTimezone);
}

function parseWallClock(date: string, time: string, timezone: string) {
	const plainDate = parsePlainDate(date);
	const plainTime = parsePlainTimeMinute(time);
	const parsedTimezone = parseIanaTimeZone(timezone);

	return {
		plainDateTime: plainDate.toPlainDateTime(plainTime),
		timezone: parsedTimezone,
	};
}

export function resolveManualWallClock({
	date,
	time,
	timezone,
	disambiguation,
}: ManualWallClockInput): ZonedDateTime {
	if (disambiguation !== "reject" && disambiguation !== "earlier" && disambiguation !== "later") {
		throw new RangeError("Manual disambiguation must be reject, earlier, or later");
	}

	const parsed = parseWallClock(date, time, timezone);
	const earlier = parsed.plainDateTime.toZonedDateTime(parsed.timezone, {
		disambiguation: "earlier",
	});
	const later = parsed.plainDateTime.toZonedDateTime(parsed.timezone, {
		disambiguation: "later",
	});
	const earlierMatches =
		Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), parsed.plainDateTime) === 0;
	const laterMatches =
		Temporal.PlainDateTime.compare(later.toPlainDateTime(), parsed.plainDateTime) === 0;

	if (!earlierMatches || !laterMatches) {
		throw new NonexistentWallClockTimeError(date, time, parsed.timezone);
	}

	const ambiguous = compareInstants(earlier.toInstant(), later.toInstant()) !== 0;
	if (ambiguous && disambiguation === "reject") {
		throw new AmbiguousWallClockTimeError(date, time, parsed.timezone);
	}

	return disambiguation === "later" ? later : earlier;
}

export function resolveScheduledWallClock({
	date,
	time,
	timezone,
}: ScheduledWallClockInput): ZonedDateTime {
	const parsed = parseWallClock(date, time, timezone);

	return parsed.plainDateTime.toZonedDateTime(parsed.timezone, {
		disambiguation: "compatible",
	});
}
