import { Temporal } from "temporal-polyfill";
import type { HolidayPreview } from "./holiday-import-state";

export function formatHolidayPreviewDate(date: string, locale: string) {
	const plainDate = Temporal.PlainDate.from(date.slice(0, 10));
	return Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
		new Date(`${plainDate.toString()}T00:00:00.000Z`),
	);
}

export function getPresetNameWithYear(baseName: string, year: number) {
	const trimmedName = baseName.trim();
	return trimmedName.endsWith(year.toString()) ? trimmedName : `${trimmedName} ${year}`;
}

export function getYearAssignmentRange(year: number) {
	const effectiveFrom = Temporal.ZonedDateTime.from({
		timeZone: "UTC",
		year,
		month: 1,
		day: 1,
		hour: 0,
	});
	const effectiveUntil = Temporal.ZonedDateTime.from({
		timeZone: "UTC",
		year,
		month: 12,
		day: 31,
		hour: 23,
		minute: 59,
		second: 59,
		millisecond: 999,
	});
	return {
		effectiveFrom: toUtcDate(effectiveFrom),
		effectiveUntil: toUtcDate(effectiveUntil),
	};
}

export function toUtcDate(dateTime: Temporal.ZonedDateTime) {
	return new Date(dateTime.epochMilliseconds);
}

export function getHolidayIdentity(holiday: HolidayPreview) {
	return `${holiday.name}\u0000${holiday.date}\u0000${holiday.type}\u0000${holiday.region ?? ""}\u0000${holiday.startDate}\u0000${holiday.endDate}`;
}

export function getHolidayCheckboxLabel(holiday: HolidayPreview) {
	return `${holiday.name}, ${holiday.date.slice(0, 10)}, ${holiday.type}`;
}

export function createRequestVersionGuard() {
	let version = 0;
	return {
		start: () => ++version,
		invalidate: () => ++version,
		isCurrent: (requestVersion: number) => requestVersion === version,
	};
}
