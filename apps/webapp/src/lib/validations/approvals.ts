import { z } from "zod";

/**
 * Schema for user information in approval requests
 */
const approvalUserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string().email(),
	image: z.string().nullable(),
});

/**
 * Schema for requester information in approvals
 */
const requesterSchema = z.object({
	user: approvalUserSchema,
});

/**
 * Day period enum for half-day absences
 */
const dayPeriodSchema = z.enum(["full_day", "am", "pm"]);

/**
 * Schema for absence information in approval requests
 * Note: startDate/endDate are YYYY-MM-DD strings (logical calendar dates)
 */
const absenceInfoSchema = z.object({
	id: z.string().uuid(),
	startDate: z.string(), // YYYY-MM-DD
	startPeriod: dayPeriodSchema,
	endDate: z.string(), // YYYY-MM-DD
	endPeriod: dayPeriodSchema,
	notes: z.string().nullable(),
	category: z.object({
		name: z.string(),
		type: z.string(),
		color: z.string().nullable(),
	}),
});

/**
 * Schema for work period in time correction approvals
 * Reuses workPeriodWithEntriesSchema but only includes relevant fields
 */
const workPeriodForApprovalSchema = z.object({
	id: z.string().uuid(),
	startTime: z.coerce.date(),
	endTime: z.coerce.date().nullable(),
	clockInEntry: z.object({
		timestamp: z.coerce.date(),
	}),
	clockOutEntry: z
		.object({
			timestamp: z.coerce.date(),
		})
		.nullable(),
});

/**
 * Schema for approval request with absence entry
 * Used in absence approval workflows
 */
export const approvalWithAbsenceSchema = z.object({
	id: z.string().uuid(),
	entityId: z.string().uuid(),
	entityType: z.string(),
	status: z.enum(["pending", "approved", "rejected"]),
	createdAt: z.coerce.date(),
	requester: requesterSchema,
	absence: absenceInfoSchema,
});

/**
 * Schema for approval request with time correction
 * Used in time correction approval workflows
 * This is the most complex nested date structure in the app
 */
export const approvalWithTimeCorrectionSchema = z.object({
	id: z.string().uuid(),
	entityId: z.string().uuid(),
	entityType: z.string(),
	status: z.enum(["pending", "approved", "rejected"]),
	createdAt: z.coerce.date(),
	requester: requesterSchema,
	workPeriod: workPeriodForApprovalSchema,
});

// Export inferred types for use in components
export type ApprovalWithAbsence = z.infer<typeof approvalWithAbsenceSchema>;
export type ApprovalWithTimeCorrection = z.infer<typeof approvalWithTimeCorrectionSchema>;
