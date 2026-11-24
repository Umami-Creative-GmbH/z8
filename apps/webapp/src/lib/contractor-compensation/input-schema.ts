import { z } from "zod";
import { compensationBases, dayUnitRuleKinds } from "./kinds";

/**
 * Entered contractor compensation terms on the wire (`ContractorCompensationInput`):
 * the compensation editor and the External Contractor invitation send this shape.
 * Only its form is checked here; `parseContractorCompensation` decides whether
 * the terms are valid and refuses with a code the client words.
 */
export const contractorCompensationInputSchema = z.strictObject({
	basis: z.enum(compensationBases),
	rateAmount: z.string().max(32),
	currency: z.string().max(8),
	dayUnitRule: z.enum(dayUnitRuleKinds).nullable().optional(),
	halfDayThresholdMinutes: z.number().int().nullable().optional(),
	standardDayMinutes: z.number().int().nullable().optional(),
	capAtOneDay: z.boolean().nullable().optional(),
});
