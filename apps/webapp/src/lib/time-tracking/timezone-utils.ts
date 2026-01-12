import { DateTime } from "luxon";
import { fromJSDate, parseISO } from "@/lib/datetime/luxon-utils";

/**
 * Get day boundaries in user's timezone, returned as UTC DateTimes for DB queries
 */
export function getDayRangeInTimezone(
	date: Date | DateTime,
	timezone: string,
): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, "utc") : date;
	const inUserTz = dt.setZone(timezone);

	return {
		start: inUserTz.startOf("day").toUTC(),
		end: inUserTz.endOf("day").toUTC(),
	};
}

/**
 * Get today's range in user's timezone, returned as UTC DateTimes for DB queries
 */
export function getTodayRangeInTimezone(timezone: string): { start: DateTime; end: DateTime } {
	const nowInUserTz = DateTime.now().setZone(timezone);

	return {
		start: nowInUserTz.startOf("day").toUTC(),
		end: nowInUserTz.endOf("day").toUTC(),
	};
}

/**
 * Get week range in user's timezone, returned as UTC DateTimes for DB queries
 */
export function getWeekRangeInTimezone(
	date: Date | DateTime,
	timezone: string,
): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, "utc") : date;
	const inUserTz = dt.setZone(timezone);

	return {
		start: inUserTz.startOf("week").toUTC(),
		end: inUserTz.endOf("week").toUTC(),
	};
}

/**
 * Get month range in user's timezone, returned as UTC DateTimes for DB queries
 */
export function getMonthRangeInTimezone(
	date: Date | DateTime,
	timezone: string,
): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, "utc") : date;
	const inUserTz = dt.setZone(timezone);

	return {
		start: inUserTz.startOf("month").toUTC(),
		end: inUserTz.endOf("month").toUTC(),
	};
}

/**
 * Format time in a specific timezone with optional timezone indicator
 * @param date - UTC date from database
 * @param timezone - IANA timezone string (e.g., "America/New_York")
 * @param showIndicator - Whether to append timezone abbreviation (e.g., "EST")
 * @returns Formatted time string (e.g., "09:00" or "09:00 EST")
 */
export function formatTimeInZone(
	date: string | Date | DateTime,
	timezone: string,
	showIndicator = false,
): string {
	let dt: DateTime;

	if (typeof date === "string") {
		dt = parseISO(date, "utc");
	} else if (date instanceof Date) {
		dt = fromJSDate(date, "utc");
	} else {
		dt = date;
	}

	const inUserTz = dt.setZone(timezone);
	const time = inUserTz.toFormat("HH:mm");

	if (showIndicator) {
		const abbr = inUserTz.offsetNameShort || timezone;
		return `${time} ${abbr}`;
	}

	return time;
}

/**
 * Format date in a specific timezone
 * @param date - UTC date from database
 * @param timezone - IANA timezone string
 * @returns Formatted date string (e.g., "Mon, Jan 15")
 */
export function formatDateInZone(date: string | Date | DateTime, timezone: string): string {
	let dt: DateTime;

	if (typeof date === "string") {
		dt = parseISO(date, "utc");
	} else if (date instanceof Date) {
		dt = fromJSDate(date, "utc");
	} else {
		dt = date;
	}

	const inUserTz = dt.setZone(timezone);

	return inUserTz.toLocaleString({
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

/**
 * Get the timezone abbreviation for display (e.g., "EST", "PST", "CET")
 */
export function getTimezoneAbbreviation(timezone: string): string {
	const dt = DateTime.now().setZone(timezone);
	return dt.offsetNameShort || timezone;
}

/**
 * Get the timezone offset for display (e.g., "UTC-5", "UTC+1")
 */
export function formatTimezoneOffset(timezone: string): string {
	const dt = DateTime.now().setZone(timezone);
	const offset = dt.offset;
	const hours = Math.floor(Math.abs(offset) / 60);
	const mins = Math.abs(offset) % 60;
	const sign = offset >= 0 ? "+" : "-";
	return mins === 0
		? `UTC${sign}${hours}`
		: `UTC${sign}${hours}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Check if a timezone string is valid
 */
export function isValidTimezone(timezone: string): boolean {
	try {
		const dt = DateTime.now().setZone(timezone);
		return dt.isValid && dt.zone.type !== "invalid";
	} catch {
		return false;
	}
}

/**
 * Convert a UTC date to user's calendar day (YYYY-MM-DD)
 * Used for grouping time entries by the user's local day
 */
export function getCalendarDayKey(utcDate: Date, timezone: string): string {
	return fromJSDate(utcDate, "utc").setZone(timezone).toISODate() || "";
}

/**
 * Get the start of a calendar day in UTC
 */
export function getCalendarDayStartUTC(calendarDay: string, timezone: string): Date {
	return DateTime.fromISO(calendarDay, { zone: timezone }).startOf("day").toUTC().toJSDate();
}

/**
 * Get the end of a calendar day in UTC
 */
export function getCalendarDayEndUTC(calendarDay: string, timezone: string): Date {
	return DateTime.fromISO(calendarDay, { zone: timezone }).endOf("day").toUTC().toJSDate();
}
