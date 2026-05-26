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

export function createYearlyHolidayRecurrenceRule(value: Date) {
	return JSON.stringify({ month: value.getUTCMonth() + 1, day: value.getUTCDate() });
}
