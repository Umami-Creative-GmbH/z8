/**
 * The working-student weekday daytime band (#2017): the local wall-clock hours of a lecture-period
 * weekday whose work counts against the 20-hour rule (§ 6 Abs. 1 Nr. 3 SGB V). An organization
 * statutory preference, as minutes after local midnight: `[start, end)`, whole quarter hours,
 * 0 ≤ start < end ≤ 1440 (24:00 is the end of the day). Pure, so client components can use it.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const WORKING_STUDENT_DAYTIME_STEP_MINUTES = 15;

/**
 * 06:00–18:00: Z8's default reading of the carriers' "evening and night hours" exception. The law
 * names no hour, so each organization sets the band its health insurer accepts.
 */
export const DEFAULT_WORKING_STUDENT_DAYTIME_START_MINUTE = 6 * 60;
export const DEFAULT_WORKING_STUDENT_DAYTIME_END_MINUTE = 18 * 60;

/** Whether `minute` is a whole quarter hour from 00:00 to 24:00. */
export function isWorkingStudentDaytimeMinute(minute: number): boolean {
	return (
		Number.isInteger(minute) &&
		minute >= 0 &&
		minute <= MINUTES_PER_DAY &&
		minute % WORKING_STUDENT_DAYTIME_STEP_MINUTES === 0
	);
}

/** A minute of the day as a 24-hour wall-clock time; 1440 is 24:00. */
export function formatMinuteOfDay(minute: number): string {
	return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
