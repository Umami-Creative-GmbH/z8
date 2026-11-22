/**
 * Drizzle ORM adapter for Date <-> Temporal.Instant conversions
 *
 * Drizzle ORM uses JavaScript Date objects for timestamp columns.
 * This adapter handles conversion at the ORM boundary, allowing
 * the rest of the application to use Temporal.Instant values.
 *
 * Strategy: All database timestamps are stored in UTC.
 */

import { dateFromInstant, type Instant, instantFromDate, systemClock } from "./temporal-core";

// ============================================================================
// READING FROM DATABASE
// ============================================================================

/**
 * Convert a Date from database to an exact UTC instant.
 */
export function instantFromDB(date: Date | null | undefined): Instant | null {
	if (!date) return null;
	return instantFromDate(date);
}

/**
 * Convert multiple database dates to exact UTC instants.
 */
export function instantsFromDB(dates: (Date | null)[]): (Instant | null)[] {
	return dates.map((date) => instantFromDB(date));
}

// ============================================================================
// WRITING TO DATABASE
// ============================================================================

/**
 * Convert an exact instant to a Date for database insertion.
 */
export function instantToDB(instant: Instant | null | undefined): Date | null {
	if (!instant) return null;
	return dateFromInstant(instant);
}

// ============================================================================
// SCHEMA HELPERS
// ============================================================================

/**
 * Helper for Drizzle $onUpdate callback
 * Returns current timestamp as Date for database
 *
 * @example
 * updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull()
 */
export function currentTimestamp(): Date {
	return dateFromInstant(systemClock.nowInstant());
}

/**
 * Helper for Drizzle default timestamp
 * Returns current timestamp as Date for database
 *
 * @example
 * createdAt: timestamp("created_at").$default(() => defaultTimestamp()).notNull()
 */
export function defaultTimestamp(): Date {
	return dateFromInstant(systemClock.nowInstant());
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if value is a JavaScript Date
 */
export function isDate(value: unknown): value is Date {
	return value instanceof Date;
}
