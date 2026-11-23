"use server";

import { z } from "zod";
import {
	ContractorCompensationRefused,
	type ContractorDetailsRefusal,
	type ContractorTermsRefusal,
} from "@/lib/contractor-compensation/refusal";
import {
	type ContractorCompensationOverviewRow,
	type ContractorCompensationRecord,
	type ContractorTermsChange,
	type ContractorTermsView,
	changeContractorTerms,
	listContractorCompensationOverview,
	loadContractorCompensation,
	saveContractorDetails,
} from "@/lib/contractor-compensation/store";
import { compensationBases, dayUnitRuleKinds } from "@/lib/contractor-compensation/terms";
import { NotFoundError } from "@/lib/effect/errors";
import type { ContractorProfileDetails } from "@/lib/engagement/contractor-profile";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";

/**
 * Contractor compensation (#1998): an External Contractor's effective-dated
 * hourly or daily terms and their company, VAT ID and PO reference. Org admins
 * only: scoped managers and members are refused before any read, so contractor
 * rates and fees never reach them. Refusals carry only their code
 * (`ContractorCompensationRefused`); the client words them.
 */

const logger = createLogger("ContractorCompensationActions");

const employeeIdSchema = z.uuid({ message: "Choose a contractor" });
const dateSchema = z.string().max(32);

const compensationSchema = z.strictObject({
	basis: z.enum(compensationBases),
	rateAmount: z.string().max(32),
	currency: z.string().max(8),
	dayUnitRule: z.enum(dayUnitRuleKinds).nullable().optional(),
	halfDayThresholdMinutes: z.number().int().nullable().optional(),
	standardDayMinutes: z.number().int().nullable().optional(),
	capAtOneDay: z.boolean().nullable().optional(),
});

const employeeNotFound = () =>
	new NotFoundError({ message: "The contractor was not found", entityType: "employee" });

/** Throws a store's refusal for `storeStep`: not found keeps its own tagged error. */
function refuse(reason: ContractorTermsRefusal | ContractorDetailsRefusal): never {
	if (reason === "employee_not_found") throw employeeNotFound();
	throw new ContractorCompensationRefused(reason);
}

const changeTerms = (
	name: string,
	context: { organizationId: string; actorUserId: string; employeeId: string },
	change: ContractorTermsChange,
) =>
	storeStep(
		`contractorCompensation.${name}`,
		async (db) => {
			const outcome = await changeContractorTerms(db, { ...context, change });
			if (!outcome.ok) refuse(outcome.reason);
			logger.info(
				{
					organizationId: context.organizationId,
					employeeId: context.employeeId,
					changed: outcome.changed,
				},
				"Contractor terms changed",
			);
			return {
				changed: outcome.changed,
				history: outcome.history,
				termsInEffectId: outcome.termsInEffectId,
			} satisfies {
				changed: boolean;
				history: ContractorTermsView[];
				termsInEffectId: string | null;
			};
		},
		{ refusal: ContractorCompensationRefused },
	);

/** One contractor's terms history, active engagement and contracting details. */
export const getContractorCompensation = organizationAction(
	{
		name: "contractorCompensation.read",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema }),
	},
	({ organizationId, input }) =>
		storeStep("contractorCompensation.read", async (db) => {
			const record: ContractorCompensationRecord | null = await loadContractorCompensation(
				db,
				organizationId,
				input.employeeId,
			);
			if (!record) throw employeeNotFound();
			return record;
		}),
);

/** Sets a contractor's terms from a date in their active engagement (backdating allowed). */
export const setContractorTerms = organizationAction(
	{
		name: "contractorCompensation.setTerms",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: employeeIdSchema,
			effectiveFrom: dateSchema,
			compensation: compensationSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		changeTerms(
			"setTerms",
			{ organizationId, actorUserId: actor.userId, employeeId: input.employeeId },
			{ kind: "set", effectiveFrom: input.effectiveFrom, compensation: input.compensation },
		),
);

/** Ends a contractor's terms from a date; work after it is unpriced until new terms. */
export const endContractorTerms = organizationAction(
	{
		name: "contractorCompensation.endTerms",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema, effectiveFrom: dateSchema }),
	},
	({ actor, organizationId, input }) =>
		changeTerms(
			"endTerms",
			{ organizationId, actorUserId: actor.userId, employeeId: input.employeeId },
			{ kind: "end", effectiveFrom: input.effectiveFrom },
		),
);

const detailSchema = z.string().max(200).nullable().optional();

/** Saves a contractor's company name, VAT ID and PO/cost-center reference. */
export const updateContractorDetails = organizationAction(
	{
		name: "contractorCompensation.updateDetails",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: employeeIdSchema,
			companyName: detailSchema,
			vatId: z.string().max(50).nullable().optional(),
			referenceCode: z.string().max(100).nullable().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"contractorCompensation.updateDetails",
			async (db) => {
				const { employeeId, ...details } = input;
				const outcome = await saveContractorDetails(db, {
					organizationId,
					actorUserId: actor.userId,
					employeeId,
					details,
				});
				if (!outcome.ok) refuse(outcome.reason);
				return outcome.details satisfies ContractorProfileDetails;
			},
			{ refusal: ContractorCompensationRefused },
		),
);

/** Every External Contractor with the terms in force today, for Settings → Contracts. */
export const listContractorCompensation = organizationAction(
	{ name: "contractorCompensation.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("contractorCompensation.list", (db): Promise<ContractorCompensationOverviewRow[]> =>
			listContractorCompensationOverview(db, organizationId),
		),
);
