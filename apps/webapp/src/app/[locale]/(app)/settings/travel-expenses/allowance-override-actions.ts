"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	type AllowanceExceptionItem,
	authorizeAllowanceOverride,
	listAllowanceExceptionItems,
	revokeAllowanceOverride,
} from "@/lib/travel-expenses/allowance-override-store";
import {
	auditLater,
	expenseAdministrator,
	revalidateExpenseSettings,
} from "./expense-settings-effects";

/**
 * Audited allowance overrides (#610). Only an org admin with an employee
 * profile in the session's organization records or revokes one, never on
 * their own report; every read and write is scoped to that organization. An
 * ordinary user is refused before any read.
 */

export const getAllowanceExceptionItems = organizationAction(
	{ name: "travelExpenses.listAllowanceExceptions", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			return yield* storeStep(
				"travelExpenses.listAllowanceExceptions",
				(database): Promise<AllowanceExceptionItem[]> =>
					listAllowanceExceptionItems(database, admin),
				{ failure: "Failed to load exceptional allowances" },
			);
		}),
);

const invalidOverride = "Invalid allowance override";

const itemInput = z.strictObject(
	{
		reportId: z.uuid(invalidOverride),
		itemId: z.uuid(invalidOverride),
		expectedVersion: z.number(invalidOverride).int(invalidOverride).positive(invalidOverride),
	},
	invalidOverride,
);

const authorizeInput = itemInput.extend({
	amount: z.string(invalidOverride).max(40, invalidOverride),
	reason: z.string(invalidOverride).max(5000, invalidOverride),
	evidence: z.string(invalidOverride).max(5000, invalidOverride),
	calculationBasis: z.string(invalidOverride).max(5000, invalidOverride),
	replacesOverrideId: z.uuid(invalidOverride).nullish(),
});

export const authorizeAllowanceOverrideAction = organizationAction(
	{
		name: "travelExpenses.authorizeAllowanceOverride",
		requires: "orgAdmin",
		schema: authorizeInput,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const { amount, reason, evidence, calculationBasis, ...target } = input;
			const result = yield* storeStep(
				"travelExpenses.authorizeAllowanceOverride",
				(database) =>
					authorizeAllowanceOverride(database, admin, {
						...target,
						draft: { amount, reason, evidence, calculationBasis },
					}),
				{ failure: "Failed to save the allowance override" },
			);
			if (result.kind === "authorized") {
				yield* auditLater(
					() =>
						logAudit({
							action: AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_AUTHORIZED,
							actorId: actor.userId,
							employeeId: admin.employeeId,
							targetId: target.reportId,
							targetType: "approval",
							organizationId,
							metadata: {
								itemId: target.itemId,
								overrideId: result.override.id,
								kind: result.override.kind,
								amount: result.override.amount,
								currency: result.override.currency,
								situation: result.override.situation.kind,
								replacesOverrideId: target.replacesOverrideId ?? null,
							},
							timestamp: new Date(),
						}),
					"Failed to log allowance override",
				);
				yield* revalidateExpenseSettings();
			}
			return result;
		}),
);

const revokeInput = itemInput.extend({ overrideId: z.uuid(invalidOverride) });

export const revokeAllowanceOverrideAction = organizationAction(
	{ name: "travelExpenses.revokeAllowanceOverride", requires: "orgAdmin", schema: revokeInput },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const result = yield* storeStep(
				"travelExpenses.revokeAllowanceOverride",
				(database) => revokeAllowanceOverride(database, admin, input),
				{ failure: "Failed to revoke the allowance override" },
			);
			if (result.kind === "revoked") {
				yield* auditLater(
					() =>
						logAudit({
							action: AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_REVOKED,
							actorId: actor.userId,
							employeeId: admin.employeeId,
							targetId: input.reportId,
							targetType: "approval",
							organizationId,
							metadata: { itemId: input.itemId, overrideId: input.overrideId },
							timestamp: new Date(),
						}),
					"Failed to log allowance override revocation",
				);
				yield* revalidateExpenseSettings();
			}
			return result;
		}),
);
