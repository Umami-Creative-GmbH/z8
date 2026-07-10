import { Temporal } from "temporal-polyfill";
import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";

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
