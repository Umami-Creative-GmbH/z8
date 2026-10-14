import * as z from "zod";
import { type ContractType, contractTypeSchema } from "./employee";

export const employmentStatusSchema = z.enum(["active", "inactive", "terminated", "leave"]);
export const workModelSchema = z.enum(["onsite", "hybrid", "remote", "flexible"]);
export const employmentReviewStateSchema = z.enum(["draft", "pending", "confirmed"]);

const HOURLY_WAGE_MESSAGE = "Hourly rate must be a positive number";
/** The largest value `numeric(10,2)` holds. */
const MAX_HOURLY_WAGE = 99_999_999.99;

/**
 * The hourly wage in employment terms: a positive amount with at most two
 * decimal places, stored as `numeric(10,2)`. A decimal string from a form is
 * read as a number; an empty string is refused, not treated as "no wage".
 */
export const hourlyWageSchema = z
	.union([
		z.number(),
		z
			.string()
			.trim()
			.regex(/^\d+(\.\d+)?$/, HOURLY_WAGE_MESSAGE)
			.transform(Number),
	])
	.pipe(
		z
			.number(HOURLY_WAGE_MESSAGE)
			.positive(HOURLY_WAGE_MESSAGE)
			.max(MAX_HOURLY_WAGE, HOURLY_WAGE_MESSAGE)
			.refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
				message: "Hourly rate can have at most two decimal places",
			}),
	);

/** Fixed terms carry no wage, whatever the client sent. */
export function wageForContract(contractType: ContractType, hourlyRate: number | null) {
	return contractType === "hourly" ? hourlyRate : null;
}

/** A form's wage text as a terms payload carries it; the server schema validates the number. */
export function hourlyWageFromForm(contractType: ContractType, value: string) {
	const trimmed = value.trim();
	return wageForContract(contractType, trimmed ? Number(trimmed) : null);
}

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
		hourlyRate: hourlyWageSchema.nullish(),
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
	.refine((data) => data.contractType !== "hourly" || data.hourlyRate != null, {
		message: "Hourly rate is required for hourly contracts",
		path: ["hourlyRate"],
	})
	.transform((data) => ({
		...data,
		hourlyRate: wageForContract(data.contractType, data.hourlyRate ?? null),
	}));

/** "Change wage": a new hourly wage from a calendar date, copying the terms in force then. */
export const changeHourlyWageSchema = z.object({
	effectiveOn: z.iso.date("Enter a valid date"),
	hourlyRate: hourlyWageSchema,
	changeReason: z.string().trim().min(1, "Reason is required").max(1000, "Reason is too long"),
	reviewState: z.enum(["confirmed", "draft"]).default("confirmed"),
});

export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type EmploymentReviewState = z.infer<typeof employmentReviewStateSchema>;
export type UpsertEmploymentHistory = z.infer<typeof upsertEmploymentHistorySchema>;
export type ChangeHourlyWage = z.input<typeof changeHourlyWageSchema>;
