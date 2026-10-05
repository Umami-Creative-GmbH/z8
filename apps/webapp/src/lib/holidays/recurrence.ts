import { Temporal } from "temporal-polyfill";

export function holidayCalendarDate(value: Date): Temporal.PlainDate {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO("UTC")
		.toPlainDate();
}

export function createYearlyHolidayRecurrenceRule(value: Date): string {
	const { month, day } = holidayCalendarDate(value);
	return JSON.stringify({ month, day });
}
