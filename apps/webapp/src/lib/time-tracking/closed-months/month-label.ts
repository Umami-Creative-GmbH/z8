import { Temporal } from "temporal-polyfill";

/**
 * `2026-03` as `March 2026` in the reader's locale, for closed-month display
 * (#762). Safe on client and server; an unknown locale falls back to English.
 */
export function formatClosedMonthLabel(month: string, locale: string): string {
	const date = new Date(`${month}-01T00:00:00Z`);
	const options = { month: "long", year: "numeric", timeZone: "UTC" } as const;
	try {
		return new Intl.DateTimeFormat(locale, options).format(date);
	} catch {
		return new Intl.DateTimeFormat("en", options).format(date);
	}
}

/**
 * The calendar months (`YYYY-MM`) a range of local dates (or ISO date-times)
 * touches, oldest first; none for an unreadable or reversed range.
 */
export function monthsOfDateRange(startDate: string, endDate: string): string[] {
	let first: Temporal.PlainYearMonth;
	let last: Temporal.PlainYearMonth;
	try {
		first = Temporal.PlainYearMonth.from(startDate.slice(0, 7));
		last = Temporal.PlainYearMonth.from(endDate.slice(0, 7));
	} catch {
		return [];
	}
	const months: string[] = [];
	for (
		let month = first;
		Temporal.PlainYearMonth.compare(month, last) <= 0 && months.length < 240;
		month = month.add({ months: 1 })
	) {
		months.push(month.toString());
	}
	return months;
}
