"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { ValidationError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { loadOrganizationReimbursementCurrency } from "@/lib/travel-expenses/conversion-read";
import {
	type AuthorizeRateResult,
	authorizeManualConversionRate,
	clearItemConversion,
	type ForeignDraftItem,
	listForeignDraftItems,
	type RemoveConversionResult,
	saveOrganizationReimbursementCurrency,
} from "@/lib/travel-expenses/conversion-store";
import {
	auditLater,
	expenseAdministrator,
	expenseStore,
	revalidateExpenseSettings,
} from "./expense-settings-effects";

/**
 * Expense administrator settings of #607: the organization's reimbursement
 * currency for new reports, and documented manual rates for foreign-currency
 * expenses of draft reports. Only org admins with an employee profile in the
 * session's organization use them; every read and write is scoped to it.
 */

export const getReimbursementCurrencySetting = organizationAction(
	{ name: "travelExpenses.getReimbursementCurrency", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* expenseAdministrator(actor, organizationId);
			const currency = yield* expenseStore(
				"travelExpenses.getReimbursementCurrency",
				"Failed to load the reimbursement currency",
				(database) => loadOrganizationReimbursementCurrency(database, organizationId),
			);
			return { currency };
		}),
);

const currencyRefusal = "Choose a currency code with at most two decimal places, e.g. EUR";

export const saveReimbursementCurrencySetting = organizationAction(
	{
		name: "travelExpenses.saveReimbursementCurrency",
		requires: "orgAdmin",
		schema: z.strictObject({ currency: z.string(currencyRefusal).max(20, currencyRefusal) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const result = yield* expenseStore(
				"travelExpenses.saveReimbursementCurrency",
				"Failed to save the reimbursement currency",
				(database) =>
					saveOrganizationReimbursementCurrency(database, {
						organizationId,
						userId: actor.userId,
						currency: input.currency,
					}),
			);
			if (result.kind !== "saved") {
				return yield* Effect.fail(
					new ValidationError({ message: currencyRefusal, field: "currency" }),
				);
			}
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_CURRENCY_UPDATED,
						actorId: actor.userId,
						employeeId: admin.employeeId,
						targetType: "organization",
						organizationId,
						metadata: { currency: result.currency },
						timestamp: new Date(),
					}),
				"Failed to log reimbursement currency change",
			);
			yield* revalidateExpenseSettings();
			return { currency: result.currency };
		}),
);

export const getForeignDraftExpenses = organizationAction(
	{ name: "travelExpenses.listForeignDraftExpenses", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* expenseAdministrator(actor, organizationId);
			return yield* expenseStore(
				"travelExpenses.listForeignDraftExpenses",
				"Failed to load foreign-currency expenses",
				(database): Promise<ForeignDraftItem[]> => listForeignDraftItems(database, organizationId),
			);
		}),
);

const itemInput = z.object(
	{
		reportId: z.uuid("Invalid expense"),
		itemId: z.uuid("Invalid expense"),
		expectedVersion: z.number("Invalid expense").int("Invalid expense").positive("Invalid expense"),
	},
	"Invalid expense",
);

const rateInput = itemInput.extend({
	rate: z.object(
		{
			base: z.string("Invalid conversion rate").max(3, "Invalid conversion rate"),
			quote: z.string("Invalid conversion rate").max(3, "Invalid conversion rate"),
			rate: z.string("Invalid conversion rate").max(40, "Invalid conversion rate"),
			rateDate: z.string("Invalid conversion rate").max(10, "Invalid conversion rate"),
			reason: z.string("Invalid conversion rate").max(2000, "Invalid conversion rate"),
			evidence: z.string("Invalid conversion rate").max(4000, "Invalid conversion rate"),
		},
		"Invalid conversion rate",
	),
});

export const authorizeManualConversionRateAction = organizationAction(
	{ name: "travelExpenses.authorizeManualConversionRate", requires: "orgAdmin", schema: rateInput },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const result = yield* expenseStore(
				"travelExpenses.authorizeManualConversionRate",
				"Failed to save the conversion rate",
				(database): Promise<AuthorizeRateResult> =>
					authorizeManualConversionRate(database, admin, input),
			);
			if (result.kind === "saved") {
				yield* auditLater(
					() =>
						logAudit({
							action: AuditAction.TRAVEL_EXPENSE_CONVERSION_RECORDED,
							actorId: actor.userId,
							employeeId: admin.employeeId,
							targetId: input.reportId,
							targetType: "approval",
							organizationId,
							metadata: { itemId: input.itemId, basis: "manual_rate" },
							timestamp: new Date(),
						}),
					"Failed to log manual conversion rate",
				);
				yield* revalidateExpenseSettings();
			}
			return result;
		}),
);

export const clearItemConversionAction = organizationAction(
	{ name: "travelExpenses.clearItemConversion", requires: "orgAdmin", schema: itemInput },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const result = yield* expenseStore(
				"travelExpenses.clearItemConversion",
				"Failed to remove the conversion",
				(database) => clearItemConversion(database, admin, input),
			);
			if (result.kind === "removed") {
				yield* auditLater(
					() =>
						logAudit({
							action: AuditAction.TRAVEL_EXPENSE_CONVERSION_REMOVED,
							actorId: actor.userId,
							employeeId: admin.employeeId,
							targetId: input.reportId,
							targetType: "approval",
							organizationId,
							metadata: { itemId: input.itemId },
							timestamp: new Date(),
						}),
					"Failed to log conversion removal",
				);
				yield* revalidateExpenseSettings();
			}
			return result as Exclude<RemoveConversionResult, { kind: "not_allowed" }>;
		}),
);
