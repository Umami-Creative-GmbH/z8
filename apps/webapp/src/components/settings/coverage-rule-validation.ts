/**
 * Client-side checks of the coverage rule form. They mirror createCoverageRuleSchema and
 * updateCoverageRuleSchema (lib/validations/coverage) and no more: a subarea, HH:mm (24h) times
 * with the start before the end on the same day, and a whole staff count from 1 to 100.
 */

/** The server's time format (lib/validations/coverage timeFormatRegex). */
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const MIN_STAFF_COUNT = 1;
export const MAX_STAFF_COUNT = 100;

export type CoverageRuleFieldError =
	| "subareaRequired"
	| "invalidTime"
	| "endNotAfterStart"
	| "staffCountRange";

function minutesOf(time: string) {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

export function coverageRuleSubareaError(subareaId: string): CoverageRuleFieldError | undefined {
	return subareaId ? undefined : "subareaRequired";
}

export function coverageRuleStartTimeError(startTime: string): CoverageRuleFieldError | undefined {
	return TIME_FORMAT.test(startTime) ? undefined : "invalidTime";
}

/** The end time's own format, then — when both times are readable — that it follows the start. */
export function coverageRuleEndTimeError(
	endTime: string,
	startTime: string,
): CoverageRuleFieldError | undefined {
	if (!TIME_FORMAT.test(endTime)) return "invalidTime";
	if (!TIME_FORMAT.test(startTime)) return undefined;
	return minutesOf(startTime) < minutesOf(endTime) ? undefined : "endNotAfterStart";
}

export function coverageRuleStaffCountError(count: number): CoverageRuleFieldError | undefined {
	return Number.isInteger(count) && count >= MIN_STAFF_COUNT && count <= MAX_STAFF_COUNT
		? undefined
		: "staffCountRange";
}
