import { z } from "zod";

export const holidayFormSchema = z
	.object({
		name: z.string().min(1, "Name is required").max(255),
		description: z.string().optional(),
		categoryId: z.string().uuid("Invalid category"),
		startDate: z.date({ message: "Start date is required" }),
		endDate: z.date({ message: "End date is required" }),
		recurrenceType: z.enum(["none", "yearly", "custom"]),
		recurrenceRule: z.string().optional(),
		recurrenceEndDate: z.date().optional().nullable(),
		isActive: z.boolean().default(true),
	})
	.refine((data) => data.endDate >= data.startDate, {
		message: "End date must be after or equal to start date",
		path: ["endDate"],
	});

export const categoryFormSchema = z.object({
	type: z.enum(["public_holiday", "company_holiday", "training_day", "custom"]),
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().optional(),
	color: z
		.string()
		.regex(/^#[0-9A-F]{6}$/i, "Invalid hex color")
		.optional(),
	blocksTimeEntry: z.boolean().default(true),
	excludeFromCalculations: z.boolean().default(true),
	isActive: z.boolean().default(true),
});

export type HolidayFormValues = z.infer<typeof holidayFormSchema>;
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

// Holiday import schemas
export const holidayImportParamsSchema = z.object({
	countryCode: z.string().length(2, "Country code must be 2 characters"),
	stateCode: z.string().optional(),
	regionCode: z.string().optional(),
	year: z.number().min(2000).max(2100),
	holidayTypes: z
		.array(z.enum(["public", "bank", "optional", "school", "observance"]))
		.default(["public"]),
});

export const holidayImportSchema = z.object({
	holidays: z.array(
		z.object({
			name: z.string(),
			date: z.string(),
			startDate: z.coerce.date(),
			endDate: z.coerce.date(),
			type: z.enum(["public", "bank", "optional", "school", "observance"]),
		}),
	),
	categoryId: z.string().uuid().optional(),
	createRecurring: z.boolean().default(true),
	skipDuplicates: z.boolean().default(true),
});

export type HolidayImportParams = z.infer<typeof holidayImportParamsSchema>;
export type HolidayImportData = z.infer<typeof holidayImportSchema>;

// ============================================
// HOLIDAY PRESET SCHEMAS
// ============================================

// Schema for creating/updating a holiday preset
export const holidayPresetFormSchema = z.object({
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().optional(),
	countryCode: z.string().length(2, "Country code must be 2 characters").optional(),
	stateCode: z.string().optional(),
	regionCode: z.string().optional(),
	color: z
		.string()
		.regex(/^#[0-9A-F]{6}$/i, "Invalid hex color")
		.optional(),
	isActive: z.boolean().default(true),
});

export type HolidayPresetFormValues = z.infer<typeof holidayPresetFormSchema>;

// Schema for individual holidays within a preset
export const holidayPresetHolidayFormSchema = z.object({
	name: z.string().min(1, "Name is required").max(255),
	description: z.string().optional(),
	month: z.number().min(1, "Month must be 1-12").max(12, "Month must be 1-12"),
	day: z.number().min(1, "Day must be 1-31").max(31, "Day must be 1-31"),
	durationDays: z.number().min(1).default(1),
	holidayType: z.enum(["public", "bank", "optional", "school", "observance"]).optional(),
	isFloating: z.boolean().default(false),
	floatingRule: z.string().optional(),
	categoryId: z.string().uuid().optional(),
	isActive: z.boolean().default(true),
});

export type HolidayPresetHolidayFormValues = z.infer<typeof holidayPresetHolidayFormSchema>;

// Schema for bulk adding holidays to a preset
export const holidayPresetHolidaysBulkSchema = z.object({
	holidays: z.array(holidayPresetHolidayFormSchema.omit({ categoryId: true })),
	categoryId: z.string().uuid().optional(),
});

export type HolidayPresetHolidaysBulkValues = z.infer<typeof holidayPresetHolidaysBulkSchema>;

// Schema for preset assignment
export const holidayPresetAssignmentFormSchema = z
	.object({
		presetId: z.string().uuid("Invalid preset"),
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

export type HolidayPresetAssignmentFormValues = z.infer<typeof holidayPresetAssignmentFormSchema>;

// Updated import schema to create preset instead of direct holidays
export const holidayPresetImportSchema = z.object({
	countryCode: z.string().length(2, "Country code must be 2 characters"),
	stateCode: z.string().optional(),
	regionCode: z.string().optional(),
	year: z.number().min(2000).max(2100),
	holidays: z.array(
		z.object({
			name: z.string(),
			date: z.string(),
			startDate: z.coerce.date(),
			endDate: z.coerce.date(),
			type: z.enum(["public", "bank", "optional", "school", "observance"]),
		}),
	),
	presetName: z.string().min(1, "Preset name is required").max(255),
	presetDescription: z.string().optional(),
	presetColor: z
		.string()
		.regex(/^#[0-9A-F]{6}$/i, "Invalid hex color")
		.optional(),
	categoryId: z.string().uuid().optional(),
	setAsOrgDefault: z.boolean().default(false),
	mergeIfExists: z.boolean().default(true),
});

export type HolidayPresetImportData = z.infer<typeof holidayPresetImportSchema>;
