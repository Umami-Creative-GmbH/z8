import { DateTime } from "luxon";
import { eachDayOfInterval, fromJSDate, toDateKey } from "@/lib/datetime/luxon-utils";
import type { DayPeriod, Holiday } from "./types";

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
	const start = startDate instanceof Date ? fromJSDate(startDate, "utc") : startDate;
	const end = endDate instanceof Date ? fromJSDate(endDate, "utc") : endDate;

	if (start > end) {
		throw new Error("Start date must be before or equal to end date");
	}

	// Create a set of holiday dates for fast lookup (YYYY-MM-DD format)
	const holidayDates = new Set(
		holidays.flatMap((h) => {
			const hStart =
				h.startDate instanceof Date
					? fromJSDate(h.startDate, "utc")
					: (h.startDate as unknown as DateTime);
			const hEnd =
				h.endDate instanceof Date
					? fromJSDate(h.endDate, "utc")
					: (h.endDate as unknown as DateTime);
			return eachDayOfInterval(hStart, hEnd).map((dt) => toDateKey(dt));
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
 * Calculate the number of business days with half-day support.
 * Returns number with 0.5 increments for half-days.
 *
 * @param startDate - Start date in YYYY-MM-DD format
 * @param startPeriod - Period of start day (full_day, am, pm)
 * @param endDate - End date in YYYY-MM-DD format
 * @param endPeriod - Period of end day (full_day, am, pm)
 * @param holidays - Array of holidays to exclude
 * @returns Number of business days (with 0.5 increments)
 */
export function calculateBusinessDaysWithHalfDays(
	startDate: string,
	startPeriod: DayPeriod,
	endDate: string,
	endPeriod: DayPeriod,
	holidays: Holiday[] = [],
): number {
	const start = DateTime.fromISO(startDate);
	const end = DateTime.fromISO(endDate);

	if (!start.isValid || !end.isValid) {
		throw new Error("Invalid date format. Expected YYYY-MM-DD");
	}

	if (start > end) {
		throw new Error("Start date must be before or equal to end date");
	}

	// Create a set of holiday dates for fast lookup (YYYY-MM-DD format)
	const holidayDates = new Set(
		holidays.flatMap((h) => {
			const hStart =
				h.startDate instanceof Date
					? fromJSDate(h.startDate, "utc")
					: DateTime.fromISO(h.startDate as unknown as string);
			const hEnd =
				h.endDate instanceof Date
					? fromJSDate(h.endDate, "utc")
					: DateTime.fromISO(h.endDate as unknown as string);
			return eachDayOfInterval(hStart, hEnd).map((dt) => toDateKey(dt));
		}),
	);

	// Helper to check if a day is a business day
	const isBusinessDay = (day: DateTime): boolean => {
		const dayOfWeek = day.weekday; // Luxon: 1 = Monday, 7 = Sunday
		const dateStr = toDateKey(day);
		return dayOfWeek !== 6 && dayOfWeek !== 7 && !holidayDates.has(dateStr);
	};

	// Single day case
	if (start.hasSame(end, "day")) {
		if (!isBusinessDay(start)) {
			return 0;
		}

		// If both are full_day, return 1
		if (startPeriod === "full_day" || endPeriod === "full_day") {
			return 1;
		}

		// If same period (both am or both pm), return 0.5
		if (startPeriod === endPeriod) {
			return 0.5;
		}

		// AM + PM = full day
		return 1;
	}

	// Multi-day case
	let total = 0;
	let current = start;

	while (current <= end) {
		if (isBusinessDay(current)) {
			if (current.hasSame(start, "day")) {
				// First day - use startPeriod
				if (startPeriod === "full_day") {
					total += 1;
				} else if (startPeriod === "pm") {
					// Starting in PM means only afternoon counts
					total += 0.5;
				} else {
					// Starting in AM means whole day counts (AM + PM)
					total += 1;
				}
			} else if (current.hasSame(end, "day")) {
				// Last day - use endPeriod
				if (endPeriod === "full_day") {
					total += 1;
				} else if (endPeriod === "am") {
					// Ending in AM means only morning counts
					total += 0.5;
				} else {
					// Ending in PM means whole day counts (AM + PM)
					total += 1;
				}
			} else {
				// Middle days - always full day
				total += 1;
			}
		}

		current = current.plus({ days: 1 });
	}

	return total;
}

/**
 * Get the start and end dates for a specific year
 *
 * @param year - Calendar year
 * @returns Start and end dates as DateTime objects
 */
export function getYearRange(year: number): { start: DateTime; end: DateTime } {
	return {
		start: DateTime.utc(year, 1, 1).startOf("day"), // January 1st
		end: DateTime.utc(year, 12, 31).endOf("day"), // December 31st
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
	expiryDate = expiryDate.endOf("day");

	return expiryDate;
}

/**
 * Format a date range for display
 *
 * @param startDate - Start date (Date, DateTime, or YYYY-MM-DD string)
 * @param endDate - End date (Date, DateTime, or YYYY-MM-DD string)
 * @returns Formatted date range string
 */
export function formatDateRange(
	startDate: Date | DateTime | string,
	endDate: Date | DateTime | string,
): string {
	// Convert to DateTime if needed
	const toDateTime = (d: Date | DateTime | string): DateTime => {
		if (typeof d === "string") {
			return DateTime.fromISO(d);
		}
		if (d instanceof Date) {
			return fromJSDate(d, "utc");
		}
		return d;
	};

	const start = toDateTime(startDate);
	const end = toDateTime(endDate);

	const startStr = start.toLocaleString({ month: "short", day: "numeric" });
	const endStr = end.toLocaleString({
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	// If same day, return single date
	if (start.hasSame(end, "day")) {
		return endStr;
	}

	return `${startStr} - ${endStr}`;
}

/**
 * Check if two date ranges overlap
 *
 * @param start1 - First range start (Date, DateTime, or YYYY-MM-DD string)
 * @param end1 - First range end (Date, DateTime, or YYYY-MM-DD string)
 * @param start2 - Second range start (Date, DateTime, or YYYY-MM-DD string)
 * @param end2 - Second range end (Date, DateTime, or YYYY-MM-DD string)
 * @returns True if ranges overlap
 */
export function dateRangesOverlap(
	start1: Date | DateTime | string,
	end1: Date | DateTime | string,
	start2: Date | DateTime | string,
	end2: Date | DateTime | string,
): boolean {
	// Convert to DateTime if needed
	const toDateTime = (d: Date | DateTime | string): DateTime => {
		if (typeof d === "string") {
			return DateTime.fromISO(d);
		}
		if (d instanceof Date) {
			return fromJSDate(d, "utc");
		}
		return d;
	};

	const s1 = toDateTime(start1);
	const e1 = toDateTime(end1);
	const s2 = toDateTime(start2);
	const e2 = toDateTime(end2);

	return s1 <= e2 && s2 <= e1;
}

/**
 * Format days for display with proper pluralization.
 * Handles half days (0.5) and integer/decimal values.
 *
 * @param days - Number of days to format
 * @param t - Translation function from useTranslate()
 * @returns Formatted string (e.g., "1 day", "0.5 day", "5 days")
 */
export function formatDays(
	days: number,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t: (key: string, defaultValue: string, params?: any) => string,
): string {
	if (days === 1) return t("common.days.one", "1 day");
	if (days === 0.5) return t("common.days.half", "0.5 day");
	return t("common.days.count", "{count} days", { count: days });
}

/**
 * Convert a Date object to a YYYY-MM-DD string in local timezone.
 * This avoids timezone issues that occur with toISOString().
 *
 * @param date - Date object to convert
 * @returns Date string in YYYY-MM-DD format
 */
export function toLocalDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
