import { z } from "zod";

/**
 * Schema for calendar event types
 */
export const calendarEventTypeSchema = z.enum([
	"holiday",
	"absence",
	"time_entry",
	"work_period",
]);

/**
 * Base calendar event schema
 * All calendar events must conform to this structure
 */
export const calendarEventSchema = z.object({
	id: z.string(),
	type: calendarEventTypeSchema,
	date: z.coerce.date(),
	title: z.string(),
	description: z.string().optional(),
	color: z.string(),
	metadata: z.record(z.any()),
});

/**
 * Holiday event schema with typed metadata
 */
export const holidayEventSchema = calendarEventSchema.extend({
	type: z.literal("holiday"),
	metadata: z.object({
		categoryName: z.string(),
		categoryType: z.string(),
		blocksTimeEntry: z.boolean(),
		isRecurring: z.boolean(),
	}),
});

/**
 * Absence event schema with typed metadata
 */
export const absenceEventSchema = calendarEventSchema.extend({
	type: z.literal("absence"),
	metadata: z.object({
		categoryName: z.string(),
		status: z.enum(["pending", "approved", "rejected"]),
		employeeName: z.string(),
	}),
});

/**
 * Time entry event schema with typed metadata
 */
export const timeEntryEventSchema = calendarEventSchema.extend({
	type: z.literal("time_entry"),
	metadata: z.object({
		entryType: z.enum(["clock_in", "clock_out", "correction"]),
		employeeName: z.string(),
	}),
});

/**
 * Work period event schema with typed metadata
 */
export const workPeriodEventSchema = calendarEventSchema.extend({
	type: z.literal("work_period"),
	metadata: z.object({
		durationMinutes: z.number().int(),
		employeeName: z.string(),
	}),
});

/**
 * Discriminated union schema for all calendar event types
 * Provides type-safe parsing for different event types
 */
export const calendarEventUnionSchema = z.discriminatedUnion("type", [
	holidayEventSchema,
	absenceEventSchema,
	timeEntryEventSchema,
	workPeriodEventSchema,
]);

// Export inferred types for use in components
export type CalendarEventType = z.infer<typeof calendarEventTypeSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type HolidayEvent = z.infer<typeof holidayEventSchema>;
export type AbsenceEvent = z.infer<typeof absenceEventSchema>;
export type TimeEntryEvent = z.infer<typeof timeEntryEventSchema>;
export type WorkPeriodEvent = z.infer<typeof workPeriodEventSchema>;
