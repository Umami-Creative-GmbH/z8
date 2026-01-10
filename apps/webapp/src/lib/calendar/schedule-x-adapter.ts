import type { CalendarEvent, CalendarEventType } from "./types";

/**
 * Schedule-X event format
 * @see https://schedule-x.dev/docs/calendar/events
 */
export interface ScheduleXEvent {
	id: string;
	title: string;
	start: string; // "YYYY-MM-DD HH:mm"
	end: string; // "YYYY-MM-DD HH:mm"
	calendarId: CalendarEventType;
	_eventData: CalendarEvent; // Store original for details panel
}

/**
 * Color configuration for each calendar type
 * Matches existing legend colors
 */
export const calendarColors = {
	holiday: {
		colorName: "holiday",
		lightColors: {
			main: "#f59e0b", // Amber
			container: "#fef3c7",
			onContainer: "#92400e",
		},
		darkColors: {
			main: "#fbbf24",
			container: "#78350f",
			onContainer: "#fde68a",
		},
	},
	absence: {
		colorName: "absence",
		lightColors: {
			main: "#3b82f6", // Blue
			container: "#dbeafe",
			onContainer: "#1e40af",
		},
		darkColors: {
			main: "#60a5fa",
			container: "#1e3a8a",
			onContainer: "#bfdbfe",
		},
	},
	work_period: {
		colorName: "work_period",
		lightColors: {
			main: "#10b981", // Green (emerald)
			container: "#d1fae5",
			onContainer: "#065f46",
		},
		darkColors: {
			main: "#34d399",
			container: "#064e3b",
			onContainer: "#a7f3d0",
		},
	},
	time_entry: {
		colorName: "time_entry",
		lightColors: {
			main: "#8b5cf6", // Purple
			container: "#ede9fe",
			onContainer: "#5b21b6",
		},
		darkColors: {
			main: "#a78bfa",
			container: "#4c1d95",
			onContainer: "#ddd6fe",
		},
	},
} as const;

/**
 * Format a Date to Schedule-X format "YYYY-MM-DD HH:mm"
 */
export function formatDateForScheduleX(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format a Date to Schedule-X all-day format "YYYY-MM-DD"
 */
export function formatDateForScheduleXAllDay(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Transform a CalendarEvent to Schedule-X event format
 */
export function calendarEventToScheduleX(event: CalendarEvent): ScheduleXEvent {
	const startDate = new Date(event.date);
	const endDate = event.endDate ? new Date(event.endDate) : new Date(event.date);

	// Determine if this is an all-day event
	const isAllDay =
		event.type === "holiday" ||
		event.type === "absence" ||
		(event.type === "work_period" && !event.metadata.startTime);

	if (isAllDay) {
		// For all-day events, use date-only format
		// End date is exclusive in Schedule-X, so add 1 day
		const exclusiveEndDate = new Date(endDate);
		exclusiveEndDate.setDate(exclusiveEndDate.getDate() + 1);

		return {
			id: event.id,
			title: event.title,
			start: formatDateForScheduleXAllDay(startDate),
			end: formatDateForScheduleXAllDay(exclusiveEndDate),
			calendarId: event.type,
			_eventData: event,
		};
	}

	// For time-based events (time entries, work periods with times)
	let start: string;
	let end: string;

	if (event.type === "time_entry") {
		// Time entries are point-in-time, show as 30-minute block
		const entryTime = event.metadata.time
			? new Date(`${formatDateForScheduleXAllDay(startDate)}T${event.metadata.time}`)
			: startDate;
		const entryEndTime = new Date(entryTime);
		entryEndTime.setMinutes(entryEndTime.getMinutes() + 30);

		start = formatDateForScheduleX(entryTime);
		end = formatDateForScheduleX(entryEndTime);
	} else if (event.type === "work_period" && event.metadata.startTime && event.metadata.endTime) {
		// Work periods with specific times
		const periodStart = new Date(
			`${formatDateForScheduleXAllDay(startDate)}T${event.metadata.startTime}`,
		);
		const periodEnd = new Date(
			`${formatDateForScheduleXAllDay(startDate)}T${event.metadata.endTime}`,
		);

		start = formatDateForScheduleX(periodStart);
		end = formatDateForScheduleX(periodEnd);
	} else {
		// Fallback: full day
		startDate.setHours(0, 0, 0, 0);
		endDate.setHours(23, 59, 0, 0);
		start = formatDateForScheduleX(startDate);
		end = formatDateForScheduleX(endDate);
	}

	return {
		id: event.id,
		title: event.title,
		start,
		end,
		calendarId: event.type,
		_eventData: event,
	};
}

/**
 * Transform multiple CalendarEvents to Schedule-X events
 */
export function calendarEventsToScheduleX(events: CalendarEvent[]): ScheduleXEvent[] {
	return events.map(calendarEventToScheduleX);
}

/**
 * Get Schedule-X calendars configuration
 */
export function getScheduleXCalendars() {
	return {
		holiday: calendarColors.holiday,
		absence: calendarColors.absence,
		work_period: calendarColors.work_period,
		time_entry: calendarColors.time_entry,
	};
}
