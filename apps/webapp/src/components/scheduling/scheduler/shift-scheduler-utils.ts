import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

export function dateToPlainDateTime(date: Date): Temporal.PlainDateTime {
	return Temporal.PlainDateTime.from({
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
		hour: date.getHours(),
		minute: date.getMinutes(),
	});
}

export function plainDateTimeToDate(dateTime: Temporal.PlainDateTime): Date {
	return new Date(dateTime.year, dateTime.month - 1, dateTime.day);
}

export function plainDateTimeToTimeString(dateTime: Temporal.PlainDateTime): string {
	return `${String(dateTime.hour).padStart(2, "0")}:${String(dateTime.minute).padStart(2, "0")}`;
}

export function shiftToEvent(shift: ShiftWithRelations) {
	const startDate = new Date(shift.date);
	const [startHours, startMinutes] = shift.startTime.split(":").map(Number);
	startDate.setHours(startHours, startMinutes, 0, 0);

	const endDate = new Date(shift.date);
	const [endHours, endMinutes] = shift.endTime.split(":").map(Number);
	endDate.setHours(endHours, endMinutes, 0, 0);

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
		start: dateToPlainDateTime(startDate),
		end: dateToPlainDateTime(endDate),
		calendarId: isOpenShift ? "open" : isDraft ? "draft" : "published",
		_shiftData: shift,
	};
}

export function getWeekDateRange(referenceDate = new Date()): DateRange {
	const dayOfWeek = referenceDate.getDay();
	const start = new Date(referenceDate);
	start.setDate(referenceDate.getDate() - dayOfWeek);
	start.setHours(0, 0, 0, 0);

	const end = new Date(start);
	end.setDate(start.getDate() + 6);
	end.setHours(23, 59, 59, 999);

	return { start, end };
}
