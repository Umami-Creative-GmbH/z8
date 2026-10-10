/**
 * Display helpers for sick notes on absences (#982), shared by server and
 * client code, so they import nothing server-only.
 */

function utcDay(plainDay: string): Date {
	// A plain calendar day; formatted in UTC so no viewer zone shifts it.
	return new Date(`${plainDay}T00:00:00Z`);
}

/**
 * An absence's date range in the locale, e.g. "12–14 Oct 2026" (en-GB) or
 * "12. Okt. 2026" for a single day in German. Dates are YYYY-MM-DD.
 */
export function formatAbsenceDateRange(startDate: string, endDate: string, locale: string): string {
	const format = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	if (startDate === endDate) return format.format(utcDay(startDate));
	return format.formatRange(utcDay(startDate), utcDay(endDate));
}
