import { Temporal } from "temporal-polyfill";
import type { AssignedHolidayRange, RequestedDateRange } from "@/lib/calendar/assigned-holidays";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { holidayStoredDates } from "@/lib/holidays/recurrence";
import type { PayrollPeriodHolidaySource, PayrollPeriodRange } from "./types";

/**
 * The range a payroll period asks the assigned-holiday reader for: its first day's UTC
 * midnight to the end of its last day, in the UTC-date encoding holidays are stored in.
 */
export function payrollHolidayRequestRange(period: PayrollPeriodRange): RequestedDateRange {
	return {
		startDate: new Date(parsePlainDate(period.startDate).toZonedDateTime("UTC").epochMilliseconds),
		endDate: new Date(
			parsePlainDate(period.endDate)
				.add({ days: 1 })
				.toZonedDateTime("UTC")
				.toInstant()
				.subtract({ milliseconds: 1 }).epochMilliseconds,
		),
	};
}

/** Each assigned holiday on its inclusive calendar dates, clipped to the period. */
export function payrollHolidaySources(
	ranges: readonly Pick<AssignedHolidayRange, "name" | "startDate" | "endDate">[],
	period: PayrollPeriodRange,
): PayrollPeriodHolidaySource[] {
	const periodStart = parsePlainDate(period.startDate);
	const periodEnd = parsePlainDate(period.endDate);
	return ranges.flatMap((range) => {
		const dates = holidayStoredDates(range.startDate, range.endDate);
		const startDate =
			Temporal.PlainDate.compare(dates.start, periodStart) < 0 ? periodStart : dates.start;
		const endDate = Temporal.PlainDate.compare(dates.end, periodEnd) > 0 ? periodEnd : dates.end;
		return Temporal.PlainDate.compare(startDate, endDate) <= 0
			? [{ name: range.name, startDate: startDate.toString(), endDate: endDate.toString() }]
			: [];
	});
}
