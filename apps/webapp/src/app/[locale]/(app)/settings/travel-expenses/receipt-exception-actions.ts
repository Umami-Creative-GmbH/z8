"use server";

import { Effect } from "effect";
import { z } from "zod";
import { travelExpenseSettings } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { loadReceiptExceptionsAllowed } from "@/lib/travel-expenses/receipt-exception-read";
import { auditLater, revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * Whether employees may submit an explained missing-receipt exception (#604).
 * Only org admins change it; submitted reports keep the exceptions they were
 * submitted with.
 */

export interface ReceiptExceptionSettings {
	missingReceiptExceptionsAllowed: boolean;
}

export const getReceiptExceptionSettings = organizationAction(
	{ name: "travelExpenses.getReceiptExceptions", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const allowed = yield* storeStep(
				"travelExpenses.getReceiptExceptions",
				(database) => loadReceiptExceptionsAllowed(database, organizationId),
				{ failure: "Failed to load the missing-receipt setting" },
			);
			return { missingReceiptExceptionsAllowed: allowed } satisfies ReceiptExceptionSettings;
		}),
);

export const saveReceiptExceptionSettings = organizationAction(
	{
		name: "travelExpenses.saveReceiptExceptions",
		requires: "orgAdmin",
		schema: z.object(
			{ missingReceiptExceptionsAllowed: z.boolean({ error: "Invalid setting" }) },
			"Invalid setting",
		),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const allowed = input.missingReceiptExceptionsAllowed;
			const now = new Date();
			yield* storeStep(
				"travelExpenses.saveReceiptExceptions",
				(database) =>
					database
						.insert(travelExpenseSettings)
						.values({
							organizationId,
							missingReceiptExceptionsAllowed: allowed,
							updatedAt: now,
							updatedBy: actor.userId,
						})
						// Only this setting; the other columns belong to other settings.
						.onConflictDoUpdate({
							target: travelExpenseSettings.organizationId,
							set: {
								missingReceiptExceptionsAllowed: allowed,
								updatedAt: now,
								updatedBy: actor.userId,
							},
						}),
				{ failure: "Failed to save the missing-receipt setting" },
			);
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_RECEIPT_EXCEPTIONS_CHANGED,
						actorId: actor.userId,
						targetType: "organization",
						organizationId,
						metadata: { missingReceiptExceptionsAllowed: allowed },
						timestamp: now,
					}),
				"Failed to log the missing-receipt setting",
			);
			yield* revalidateExpenseSettings();
			return { missingReceiptExceptionsAllowed: allowed } satisfies ReceiptExceptionSettings;
		}),
);
