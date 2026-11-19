import { Temporal } from "temporal-polyfill";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type { PayrollExportJobSummary } from "@/lib/payroll-export/types";

/**
 * An export's range is logical payroll dates (the first ten characters of each
 * stored bound), not instants: a whole calendar month shows as that month, any
 * other range as its dates, both in the reader's locale.
 */
export function formatPayrollExportRange(
	filters: PayrollExportJobSummary["filters"],
	locale: string,
): string {
	const startValue = String(filters.dateRange.start).slice(0, 10);
	const endValue = String(filters.dateRange.end).slice(0, 10);
	let start: Temporal.PlainDate;
	let end: Temporal.PlainDate;
	try {
		start = Temporal.PlainDate.from(startValue);
		end = Temporal.PlainDate.from(endValue);
	} catch {
		return `${startValue} – ${endValue}`;
	}

	const month = start.toPlainYearMonth();
	if (start.day === 1 && end.equals(month.toPlainDate({ day: month.daysInMonth }))) {
		return formatPlainDate(start, locale, "monthYear");
	}
	if (Temporal.PlainDate.compare(start, end) > 0) {
		return `${formatPlainDate(start, locale, "dateMedium")} – ${formatPlainDate(end, locale, "dateMedium")}`;
	}
	return formatPlainDateRange(start, end, locale, "dateMedium");
}

/** When an export was requested: an audit instant, in the organization's zone, zone named. */
export function createPayrollExportTimeFormatter(locale: string, timeZone: string) {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
		timeZoneName: "short",
	};
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat(locale, options);
	} catch {
		formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	}
	return (createdAt: Date | string) =>
		formatter.format(instantFromDate(new Date(createdAt)).epochMilliseconds);
}
