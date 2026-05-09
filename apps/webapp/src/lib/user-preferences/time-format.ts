export type TimeFormat = "24h" | "12h";

export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";

export const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string; example: string }> = [
	{ value: "24h", label: "24-hour", example: "08:00" },
	{ value: "12h", label: "12-hour", example: "8:00 AM" },
];

export function isTimeFormat(value: unknown): value is TimeFormat {
	return value === "24h" || value === "12h";
}

export function normalizeTimeFormat(value: unknown): TimeFormat {
	return isTimeFormat(value) ? value : DEFAULT_TIME_FORMAT;
}

export function timeFormatToPickerType(timeFormat: TimeFormat): "24h" | "12h" {
	return timeFormat;
}

export function getTimeFormatDateTimeOptions(timeFormat: TimeFormat): Intl.DateTimeFormatOptions {
	return timeFormat === "12h"
		? { hour: "numeric", minute: "2-digit", hour12: true }
		: { hour: "2-digit", minute: "2-digit", hour12: false };
}

export function formatTimeStringForPreference(value: string, timeFormat: TimeFormat): string {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) {
		return value;
	}

	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) {
		return value;
	}

	if (timeFormat === "24h") {
		return value;
	}

	const suffix = hour >= 12 ? "PM" : "AM";
	const displayHour = hour % 12 || 12;
	return `${displayHour}:${match[2]} ${suffix}`;
}
