/** A latest clock-in is a local wall-clock time `HH:mm` (00:00 to 23:59). */
const LATEST_CLOCK_IN_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLatestClockIn(value: string): boolean {
	return LATEST_CLOCK_IN_PATTERN.test(value);
}

/** The latest clock-in a schedule day stores: only work days carry one, and blank means none. */
export function latestClockInForDay(day: {
	isWorkDay: boolean;
	latestClockIn?: string | null;
}): string | null {
	return day.isWorkDay && day.latestClockIn ? day.latestClockIn : null;
}

/** Whether every work day's latest clock-in is blank or a valid `HH:mm` time. */
export function hasValidLatestClockIns(
	days: readonly { isWorkDay: boolean; latestClockIn?: string | null }[],
): boolean {
	return days.every((day) => {
		const value = latestClockInForDay(day);
		return value === null || isLatestClockIn(value);
	});
}
