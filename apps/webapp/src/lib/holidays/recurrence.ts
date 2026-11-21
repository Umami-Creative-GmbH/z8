import { Temporal } from "temporal-polyfill";

export function holidayCalendarDate(value: Date): Temporal.PlainDate {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO("UTC")
		.toPlainDate();
}

export function createYearlyHolidayRecurrenceRule(value: Date): string {
	const { month, day } = holidayCalendarDate(value);
	return JSON.stringify({ month, day });
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUARTER_HOUR_MS = 900_000;
/** Day lengths a span of local days can differ by: none, a half-hour or an hour DST shift. */
const DST_SHIFTS_MS = new Set([0, 1_800_000, 3_600_000]);
/**
 * A local midnight at a UTC time of day after this lies in a zone east of UTC, on the next
 * UTC date; at or before it, in a zone west of UTC, on the same UTC date. 10:00 separates
 * Hawaii (UTC-10) from New Zealand summer time, Tonga and Samoa (UTC+13) and Chatham
 * (UTC+12:45/+13:45). Only UTC-11 (Niue, American Samoa) and UTC+14 (Kiribati Line
 * Islands) are misread, as they cannot be told apart from UTC+13 and UTC-10.
 */
const EAST_OF_UTC_AFTER_MS = 10 * HOUR_MS;
/** The last millisecond of a UTC day, as end-of-day encoded holiday ends store it. */
const LAST_MILLISECOND_MS = DAY_MS - 1;

function utcTimeOfDay(value: Date): number {
	return ((value.getTime() % DAY_MS) + DAY_MS) % DAY_MS;
}

/** Off UTC midnight on a quarter hour: the shape of a real zone's local midnight. */
function isLocalMidnightShape(timeOfDay: number): boolean {
	return timeOfDay !== 0 && timeOfDay % QUARTER_HOUR_MS === 0;
}

/** The calendar date whose local midnight a local-midnight-shaped instant is. */
function localMidnightDate(value: Date): Temporal.PlainDate {
	const date = holidayCalendarDate(value);
	return utcTimeOfDay(value) > EAST_OF_UTC_AFTER_MS ? date.add({ days: 1 }) : date;
}

/**
 * The inclusive calendar dates of a stored holiday row.
 *
 * Holidays are calendar dates stored at UTC midnight: the end is that last day's UTC
 * midnight or the end of it. The date-holidays import (`mapToHolidayFormValues`) stores
 * the country's real instants instead, from a local midnight to the local midnight after
 * the last day (exclusive), so a German holiday starts at 22:00 or 23:00 UTC the day
 * before. Rows are read as follows:
 * - start and end both off UTC midnight on a quarter hour, spanning whole local days
 *   (give or take a DST shift): local midnights, end exclusive (`localMidnightDate`);
 * - start in that shape but end at a UTC midnight or the end of a UTC day, as the
 *   holiday dialog stores an edited end of an imported row: start local, end inclusive
 *   on its UTC date;
 * - anything else: the UTC dates of start and end.
 */
export function holidayStoredDates(
	startDate: Date,
	endDate: Date,
): { start: Temporal.PlainDate; end: Temporal.PlainDate } {
	const utcDates = { start: holidayCalendarDate(startDate), end: holidayCalendarDate(endDate) };
	const startTime = utcTimeOfDay(startDate);
	if (!isLocalMidnightShape(startTime)) return utcDates;

	const endTime = utcTimeOfDay(endDate);
	const span = endDate.getTime() - startDate.getTime();
	const days = Math.round(span / DAY_MS);
	if (
		isLocalMidnightShape(endTime) &&
		days >= 1 &&
		DST_SHIFTS_MS.has(Math.abs(span - days * DAY_MS))
	) {
		const first = localMidnightDate(startDate);
		return { start: first, end: first.add({ days: days - 1 }) };
	}

	if (endTime === 0 || endTime === LAST_MILLISECOND_MS) {
		const start = localMidnightDate(startDate);
		if (Temporal.PlainDate.compare(start, utcDates.end) <= 0) {
			return { start, end: utcDates.end };
		}
	}
	return utcDates;
}

/** Whether a one-off stored holiday row covers a calendar date (`holidayStoredDates`). */
export function holidayStoredDatesInclude(
	startDate: Date,
	endDate: Date,
	date: Temporal.PlainDate,
): boolean {
	const { start, end } = holidayStoredDates(startDate, endDate);
	return Temporal.PlainDate.compare(start, date) <= 0 && Temporal.PlainDate.compare(date, end) <= 0;
}
