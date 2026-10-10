import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	type PlainDate,
	parsePlainTimeMinute,
	type ZonedDateTime,
} from "@/lib/datetime/temporal-core";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftEndsNextDay, shiftPlaceLabel } from "@/lib/scheduling/shift-labels";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";

/** The seven organization-local days of the week holding `anchor`, and their query range. */
export function employeeScheduleWeek(
	anchor: PlainDate,
	weekStartDay: WeekStartDay,
): { days: PlainDate[]; dateRange: DateRange } {
	const offset = weekStartDay === "monday" ? anchor.dayOfWeek - 1 : anchor.dayOfWeek % 7;
	const start = anchor.subtract({ days: offset });
	const days = Array.from({ length: 7 }, (_, index) => start.add({ days: index }));
	return {
		days,
		dateRange: { startDate: start.toString(), endDateExclusive: start.add({ days: 7 }).toString() },
	};
}

/**
 * The days a Schedule-X range shows, as a query range. The calendar runs in the organization's
 * zone; its range ends on (not after) the last shown day, so one day is added. A range ending
 * exactly at the next midnight only adds a day more, which is harmless for reading shifts.
 */
export function calendarRangeToDateRange(range: {
	start: ZonedDateTime;
	end: ZonedDateTime;
}): DateRange {
	return {
		startDate: range.start.toPlainDate().toString(),
		endDateExclusive: range.end.toPlainDate().add({ days: 1 }).toString(),
	};
}

/** Each day with its shifts, by shift date in the organization's zone and then by start time. */
export function groupShiftsByDay(
	shifts: ShiftWithRelations[],
	days: PlainDate[],
	organizationTimezone: string,
): Array<{ date: PlainDate; shifts: ShiftWithRelations[] }> {
	const byDay = new Map<string, ShiftWithRelations[]>();
	for (const shift of shifts) {
		const key = shiftCalendarDate(shift.date, organizationTimezone).toString();
		byDay.set(key, [...(byDay.get(key) ?? []), shift]);
	}
	return days.map((date) => ({
		date,
		shifts: (byDay.get(date.toString()) ?? []).toSorted((left, right) =>
			left.startTime.localeCompare(right.startTime),
		),
	}));
}

/**
 * A Schedule-X event for the employee's calendar. Schedule-X 4 takes timed events only as
 * `ZonedDateTime`, so wall times are placed in the organization's zone.
 */
export function employeeShiftEvent(
	shift: ShiftWithRelations,
	organizationTimezone: string,
	fallbackTitle: string,
) {
	const date = shiftCalendarDate(shift.date, organizationTimezone);
	const endDate = shiftEndsNextDay(shift) ? date.add({ days: 1 }) : date;
	return {
		id: shift.id,
		title: shiftPlaceLabel(shift.subarea?.location.name, shift.subarea?.name) || fallbackTitle,
		start: date
			.toPlainDateTime(parsePlainTimeMinute(shift.startTime))
			.toZonedDateTime(organizationTimezone),
		end: endDate
			.toPlainDateTime(parsePlainTimeMinute(shift.endTime))
			.toZonedDateTime(organizationTimezone),
		calendarId: "published",
	};
}
