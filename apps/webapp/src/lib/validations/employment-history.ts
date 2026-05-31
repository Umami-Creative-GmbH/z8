import * as z from "zod";
import { contractTypeSchema } from "./employee";

export const employmentStatusSchema = z.enum(["active", "inactive", "terminated", "leave"]);
export const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
export const employmentReviewStateSchema = z.enum(["draft", "pending", "confirmed"]);

const strictHourlyRateSchema = z
	.string()
	.trim()
	.refine(
		(value) => {
			if (value === "") return true;
			const numericValue = Number(value);
			return Number.isFinite(numericValue) && numericValue > 0;
		},
		{ message: "Hourly rate must be a positive number" },
	)
	.optional()
	.nullable();

export const upsertEmploymentHistorySchema = z
	.object({
		validFrom: z.coerce.date(),
		status: employmentStatusSchema.default("active"),
		contractType: contractTypeSchema.default("fixed"),
		weeklyContractMinutes: z.number().int().min(0).max(10080),
		probationStartsOn: z.coerce.date().optional().nullable(),
		probationEndsOn: z.coerce.date().optional().nullable(),
		workModel: workModelSchema.default("onsite"),
		workPolicyId: z.uuid("Invalid work policy ID").optional().nullable(),
		hourlyRate: strictHourlyRateSchema,
		currency: z.string().min(3).max(3).default("EUR"),
		changeReason: z.string().max(1000, "Reason is too long").optional().nullable(),
		reviewState: employmentReviewStateSchema.default("draft"),
	})
	.refine(
		(data) => {
			if (!data.probationStartsOn || !data.probationEndsOn) return true;
			return data.probationEndsOn > data.probationStartsOn;
		},
		{ message: "Probation end must be after probation start", path: ["probationEndsOn"] },
	)
	.refine((data) => data.contractType !== "hourly" || !!data.hourlyRate, {
		message: "Hourly rate is required for hourly contracts",
		path: ["hourlyRate"],
	});

export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type EmploymentReviewState = z.infer<typeof employmentReviewStateSchema>;
export type UpsertEmploymentHistory = z.infer<typeof upsertEmploymentHistorySchema>;
