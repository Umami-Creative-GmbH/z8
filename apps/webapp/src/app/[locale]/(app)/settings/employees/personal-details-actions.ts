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
import {
	PersonalDetailsRefusal,
	type PersonalDetailsView,
} from "@/lib/organization/personal-details/types";

/**
 * Personal details on the employee page (#2069, #2071, spec #2068). Any member may
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

/** A decider ends the employee's bank account from a day: none is on file from then on. */
export const endEmployeeBankAccount = organizationAction(
	{
		name: "personalDetails.endBankAccount",
		requires: "member",
		schema: z.object({ employeeId: employeeIdSchema, validFrom: z.string().max(32) }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"personalDetails.endBankAccount",
			(db) =>
				endPersonalDetails(
					{
						organizationId,
						actorUserId: actor.userId,
						employeeId: input.employeeId,
						part: "bank_account",
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
