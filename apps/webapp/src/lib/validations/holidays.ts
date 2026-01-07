import { z } from "zod";

/**
 * Schema for holiday information
 * Maps to the holiday table in the database
 */
export const holidaySchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	categoryId: z.string().uuid(),
	recurrencePattern: z.string().nullable().optional(),
	recurrenceEndDate: z.coerce.date().nullable().optional(),
});

/**
 * Schema for holiday with category information
 * Used when displaying holidays with their category details
 */
export const holidayWithCategorySchema = holidaySchema.extend({
	category: z.object({
		id: z.string().uuid(),
		name: z.string(),
		type: z.string(),
		blocksTimeEntry: z.boolean(),
	}),
});

/**
 * Schema for creating a new holiday
 */
export const createHolidaySchema = z.object({
	name: z.string().min(1, "Holiday name is required"),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	categoryId: z.string().uuid(),
	recurrencePattern: z.string().nullable().optional(),
	recurrenceEndDate: z.coerce.date().nullable().optional(),
});

// Export inferred types for use in components
export type Holiday = z.infer<typeof holidaySchema>;
export type HolidayWithCategory = z.infer<typeof holidayWithCategorySchema>;
export type CreateHoliday = z.infer<typeof createHolidaySchema>;
