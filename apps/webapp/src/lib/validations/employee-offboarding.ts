import * as z from "zod";
import { contractTypeSchema } from "./employee";
import { workModelSchema } from "./employment-history";

/**
 * Serializable departure and rehire payloads. The server derives cutoff and
 * timezone from the organization; nothing in these payloads is authoritative
 * for them.
 */
export const scheduleDepartureSchema = z.object({
	employeeId: z.uuid(),
	requestId: z.uuid(),
	expectedRevision: z.number().int().positive().nullable(),
	lastWorkingDay: z.iso.date(),
	replacementEmployeeId: z.uuid().nullable(),
	acknowledgeUnassignedDuties: z.boolean(),
});

export const cancelDepartureSchema = z.object({
	employeeId: z.uuid(),
	departureId: z.uuid(),
	expectedRevision: z.number().int().positive(),
	requestId: z.uuid(),
});

export const offboardNowSchema = z.object({
	employeeId: z.uuid(),
	requestId: z.uuid(),
	replacementEmployeeId: z.uuid().nullable(),
	acknowledgeUnassignedDuties: z.boolean(),
});

export const rehireEmployeeSchema = z
	.object({
		employeeId: z.uuid(),
		requestId: z.uuid(),
		previousEmploymentPeriodId: z.uuid(),
		role: z.enum(["admin", "manager", "employee"]),
		teamId: z.uuid().nullable(),
		primaryManagerId: z.uuid().nullable(),
		workPolicyId: z.uuid(),
		weeklyContractMinutes: z.number().int().min(0).max(10080),
		contractType: contractTypeSchema,
		workModel: workModelSchema,
		hourlyRate: z
			.string()
			.trim()
			.refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
				message: "Hourly rate must be a positive number",
			})
			.nullable(),
		currency: z.string().length(3),
		probationStartsOn: z.iso.date().nullable(),
		probationEndsOn: z.iso.date().nullable(),
		changeReason: z.string().max(1000).nullable(),
	})
	.refine((data) => data.contractType !== "hourly" || data.hourlyRate !== null, {
		message: "Hourly rate is required for hourly contracts",
		path: ["hourlyRate"],
	})
	.refine(
		(data) =>
			!data.probationStartsOn ||
			!data.probationEndsOn ||
			data.probationEndsOn > data.probationStartsOn,
		{ message: "Probation end must be after probation start", path: ["probationEndsOn"] },
	);

export const employeeOffboardingViewSchema = z.object({ employeeId: z.uuid() });

/** Advisory preview; a null last working day previews an immediate departure. */
export const previewDepartureSchema = z.object({
	employeeId: z.uuid(),
	lastWorkingDay: z.iso.date().nullable(),
});

export const resolveDepartureReviewSchema = z.object({
	reviewId: z.uuid(),
	resolution: z.string().trim().min(1).max(1000),
});

export const retryDepartureTaskSchema = z.object({ taskId: z.uuid() });

export const assignDepartureReplacementSchema = z.object({
	departureId: z.uuid(),
	handoverTaskId: z.uuid(),
	replacementEmployeeId: z.uuid(),
	requestId: z.uuid(),
});

export type ScheduleDepartureInput = z.infer<typeof scheduleDepartureSchema>;
export type CancelDepartureInput = z.infer<typeof cancelDepartureSchema>;
export type OffboardNowInput = z.infer<typeof offboardNowSchema>;
export type RehireEmployeeInput = z.infer<typeof rehireEmployeeSchema>;
export type PreviewDepartureInput = z.infer<typeof previewDepartureSchema>;
export type ResolveDepartureReviewInput = z.infer<typeof resolveDepartureReviewSchema>;
export type AssignDepartureReplacementInput = z.infer<typeof assignDepartureReplacementSchema>;
