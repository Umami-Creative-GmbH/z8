import { DateTime } from "luxon";
import { fromJSDate, parseISO } from "@/lib/datetime/luxon-utils";

export function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

export function formatDate(dateString: string | Date | DateTime): string {
	let dt: DateTime;

	if (typeof dateString === 'string') {
		dt = parseISO(dateString, 'utc');
	} else if (dateString instanceof Date) {
		dt = fromJSDate(dateString, 'utc');
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

	if (typeof dateString === 'string') {
		dt = parseISO(dateString, 'utc');
	} else if (dateString instanceof Date) {
		dt = fromJSDate(dateString, 'utc');
	} else {
		dt = dateString;
	}

	return dt.toFormat("HH:mm");
}

export function getWeekRange(date: Date | DateTime): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, 'utc') : date;

	return {
		start: dt.startOf('week'),
		end: dt.endOf('week')
	};
}

export function getMonthRange(date: Date | DateTime): { start: DateTime; end: DateTime } {
	const dt = date instanceof Date ? fromJSDate(date, 'utc') : date;

	return {
		start: dt.startOf('month'),
		end: dt.endOf('month')
	};
}

export function getTodayRange(): { start: DateTime; end: DateTime } {
	const today = DateTime.now();

	return {
		start: today.startOf('day'),
		end: today.endOf('day')
	};
}

export function calculateElapsedMinutes(startTime: Date | string | DateTime): number {
	let start: DateTime;

	if (typeof startTime === 'string') {
		start = parseISO(startTime, 'utc');
	} else if (startTime instanceof Date) {
		start = fromJSDate(startTime, 'utc');
	} else {
		start = startTime;
	}

	const now = DateTime.now();
	return Math.floor(now.diff(start, 'minutes').minutes);
}
