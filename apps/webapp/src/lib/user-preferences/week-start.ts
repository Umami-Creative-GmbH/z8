import type { DateTime } from "luxon";

export type WeekStartDay = "sunday" | "monday";

export const DEFAULT_WEEK_START_DAY: WeekStartDay = "sunday";

export const WEEK_START_OPTIONS: Array<{ value: WeekStartDay; label: string; labelKey: string }> = [
	{ value: "sunday", label: "Sunday", labelKey: "settings.weekStart.options.sunday" },
	{ value: "monday", label: "Monday", labelKey: "settings.weekStart.options.monday" },
];

export function normalizeWeekStartDay(value: unknown): WeekStartDay {
	return isWeekStartDay(value) ? value : DEFAULT_WEEK_START_DAY;
}

export function isWeekStartDay(value: unknown): value is WeekStartDay {
	return value === "monday" || value === "sunday";
}

export function weekStartDayToDayPickerValue(weekStartDay: WeekStartDay): 0 | 1 {
	return weekStartDay === "monday" ? 1 : 0;
}

export function getWeekBounds(date: DateTime, weekStartDay: WeekStartDay) {
	if (weekStartDay === "monday") {
		const start = date.startOf("week").startOf("day");
		return { start, end: start.plus({ days: 6 }).endOf("day") };
	}

	const daysSinceSunday = date.weekday % 7;
	const start = date.minus({ days: daysSinceSunday }).startOf("day");
	return { start, end: start.plus({ days: 6 }).endOf("day") };
}
