import { z } from "zod";

/**
 * Schema for time entry (clock in/out entry)
 * Maps to the timeEntry table in the database
 */
export const timeEntrySchema = z.object({
	id: z.string().uuid(),
	employeeId: z.string().uuid(),
	type: z.enum(["clock_in", "clock_out"]),
	timestamp: z.coerce.date(),

	// Blockchain linking
	previousEntryId: z.string().uuid().nullable(),
	hash: z.string(),
	previousHash: z.string().nullable(),

	// Correction tracking
	replacesEntryId: z.string().uuid().nullable(),
	isSuperseded: z.boolean().default(false),
	supersededById: z.string().uuid().nullable(),

	// Metadata
	notes: z.string().nullable(),
	location: z.string().nullable(),
	ipAddress: z.string().nullable(),
	deviceInfo: z.string().nullable(),

	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

/**
 * Schema for work period with nested time entries
 * Used in time tracking components and approval workflows
 */
export const workPeriodWithEntriesSchema = z.object({
	id: z.string().uuid(),
	employeeId: z.string().uuid(),
	startTime: z.coerce.date(),
	endTime: z.coerce.date().nullable(),
	durationMinutes: z.number().int().nullable(),
	clockIn: timeEntrySchema,
	clockOut: timeEntrySchema.optional(),
});

/**
 * Schema for time summary statistics
 */
export const timeSummarySchema = z.object({
	totalMinutes: z.number().int(),
	totalHours: z.number(),
	periodCount: z.number().int(),
	averageHoursPerDay: z.number(),
});

// Export inferred types for use in components
export type TimeEntry = z.infer<typeof timeEntrySchema>;
export type WorkPeriodWithEntries = z.infer<typeof workPeriodWithEntriesSchema>;
export type TimeSummary = z.infer<typeof timeSummarySchema>;
