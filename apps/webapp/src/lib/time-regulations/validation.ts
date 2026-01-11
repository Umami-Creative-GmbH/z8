import { z } from "zod";

// ============================================
// BREAK OPTION SCHEMA
// ============================================

export const breakOptionSchema = z.object({
	id: z.string().uuid().optional(), // Present when editing existing option
	// null = any number of splits allowed
	// 1 = take entire break at once
	// 2, 3, etc. = can be split into that many parts
	splitCount: z.number().min(1).max(10).nullable(),
	// Minimum duration per split in minutes (null if splitCount is 1)
	minimumSplitMinutes: z.number().min(1).max(60).nullable(),
	// For "any number" option (splitCount = null), the minimum for the longest split
	minimumLongestSplitMinutes: z.number().min(1).max(60).nullable(),
});

export type BreakOptionFormValues = z.infer<typeof breakOptionSchema>;

// ============================================
// BREAK RULE SCHEMA
// ============================================

export const breakRuleSchema = z.object({
	id: z.string().uuid().optional(), // Present when editing existing rule
	// Trigger condition: "In case of more than X minutes of working time"
	workingMinutesThreshold: z.number().min(60).max(1440), // 1-24 hours
	// Required total break: "Y minutes of break are necessary"
	requiredBreakMinutes: z.number().min(5).max(120), // 5-120 minutes
	// At least one option must be provided
	options: z.array(breakOptionSchema).min(1, "At least one break option is required"),
});

export type BreakRuleFormValues = z.infer<typeof breakRuleSchema>;

// ============================================
// TIME REGULATION FORM SCHEMA
// ============================================

export const timeRegulationFormSchema = z.object({
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().optional(),
	// Maximum working time per day (in minutes), e.g., 600 = 10 hours
	maxDailyMinutes: z.number().min(60).max(1440).nullable(), // 1-24 hours
	// Maximum working time per week (in minutes), e.g., 2880 = 48 hours
	maxWeeklyMinutes: z.number().min(60).max(10080).nullable(), // 1 hour - 168 hours
	// Maximum uninterrupted working time without break (in minutes)
	maxUninterruptedMinutes: z.number().min(30).max(720).nullable(), // 30 min - 12 hours
	// Break rules (optional, but if provided must have at least one)
	breakRules: z.array(breakRuleSchema).default([]),
	isActive: z.boolean().default(true),
});

export type TimeRegulationFormValues = z.infer<typeof timeRegulationFormSchema>;

// ============================================
// TIME REGULATION ASSIGNMENT SCHEMA
// ============================================

export const timeRegulationAssignmentFormSchema = z
	.object({
		regulationId: z.string().uuid("Invalid regulation"),
		assignmentType: z.enum(["organization", "team", "employee"]),
		teamId: z.string().uuid().optional().nullable(),
		employeeId: z.string().uuid().optional().nullable(),
		effectiveFrom: z.date().optional().nullable(),
		effectiveUntil: z.date().optional().nullable(),
		isActive: z.boolean().default(true),
	})
	.refine(
		(data) => {
			// Team assignment requires teamId
			if (data.assignmentType === "team" && !data.teamId) {
				return false;
			}
			// Employee assignment requires employeeId
			if (data.assignmentType === "employee" && !data.employeeId) {
				return false;
			}
			return true;
		},
		{
			message: "Team or employee ID required based on assignment type",
			path: ["assignmentType"],
		},
	)
	.refine(
		(data) => {
			if (data.effectiveFrom && data.effectiveUntil) {
				return data.effectiveUntil >= data.effectiveFrom;
			}
			return true;
		},
		{
			message: "Effective until must be after effective from",
			path: ["effectiveUntil"],
		},
	);

export type TimeRegulationAssignmentFormValues = z.infer<typeof timeRegulationAssignmentFormSchema>;

// ============================================
// PRESET IMPORT SCHEMA
// ============================================

export const timeRegulationPresetImportSchema = z.object({
	presetId: z.string().uuid("Invalid preset"),
	// Optional: override the name when importing
	name: z.string().min(1).max(255).optional(),
	// Optional: set as organization default immediately
	setAsOrgDefault: z.boolean().default(false),
});

export type TimeRegulationPresetImportValues = z.infer<typeof timeRegulationPresetImportSchema>;

// ============================================
// VIOLATION ACKNOWLEDGMENT SCHEMA
// ============================================

export const violationAcknowledgmentSchema = z.object({
	violationId: z.string().uuid("Invalid violation ID"),
	note: z.string().max(1000).optional(),
});

export type ViolationAcknowledgmentValues = z.infer<typeof violationAcknowledgmentSchema>;

// ============================================
// COMPLIANCE CHECK RESULT TYPES
// ============================================

export type ComplianceWarning = {
	type: "max_daily" | "max_weekly" | "max_uninterrupted" | "break_required";
	message: string;
	actualValue: number;
	limitValue: number;
	severity: "warning" | "violation";
};

export type BreakRequirementResult = {
	isRequired: boolean;
	totalBreakNeeded: number;
	breakTaken: number;
	remaining: number;
	splitOptions: Array<{
		description: string;
		splitCount: number | null;
		minimumPerSplit: number | null;
	}>;
};

export type ComplianceCheckResult = {
	isCompliant: boolean;
	warnings: ComplianceWarning[];
	breakRequirement: BreakRequirementResult | null;
};

// ============================================
// EFFECTIVE REGULATION TYPE
// ============================================

export type EffectiveTimeRegulation = {
	regulationId: string;
	regulationName: string;
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	maxUninterruptedMinutes: number | null;
	breakRules: Array<{
		workingMinutesThreshold: number;
		requiredBreakMinutes: number;
		options: Array<{
			splitCount: number | null;
			minimumSplitMinutes: number | null;
			minimumLongestSplitMinutes: number | null;
		}>;
	}>;
	assignmentType: "organization" | "team" | "employee";
	assignedVia: string; // "Organization Default", team name, or "Individual"
};
