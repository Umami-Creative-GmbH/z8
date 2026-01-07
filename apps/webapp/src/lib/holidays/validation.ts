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
