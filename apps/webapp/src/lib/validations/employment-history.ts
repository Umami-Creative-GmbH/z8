import * as z from "zod";
import { contractTypeSchema, hourlyRateSchema } from "./employee";

export const employmentStatusSchema = z.enum(["active", "inactive", "terminated", "leave"]);
export const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
export const employmentReviewStateSchema = z.enum(["draft", "pending", "confirmed"]);

export const upsertEmploymentHistorySchema = z
	.object({
		validFrom: z.date(),
		status: employmentStatusSchema.default("active"),
		contractType: contractTypeSchema.default("fixed"),
		weeklyContractMinutes: z.number().int().min(0).max(10080),
		probationStartsOn: z.date().optional().nullable(),
		probationEndsOn: z.date().optional().nullable(),
		workModel: workModelSchema.default("onsite"),
		workPolicyId: z.string().uuid("Invalid work policy ID").optional().nullable(),
		hourlyRate: hourlyRateSchema,
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
