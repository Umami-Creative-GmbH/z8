/**
 * Drizzle ORM adapter for Date ↔ DateTime conversions
 *
 * Drizzle ORM uses JavaScript Date objects for timestamp columns.
 * This adapter handles conversion at the ORM boundary, allowing
 * the rest of the application to use Luxon DateTime objects.
 *
 * Strategy: All database timestamps are stored in UTC
 */

import { DateTime } from 'luxon';
import { fromJSDate, toJSDate, toUTC } from './luxon-utils';

// ============================================================================
// READING FROM DATABASE
// ============================================================================

/**
 * Convert a Date from database to UTC DateTime
 * Use this when reading timestamp columns from Drizzle queries
 *
 * @param date Date object from database
 * @returns DateTime in UTC timezone
 */
export function dateFromDB(date: Date | null | undefined): DateTime | null {
  if (!date) return null;
  return fromJSDate(date, 'utc');
}

/**
 * Convert multiple dates from database to UTC DateTimes
 * Useful for batch conversions when mapping query results
 *
 * @param dates Array of Date objects from database
 * @returns Array of DateTimes in UTC timezone
 */
export function datesFromDB(dates: (Date | null)[]): (DateTime | null)[] {
  return dates.map(date => dateFromDB(date));
}

/**
 * Map database query result with timestamp fields to DateTime
 * Automatically converts specified Date fields to DateTime
 *
 * @param record Record from database query
 * @param dateFields Array of field names that contain Date objects
 * @returns Record with Date fields converted to DateTime
 *
 * @example
 * const absence = await db.select().from(absenceEntry).where(...);
 * const mapped = mapRecordFromDB(absence[0], ['startDate', 'endDate', 'createdAt', 'updatedAt']);
 * // mapped.startDate is now DateTime instead of Date
 */
export function mapRecordFromDB<T extends Record<string, any>>(
  record: T,
  dateFields: (keyof T)[]
): T {
  const result = { ...record };
  for (const field of dateFields) {
    if (record[field] instanceof Date) {
      result[field] = dateFromDB(record[field]) as any;
    }
  }
  return result;
}

/**
 * Map array of database query results with timestamp fields to DateTime
 *
 * @param records Array of records from database query
 * @param dateFields Array of field names that contain Date objects
 * @returns Array of records with Date fields converted to DateTime
 *
 * @example
 * const absences = await db.select().from(absenceEntry).where(...);
 * const mapped = mapRecordsFromDB(absences, ['startDate', 'endDate', 'createdAt', 'updatedAt']);
 */
export function mapRecordsFromDB<T extends Record<string, any>>(
  records: T[],
  dateFields: (keyof T)[]
): T[] {
  return records.map(record => mapRecordFromDB(record, dateFields));
}

// ============================================================================
// WRITING TO DATABASE
// ============================================================================

/**
 * Convert DateTime to Date for database insertion
 * Use this when writing to Drizzle timestamp columns
 *
 * @param dt DateTime to convert
 * @returns Date object for database (always in UTC)
 */
export function dateToDB(dt: DateTime | null | undefined): Date | null {
  if (!dt) return null;
  return toJSDate(toUTC(dt));
}

/**
 * Convert multiple DateTimes to Dates for database insertion
 *
 * @param dts Array of DateTimes
 * @returns Array of Date objects for database
 */
export function datesToDB(dts: (DateTime | null)[]): (Date | null)[] {
  return dts.map(dt => dateToDB(dt));
}

/**
 * Prepare record for database insertion by converting DateTime fields to Date
 *
 * @param record Record with DateTime fields
 * @param dateFields Array of field names that contain DateTime objects
 * @returns Record with DateTime fields converted to Date
 *
 * @example
 * const absenceData = {
 *   startDate: DateTime.now(),
 *   endDate: DateTime.now().plus({ days: 5 }),
 *   reason: 'Vacation'
 * };
 * const dbRecord = prepareRecordForDB(absenceData, ['startDate', 'endDate']);
 * await db.insert(absenceEntry).values(dbRecord);
 */
export function prepareRecordForDB<T extends Record<string, any>>(
  record: T,
  dateFields: (keyof T)[]
): T {
  const result = { ...record };
  for (const field of dateFields) {
    if (record[field] && typeof record[field] === 'object') {
      // Check if it's a Luxon DateTime
      if ('toJSDate' in record[field]) {
        result[field] = dateToDB(record[field]) as any;
      }
    }
  }
  return result;
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
  return DateTime.utc().toJSDate();
}

/**
 * Helper for Drizzle default timestamp
 * Returns current timestamp as Date for database
 *
 * @example
 * createdAt: timestamp("created_at").$default(() => defaultTimestamp()).notNull()
 */
export function defaultTimestamp(): Date {
  return DateTime.utc().toJSDate();
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if value is a Luxon DateTime
 */
export function isDateTime(value: any): value is DateTime {
  return value && typeof value === 'object' && 'toJSDate' in value;
}

/**
 * Check if value is a JavaScript Date
 */
export function isDate(value: any): value is Date {
  return value instanceof Date;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely convert unknown date value to DateTime
 * Handles Date, DateTime, ISO string, and null/undefined
 *
 * @param value Unknown date value
 * @returns DateTime in UTC or null
 */
export function toDateTime(value: unknown): DateTime | null {
  if (!value) return null;

  if (isDateTime(value)) {
    return toUTC(value);
  }

  if (isDate(value)) {
    return fromJSDate(value, 'utc');
  }

  if (typeof value === 'string') {
    const dt = DateTime.fromISO(value);
    return dt.isValid ? toUTC(dt) : null;
  }

  return null;
}

/**
 * Safely convert unknown date value to Date for database
 *
 * @param value Unknown date value
 * @returns Date object or null
 */
export function toDate(value: unknown): Date | null {
  const dt = toDateTime(value);
  return dt ? dateToDB(dt) : null;
}
