import { DateTime } from "luxon";

export function formatDashboardDate(date: Date | string, locale: string) {
	const dateTime =
		date instanceof Date
			? DateTime.fromJSDate(date, { zone: "utc" })
			: DateTime.fromISO(date, { zone: "utc" });

	if (!dateTime.isValid) {
		return String(date);
	}

	return dateTime.setLocale(locale).toLocaleString({ month: "short", day: "numeric" });
}

export function formatDashboardDateWithYear(date: Date | string, locale: string) {
	const dateTime =
		date instanceof Date
			? DateTime.fromJSDate(date, { zone: "utc" })
			: DateTime.fromISO(date, { zone: "utc" });

	if (!dateTime.isValid) {
		return String(date);
	}

	return dateTime.setLocale(locale).toLocaleString({
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
