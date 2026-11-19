import { Temporal } from "temporal-polyfill";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";

export type PayrollReadinessSearchParams = {
	start?: string;
	end?: string;
};

/**
 * The payroll-readiness period as UTC calendar days (`?start=&end=`, inclusive).
 * Readiness checks run from the start of `start` to the end of `end`, in UTC.
 */
export interface PayrollReadinessPeriod {
	start: Temporal.PlainDate;
	end: Temporal.PlainDate;
	/** The calendar month the period covers exactly, if it is one whole month. */
	month: Temporal.PlainYearMonth | null;
}

const PAYROLL_READINESS_PATH = "/settings/payroll-readiness";

/**
 * The requested period, each bound falling back on its own to the previous UTC
 * month (the page's default since its introduction). `today` is the UTC date.
 */
export function resolvePayrollReadinessPeriod(
	searchParams: PayrollReadinessSearchParams,
	today: Temporal.PlainDate,
): PayrollReadinessPeriod {
	const defaultMonth = defaultPayrollReadinessMonth(today);
	const start = parseUtcDate(searchParams.start) ?? firstDayOf(defaultMonth);
	const end = parseUtcDate(searchParams.end) ?? lastDayOf(defaultMonth);

	return { start, end, month: wholeMonthOf(start, end) };
}

/** The month the page opens on: the month before today's UTC month. */
export function defaultPayrollReadinessMonth(today: Temporal.PlainDate) {
	return today.toPlainYearMonth().subtract({ months: 1 });
}

/** The page URL for one whole calendar month, in the page's `?start=&end=` convention. */
export function payrollReadinessMonthHref(month: Temporal.PlainYearMonth) {
	const query = new URLSearchParams({
		start: firstDayOf(month).toString(),
		end: lastDayOf(month).toString(),
	});
	return `${PAYROLL_READINESS_PATH}?${query.toString()}`;
}

/** The month a previous/next step starts from: the month the period starts in. */
export function payrollReadinessAnchorMonth(period: PayrollReadinessPeriod) {
	return period.month ?? period.start.toPlainYearMonth();
}

export function formatPayrollReadinessMonth(month: Temporal.PlainYearMonth, locale: string) {
	return formatPlainDate(firstDayOf(month), locale, "monthYear");
}

/** "June 2026" for a whole month, else the locale's date range ("1–15 Jun 2026"). */
export function formatPayrollReadinessPeriod(period: PayrollReadinessPeriod, locale: string) {
	if (period.month) return formatPayrollReadinessMonth(period.month, locale);
	if (Temporal.PlainDate.compare(period.start, period.end) > 0) {
		return `${formatPlainDate(period.start, locale, "dateMedium")} – ${formatPlainDate(period.end, locale, "dateMedium")}`;
	}
	return formatPlainDateRange(period.start, period.end, locale, "dateMedium");
}

function firstDayOf(month: Temporal.PlainYearMonth) {
	return month.toPlainDate({ day: 1 });
}

function lastDayOf(month: Temporal.PlainYearMonth) {
	return month.toPlainDate({ day: month.daysInMonth });
}

function wholeMonthOf(start: Temporal.PlainDate, end: Temporal.PlainDate) {
	const month = start.toPlainYearMonth();
	return start.equals(firstDayOf(month)) && end.equals(lastDayOf(month)) ? month : null;
}

/**
 * A `?start=`/`?end=` value as a UTC calendar day: a date, a date-time read in
 * UTC, or an instant with an offset converted to UTC; anything else is unread.
 */
function parseUtcDate(value: string | undefined): Temporal.PlainDate | null {
	if (!value) return null;
	try {
		return Temporal.Instant.from(value).toZonedDateTimeISO("UTC").toPlainDate();
	} catch {
		// Not an instant: a plain date or date-time follows.
	}
	try {
		return Temporal.PlainDate.from(value, { overflow: "reject" });
	} catch {
		return null;
	}
}
