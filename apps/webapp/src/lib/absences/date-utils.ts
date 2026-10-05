import { DateTime } from "luxon";
import { fromJSDate } from "@/lib/datetime/luxon-utils";
import { countBusinessDays, utcHolidayDate } from "./business-days";
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
	const start =
		startDate instanceof Date ? utcHolidayDate(startDate).toString() : startDate.toISODate();
	const end = endDate instanceof Date ? utcHolidayDate(endDate).toString() : endDate.toISODate();
	if (!start || !end) throw new Error("Invalid date");
	return countBusinessDays(start, "full_day", end, "full_day", holidays);
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
	return countBusinessDays(startDate, startPeriod, endDate, endPeriod, holidays);
}

/**
 * Get the start and end dates for a specific year
 *
 * @param year - Calendar year
 * @returns Start and end dates as DateTime objects
 */
export function getYearRange(year: number): { start: DateTime; end: DateTime } {
	return {
		start: DateTime.utc(year, 1, 1).startOf("day"),
		end: DateTime.utc(year, 12, 31).endOf("day"),
	};
}

/**
 * Calculate carryover expiry date based on rules
 *
 * @param year - Current year
 * @param expiryMonths - Number of months until expiry
 * @returns Expiry date as DateTime
 */
export function calculateCarryoverExpiryDate(
	year: number,
	expiryMonths: number,
	timezone = "UTC",
): DateTime {
	return DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timezone })
		.startOf("day")
		.plus({ months: expiryMonths })
		.minus({ milliseconds: 1 });
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
			const [year, month, day] = d.split("-").map(Number);
			return DateTime.utc(year, month, day);
		}
		if (d instanceof Date) {
			return fromJSDate(d, "utc");
		}
		return d;
	};

	const s1 = toDateTime(start1);
	const e1 = normalizeOverlapEnd(s1, toDateTime(end1), end1);
	const s2 = toDateTime(start2);
	const e2 = normalizeOverlapEnd(s2, toDateTime(end2), end2);

	return s1 <= e2 && s2 <= e1;
}

function normalizeOverlapEnd(
	start: DateTime,
	end: DateTime,
	originalEnd: Date | DateTime | string,
): DateTime {
	if (typeof originalEnd === "string") {
		return end;
	}

	if (end > start && end.equals(end.startOf("day"))) {
		return end.minus({ milliseconds: 1 });
	}

	return end;
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
