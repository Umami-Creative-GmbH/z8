"use server";

import { z } from "zod";
import { NotFoundError } from "@/lib/effect/errors";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	changePersonalDetails,
	endPersonalDetails,
	readPersonalDetails,
} from "@/lib/organization/personal-details/personal-details";
import { HEALTH_INSURANCE_KINDS } from "@/lib/organization/personal-details/health-insurance";
import {
	PERSONAL_DETAILS_PARTS,
	PersonalDetailsRefusal,
	type PersonalDetailsView,
} from "@/lib/organization/personal-details/types";

/**
 * Personal details on the employee page (#2069, #2070, #2071, spec #2068). Any member may
 * call these: the personal details module alone decides who sees and changes an
 * employee's personal details, so these actions never widen or narrow it.
 * Refusals carry only their code (`PersonalDetailsRefusal`); the client words them.
 */

const employeeIdSchema = z.uuid({ message: "Choose an employee" });

const bankAccountChangeSchema = z.object({
	employeeId: employeeIdSchema,
	validFrom: z.string().max(32),
	accountHolder: z.string().max(500),
	iban: z.string().max(200),
	bic: z.string().max(100).nullable().optional(),
});

/** A decider records the employee's bank account from a valid-from day. */
export const changeEmployeeBankAccount = organizationAction(
	{
		name: "personalDetails.changeBankAccount",
		requires: "member",
		schema: bankAccountChangeSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"personalDetails.changeBankAccount",
			(db) =>
				changePersonalDetails(
					{
						organizationId,
						actorUserId: actor.userId,
						employeeId: input.employeeId,
						part: "bank_account",
						validFrom: input.validFrom,
						value: { accountHolder: input.accountHolder, iban: input.iban, bic: input.bic },
					},
					{ database: db },
				),
			{ refusal: PersonalDetailsRefusal },
		),
);

const healthInsuranceChangeSchema = z.object({
	employeeId: employeeIdSchema,
	validFrom: z.string().max(32),
	kind: z.enum(HEALTH_INSURANCE_KINDS),
	betriebsnummer: z.string().max(32).nullable().optional(),
	insurerName: z.string().max(500).nullable().optional(),
});

/**
 * A decider records the employee's health insurance from a valid-from day: a
 * statutory insurer picked from the list by Betriebsnummer, or a typed name.
 */
export const changeEmployeeHealthInsurance = organizationAction(
	{
		name: "personalDetails.changeHealthInsurance",
		requires: "member",
		schema: healthInsuranceChangeSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"personalDetails.changeHealthInsurance",
			(db) =>
				changePersonalDetails(
					{
						organizationId,
						actorUserId: actor.userId,
						employeeId: input.employeeId,
						part: "health_insurance",
						validFrom: input.validFrom,
						value: {
							kind: input.kind,
							betriebsnummer: input.betriebsnummer,
							insurerName: input.insurerName,
						},
					},
					{ database: db },
				),
			{ refusal: PersonalDetailsRefusal },
		),
);

/** A decider ends a part of the employee's personal details from a day: none is on file from then on. */
export const endEmployeePersonalDetails = organizationAction(
	{
		name: "personalDetails.end",
		requires: "member",
		schema: z.object({
			employeeId: employeeIdSchema,
			part: z.enum(PERSONAL_DETAILS_PARTS),
			validFrom: z.string().max(32),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"personalDetails.end",
			(db) =>
				endPersonalDetails(
					{
						organizationId,
						actorUserId: actor.userId,
						employeeId: input.employeeId,
						part: input.part,
						validFrom: input.validFrom,
					},
					{ database: db },
				),
			{ refusal: PersonalDetailsRefusal },
		),
);

/** The employee's personal details with IBANs in full: a decider's "show". */
export const revealEmployeePersonalDetails = organizationAction(
	{
		name: "personalDetails.reveal",
		requires: "member",
		schema: z.object({ employeeId: employeeIdSchema }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"personalDetails.reveal",
			async (db): Promise<PersonalDetailsView> => {
				const view = await readPersonalDetails(
					{ organizationId, actorUserId: actor.userId, employeeId: input.employeeId, reveal: true },
					{ database: db },
				);
				if (!view) {
					throw new NotFoundError({ message: "Employee not found", entityType: "employee" });
				}
				return view;
			},
			{ refusal: PersonalDetailsRefusal },
		),
);
