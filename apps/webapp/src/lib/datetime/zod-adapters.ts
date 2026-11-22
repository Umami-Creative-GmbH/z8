/**
 * Zod schema adapters for Temporal validation
 *
 * Provides Zod schemas and transformers for working with Temporal Instant
 * and PlainDate values in form and API validation.
 */

import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	instantFromDate,
	isInstant,
	parseInstant,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "./temporal-core";

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * Base Instant schema
 * Accepts Date, Temporal.Instant, or ISO datetime string and converts to Instant
 */
export const dateTimeSchema = z.union([
	z.date().transform((d) => instantFromDate(d)),
	z.iso.datetime().transform((s) => parseInstant(s)),
	z.custom<Instant>((val) => isInstant(val), { message: "Invalid date" }),
]);

/**
 * Optional Instant schema
 */
export const dateTimeSchemaOptional = dateTimeSchema.optional().nullable();

/**
 * PlainDate schema that accepts ISO date strings (YYYY-MM-DD)
 * Common for HTML5 date inputs
 */
export const dateStringSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
	.transform((s) => parsePlainDate(s));

/**
 * Optional date string schema
 */
export const dateStringSchemaOptional = dateStringSchema.optional().nullable();

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Create a schema for timestamps that must be in the past
 */
export function pastDateSchema(message: string = "Date must be in the past") {
	return dateTimeSchema.refine(
		(instant) => compareInstants(instant, systemClock.nowInstant()) <= 0,
		{ message },
	);
}

/**
 * Create a schema for timestamps that must be in the future
 */
export function futureDateSchema(message: string = "Date must be in the future") {
	return dateTimeSchema.refine(
		(instant) => compareInstants(instant, systemClock.nowInstant()) >= 0,
		{ message },
	);
}

/**
 * Create a schema for timestamps that must be before a specific instant
 */
export function beforeDateSchema(
	maxDate: Instant,
	message: string = `Date must be before ${plainDateAt(maxDate, "UTC").toString()}`,
) {
	return dateTimeSchema.refine((instant) => compareInstants(instant, maxDate) <= 0, { message });
}

/**
 * Create a schema for timestamps that must be after a specific instant
 */
export function afterDateSchema(
	minDate: Instant,
	message: string = `Date must be after ${plainDateAt(minDate, "UTC").toString()}`,
) {
	return dateTimeSchema.refine((instant) => compareInstants(instant, minDate) >= 0, { message });
}

/**
 * Create a schema for date ranges (start must be before or equal to end)
 */
export function dateRangeSchema() {
	return z
		.object({
			startDate: dateTimeSchema,
			endDate: dateTimeSchema,
		})
		.refine((data) => compareInstants(data.startDate, data.endDate) <= 0, {
			message: "End date must be after or equal to start date",
			path: ["endDate"],
		});
}

// ============================================================================
// FORM COMPATIBILITY
// ============================================================================

/**
 * Schema for form Date values, transforming to Temporal.Instant
 */
export function formDateSchema() {
	return z.date().transform((d) => instantFromDate(d));
}

/**
 * Optional form date schema
 */
export function formDateSchemaOptional() {
	return z
		.date()
		.optional()
		.nullable()
		.transform((d) => (d ? instantFromDate(d) : null));
}

// ============================================================================
// API COMPATIBILITY
// ============================================================================

/**
 * Schema for API payloads that send ISO datetime strings
 * Validates and converts to Temporal.Instant
 */
export function apiDateSchema() {
	return z.iso.datetime().transform((s) => parseInstant(s));
}

/**
 * Optional API date schema
 */
export function apiDateSchemaOptional() {
	return z.iso
		.datetime()
		.optional()
		.nullable()
		.transform((s) => (s ? parseInstant(s) : null));
}

/**
 * Schema for date-only strings from API (YYYY-MM-DD)
 */
export function apiDateOnlySchema() {
	return z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.transform((s) => parsePlainDate(s));
}

// ============================================================================
// PRE-DEFINED COMMON SCHEMAS
// ============================================================================

function isBirthdayOnOrBeforeToday(date: Date): boolean {
	const birthday = plainDateAt(instantFromDate(date), "UTC");
	const todayUtc = plainDateAt(systemClock.nowInstant(), "UTC");
	return comparePlainDates(birthday, todayUtc) <= 0;
}

function isBirthdayOnOrAfter1900(date: Date): boolean {
	const birthday = plainDateAt(instantFromDate(date), "UTC");
	return comparePlainDates(birthday, Temporal.PlainDate.from("1900-01-01")) >= 0;
}

/**
 * Birthday schema (must be in the past, reasonable date range)
 */
export const birthdaySchema = z
	.date()
	.refine(isBirthdayOnOrBeforeToday, "Birthday must be in the past")
	.refine(isBirthdayOnOrAfter1900, "Birthday must be after 1900")
	.transform((d) => instantFromDate(d));

/**
 * Optional birthday schema
 */
export const birthdaySchemaOptional = z
	.date()
	.refine(isBirthdayOnOrBeforeToday, "Birthday must be in the past")
	.refine(isBirthdayOnOrAfter1900, "Birthday must be after 1900")
	.optional()
	.nullable()
	.transform((d) => (d ? instantFromDate(d) : null));

/**
 * Absence date range schema
 */
export const absenceDateRangeSchema = z
	.object({
		startDate: z.date().transform((d) => instantFromDate(d)),
		endDate: z.date().transform((d) => instantFromDate(d)),
	})
	.refine((data) => compareInstants(data.startDate, data.endDate) <= 0, {
		message: "End date must be after or equal to start date",
		path: ["endDate"],
	});

/**
 * Work schedule effective date range schema
 */
export const workScheduleDateRangeSchema = z
	.object({
		effectiveFrom: z.date().transform((d) => instantFromDate(d)),
		effectiveUntil: z
			.date()
			.optional()
			.nullable()
			.transform((d) => (d ? instantFromDate(d) : null)),
	})
	.refine(
		(data) => !data.effectiveUntil || compareInstants(data.effectiveFrom, data.effectiveUntil) <= 0,
		{
			message: "Effective until date must be after effective from date",
			path: ["effectiveUntil"],
		},
	);

// ============================================================================
// TRANSFORMATION HELPERS
// ============================================================================

/**
 * Transform Date to Temporal.Instant (for use in .transform())
 */
export function transformDateToInstant(date: Date): Instant {
	return instantFromDate(date);
}

/**
 * Transform ISO string to Temporal.Instant (for use in .transform())
 */
export function transformISOToInstant(iso: string): Instant {
	return parseInstant(iso);
}

/**
 * Transform unknown value to Temporal.Instant (for use in .transform())
 * Returns null if invalid
 */
export function transformToInstant(value: unknown): Instant | null {
	if (!value) return null;

	if (isInstant(value)) {
		return value;
	}

	if (value instanceof Date) {
		try {
			return instantFromDate(value);
		} catch {
			return null;
		}
	}

	if (typeof value === "string") {
		try {
			return parseInstant(value);
		} catch {
			return null;
		}
	}

	return null;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type helper for inferred Instant from schema
 */
export type InferInstant<T extends z.ZodType> = z.infer<T> extends Instant ? z.infer<T> : never;
