import type { CalendarEvent } from "@/lib/calendar/types";
import type { AbsenceWithCategory, Holiday } from "./types";

// Color mapping based on absence status
const statusColors = {
	approved: "#3b82f6", // blue-500
	pending: "#eab308", // yellow-500
	rejected: "#ef4444", // red-500
};

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Transform AbsenceWithCategory[] to CalendarEvent[]
 * Creates one event per day for multi-day absences
 */
export function absencesToCalendarEvents(absences: AbsenceWithCategory[]): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	for (const absence of absences) {
		const startDate = new Date(absence.startDate);
		const endDate = new Date(absence.endDate);

		// For multi-day absences, create an event for each day
		const current = new Date(startDate);
		while (current <= endDate) {
			events.push({
				id: `absence-${absence.id}-${formatDateKey(current)}`,
				type: "absence",
				date: new Date(current),
				title: absence.category.name,
				description: absence.notes || undefined,
				color: statusColors[absence.status],
				metadata: {
					absenceId: absence.id,
					categoryName: absence.category.name,
					categoryType: absence.category.type,
					categoryColor: absence.category.color,
					status: absence.status,
					startDate: absence.startDate,
					endDate: absence.endDate,
					startPeriod: absence.startPeriod,
					endPeriod: absence.endPeriod,
				},
			});
			current.setDate(current.getDate() + 1);
		}
	}

	return events;
}

/**
 * Transform Holiday[] to CalendarEvent[]
 * Creates one event per day for multi-day holidays
 */
export function holidaysToCalendarEvents(holidays: Holiday[]): CalendarEvent[] {
	const events: CalendarEvent[] = [];

	for (const holiday of holidays) {
		const startDate = new Date(holiday.startDate);
		const endDate = new Date(holiday.endDate);

		// For multi-day holidays, create an event for each day
		const current = new Date(startDate);
		while (current <= endDate) {
			events.push({
				id: `holiday-${holiday.id}-${formatDateKey(current)}`,
				type: "holiday",
				date: new Date(current),
				title: holiday.name,
				color: "#f59e0b", // amber-500
				metadata: {
					holidayId: holiday.id,
					name: holiday.name,
				},
			});
			current.setDate(current.getDate() + 1);
		}
	}

	return events;
}

/**
 * Combine absences and holidays into a single CalendarEvent array
 */
export function toCalendarEvents(
	absences: AbsenceWithCategory[],
	holidays: Holiday[],
): CalendarEvent[] {
	return [...absencesToCalendarEvents(absences), ...holidaysToCalendarEvents(holidays)];
}
