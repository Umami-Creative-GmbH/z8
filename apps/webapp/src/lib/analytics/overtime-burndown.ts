import { DateTime } from "luxon";

export function clampOvertime(hours: number): number {
	return Math.max(0, hours);
}

export function weekStartIso(value: Date): string | null {
	return DateTime.fromJSDate(value).startOf("week").toISODate();
}

export function weekOverWeekDelta(values: number[]): number {
	if (values.length < 2) {
		return 0;
	}

	const previous = values[values.length - 2];
	const current = values[values.length - 1];

	return current - previous;
}
