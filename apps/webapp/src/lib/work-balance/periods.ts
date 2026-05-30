import { DateTime } from "luxon";

export interface DateRangeIso {
	startDate: string;
	endDate: string;
}

export interface PeriodRangeIso {
	periodStart: string;
	periodEnd: string;
}

function parseIsoDate(date: string) {
	return DateTime.fromISO(date, { zone: "utc" }).startOf("day");
}

function toIsoDate(date: DateTime) {
	if (!date.isValid) {
		throw new RangeError(
			`Invalid date: ${date.invalidExplanation ?? date.invalidReason ?? "unknown reason"}`,
		);
	}

	const isoDate = date.toISODate();
	if (isoDate === null) {
		throw new RangeError("Invalid date: unable to convert to ISO date");
	}

	return isoDate;
}

export function getHotWindowRange(now = new Date()): DateRangeIso {
	const today = DateTime.fromJSDate(now, { zone: "utc" }).startOf("day");
	return {
		startDate: toIsoDate(today.startOf("month").minus({ months: 2 })),
		endDate: toIsoDate(today),
	};
}

export function getClosedMonthRange(date: string): PeriodRangeIso {
	const cursor = parseIsoDate(date);
	return {
		periodStart: toIsoDate(cursor.startOf("month")),
		periodEnd: toIsoDate(cursor.endOf("month").startOf("day")),
	};
}

export function getYearPeriodForDate(date: string): PeriodRangeIso {
	const cursor = parseIsoDate(date);
	return {
		periodStart: toIsoDate(cursor.startOf("year")),
		periodEnd: toIsoDate(cursor.endOf("year").startOf("day")),
	};
}

export function getMonthPeriodsBetween(startDate: string, endDate: string): PeriodRangeIso[] {
	const start = parseIsoDate(startDate).startOf("month");
	const end = parseIsoDate(endDate).startOf("month");
	if (!start.isValid || !end.isValid || end < start) return [];

	const periods: PeriodRangeIso[] = [];
	for (let cursor = start; cursor <= end; cursor = cursor.plus({ months: 1 })) {
		periods.push(getClosedMonthRange(toIsoDate(cursor)));
	}
	return periods;
}

export function isBeforeHotWindow(date: string, now = new Date()): boolean {
	return date < getHotWindowRange(now).startDate;
}
