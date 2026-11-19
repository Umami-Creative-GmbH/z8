import "server-only";

import { Temporal } from "temporal-polyfill";
import { dateFromInstant, type PlainDate } from "@/lib/datetime/temporal-core";
import { getAbsenceEntries, getHolidays } from "./queries";

/** Holiday reads take a `Date` and use its UTC calendar day. */
function holidayBoundary(date: PlainDate) {
	return dateFromInstant(date.toZonedDateTime("UTC").toInstant());
}

/**
 * One employee's absences and holidays for a calendar year. Both are calendar dates, so the
 * range is the year's first and last day in any timezone. The caller has resolved
 * `employeeId` to the current employee.
 */
export async function readAbsenceCalendarYear(employeeId: string, year: number) {
	const firstDay = Temporal.PlainDate.from({ year, month: 1, day: 1 });
	const lastDay = Temporal.PlainDate.from({ year, month: 12, day: 31 });
	const [absences, holidays] = await Promise.all([
		getAbsenceEntries(employeeId, firstDay.toString(), lastDay.toString()),
		getHolidays(employeeId, holidayBoundary(firstDay), holidayBoundary(lastDay)),
	]);
	return { absences, holidays };
}
