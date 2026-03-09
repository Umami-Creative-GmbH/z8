/**
 * TimeRange value object representing a time interval within a day.
 * Times are stored in "HH:mm" format (24-hour).
 */

export interface TimeRangeData {
	startTime: string; // "HH:mm"
	endTime: string; // "HH:mm"
}

export type TimeRangeValidationError = {
	type: "invalid_format" | "invalid_range";
	message: string;
};

/**
 * Parse "HH:mm" time string to minutes since midnight.
 */
export function timeToMinutes(time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to "HH:mm" format.
 */
export function minutesToTime(minutes: number): string {
	const hours = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Validate "HH:mm" time format.
 */
export function isValidTimeFormat(time: string): boolean {
	const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
	return regex.test(time);
}

/**
 * Validate a time range.
 * Returns null if valid, or an error object if invalid.
 */
export function validateTimeRange(
	startTime: string,
	endTime: string,
): TimeRangeValidationError | null {
	if (!isValidTimeFormat(startTime)) {
		return { type: "invalid_format", message: `Invalid start time format: ${startTime}` };
	}
	if (!isValidTimeFormat(endTime)) {
		return { type: "invalid_format", message: `Invalid end time format: ${endTime}` };
	}

	const startMinutes = timeToMinutes(startTime);
	const endMinutes = timeToMinutes(endTime);

	if (startMinutes >= endMinutes) {
		return {
			type: "invalid_range",
			message: "Start time must be before end time",
		};
	}

	return null;
}

/**
 * Check if two time ranges overlap.
 * Ranges are considered overlapping if they share any time.
 * Adjacent ranges (e.g., 08:00-12:00 and 12:00-16:00) do NOT overlap.
 */
export function timeRangesOverlap(range1: TimeRangeData, range2: TimeRangeData): boolean {
	const start1 = timeToMinutes(range1.startTime);
	const end1 = timeToMinutes(range1.endTime);
	const start2 = timeToMinutes(range2.startTime);
	const end2 = timeToMinutes(range2.endTime);

	return start1 < end2 && start2 < end1;
}

/**
 * Check if a time point falls within a time range.
 * The start is inclusive, the end is exclusive.
 */
export function timeRangeContains(range: TimeRangeData, time: string): boolean {
	const rangeStart = timeToMinutes(range.startTime);
	const rangeEnd = timeToMinutes(range.endTime);
	const timeMinutes = timeToMinutes(time);

	return timeMinutes >= rangeStart && timeMinutes < rangeEnd;
}

/**
 * Get the duration of a time range in minutes.
 */
export function timeRangeDuration(range: TimeRangeData): number {
	const start = timeToMinutes(range.startTime);
	const end = timeToMinutes(range.endTime);
	return end - start;
}

/**
 * Get the overlap duration between two time ranges in minutes.
 * Returns 0 if ranges don't overlap.
 */
export function timeRangeOverlapDuration(range1: TimeRangeData, range2: TimeRangeData): number {
	if (!timeRangesOverlap(range1, range2)) {
		return 0;
	}

	const start1 = timeToMinutes(range1.startTime);
	const end1 = timeToMinutes(range1.endTime);
	const start2 = timeToMinutes(range2.startTime);
	const end2 = timeToMinutes(range2.endTime);

	const overlapStart = Math.max(start1, start2);
	const overlapEnd = Math.min(end1, end2);

	return overlapEnd - overlapStart;
}

/**
 * Create a TimeRange from start and end times with validation.
 */
export function createTimeRange(
	startTime: string,
	endTime: string,
): { success: true; data: TimeRangeData } | { success: false; error: TimeRangeValidationError } {
	const error = validateTimeRange(startTime, endTime);
	if (error) {
		return { success: false, error };
	}

	return {
		success: true,
		data: { startTime, endTime },
	};
}

/**
 * Check if range1 fully contains range2.
 */
export function timeRangeFullyContains(container: TimeRangeData, contained: TimeRangeData): boolean {
	const containerStart = timeToMinutes(container.startTime);
	const containerEnd = timeToMinutes(container.endTime);
	const containedStart = timeToMinutes(contained.startTime);
	const containedEnd = timeToMinutes(contained.endTime);

	return containerStart <= containedStart && containerEnd >= containedEnd;
}
