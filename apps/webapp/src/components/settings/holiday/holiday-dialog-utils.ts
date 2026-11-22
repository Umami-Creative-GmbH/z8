import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

export function formatHolidayDatePickerValue(value: Date | null | undefined) {
	return value && !Number.isNaN(value.getTime())
		? plainDateAt(instantFromDate(value), "UTC").toString()
		: "";
}

export function parseHolidayDatePickerValue(value: string) {
	if (!value) return null;
	try {
		return dateFromInstant(parsePlainDate(value).toZonedDateTime("UTC").toInstant());
	} catch {
		return null;
	}
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
