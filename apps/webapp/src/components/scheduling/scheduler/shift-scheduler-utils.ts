import { Temporal } from "temporal-polyfill";
import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	type PlainDate,
	parsePlainDate,
	parsePlainTimeMinute,
	type ZonedDateTime,
} from "@/lib/datetime/temporal-core";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

function formatWallTime(dateTime: { hour: number; minute: number }): string {
	return `${String(dateTime.hour).padStart(2, "0")}:${String(dateTime.minute).padStart(2, "0")}`;
}

/**
 * A Schedule-X event for the planner. Schedule-X 4 takes timed events only as `ZonedDateTime`, so
 * the shift's wall times are placed on its calendar date in the organization's zone. A shift
 * ending at or before its start ends on the next day.
 */
export function shiftToEvent(shift: ShiftWithRelations, organizationTimezone: string) {
	const timeZone = parseIanaTimeZone(organizationTimezone);
	const date = shiftCalendarDate(shift.date, timeZone);
	const endDate = shift.endTime <= shift.startTime ? date.add({ days: 1 }) : date;
	const start = date
		.toPlainDateTime(parsePlainTimeMinute(shift.startTime))
		.toZonedDateTime(timeZone);
	const end = endDate
		.toPlainDateTime(parsePlainTimeMinute(shift.endTime))
		.toZonedDateTime(timeZone);
	const isOpenShift = !shift.employeeId;
	const isDraft = shift.status === "draft";

	let title = isOpenShift
		? "Open Shift"
		: `${shift.employee?.firstName || ""} ${shift.employee?.lastName || ""}`.trim() || "Assigned";

	if (isDraft) {
		title = `[Draft] ${title}`;
	}

	return {
		id: shift.id,
		title,
		start,
		end,
		calendarId: isOpenShift ? "open" : isDraft ? "draft" : "published",
		_shiftData: shift,
	};
}

/**
 * The calendar date and wall times of a moved Schedule-X event, read in the organization's zone.
 * An end on the next day keeps its wall time, which marks the shift as overnight.
 */
export function eventToShiftTimes(
	event: { start: ZonedDateTime; end: ZonedDateTime },
	organizationTimezone: string,
): { date: string; startTime: string; endTime: string } {
	const timeZone = parseIanaTimeZone(organizationTimezone);
	const start = event.start.withTimeZone(timeZone);
	const end = event.end.withTimeZone(timeZone);
	return {
		date: start.toPlainDate().toString(),
		startTime: formatWallTime(start),
		endTime: formatWallTime(end),
	};
}

/** The seven days of the week holding `referenceDate`, as a query range. */
export function getWeekDateRange(
	referenceDate: PlainDate | string,
	weekStartDay: WeekStartDay,
): DateRange {
	const date = typeof referenceDate === "string" ? parsePlainDate(referenceDate) : referenceDate;
	const offset = weekStartDay === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
	const start = date.subtract({ days: offset });

	return { startDate: start.toString(), endDateExclusive: start.add({ days: 7 }).toString() };
}

/** Schedule-X's `firstDayOfWeek` (1 = Monday … 7 = Sunday) for a week start preference. */
export function scheduleXFirstDayOfWeek(weekStartDay: WeekStartDay): 1 | 7 {
	return weekStartDay === "monday" ? 1 : 7;
}

/**
 * The days a Schedule-X range shows, as a query range. The calendar runs in the organization's
 * zone and its range ends on (not after) the last shown day, so one day is added.
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

/** A schedule opened for one employee around one date, e.g. from a departure. */
export type SchedulerFocus = { employeeId: string | null; date: string | null };

/** Reads the focus from URL parameters; malformed values are ignored. */
export function parseSchedulerFocus(input: { employeeId?: string; date?: string }): SchedulerFocus {
	let date: string | null = null;
	if (input.date) {
		try {
			date = parsePlainDate(input.date).toString();
		} catch {
			date = null;
		}
	}
	return { employeeId: isCanonicalUuid(input.employeeId) ? input.employeeId : null, date };
}

/** Keeps one employee's shifts; without a focus every shift is shown. */
export function filterShiftsForEmployee<TShift extends { employeeId: string | null }>(
	shifts: TShift[],
	employeeId: string | null,
): TShift[] {
	return employeeId === null ? shifts : shifts.filter((shift) => shift.employeeId === employeeId);
}

/**
 * The week and day the scheduler opens on: the focus date, or today in the organization's zone.
 * The week starts on `weekStartDay`, matching the calendar's `firstDayOfWeek`, because Schedule-X
 * doesn't report its first range.
 */
export function initialSchedulerView(
	focusDate: string | null,
	organizationTimezone: string,
	weekStartDay: WeekStartDay,
): { dateRange: DateRange; selectedDate: PlainDate } {
	const selectedDate = focusDate
		? parsePlainDate(focusDate)
		: Temporal.Now.plainDateISO(parseIanaTimeZone(organizationTimezone));
	return { dateRange: getWeekDateRange(selectedDate, weekStartDay), selectedDate };
}
