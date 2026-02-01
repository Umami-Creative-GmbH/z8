import * as z from "zod";

// ============================================
// COVERAGE RULE SCHEMAS
// ============================================

/**
 * Validate HH:mm time format.
 */
const timeFormatRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const timeSchema = z
	.string()
	.regex(timeFormatRegex, "Time must be in HH:mm format (e.g., 09:00)");

/**
 * Day of week enum matching the database enum.
 */
export const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

/**
 * Base coverage rule fields.
 */
export const coverageRuleSchema = z
	.object({
		subareaId: z.string().uuid("Invalid subarea ID"),
		dayOfWeek: dayOfWeekSchema,
		startTime: timeSchema,
		endTime: timeSchema,
		minimumStaffCount: z
			.number()
			.int("Staff count must be a whole number")
			.min(1, "Minimum staff count must be at least 1")
			.max(100, "Minimum staff count cannot exceed 100"),
		priority: z.number().int().min(0).max(100).optional().default(0),
	})
	.refine((data) => {
		// Validate that startTime < endTime
		const [startHours, startMinutes] = data.startTime.split(":").map(Number);
		const [endHours, endMinutes] = data.endTime.split(":").map(Number);
		const startTotal = startHours * 60 + startMinutes;
		const endTotal = endHours * 60 + endMinutes;
		return startTotal < endTotal;
	}, "Start time must be before end time");

/**
 * Create coverage rule schema (with optional priority defaulting to 0).
 */
export const createCoverageRuleSchema = z
	.object({
		subareaId: z.string().uuid("Invalid subarea ID"),
		dayOfWeek: dayOfWeekSchema,
		startTime: timeSchema,
		endTime: timeSchema,
		minimumStaffCount: z
			.number()
			.int("Staff count must be a whole number")
			.min(1, "Minimum staff count must be at least 1")
			.max(100, "Minimum staff count cannot exceed 100"),
		priority: z.number().int().min(0).max(100).optional(),
	})
	.refine((data) => {
		// Validate that startTime < endTime
		const [startHours, startMinutes] = data.startTime.split(":").map(Number);
		const [endHours, endMinutes] = data.endTime.split(":").map(Number);
		const startTotal = startHours * 60 + startMinutes;
		const endTotal = endHours * 60 + endMinutes;
		return startTotal < endTotal;
	}, "Start time must be before end time");

/**
 * Update coverage rule schema (all fields optional).
 */
export const updateCoverageRuleSchema = z
	.object({
		subareaId: z.string().uuid("Invalid subarea ID").optional(),
		dayOfWeek: dayOfWeekSchema.optional(),
		startTime: timeSchema.optional(),
		endTime: timeSchema.optional(),
		minimumStaffCount: z
			.number()
			.int("Staff count must be a whole number")
			.min(1, "Minimum staff count must be at least 1")
			.max(100, "Minimum staff count cannot exceed 100")
			.optional(),
		priority: z.number().int().min(0).max(100).optional(),
	})
	.refine(
		(data) => {
			// If both times are provided, validate that start < end
			if (data.startTime && data.endTime) {
				const [startHours, startMinutes] = data.startTime.split(":").map(Number);
				const [endHours, endMinutes] = data.endTime.split(":").map(Number);
				const startTotal = startHours * 60 + startMinutes;
				const endTotal = endHours * 60 + endMinutes;
				return startTotal < endTotal;
			}
			return true;
		},
		{ message: "Start time must be before end time" },
	);

/**
 * Bulk create coverage rules schema.
 */
export const bulkCreateCoverageRulesSchema = z.object({
	rules: z.array(coverageRuleSchema).min(1, "At least one rule is required"),
});

/**
 * Date range query schema for coverage calculations.
 */
export const coverageDateRangeSchema = z.object({
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	subareaIds: z.array(z.string().uuid()).optional(),
});

// ============================================
// TYPES
// ============================================

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type CoverageRuleFormValues = z.infer<typeof coverageRuleSchema>;
export type CreateCoverageRule = z.infer<typeof createCoverageRuleSchema>;
export type UpdateCoverageRule = z.infer<typeof updateCoverageRuleSchema>;
export type BulkCreateCoverageRules = z.infer<typeof bulkCreateCoverageRulesSchema>;
export type CoverageDateRange = z.infer<typeof coverageDateRangeSchema>;
