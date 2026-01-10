/**
 * Zod schema adapters for DateTime validation
 *
 * Provides Zod schemas and transformers for working with Luxon DateTime
 * in form validation. Maintains compatibility with react-hook-form and
 * existing z.date() schemas.
 */

import type { DateTime } from "luxon";
import { z } from "zod";
import { fromJSDate, isValid, now, parseISO } from "./luxon-utils";

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * Base DateTime schema
 * Accepts Date, DateTime, or ISO string and converts to DateTime
 */
export const dateTimeSchema = z
	.union([
		z.date().transform((d) => fromJSDate(d, "utc")),
		z
			.string()
			.datetime()
			.transform((s) => parseISO(s, "utc")),
		z.custom<DateTime>((val) => val && typeof val === "object" && "toJSDate" in val),
	])
	.refine((val) => isValid(val as DateTime), { message: "Invalid date" });

/**
 * Optional DateTime schema
 */
export const dateTimeSchemaOptional = dateTimeSchema.optional().nullable();

/**
 * DateTime schema that accepts ISO date strings (YYYY-MM-DD)
 * Common for HTML5 date inputs
 */
export const dateStringSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
	.transform((s) => parseISO(s, "utc"));

/**
 * Optional date string schema
 */
export const dateStringSchemaOptional = dateStringSchema.optional().nullable();

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Create a schema for dates that must be in the past
 *
 * @example
 * const birthdaySchema = pastDateSchema('Birthday must be in the past');
 */
export function pastDateSchema(message: string = "Date must be in the past") {
	return dateTimeSchema.refine((dt) => dt <= now(), { message });
}

/**
 * Create a schema for dates that must be in the future
 */
export function futureDateSchema(message: string = "Date must be in the future") {
	return dateTimeSchema.refine((dt) => dt >= now(), { message });
}

/**
 * Create a schema for dates that must be before a specific date
 */
export function beforeDateSchema(
	maxDate: DateTime,
	message: string = `Date must be before ${maxDate.toISODate()}`,
) {
	return dateTimeSchema.refine((dt) => dt <= maxDate, { message });
}

/**
 * Create a schema for dates that must be after a specific date
 */
export function afterDateSchema(
	minDate: DateTime,
	message: string = `Date must be after ${minDate.toISODate()}`,
) {
	return dateTimeSchema.refine((dt) => dt >= minDate, { message });
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
		.refine((data) => data.startDate <= data.endDate, {
			message: "End date must be after or equal to start date",
			path: ["endDate"],
		});
}

// ============================================================================
// FORM COMPATIBILITY
// ============================================================================

/**
 * Schema for react-hook-form compatibility
 * Keeps z.date() for form compatibility, transforms after validation
 *
 * @example
 * const schema = z.object({
 *   birthday: formDateSchema()
 *     .refine(dt => dt <= DateTime.now(), 'Birthday must be in the past')
 * });
 */
export function formDateSchema() {
	return z.date().transform((d) => fromJSDate(d, "utc"));
}

/**
 * Optional form date schema
 */
export function formDateSchemaOptional() {
	return z
		.date()
		.optional()
		.nullable()
		.transform((d) => (d ? fromJSDate(d, "utc") : null));
}

// ============================================================================
// API COMPATIBILITY
// ============================================================================

/**
 * Schema for API payloads that send ISO strings
 * Validates and converts to DateTime
 *
 * @example
 * const createAbsenceSchema = z.object({
 *   startDate: apiDateSchema(),
 *   endDate: apiDateSchema()
 * });
 */
export function apiDateSchema() {
	return z
		.string()
		.datetime()
		.transform((s) => parseISO(s, "utc"));
}

/**
 * Optional API date schema
 */
export function apiDateSchemaOptional() {
	return z
		.string()
		.datetime()
		.optional()
		.nullable()
		.transform((s) => (s ? parseISO(s, "utc") : null));
}

/**
 * Schema for date-only strings from API (YYYY-MM-DD)
 */
export function apiDateOnlySchema() {
	return z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.transform((s) => parseISO(s, "utc"));
}

// ============================================================================
// PRE-DEFINED COMMON SCHEMAS
// ============================================================================

/**
 * Birthday schema (must be in the past, reasonable date range)
 */
export const birthdaySchema = z
	.date()
	.max(new Date(), "Birthday must be in the past")
	.min(new Date(1900, 0, 1), "Birthday must be after 1900")
	.transform((d) => fromJSDate(d, "utc"));

/**
 * Optional birthday schema
 */
export const birthdaySchemaOptional = z
	.date()
	.max(new Date(), "Birthday must be in the past")
	.min(new Date(1900, 0, 1), "Birthday must be after 1900")
	.optional()
	.nullable()
	.transform((d) => (d ? fromJSDate(d, "utc") : null));

/**
 * Absence date range schema
 */
export const absenceDateRangeSchema = z
	.object({
		startDate: z.date().transform((d) => fromJSDate(d, "utc")),
		endDate: z.date().transform((d) => fromJSDate(d, "utc")),
	})
	.refine((data) => data.startDate <= data.endDate, {
		message: "End date must be after or equal to start date",
		path: ["endDate"],
	});

/**
 * Work schedule effective date range schema
 */
export const workScheduleDateRangeSchema = z
	.object({
		effectiveFrom: z.date().transform((d) => fromJSDate(d, "utc")),
		effectiveUntil: z
			.date()
			.optional()
			.nullable()
			.transform((d) => (d ? fromJSDate(d, "utc") : null)),
	})
	.refine((data) => !data.effectiveUntil || data.effectiveFrom <= data.effectiveUntil, {
		message: "Effective until date must be after effective from date",
		path: ["effectiveUntil"],
	});

// ============================================================================
// TRANSFORMATION HELPERS
// ============================================================================

/**
 * Transform Date to DateTime (for use in .transform())
 */
export function transformDateToDateTime(date: Date): DateTime {
	return fromJSDate(date, "utc");
}

/**
 * Transform ISO string to DateTime (for use in .transform())
 */
export function transformISOToDateTime(iso: string): DateTime {
	return parseISO(iso, "utc");
}

/**
 * Transform unknown value to DateTime (for use in .transform())
 * Returns null if invalid
 */
export function transformToDateTime(value: unknown): DateTime | null {
	if (!value) return null;

	if (value instanceof Date) {
		return fromJSDate(value, "utc");
	}

	if (typeof value === "string") {
		const dt = parseISO(value, "utc");
		return isValid(dt) ? dt : null;
	}

	if (typeof value === "object" && "toJSDate" in value) {
		return value as DateTime;
	}

	return null;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type helper for inferred DateTime from schema
 */
export type InferDateTime<T extends z.ZodType<any, any, any>> =
	T extends z.ZodType<infer U, any, any> ? (U extends DateTime ? U : never) : never;
