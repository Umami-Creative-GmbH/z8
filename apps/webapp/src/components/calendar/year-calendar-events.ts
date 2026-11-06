import { Temporal } from "temporal-polyfill";
import { allDayDateKeyForDate, calendarDateKeyForDate } from "@/lib/calendar/date-keys";
import type { CalendarEvent } from "@/lib/calendar/types";

export function groupYearCalendarEventsByDate(
	events: CalendarEvent[],
	timeZone: string,
): Map<string, CalendarEvent[]> {
	const eventsByDate = new Map<string, CalendarEvent[]>();
	for (const event of events) {
		const isAllDay = event.type === "absence" || event.type === "holiday";
		const start = Temporal.PlainDate.from(
			isAllDay ? allDayDateKeyForDate(event.date) : calendarDateKeyForDate(event.date, timeZone),
		);
		const end =
			isAllDay && event.endDate
				? Temporal.PlainDate.from(allDayDateKeyForDate(event.endDate))
				: start;
		// All-day event end dates are inclusive, just as in the month view.
		const lastDay = Temporal.PlainDate.compare(end, start) < 0 ? start : end;
		for (
			let date = start;
			Temporal.PlainDate.compare(date, lastDay) <= 0;
			date = date.add({ days: 1 })
		) {
			const dateKey = date.toString();
			const existing = eventsByDate.get(dateKey) ?? [];
			existing.push(event);
			eventsByDate.set(dateKey, existing);
		}
	}
	return eventsByDate;
}
