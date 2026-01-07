import { z } from "zod";

/**
 * Schema for vacation balance information
 */
export const vacationBalanceSchema = z.object({
	year: z.number().int(),
	totalDays: z.number(),
	usedDays: z.number(),
	pendingDays: z.number(),
	remainingDays: z.number(),
	carryoverDays: z.number().optional(),
	carryoverExpiryDate: z.coerce.date().optional(),
});

/**
 * Schema for absence request (form submission)
 */
export const absenceRequestSchema = z.object({
	categoryId: z.string().uuid(),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	notes: z.string().optional(),
});

/**
 * Schema for employee allowance update
 */
export const employeeAllowanceUpdateSchema = z.object({
	employeeId: z.string().uuid(),
	year: z.number().int(),
	customAnnualDays: z.number().optional(),
	customCarryoverDays: z.number().optional(),
	adjustmentDays: z.number().optional(),
	adjustmentReason: z.string().optional(),
});

/**
 * Schema for absence category information
 */
const absenceCategorySchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	type: z.string(),
	color: z.string().nullable(),
	countsAgainstVacation: z.boolean(),
});

/**
 * Schema for absence with category (full absence information)
 * Used when displaying absence records with related data
 */
export const absenceWithCategorySchema = z.object({
	id: z.string().uuid(),
	employeeId: z.string().uuid(),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	status: z.enum(["pending", "approved", "rejected"]),
	notes: z.string().nullable(),
	category: absenceCategorySchema,
	approvedBy: z.string().uuid().nullable(),
	approvedAt: z.coerce.date().nullable(),
	rejectionReason: z.string().nullable(),
	createdAt: z.coerce.date(),
});

// Export inferred types for use in components
export type VacationBalance = z.infer<typeof vacationBalanceSchema>;
export type AbsenceRequest = z.infer<typeof absenceRequestSchema>;
export type EmployeeAllowanceUpdate = z.infer<typeof employeeAllowanceUpdateSchema>;
export type AbsenceWithCategory = z.infer<typeof absenceWithCategorySchema>;
