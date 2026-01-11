import { z } from "zod";

// ============================================
// BASE SCHEMAS
// ============================================

const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

// HH:mm format validation
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
	message: "Time must be in HH:mm format (e.g., 09:00, 22:30)",
});

// Percentage validation (0.01 to 10.0 = 1% to 1000%)
const percentageSchema = z
	.number()
	.min(0.01, "Percentage must be at least 1%")
	.max(10, "Percentage cannot exceed 1000%");

// ============================================
// RULE SCHEMAS BY TYPE
// ============================================

export const dayOfWeekRuleSchema = z.object({
	ruleType: z.literal("day_of_week"),
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().max(1000).optional().nullable(),
	percentage: percentageSchema,
	dayOfWeek: dayOfWeekSchema,
	priority: z.number().int().min(0).default(0),
	validFrom: z.date().optional().nullable(),
	validUntil: z.date().optional().nullable(),
	isActive: z.boolean().default(true),
});

export const timeWindowRuleSchema = z.object({
	ruleType: z.literal("time_window"),
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().max(1000).optional().nullable(),
	percentage: percentageSchema,
	windowStartTime: timeSchema,
	windowEndTime: timeSchema,
	priority: z.number().int().min(0).default(0),
	validFrom: z.date().optional().nullable(),
	validUntil: z.date().optional().nullable(),
	isActive: z.boolean().default(true),
});

export const dateBasedRuleSchema = z
	.object({
		ruleType: z.literal("date_based"),
		name: z.string().min(1, "Name is required").max(255),
		description: z.string().max(1000).optional().nullable(),
		percentage: percentageSchema,
		specificDate: z.date().optional().nullable(),
		dateRangeStart: z.date().optional().nullable(),
		dateRangeEnd: z.date().optional().nullable(),
		priority: z.number().int().min(0).default(0),
		validFrom: z.date().optional().nullable(),
		validUntil: z.date().optional().nullable(),
		isActive: z.boolean().default(true),
	})
	.refine(
		(data) => data.specificDate || (data.dateRangeStart && data.dateRangeEnd),
		{ message: "Either a specific date or a date range is required" },
	)
	.refine(
		(data) => {
			if (data.dateRangeStart && data.dateRangeEnd) {
				return data.dateRangeEnd >= data.dateRangeStart;
			}
			return true;
		},
		{ message: "End date must be on or after start date" },
	);

// ============================================
// COMBINED RULE SCHEMA
// ============================================

export const surchargeRuleSchema = z.discriminatedUnion("ruleType", [
	dayOfWeekRuleSchema,
	timeWindowRuleSchema,
	dateBasedRuleSchema,
]);

export type SurchargeRuleFormData = z.infer<typeof surchargeRuleSchema>;

// ============================================
// MODEL SCHEMAS
// ============================================

export const surchargeModelFormSchema = z.object({
	name: z
		.string()
		.min(1, "Name is required")
		.max(255, "Name cannot exceed 255 characters"),
	description: z.string().max(1000).optional().nullable(),
	rules: z
		.array(surchargeRuleSchema)
		.min(1, "At least one rule is required"),
	isActive: z.boolean().default(true),
});

export type SurchargeModelFormData = z.infer<typeof surchargeModelFormSchema>;

// Schema for updating an existing model
export const updateSurchargeModelSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	description: z.string().max(1000).optional().nullable(),
	isActive: z.boolean().optional(),
});

export type UpdateSurchargeModelData = z.infer<typeof updateSurchargeModelSchema>;

// ============================================
// ASSIGNMENT SCHEMAS
// ============================================

export const surchargeAssignmentFormSchema = z
	.object({
		modelId: z.string().uuid("Invalid model ID"),
		assignmentType: z.enum(["organization", "team", "employee"]),
		teamId: z.string().uuid().optional().nullable(),
		employeeId: z.string().uuid().optional().nullable(),
		effectiveFrom: z.date().optional().nullable(),
		effectiveUntil: z.date().optional().nullable(),
		isActive: z.boolean().default(true),
	})
	.refine(
		(data) => {
			if (data.assignmentType === "team" && !data.teamId) return false;
			if (data.assignmentType === "employee" && !data.employeeId) return false;
			return true;
		},
		{ message: "Team or employee ID required based on assignment type" },
	)
	.refine(
		(data) => {
			if (data.effectiveFrom && data.effectiveUntil) {
				return data.effectiveUntil >= data.effectiveFrom;
			}
			return true;
		},
		{ message: "Effective until date must be on or after effective from date" },
	);

export type SurchargeAssignmentFormData = z.infer<typeof surchargeAssignmentFormSchema>;

// ============================================
// QUERY SCHEMAS
// ============================================

export const surchargeCalculationsQuerySchema = z.object({
	organizationId: z.string(),
	startDate: z.date(),
	endDate: z.date(),
	employeeId: z.string().uuid().optional(),
});

export type SurchargeCalculationsQuery = z.infer<typeof surchargeCalculationsQuerySchema>;

// ============================================
// RESPONSE TYPES
// ============================================

export type SurchargeModelWithRules = {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	rules: Array<{
		id: string;
		name: string;
		description: string | null;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: string;
		dayOfWeek: string | null;
		windowStartTime: string | null;
		windowEndTime: string | null;
		specificDate: Date | null;
		dateRangeStart: Date | null;
		dateRangeEnd: Date | null;
		priority: number;
		validFrom: Date | null;
		validUntil: Date | null;
		isActive: boolean;
		createdAt: Date;
		createdBy: string;
	}>;
};

export type SurchargeAssignmentWithDetails = {
	id: string;
	modelId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	model: {
		id: string;
		name: string;
	};
	team: {
		id: string;
		name: string;
	} | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
};

export type SurchargeCalculationWithDetails = {
	id: string;
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	surchargeRuleId: string | null;
	surchargeModelId: string | null;
	calculationDate: Date;
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
	appliedPercentage: string;
	calculationDetails: {
		workPeriodStartTime: string;
		workPeriodEndTime: string;
		rulesApplied: Array<{
			ruleId: string;
			ruleName: string;
			ruleType: string;
			percentage: number;
			qualifyingMinutes: number;
			surchargeMinutes: number;
		}>;
		overlapPolicy: string;
		calculatedAt: string;
	} | null;
	createdAt: Date;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	};
};
