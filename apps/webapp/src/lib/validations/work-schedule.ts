import * as z from "zod";

// Enum schemas matching database enums
export const scheduleCycleSchema = z.enum(["daily", "weekly", "biweekly", "monthly", "yearly"]);
export const scheduleTypeSchema = z.enum(["simple", "detailed"]);
export const workingDaysPresetSchema = z.enum(["weekdays", "weekends", "all_days", "custom"]);
export const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);
export const assignmentTypeSchema = z.enum(["organization", "team", "employee"]);

// Work schedule template day schema for detailed schedules
export const templateDaySchema = z.object({
	dayOfWeek: dayOfWeekSchema,
	hoursPerDay: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 24;
			},
			{ message: "Hours per day must be between 0 and 24" },
		),
	isWorkDay: z.boolean(),
	cycleWeek: z.number().min(1).max(2).optional().default(1),
});

// Simple template schema
export const simpleTemplateSchema = z.object({
	scheduleType: z.literal("simple"),
	name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
	description: z.string().max(500, "Description must be 500 characters or less").optional(),
	scheduleCycle: scheduleCycleSchema,
	workingDaysPreset: workingDaysPresetSchema,
	hoursPerCycle: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 744; // Max 24*31 for monthly
			},
			{ message: "Hours per cycle must be between 0 and 744" },
		),
	homeOfficeDaysPerCycle: z.number().min(0).max(31).optional().default(0),
});

// Detailed template schema
export const detailedTemplateSchema = z.object({
	scheduleType: z.literal("detailed"),
	name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
	description: z.string().max(500, "Description must be 500 characters or less").optional(),
	scheduleCycle: scheduleCycleSchema,
	workingDaysPreset: z.literal("custom"), // Detailed mode always uses custom
	homeOfficeDaysPerCycle: z.number().min(0).max(31).optional().default(0),
	days: z
		.array(templateDaySchema)
		.min(7, "Must include all 7 days of the week")
		.refine(
			(days) => {
				const allDays = [
					"monday",
					"tuesday",
					"wednesday",
					"thursday",
					"friday",
					"saturday",
					"sunday",
				];
				const providedDays = days.map((d) => d.dayOfWeek);
				return allDays.every((day) =>
					providedDays.includes(day as z.infer<typeof dayOfWeekSchema>),
				);
			},
			{ message: "All 7 days of the week must be included" },
		)
		.refine(
			(days) => {
				// Ensure no duplicate days within the same cycle week
				const dayWeekPairs = days.map((d) => `${d.dayOfWeek}-${d.cycleWeek || 1}`);
				const pairSet = new Set(dayWeekPairs);
				return pairSet.size === days.length;
			},
			{ message: "Duplicate days are not allowed within the same cycle week" },
		),
});

// Union schema for creating either simple or detailed template
export const createWorkScheduleTemplateSchema = z.discriminatedUnion("scheduleType", [
	simpleTemplateSchema,
	detailedTemplateSchema,
]);

// Update template schema (partial)
export const updateWorkScheduleTemplateSchema = z.object({
	name: z
		.string()
		.min(1, "Name is required")
		.max(100, "Name must be 100 characters or less")
		.optional(),
	description: z
		.string()
		.max(500, "Description must be 500 characters or less")
		.optional()
		.nullable(),
	scheduleCycle: scheduleCycleSchema.optional(),
	scheduleType: scheduleTypeSchema.optional(),
	workingDaysPreset: workingDaysPresetSchema.optional(),
	hoursPerCycle: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 744;
			},
			{ message: "Hours per cycle must be between 0 and 744" },
		)
		.optional()
		.nullable(),
	homeOfficeDaysPerCycle: z.number().min(0).max(31).optional(),
	days: z.array(templateDaySchema).optional(),
	isDefault: z.boolean().optional(),
});

// Assignment schema
export const createWorkScheduleAssignmentSchema = z
	.object({
		templateId: z.string().uuid("Invalid template ID"),
		assignmentType: assignmentTypeSchema,
		teamId: z.string().uuid("Invalid team ID").optional().nullable(),
		employeeId: z.string().uuid("Invalid employee ID").optional().nullable(),
		effectiveFrom: z.date().optional().nullable(),
		effectiveUntil: z.date().optional().nullable(),
	})
	.refine(
		(data) => {
			// Validate that teamId is provided for team assignments
			if (data.assignmentType === "team" && !data.teamId) {
				return false;
			}
			return true;
		},
		{ message: "Team ID is required for team assignments", path: ["teamId"] },
	)
	.refine(
		(data) => {
			// Validate that employeeId is provided for employee assignments
			if (data.assignmentType === "employee" && !data.employeeId) {
				return false;
			}
			return true;
		},
		{ message: "Employee ID is required for employee assignments", path: ["employeeId"] },
	);

// Delete assignment schema
export const deleteWorkScheduleAssignmentSchema = z.object({
	assignmentId: z.string().uuid("Invalid assignment ID"),
});

// Work classification schema for employee schedules
export const workClassificationSchema = z.enum([
	"full_time",
	"part_time",
	"mini_job",
	"contractor",
]);

// Schedule day schema for detailed employee schedules
export const scheduleDaySchema = z.object({
	dayOfWeek: dayOfWeekSchema,
	hoursPerDay: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 24;
			},
			{ message: "Hours per day must be between 0 and 24" },
		),
	isWorkDay: z.boolean(),
});

// Simple work schedule schema (for direct employee assignment)
export const simpleWorkScheduleSchema = z.object({
	scheduleType: z.literal("simple"),
	hoursPerWeek: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 168; // Max hours in a week
			},
			{ message: "Hours per week must be between 0 and 168" },
		),
	workClassification: workClassificationSchema,
	effectiveFrom: z.date().optional(),
});

// Detailed work schedule schema (for direct employee assignment)
export const detailedWorkScheduleSchema = z.object({
	scheduleType: z.literal("detailed"),
	workClassification: workClassificationSchema,
	effectiveFrom: z.date().optional(),
	days: z
		.array(scheduleDaySchema)
		.min(7, "Must include all 7 days of the week")
		.refine(
			(days) => {
				const allDays = [
					"monday",
					"tuesday",
					"wednesday",
					"thursday",
					"friday",
					"saturday",
					"sunday",
				];
				const providedDays = days.map((d) => d.dayOfWeek);
				return allDays.every((day) =>
					providedDays.includes(day as z.infer<typeof dayOfWeekSchema>),
				);
			},
			{ message: "All 7 days of the week must be included" },
		),
});

// Union schema for creating either simple or detailed work schedule for an employee
export const createWorkScheduleSchema = z.discriminatedUnion("scheduleType", [
	simpleWorkScheduleSchema,
	detailedWorkScheduleSchema,
]);

// Types derived from schemas
export type ScheduleCycle = z.infer<typeof scheduleCycleSchema>;
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;
export type WorkingDaysPreset = z.infer<typeof workingDaysPresetSchema>;
export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type AssignmentType = z.infer<typeof assignmentTypeSchema>;
export type TemplateDay = z.infer<typeof templateDaySchema>;
export type SimpleTemplate = z.infer<typeof simpleTemplateSchema>;
export type DetailedTemplate = z.infer<typeof detailedTemplateSchema>;
export type CreateWorkScheduleTemplate = z.infer<typeof createWorkScheduleTemplateSchema>;
export type UpdateWorkScheduleTemplate = z.infer<typeof updateWorkScheduleTemplateSchema>;
export type CreateWorkScheduleAssignment = z.infer<typeof createWorkScheduleAssignmentSchema>;
export type DeleteWorkScheduleAssignment = z.infer<typeof deleteWorkScheduleAssignmentSchema>;
export type WorkClassification = z.infer<typeof workClassificationSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type SimpleWorkSchedule = z.infer<typeof simpleWorkScheduleSchema>;
export type DetailedWorkSchedule = z.infer<typeof detailedWorkScheduleSchema>;
export type CreateWorkSchedule = z.infer<typeof createWorkScheduleSchema>;
