"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuthorizationError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	CURRENT_REFERENCE_RATE_ACKNOWLEDGEMENT,
	REFERENCE_RATE_PROVIDERS,
} from "@/lib/travel-expenses/reference-rate";
import {
	loadReferenceRatePolicy,
	loadReferenceRateProviderStatus,
	type ReferenceRatePolicyView,
	type ReferenceRateProviderStatus,
} from "@/lib/travel-expenses/reference-rate-read";
import {
	approveReferenceRatePolicy,
	revokeReferenceRatePolicy,
} from "@/lib/travel-expenses/reference-rate-store";
import {
	auditLater,
	expenseAdministrator,
	revalidateExpenseSettings,
} from "./expense-settings-effects";

/**
 * Expense administrator settings of #608: whether the organization approves
 * ECB reference rates as a conversion basis for foreign-currency expenses.
 * Only org admins with an employee profile in the session's organization read
 * or change it; the approval is attributed to that profile.
 */

export interface ReferenceRateSettings {
	policy: ReferenceRatePolicyView | null;
	/** Fetch state of the source, shared by every organization. */
	provider: ReferenceRateProviderStatus;
}

export const getReferenceRateSettings = organizationAction(
	{ name: "travelExpenses.getReferenceRateSettings", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			yield* expenseAdministrator(actor, organizationId);
			const [policy, provider] = yield* storeStep(
				"travelExpenses.getReferenceRateSettings",
				(database) =>
					Promise.all([
						loadReferenceRatePolicy(database, organizationId),
						loadReferenceRateProviderStatus(database),
					]),
				{ failure: "Failed to load the reference rate settings" },
			);
			return { policy, provider } satisfies ReferenceRateSettings;
		}),
);

/**
 * Approves a reference source. `acknowledged` confirms that the administrator
 * accepted the source's current statement (`CURRENT_REFERENCE_RATE_ACKNOWLEDGEMENT`:
 * ECB publishes the rates for information only, with limited currencies and
 * working-day publications); that statement version is stored with the
 * approval and its time.
 */
export const approveReferenceRateSource = organizationAction(
	{
		name: "travelExpenses.approveReferenceRateSource",
		requires: "orgAdmin",
		schema: z.strictObject({
			provider: z.enum(REFERENCE_RATE_PROVIDERS, "Unknown reference rate source"),
			acknowledged: z
				.boolean("Confirm how the reference rates may be used")
				.refine((acknowledged) => acknowledged, "Confirm how the reference rates may be used"),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const policy = yield* storeStep(
				"travelExpenses.approveReferenceRateSource",
				(database) =>
					approveReferenceRatePolicy(database, {
						organizationId,
						userId: actor.userId,
						provider: input.provider,
						acknowledgement: CURRENT_REFERENCE_RATE_ACKNOWLEDGEMENT[input.provider],
					}),
				{ failure: "Failed to approve the reference rate source" },
			);
			if (!policy) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Unauthorized: Admin access required",
						userId: actor.userId,
						resource: "travelExpenses.approveReferenceRateSource",
					}),
				);
			}
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_APPROVED,
						actorId: actor.userId,
						employeeId: admin.employeeId,
						targetType: "organization",
						organizationId,
						metadata: { provider: policy.provider, acknowledgement: policy.acknowledgement },
						timestamp: new Date(),
					}),
				"Failed to log reference rate approval",
			);
			yield* revalidateExpenseSettings();
			return { policy };
		}),
);

export const revokeReferenceRateSource = organizationAction(
	{ name: "travelExpenses.revokeReferenceRateSource", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const admin = yield* expenseAdministrator(actor, organizationId);
			const revoked = yield* storeStep(
				"travelExpenses.revokeReferenceRateSource",
				(database) => revokeReferenceRatePolicy(database, organizationId),
				{ failure: "Failed to revoke the reference rate source" },
			);
			if (revoked) {
				yield* auditLater(
					() =>
						logAudit({
							action: AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_REVOKED,
							actorId: actor.userId,
							employeeId: admin.employeeId,
							targetType: "organization",
							organizationId,
							timestamp: new Date(),
						}),
					"Failed to log reference rate revocation",
				);
			}
			yield* revalidateExpenseSettings();
			return { policy: null };
		}),
);
