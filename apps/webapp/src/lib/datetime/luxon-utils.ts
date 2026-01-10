/**
 * Core Luxon DateTime utilities for the application.
 * Central abstraction layer for all date/time operations.
 *
 * Strategy: UTC for storage/computation, local for display
 */

import { DateTime, Interval } from "luxon";

// ============================================================================
// PARSING & CREATION
// ============================================================================

/**
 * Parse an ISO 8601 string to DateTime
 * @param iso ISO string (e.g., "2024-01-15T10:30:00Z")
 * @param zone Timezone to interpret the date in (default: 'utc')
 */
export function parseISO(iso: string, zone: string = "utc"): DateTime {
	return DateTime.fromISO(iso, { zone });
}

/**
 * Convert JavaScript Date to DateTime
 * @param date JavaScript Date object
 * @param zone Timezone to interpret the date in (default: 'utc')
 */
export function fromJSDate(date: Date, zone: string = "utc"): DateTime {
	return DateTime.fromJSDate(date, { zone });
}

/**
 * Get current DateTime in local timezone
 */
export function now(): DateTime {
	return DateTime.now();
}

/**
 * Get current DateTime in UTC
 */
export function utcNow(): DateTime {
	return DateTime.utc();
}

/**
 * Create a DateTime for a specific local date (year, month, day)
 * @param year Full year (e.g., 2024)
 * @param month Month (1-12, NOT 0-11 like JavaScript Date)
 * @param day Day of month (1-31)
 */
export function local(year: number, month: number, day: number = 1): DateTime {
	return DateTime.local(year, month, day);
}

/**
 * Create a DateTime for a specific UTC date
 */
export function utc(year: number, month: number, day: number = 1): DateTime {
	return DateTime.utc(year, month, day);
}

// ============================================================================
// DISPLAY FORMATTING
// ============================================================================

/**
 * Format DateTime for display (uses date-fns format for now - will migrate later)
 * For now, this converts to Date and uses existing format functions
 */
export function formatDate(dt: DateTime, locale: string = "en-US"): string {
	return dt.toLocaleString(DateTime.DATE_MED);
}

/**
 * Format date range for display
 * @param start Start DateTime
 * @param end End DateTime
 * @param locale Locale for formatting
 */
export function formatDateRange(start: DateTime, end: DateTime, locale: string = "en-US"): string {
	const startStr = start.toLocaleString({ month: "short", day: "numeric" });
	const endStr = end.toLocaleString({
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	if (start.hasSame(end, "day")) {
		return endStr;
	}

	return `${startStr} - ${endStr}`;
}

/**
 * Format time for display (HH:mm format)
 */
export function formatTime(dt: DateTime, locale: string = "en-US"): string {
	return dt.toFormat("HH:mm");
}

/**
 * Format DateTime with custom pattern (date-fns compatible)
 * Supports both Luxon format tokens and common date-fns patterns
 *
 * Common date-fns patterns (auto-converted):
 * - "PPP" -> "Apr 29, 1453" (long localized date)
 * - "PP" -> "Apr 29, 1453" (medium localized date)
 * - "P" -> "04/29/1453" (short localized date)
 * - "PPpp" -> "Apr 29, 1453, 12:00:00 AM" (long date + time)
 *
 * Luxon patterns (native):
 * - "yyyy-MM-dd" -> "2024-01-15"
 * - "MMM d, yyyy" -> "Jan 15, 2024"
 * - "MMMM d" -> "January 15"
 * - "yyyy-MM-dd HH:mm:ss" -> "2024-01-15 10:30:00"
 *
 * @param dt DateTime or Date to format
 * @param pattern Luxon format pattern or date-fns pattern
 */
export function format(dt: DateTime | Date, pattern: string): string {
	const dateTime = dt instanceof Date ? fromJSDate(dt) : dt;

	// Map common date-fns patterns to Luxon equivalents
	const patternMap: Record<string, string> = {
		PPP: "LLLL d, yyyy", // April 29, 1453
		PP: "LLL d, yyyy", // Apr 29, 1453
		P: "M/d/yyyy", // 4/29/1453
		PPpp: "LLLL d, yyyy, h:mm:ss a", // April 29, 1453, 12:00:00 AM
		Pp: "M/d/yyyy, h:mm a", // 4/29/1453, 12:00 AM
	};

	const luxonPattern = patternMap[pattern] || pattern;
	return dateTime.toFormat(luxonPattern);
}

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days")
 * @param dt DateTime or Date to format
 */
export function formatRelative(dt: DateTime | Date): string {
	const dateTime = dt instanceof Date ? fromJSDate(dt) : dt;
	return dateTime.toRelative() || "";
}

/**
 * Calculate difference in days between two dates
 * Compatible with date-fns differenceInDays
 * @param dt1 Later date
 * @param dt2 Earlier date
 * @returns Number of days between dates
 */
export function differenceInDays(dt1: DateTime | Date, dt2: DateTime | Date): number {
	const date1 = dt1 instanceof Date ? fromJSDate(dt1) : dt1;
	const date2 = dt2 instanceof Date ? fromJSDate(dt2) : dt2;
	return Math.floor(date1.diff(date2, "days").days);
}

// ============================================================================
// BUSINESS LOGIC UTILITIES
// ============================================================================

/**
 * Get start of day (00:00:00.000)
 */
export function startOfDay(dt: DateTime): DateTime {
	return dt.startOf("day");
}

/**
 * Get end of day (23:59:59.999)
 */
export function endOfDay(dt: DateTime): DateTime {
	return dt.endOf("day");
}

/**
 * Get year range (January 1 to December 31)
 * @param year Full year (e.g., 2024)
 * @returns Object with start and end DateTime
 */
export function getYearRange(year: number): { start: DateTime; end: DateTime } {
	const start = DateTime.utc(year, 1, 1).startOf("day");
	const end = DateTime.utc(year, 12, 31).endOf("day");
	return { start, end };
}

/**
 * Get month range (first day to last day of month)
 * @param dt DateTime to get month range for
 * @returns Object with start and end DateTime
 */
export function getMonthRange(dt: DateTime): { start: DateTime; end: DateTime } {
	return {
		start: dt.startOf("month"),
		end: dt.endOf("month"),
	};
}

/**
 * Get week range (Monday to Sunday)
 * @param dt DateTime to get week range for
 * @returns Object with start (Monday) and end (Sunday) DateTime
 */
export function getWeekRange(dt: DateTime): { start: DateTime; end: DateTime } {
	return {
		start: dt.startOf("week"),
		end: dt.endOf("week"),
	};
}

/**
 * Get today's date range (start to end of current day)
 */
export function getTodayRange(): { start: DateTime; end: DateTime } {
	const today = DateTime.now();
	return {
		start: today.startOf("day"),
		end: today.endOf("day"),
	};
}

// ============================================================================
// DATE KEYS FOR MAPS/SETS
// ============================================================================

/**
 * Convert DateTime to date key string (YYYY-MM-DD)
 * Useful for Map/Set keys and date grouping
 */
export function toDateKey(dt: DateTime): string {
	return dt.toISODate() || "";
}

/**
 * Parse date key string (YYYY-MM-DD) to DateTime
 */
export function fromDateKey(key: string, zone: string = "utc"): DateTime {
	return DateTime.fromISO(key, { zone });
}

// ============================================================================
// SERIALIZATION (for API/DB)
// ============================================================================

/**
 * Convert DateTime to ISO string (for API/storage)
 */
export function toISO(dt: DateTime): string {
	return dt.toISO() || "";
}

/**
 * Convert DateTime to JavaScript Date (for Drizzle ORM)
 */
export function toJSDate(dt: DateTime): Date {
	return dt.toJSDate();
}

/**
 * Convert DateTime to UTC
 */
export function toUTC(dt: DateTime): DateTime {
	return dt.toUTC();
}

/**
 * Convert DateTime to local timezone
 */
export function toLocal(dt: DateTime): DateTime {
	return dt.toLocal();
}

// ============================================================================
// COMPARISONS
// ============================================================================

/**
 * Check if two DateTimes represent the same calendar day
 */
export function isSameDay(dt1: DateTime, dt2: DateTime): boolean {
	return dt1.hasSame(dt2, "day");
}

/**
 * Check if dt1 is after dt2
 */
export function isAfter(dt1: DateTime, dt2: DateTime): boolean {
	return dt1 > dt2;
}

/**
 * Check if dt1 is before dt2
 */
export function isBefore(dt1: DateTime, dt2: DateTime): boolean {
	return dt1 < dt2;
}

/**
 * Check if two date ranges overlap
 * @param start1 Start of first range
 * @param end1 End of first range
 * @param start2 Start of second range
 * @param end2 End of second range
 */
export function dateRangesOverlap(
	start1: DateTime,
	end1: DateTime,
	start2: DateTime,
	end2: DateTime,
): boolean {
	return start1 <= end2 && start2 <= end1;
}

/**
 * Check if a DateTime falls within a date range (inclusive)
 */
export function isWithinRange(dt: DateTime, start: DateTime, end: DateTime): boolean {
	return dt >= start && dt <= end;
}

// ============================================================================
// DATE ARITHMETIC
// ============================================================================

/**
 * Add duration to DateTime
 * @param dt DateTime to add to
 * @param duration Duration object (e.g., { days: 1, hours: 2 })
 */
export function plus(
	dt: DateTime,
	duration: { years?: number; months?: number; days?: number; hours?: number; minutes?: number },
): DateTime {
	return dt.plus(duration);
}

/**
 * Subtract duration from DateTime
 */
export function minus(
	dt: DateTime,
	duration: { years?: number; months?: number; days?: number; hours?: number; minutes?: number },
): DateTime {
	return dt.minus(duration);
}

/**
 * Calculate difference between two DateTimes
 * @param end End DateTime
 * @param start Start DateTime
 * @param unit Unit of time ('years', 'months', 'days', 'hours', 'minutes', 'seconds')
 * @returns Difference as a number
 */
export function diff(
	end: DateTime,
	start: DateTime,
	unit: "years" | "months" | "days" | "hours" | "minutes" | "seconds" = "days",
): number {
	return end.diff(start, unit).as(unit);
}

// ============================================================================
// INTERVAL UTILITIES
// ============================================================================

/**
 * Create an Interval between two DateTimes
 */
export function createInterval(start: DateTime, end: DateTime): Interval {
	return Interval.fromDateTimes(start, end);
}

/**
 * Get all days in an interval
 * @param start Start DateTime
 * @param end End DateTime
 * @returns Array of DateTimes for each day
 */
export function eachDayOfInterval(start: DateTime, end: DateTime): DateTime[] {
	const interval = Interval.fromDateTimes(start, end);
	return interval.splitBy({ days: 1 }).map((i) => i.start!);
}

/**
 * Generate array of date keys (YYYY-MM-DD) for a range
 */
export function generateDateKeys(start: DateTime, end: DateTime): string[] {
	return eachDayOfInterval(start, end).map((dt) => toDateKey(dt));
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Check if a DateTime is valid
 */
export function isValid(dt: DateTime): boolean {
	return dt.isValid;
}

/**
 * Get validation error message if DateTime is invalid
 */
export function getInvalidReason(dt: DateTime): string | null {
	return dt.invalidReason;
}

// ============================================================================
// TIMEZONE UTILITIES
// ============================================================================

/**
 * Get user's local timezone
 */
export function getLocalTimezone(): string {
	return DateTime.local().zoneName;
}

/**
 * Convert DateTime to specific timezone
 */
export function toZone(dt: DateTime, zone: string): DateTime {
	return dt.setZone(zone);
}

/**
 * Set zone while keeping the same local time
 * (e.g., convert "2024-01-15 10:00 EST" to "2024-01-15 10:00 PST")
 */
export function setZoneKeepLocal(dt: DateTime, zone: string): DateTime {
	return dt.setZone(zone, { keepLocalTime: true });
}
