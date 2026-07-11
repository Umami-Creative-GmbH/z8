import { allDayDateKeyForDate, calendarDateKeyForDate } from "@/lib/calendar/date-keys";
import type { CalendarEvent } from "@/lib/calendar/types";

export function groupYearCalendarEventsByDate(
	events: CalendarEvent[],
	timeZone: string,
): Map<string, CalendarEvent[]> {
	const eventsByDate = new Map<string, CalendarEvent[]>();
	for (const event of events) {
		const dateKey =
			event.type === "absence" || event.type === "holiday"
				? allDayDateKeyForDate(event.date)
				: calendarDateKeyForDate(event.date, timeZone);
		const existing = eventsByDate.get(dateKey) ?? [];
		existing.push(event);
		eventsByDate.set(dateKey, existing);
	}
	return eventsByDate;
}
