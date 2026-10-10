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

/** The calendar months (`YYYY-MM`) a range of local dates touches, oldest first. */
export function monthsOfDateRange(startDate: string, endDate: string): string[] {
	const months: string[] = [];
	let [year, month] = startDate.slice(0, 7).split("-").map(Number);
	const [lastYear, lastMonth] = endDate.slice(0, 7).split("-").map(Number);
	while ((year < lastYear || (year === lastYear && month <= lastMonth)) && months.length < 240) {
		months.push(`${year}-${String(month).padStart(2, "0")}`);
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
	}
	return months;
}
