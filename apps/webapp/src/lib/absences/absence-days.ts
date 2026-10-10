import { Temporal } from "temporal-polyfill";
import type { DayPeriod, Holiday } from "./types";

/** Whether a calendar day is a working day for one employee (Absences glossary). */
export type IsWorkingDay = (day: Temporal.PlainDate) => boolean;

/** The working days of an employee whose policy has no schedule, or who has no policy. */
export const mondayToFriday: IsWorkingDay = (day) => day.dayOfWeek <= 5;

export interface AbsenceDayRange {
	startDate: string; // YYYY-MM-DD
	startPeriod: DayPeriod;
	endDate: string; // YYYY-MM-DD
	endPeriod: DayPeriod;
}

// Holiday timestamps encode inclusive calendar dates in UTC, independent of the viewer's zone.
export function utcHolidayDate(value: Date): Temporal.PlainDate {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO("UTC")
		.toPlainDate();
}

/** Every calendar date (`YYYY-MM-DD`) the holidays cover. */
export function holidayDateKeys(holidays: readonly Holiday[]): Set<string> {
	const dateKeys = new Set<string>();
	for (const holiday of holidays) {
		const holidayEnd = utcHolidayDate(holiday.endDate);
		for (
			let day = utcHolidayDate(holiday.startDate);
			Temporal.PlainDate.compare(day, holidayEnd) <= 0;
			day = day.add({ days: 1 })
		) {
			dateKeys.add(day.toString());
		}
	}
	return dateKeys;
}

/**
 * The absence days of a range: each working day counts 1, and a morning or afternoon half on
 * the start or end day counts ½. Non-working days count nothing, halves included.
 */
export function countAbsenceDays(range: AbsenceDayRange, isWorkingDay: IsWorkingDay): number {
	const { startPeriod, endPeriod } = range;
	const start = Temporal.PlainDate.from(range.startDate);
	const end = Temporal.PlainDate.from(range.endDate);
	if (Temporal.PlainDate.compare(start, end) > 0) {
		throw new Error("Start date must be before or equal to end date");
	}
	let total = 0;
	for (let day = start; Temporal.PlainDate.compare(day, end) <= 0; day = day.add({ days: 1 })) {
		if (!isWorkingDay(day)) continue;
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

/**
 * The part of a range inside a window of calendar days. An end cut by the window becomes a full
 * day there; null when the range lies outside the window.
 */
export function clipAbsenceDayRange(
	range: AbsenceDayRange,
	within: { startDate: string; endDate: string },
): AbsenceDayRange | null {
	const startsInside = range.startDate >= within.startDate;
	const endsInside = range.endDate <= within.endDate;
	const startDate = startsInside ? range.startDate : within.startDate;
	const endDate = endsInside ? range.endDate : within.endDate;
	if (startDate > endDate) return null;
	return {
		startDate,
		startPeriod: startsInside ? range.startPeriod : "full_day",
		endDate,
		endPeriod: endsInside ? range.endPeriod : "full_day",
	};
}

/** Why an absence request is refused for its absence days. */
export type AbsenceDaysRefusal = "no_working_days";

export const NO_WORKING_DAYS_MESSAGE = "This range contains no working days.";

/**
 * Vacation that covers no working day is refused; categories that don't count against
 * vacation, such as sick leave, are accepted with 0 absence days.
 */
export function refusalForAbsenceDays(input: {
	countsAgainstVacation: boolean;
	absenceDays: number;
}): AbsenceDaysRefusal | null {
	return input.countsAgainstVacation && input.absenceDays <= 0 ? "no_working_days" : null;
}
