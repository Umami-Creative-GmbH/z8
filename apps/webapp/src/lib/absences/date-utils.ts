import { DateTime } from "luxon";
import { fromJSDate, toDateKey, eachDayOfInterval } from "@/lib/datetime/luxon-utils";
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
	startDate: Date | DateTime,
	endDate: Date | DateTime,
	holidays: Holiday[] = [],
): number {
	// Convert to DateTime if needed
	const start = startDate instanceof Date ? fromJSDate(startDate, 'utc') : startDate;
	const end = endDate instanceof Date ? fromJSDate(endDate, 'utc') : endDate;

	if (start > end) {
		throw new Error("Start date must be before or equal to end date");
	}

	// Create a set of holiday dates for fast lookup (YYYY-MM-DD format)
	const holidayDates = new Set(
		holidays.flatMap((h) => {
			const hStart = h.startDate instanceof Date ? fromJSDate(h.startDate, 'utc') : h.startDate as unknown as DateTime;
			const hEnd = h.endDate instanceof Date ? fromJSDate(h.endDate, 'utc') : h.endDate as unknown as DateTime;
			return eachDayOfInterval(hStart, hEnd).map(dt => toDateKey(dt));
		}),
	);

	let businessDays = 0;
	const days = eachDayOfInterval(start, end);

	for (const day of days) {
		const dayOfWeek = day.weekday; // Luxon: 1 = Monday, 7 = Sunday
		const dateStr = toDateKey(day);

		// Check if it's not a weekend (6 = Saturday, 7 = Sunday)
		// and not a holiday
		if (dayOfWeek !== 6 && dayOfWeek !== 7 && !holidayDates.has(dateStr)) {
			businessDays++;
		}
	}

	return businessDays;
}

/**
 * Get the start and end dates for a specific year
 *
 * @param year - Calendar year
 * @returns Start and end dates as DateTime objects
 */
export function getYearRange(year: number): { start: DateTime; end: DateTime } {
	return {
		start: DateTime.utc(year, 1, 1).startOf('day'), // January 1st
		end: DateTime.utc(year, 12, 31).endOf('day'), // December 31st
	};
}

/**
 * Calculate carryover expiry date based on rules
 *
 * @param year - Current year
 * @param expiryMonths - Number of months until expiry
 * @returns Expiry date as DateTime
 */
export function calculateCarryoverExpiryDate(year: number, expiryMonths: number): DateTime {
	// Start at January 1st of current year
	let expiryDate = DateTime.utc(year, 1, 1);

	// Add months
	expiryDate = expiryDate.plus({ months: expiryMonths });

	// Go to last day of previous month
	expiryDate = expiryDate.minus({ days: 1 });

	// Set to end of day
	expiryDate = expiryDate.endOf('day');

	return expiryDate;
}

/**
 * Format a date range for display
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Formatted date range string
 */
export function formatDateRange(startDate: Date | DateTime, endDate: Date | DateTime): string {
	// Convert to DateTime if needed
	const start = startDate instanceof Date ? fromJSDate(startDate, 'utc') : startDate;
	const end = endDate instanceof Date ? fromJSDate(endDate, 'utc') : endDate;

	const startStr = start.toLocaleString({ month: "short", day: "numeric" });
	const endStr = end.toLocaleString({
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	// If same day, return single date
	if (start.hasSame(end, 'day')) {
		return endStr;
	}

	return `${startStr} - ${endStr}`;
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
export function dateRangesOverlap(
	start1: Date | DateTime,
	end1: Date | DateTime,
	start2: Date | DateTime,
	end2: Date | DateTime
): boolean {
	// Convert to DateTime if needed
	const s1 = start1 instanceof Date ? fromJSDate(start1, 'utc') : start1;
	const e1 = end1 instanceof Date ? fromJSDate(end1, 'utc') : end1;
	const s2 = start2 instanceof Date ? fromJSDate(start2, 'utc') : start2;
	const e2 = end2 instanceof Date ? fromJSDate(end2, 'utc') : end2;

	return s1 <= e2 && s2 <= e1;
}
