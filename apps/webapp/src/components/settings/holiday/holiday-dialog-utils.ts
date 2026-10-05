import { DateTime } from "luxon";

export function formatHolidayDatePickerValue(value: Date | null | undefined) {
	return value && !Number.isNaN(value.getTime())
		? DateTime.fromJSDate(value, { zone: "utc" }).toISODate()
		: "";
}

export function parseHolidayDatePickerValue(value: string) {
	const date = DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? date.toJSDate() : null;
}

export { createYearlyHolidayRecurrenceRule } from "@/lib/holidays/recurrence";

export function getEndDateAfterStartDateChange({
	isEditing,
	nextStartDate,
	currentEndDate,
}: {
	isEditing: boolean;
	nextStartDate: Date;
	currentEndDate: Date;
}) {
	return isEditing ? currentEndDate : nextStartDate;
}
