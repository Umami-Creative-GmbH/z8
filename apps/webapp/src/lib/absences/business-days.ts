import { Temporal } from "temporal-polyfill";
import type { DayPeriod, Holiday } from "./types";

// Holiday timestamps encode inclusive calendar dates in UTC, independent of the viewer's zone.
export function utcHolidayDate(value: Date): Temporal.PlainDate {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO("UTC")
		.toPlainDate();
}

export function countBusinessDays(
	startDate: string,
	startPeriod: DayPeriod,
	endDate: string,
	endPeriod: DayPeriod,
	holidays: Holiday[],
): number {
	const start = Temporal.PlainDate.from(startDate);
	const end = Temporal.PlainDate.from(endDate);
	if (Temporal.PlainDate.compare(start, end) > 0) {
		throw new Error("Start date must be before or equal to end date");
	}
	const holidayDates = new Set<string>();
	for (const holiday of holidays) {
		const holidayEnd = utcHolidayDate(holiday.endDate);
		for (
			let day = utcHolidayDate(holiday.startDate);
			Temporal.PlainDate.compare(day, holidayEnd) <= 0;
			day = day.add({ days: 1 })
		) {
			holidayDates.add(day.toString());
		}
	}
	let total = 0;
	for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) {
		if (day.dayOfWeek > 5 || holidayDates.has(day.toString())) continue;
		if (start.equals(end)) {
			total +=
				startPeriod === "full_day" || endPeriod === "full_day" || startPeriod !== endPeriod
					? 1
					: 0.5;
		} else if (day.equals(start) && startPeriod === "pm") {
			total += 0.5;
		} else if (day.equals(end) && endPeriod === "am") {
			total += 0.5;
		} else {
			total += 1;
		}
	}
	return total;
}
