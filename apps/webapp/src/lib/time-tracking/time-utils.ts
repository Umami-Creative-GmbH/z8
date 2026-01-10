import { DateTime } from "luxon";
import { fromJSDate, parseISO } from "@/lib/datetime/luxon-utils";

export function formatDuration(minutes: number | null | undefined): string {
	const safeMinutes = minutes ?? 0;
	if (Number.isNaN(safeMinutes)) {
		return "0h 00m";
	}
	const hours = Math.floor(safeMinutes / 60);
	const mins = safeMinutes % 60;
	return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

export function formatDurationWithSeconds(totalSeconds: number | null | undefined): string {
	const safeSeconds = totalSeconds ?? 0;
	if (Number.isNaN(safeSeconds)) {
		return "0:00:00";
	}
	const hours = Math.floor(safeSeconds / 3600);
	const minutes = Math.floor((safeSeconds % 3600) / 60);
	const seconds = safeSeconds % 60;
	return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDate(dateString: string | Date | DateTime): string {
	let dt: DateTime;

	if (typeof dateString === "string") {
		dt = parseISO(dateString, "utc");
	} else if (dateString instanceof Date) {
		dt = fromJSDate(dateString, "utc");
	} else {
		dt = dateString;
	}

	return dt.toLocaleString({
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function formatTime(dateString: string | Date | DateTime): string {
	let dt: DateTime;

	if (typeof dateString === "string") {
		dt = parseISO(dateString, "utc");
	} else if (dateString instanceof Date) {
		dt = fromJSDate(dateString, "utc");
	} else {
		dt = dateString;
	}

	return dt.toFormat("HH:mm");
}

export function getWeekRange(date: Date | DateTime): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, "utc") : date;

	return {
		start: dt.startOf("week"),
		end: dt.endOf("week"),
	};
}

export function getMonthRange(date: Date | DateTime): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, "utc") : date;

	return {
		start: dt.startOf("month"),
		end: dt.endOf("month"),
	};
}

export function getTodayRange(): { start: DateTime; end: DateTime } {
	const today = DateTime.now();

	return {
		start: today.startOf("day"),
		end: today.endOf("day"),
	};
}

export function calculateElapsedMinutes(startTime: Date | string | DateTime): number {
	let start: DateTime;

	if (typeof startTime === "string") {
		start = parseISO(startTime, "utc");
	} else if (startTime instanceof Date) {
		start = fromJSDate(startTime, "utc");
	} else {
		start = startTime;
	}

	const now = DateTime.now();
	return Math.floor(now.diff(start, "minutes").minutes);
}

/**
 * Check if a timestamp is from "today" in the given timezone
 * Used to determine if a time entry can be edited directly or requires approval
 */
export function isSameDayInTimezone(
	timestamp: Date | string | DateTime,
	timezone: string,
): boolean {
	let dt: DateTime;

	if (typeof timestamp === "string") {
		dt = parseISO(timestamp, "utc");
	} else if (timestamp instanceof Date) {
		dt = fromJSDate(timestamp, "utc");
	} else {
		dt = timestamp;
	}

	// Convert both to the target timezone for comparison
	const timestampInTz = dt.setZone(timezone);
	const todayInTz = DateTime.now().setZone(timezone);

	return timestampInTz.hasSame(todayInTz, "day");
}
