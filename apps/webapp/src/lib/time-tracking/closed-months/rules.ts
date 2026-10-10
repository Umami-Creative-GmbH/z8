import { Temporal } from "temporal-polyfill";
import { localMonthRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";

/**
 * The range and freeze rules of closed months (#762, Time Tracking ADR-0004).
 * A month is a calendar month written `YYYY-MM`; the database stores its first day.
 */

/** A calendar month, `YYYY-MM`. */
export type ClosedMonthKey = string;

/** One employee's closed range: the month in their timezone, fixed as instants. */
export interface ClosedRange {
	month: ClosedMonthKey;
	start: Instant;
	endExclusive: Instant;
}

/** Work as instants; live work has no end yet. */
export interface WorkInterval {
	start: Instant;
	end: Instant | null;
}

/** An absence's local days, inclusive. */
export interface DayRange {
	startDate: string;
	endDate: string;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})(?:-01)?$/;

/** Accepts `YYYY-MM` or the month's first day; anything else is a RangeError. */
export function parseClosedMonth(value: string): ClosedMonthKey {
	const match = MONTH_PATTERN.exec(value);
	if (!match) {
		throw new RangeError(`Not a calendar month: ${value}`);
	}
	return Temporal.PlainYearMonth.from(
		{
			year: Number(match[1]),
			month: Number(match[2]),
		},
		{ overflow: "reject" },
	).toString();
}

/** The stored first day (`YYYY-MM-01`) of a month. */
export function firstDayOfMonth(month: ClosedMonthKey): string {
	return `${parseClosedMonth(month)}-01`;
}

/** The month of a stored first day. */
export function monthOfFirstDay(firstDay: string): ClosedMonthKey {
	return parseClosedMonth(firstDay);
}

/** The month in the employee's effective timezone, as the instants a close fixes. */
export function employeeMonthRange(
	month: ClosedMonthKey,
	timezone: string,
): { start: Instant; endExclusive: Instant } {
	return localMonthRange(firstDayOfMonth(month), timezone);
}

/**
 * The first closed range any of the intervals touches, even in part. A writer
 * passes the work before and after its change. A moment equal to a range's
 * start is inside it; its exclusive end is not.
 */
export function closedRangeTouchedByWork(
	intervals: readonly WorkInterval[],
	ranges: readonly ClosedRange[],
): ClosedRange | null {
	for (const interval of intervals) {
		for (const range of ranges) {
			const startsBeforeRangeEnds = compareInstants(interval.start, range.endExclusive) < 0;
			const reachesRange = interval.end === null || compareInstants(interval.end, range.start) >= 0;
			if (startsBeforeRangeEnds && reachesRange) {
				return range;
			}
		}
	}
	return null;
}

/** The first closed month an absence's local days touch, even in part. */
export function closedMonthTouchedByDays(
	days: DayRange,
	months: readonly ClosedMonthKey[],
): ClosedMonthKey | null {
	const startDate = Temporal.PlainDate.from(days.startDate);
	const endDate = Temporal.PlainDate.from(days.endDate);
	for (const month of months) {
		const first = Temporal.PlainDate.from(firstDayOfMonth(month));
		const last = first.add({ months: 1 }).subtract({ days: 1 });
		if (
			Temporal.PlainDate.compare(startDate, last) <= 0 &&
			Temporal.PlainDate.compare(endDate, first) >= 0
		) {
			return month;
		}
	}
	return null;
}

/**
 * The month an automatic close is due for on the organization's local day:
 * the month before, once `afterDays` days have passed since it ended.
 */
export function autoCloseMonthDue(today: PlainDate, afterDays: number): ClosedMonthKey | null {
	const firstOfMonth = today.with({ day: 1 });
	if (Temporal.PlainDate.compare(today, firstOfMonth.add({ days: afterDays })) < 0) {
		return null;
	}
	return firstOfMonth.subtract({ months: 1 }).toPlainYearMonth().toString();
}
