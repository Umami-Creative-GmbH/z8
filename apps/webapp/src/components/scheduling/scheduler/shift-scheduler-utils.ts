import { Temporal } from "temporal-polyfill";
import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

export function plainDateTimeToDateKey(dateTime: Temporal.PlainDateTime): string {
	return dateTime.toPlainDate().toString();
}

export function plainDateTimeToTimeString(dateTime: Temporal.PlainDateTime): string {
	return `${String(dateTime.hour).padStart(2, "0")}:${String(dateTime.minute).padStart(2, "0")}`;
}

export function shiftToEvent(shift: ShiftWithRelations, organizationTimezone = "Europe/Berlin") {
	const date = instantFromDate(shift.date)
		.toZonedDateTimeISO(parseIanaTimeZone(organizationTimezone))
		.toPlainDate();
	const start = date.toPlainDateTime(Temporal.PlainTime.from(shift.startTime));
	const end = date.toPlainDateTime(Temporal.PlainTime.from(shift.endTime));
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

export function getWeekDateRange(referenceDate = Temporal.Now.plainDateISO()): DateRange {
	const date = typeof referenceDate === "string" ? parsePlainDate(referenceDate) : referenceDate;
	const start = date.subtract({ days: date.dayOfWeek % 7 });

	return { startDate: start.toString(), endDateExclusive: start.add({ days: 7 }).toString() };
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

/** The week and day the scheduler opens on: the focus date, or today. */
export function initialSchedulerView(focusDate: string | null): {
	dateRange: DateRange;
	selectedDate: Temporal.PlainDate;
} {
	const selectedDate = focusDate ? parsePlainDate(focusDate) : Temporal.Now.plainDateISO();
	return { dateRange: getWeekDateRange(selectedDate), selectedDate };
}
