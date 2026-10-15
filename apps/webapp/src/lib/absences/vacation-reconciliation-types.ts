import { z } from "zod";
const period = z.enum(["full_day", "am", "pm"]);
export const reconciliationProofSchema = z.object({
	operationId: z.uuid(),
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ReconciliationProof = z.infer<typeof reconciliationProofSchema>;
export const reconciledAbsenceSchema = z.object({
	employeeId: z.uuid(),
	categoryId: z.uuid(),
	startDate: z.string(),
	endDate: z.string(),
	startPeriod: period,
	endPeriod: period,
	durationKind: z.enum(["full_day", "partial_day"]).optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
	notes: z.string().max(2000).optional(),
	sickDetail: z
		.enum(["child_sick", "with_certificate", "without_certificate", "other"])
		.optional(),
	deputyEmployeeId: z.uuid().optional(),
});
const common = {
	decisions: z
		.array(
			z.object({
				employeeId: z.uuid(),
				year: z.number().int().min(1900).max(9998),
				remainingDays: z.number().finite().min(0).max(366).multipleOf(0.5),
			}),
		)
		.max(500),
	reason: z.string().trim().min(1).max(2000),
};
export const reconciliationInputSchema = z.discriminatedUnion("kind", [
	z.object({
		...common,
		kind: z.literal("manual"),
		absence: reconciledAbsenceSchema,
	}),
	z.object({
		...common,
		kind: z.literal("import"),
		batchId: z.uuid(),
		mappings: z
			.array(
				z.object({
					rowId: z.uuid(),
					categoryId: z.uuid(),
					startPeriod: period,
					endPeriod: period,
				}),
			)
			.min(1)
			.max(500),
	}),
	z.object({
		...common,
		kind: z.literal("change"),
		absenceId: z.uuid(),
		proposed: z.object({
			startDate: z.string(),
			endDate: z.string(),
			startPeriod: period,
			endPeriod: period,
		}),
		coverage: z.enum(["keep", "choose"]).default("choose"),
	}),
]);
export type ReconciliationInput = z.infer<typeof reconciliationInputSchema>;
export type ReconciledAbsenceInput = z.infer<typeof reconciledAbsenceSchema>;

export type ReconciliationSource = ReconciliationInput extends infer T
	? T extends ReconciliationInput
		? Omit<T, "decisions" | "reason">
		: never
	: never;
