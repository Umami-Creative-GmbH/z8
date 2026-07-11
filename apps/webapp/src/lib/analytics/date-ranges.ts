import { instantFromDate } from "@/lib/datetime/temporal-core";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import { resolveReportDateRange } from "@/lib/reports/report-date-range";
import type { PeriodPreset, ReportDateRange } from "@/lib/reports/types";
import { parseTimeZone } from "@/lib/timezone/validation";
import type { DateRange } from "./types";

export function toAnalyticsDateRange(
	{ startDate, endDate }: ReportDateRange,
	timezone = "UTC",
): DateRange {
	const range = resolveReportDateRange(startDate, endDate, timezone);

	return {
		start: new Date(range.start.epochMilliseconds),
		end: new Date(range.endExclusive.epochMilliseconds - 1),
		startDate,
		endDate,
		timezone: range.timezone,
	};
}

export function toReportDateRange(
	{ start, end, startDate, endDate, timezone: rangeTimezone }: DateRange,
	timezone = rangeTimezone ?? "UTC",
): ReportDateRange {
	if (startDate && endDate) return { startDate, endDate };
	const resolvedTimezone = parseTimeZone(timezone);

	return {
		startDate: instantFromDate(start).toZonedDateTimeISO(resolvedTimezone).toPlainDate().toString(),
		endDate: instantFromDate(end).toZonedDateTimeISO(resolvedTimezone).toPlainDate().toString(),
	};
}

export function getAnalyticsDateRangeForPreset(
	preset: PeriodPreset,
	options?: Parameters<typeof getDateRangeForPreset>[1],
): DateRange {
	const timezone = typeof options === "number" ? "UTC" : (options?.timezone ?? "UTC");
	return toAnalyticsDateRange(getDateRangeForPreset(preset, options), timezone);
}
