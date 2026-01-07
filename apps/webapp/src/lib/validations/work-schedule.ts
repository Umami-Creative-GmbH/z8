import * as z from "zod";

// Enum schemas matching database enums
export const workClassificationSchema = z.enum(["daily", "weekly", "monthly"]);
export const scheduleTypeSchema = z.enum(["simple", "detailed"]);
export const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

// Work schedule day schema for detailed schedules
export const workScheduleDaySchema = z.object({
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

// Simple schedule schema
export const simpleScheduleSchema = z.object({
	scheduleType: z.literal("simple"),
	workClassification: workClassificationSchema,
	hoursPerWeek: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/, "Invalid number format")
		.refine(
			(val) => {
				const hours = parseFloat(val);
				return !isNaN(hours) && hours >= 0 && hours <= 168;
			},
			{ message: "Hours per week must be between 0 and 168" },
		),
	effectiveFrom: z.date(),
});

// Detailed schedule schema
export const detailedScheduleSchema = z.object({
	scheduleType: z.literal("detailed"),
	workClassification: workClassificationSchema,
	days: z
		.array(workScheduleDaySchema)
		.length(7, "Must include all 7 days of the week")
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
				return allDays.every((day) => providedDays.includes(day as any));
			},
			{ message: "All 7 days of the week must be included" },
		)
		.refine(
			(days) => {
				// Ensure no duplicate days
				const daySet = new Set(days.map((d) => d.dayOfWeek));
				return daySet.size === days.length;
			},
			{ message: "Duplicate days are not allowed" },
		),
	effectiveFrom: z.date(),
});

// Union schema for creating either simple or detailed schedule
export const createWorkScheduleSchema = z.discriminatedUnion("scheduleType", [
	simpleScheduleSchema,
	detailedScheduleSchema,
]);

// Schema for ending a schedule
export const endWorkScheduleSchema = z.object({
	scheduleId: z.string().uuid("Invalid schedule ID"),
	effectiveUntil: z.date(),
});

// Types derived from schemas
export type WorkClassification = z.infer<typeof workClassificationSchema>;
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;
export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type WorkScheduleDay = z.infer<typeof workScheduleDaySchema>;
export type SimpleSchedule = z.infer<typeof simpleScheduleSchema>;
export type DetailedSchedule = z.infer<typeof detailedScheduleSchema>;
export type CreateWorkSchedule = z.infer<typeof createWorkScheduleSchema>;
export type EndWorkSchedule = z.infer<typeof endWorkScheduleSchema>;
