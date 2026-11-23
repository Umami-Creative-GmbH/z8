"use server";

import { Effect } from "effect";
import { z } from "zod";
import {
	type ContractorCompensationOverviewRow,
	type ContractorCompensationRecord,
	type ContractorTermsChange,
	type ContractorTermsRefusal,
	type ContractorTermsView,
	changeContractorTerms,
	listContractorCompensationOverview,
	loadContractorCompensation,
	saveContractorDetails,
} from "@/lib/contractor-compensation/store";
import { compensationBases, dayUnitRuleKinds } from "@/lib/contractor-compensation/terms";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { ContractorProfileDetails } from "@/lib/engagement/contractor-profile";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

/**
 * Contractor compensation (#1998): an External Contractor's effective-dated
 * hourly or daily terms and their company, VAT ID and PO reference. Org admins
 * only: scoped managers and members are refused before any read, so contractor
 * rates and fees never reach them.
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

const REFUSAL_MESSAGES: Record<
	Exclude<ContractorTermsRefusal, "employee_not_found">,
	[string, string]
> = {
	invalid_date: ["Enter a valid date", "effectiveFrom"],
	not_contractor: [
		"Only an active External Contractor engagement has contractor terms",
		"employeeId",
	],
	before_engagement: ["Terms cannot start before the engagement started", "effectiveFrom"],
	invalid_basis: ["Choose hourly or daily", "basis"],
	invalid_currency: ["Enter an ISO 4217 currency code, such as EUR", "currency"],
	invalid_rate: ["Enter a rate", "rateAmount"],
	rate_not_positive: ["Enter a positive rate", "rateAmount"],
	rate_too_large: ["Enter a rate below one million", "rateAmount"],
	rate_too_precise: ["The rate has more decimals than the currency allows", "rateAmount"],
	invalid_day_unit_rule: ["Choose how worked days are counted", "dayUnitRule"],
	invalid_half_day_threshold: [
		"Enter a half-day threshold from 1 to 1440 minutes",
		"halfDayThresholdMinutes",
	],
	invalid_standard_day: ["Enter a standard day from 1 to 1440 minutes", "standardDayMinutes"],
};

function refusalError(reason: ContractorTermsRefusal) {
	if (reason === "employee_not_found") return employeeNotFound();
	const [message, field] = REFUSAL_MESSAGES[reason];
	return new ValidationError({ message, field, refusal: reason });
}

const changeTerms = (
	name: string,
	context: { organizationId: string; actorUserId: string; employeeId: string },
	change: ContractorTermsChange,
) =>
	Effect.gen(function* () {
		const service = yield* DatabaseService;
		const outcome = yield* service.query(`contractorCompensation.${name}`, () =>
			changeContractorTerms(service.db, { ...context, change }),
		);
		if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
		logger.info(
			{
				organizationId: context.organizationId,
				employeeId: context.employeeId,
				changed: outcome.changed,
			},
			"Contractor terms changed",
		);
		return { changed: outcome.changed, history: outcome.history } satisfies {
			changed: boolean;
			history: ContractorTermsView[];
		};
	});

/** One contractor's terms history, active engagement and contracting details. */
export const getContractorCompensation = organizationAction(
	{
		name: "contractorCompensation.read",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			const record: ContractorCompensationRecord | null = yield* service.query(
				"contractorCompensation.read",
				() => loadContractorCompensation(service.db, organizationId, input.employeeId),
			);
			if (!record) return yield* Effect.fail(employeeNotFound());
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
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			const { employeeId, ...details } = input;
			const outcome = yield* service.query("contractorCompensation.updateDetails", () =>
				saveContractorDetails(service.db, {
					organizationId,
					actorUserId: actor.userId,
					employeeId,
					details,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(refusalError(outcome.reason));
			return outcome.details satisfies ContractorProfileDetails;
		}),
);

/** Every External Contractor with the terms in force today, for Settings → Contracts. */
export const listContractorCompensation = organizationAction(
	{ name: "contractorCompensation.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			const rows: ContractorCompensationOverviewRow[] = yield* service.query(
				"contractorCompensation.list",
				() => listContractorCompensationOverview(service.db, organizationId),
			);
			return rows;
		}),
);
