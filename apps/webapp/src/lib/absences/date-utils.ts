import type { Holiday } from "./types";

/**
 * Calculate the number of business days between two dates
 * Excludes weekends (Saturday/Sunday) and organization holidays
 *
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @param holidays - Array of holidays to exclude
 * @returns Number of business days
 */
export function calculateBusinessDays(
	startDate: Date,
	endDate: Date,
	holidays: Holiday[] = [],
): number {
	if (startDate > endDate) {
		throw new Error("Start date must be before or equal to end date");
	}

	// Create a set of holiday dates for fast lookup (YYYY-MM-DD format)
	const holidayDates = new Set(
		holidays.flatMap((h) => {
			const dates: string[] = [];
			const current = new Date(h.startDate);
			const end = new Date(h.endDate);

			while (current <= end) {
				dates.push(current.toISOString().split("T")[0]);
				current.setDate(current.getDate() + 1);
			}
			return dates;
		}),
	);

	let businessDays = 0;
	const current = new Date(startDate);
	const end = new Date(endDate);

	while (current <= end) {
		const dayOfWeek = current.getDay();
		const dateStr = current.toISOString().split("T")[0];

		// Check if it's not a weekend (0 = Sunday, 6 = Saturday)
		// and not a holiday
		if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
			businessDays++;
		}

		current.setDate(current.getDate() + 1);
	}

	return businessDays;
}

/**
 * Get the start and end dates for a specific year
 *
 * @param year - Calendar year
 * @returns Start and end dates
 */
export function getYearRange(year: number): { start: Date; end: Date } {
	return {
		start: new Date(year, 0, 1), // January 1st
		end: new Date(year, 11, 31, 23, 59, 59, 999), // December 31st
	};
}

/**
 * Calculate carryover expiry date based on rules
 *
 * @param year - Current year
 * @param expiryMonths - Number of months until expiry
 * @returns Expiry date
 */
export function calculateCarryoverExpiryDate(year: number, expiryMonths: number): Date {
	const expiryDate = new Date(year, 0, 1); // January 1st of current year
	expiryDate.setMonth(expiryDate.getMonth() + expiryMonths);
	expiryDate.setDate(expiryDate.getDate() - 1); // Last day of the month before
	expiryDate.setHours(23, 59, 59, 999);
	return expiryDate;
}

/**
 * Format a date range for display
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Formatted date range string
 */
export function formatDateRange(startDate: Date, endDate: Date): string {
	const options: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
		year: "numeric",
	};

	const start = startDate.toLocaleDateString("en-US", options);
	const end = endDate.toLocaleDateString("en-US", options);

	// If same day, return single date
	if (
		startDate.getFullYear() === endDate.getFullYear() &&
		startDate.getMonth() === endDate.getMonth() &&
		startDate.getDate() === endDate.getDate()
	) {
		return start;
	}

	return `${start} - ${end}`;
}

/**
 * Check if two date ranges overlap
 *
 * @param start1 - First range start
 * @param end1 - First range end
 * @param start2 - Second range start
 * @param end2 - Second range end
 * @returns True if ranges overlap
 */
export function dateRangesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
	return start1 <= end2 && start2 <= end1;
}
