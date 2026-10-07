"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import { parseSettlementCommand } from "@/lib/travel-expenses/settlement";
import { recordSettlementEntry } from "@/lib/travel-expenses/settlement-store";
import type { RecordReimbursementResult } from "./finance-actions";

/**
 * Records money recovered from the employee against an overpayment (#615),
 * e.g. after an approved negative adjustment of an already reimbursed report.
 * The recovery is its own immutable settlement entry of the report's account:
 * the original reimbursement is never edited, nothing is netted against other
 * reports and Z8 moves no money. Retrying with the same `idempotencyKey`
 * returns the recorded entry instead of recording it again.
 */

const recoverySchema = z.object({
	source: z.object({ type: z.enum(["report", "legacy_claim"]), id: z.uuid() }),
	idempotencyKey: z.uuid(),
	amount: z.string().max(40),
	occurredOn: z.string().max(10),
	reference: z.string().max(400),
	note: z.string().max(2000).nullable().optional(),
	expectedBalance: z.object({ currency: z.string().max(3), amount: z.string().max(40) }),
});

export async function recordTravelExpenseRecoveryAction(
	input: z.input<typeof recoverySchema>,
): Promise<ServerActionResult<RecordReimbursementResult>> {
	try {
		const parsed = recoverySchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid recovery" };
		const actor = await loadFinanceActor();
		if (!actor?.canSettle) return { success: false, error: "Unauthorized" };
		const now = systemClock.nowInstant();
		const command = parseSettlementCommand(
			{
				kind: "recovery",
				amount: parsed.data.amount,
				currency: parsed.data.expectedBalance.currency,
				occurredOn: parsed.data.occurredOn,
				reference: parsed.data.reference,
				note: parsed.data.note ?? null,
			},
			{ latestDate: latestCalendarDate(now) },
		);
		if (!command.ok) return { success: true, data: { status: "invalid", errors: command.errors } };
		const result = await recordSettlementEntry(
			db,
			{
				actor,
				source: parsed.data.source,
				idempotencyKey: parsed.data.idempotencyKey,
				command: command.command,
				expectedBalance: parsed.data.expectedBalance,
			},
			now,
		);
		switch (result.status) {
			case "not_found":
				return { success: false, error: "Not found" };
			case "refused":
				return {
					success: true,
					data: { status: "refused", reason: result.reason, account: result.account },
				};
			case "recorded":
				if (!result.replayed) {
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_RECOVERY_RECORDED,
						actorId: actor.userId,
						employeeId: result.account.employeeId,
						targetId: parsed.data.source.id,
						targetType: "approval",
						organizationId: actor.organizationId,
						metadata: {
							sourceType: parsed.data.source.type,
							entryId: result.entry.id,
							amount: result.entry.amount,
							currency: result.entry.currency,
							occurredOn: result.entry.occurredOn,
						},
						timestamp: new Date(),
					}).catch((error) => logger.error({ error }, "Failed to audit a recovery"));
					revalidatePath("/travel-expenses");
				}
				return {
					success: true,
					data: { status: "recorded", replayed: result.replayed, account: result.account },
				};
			default:
				return { success: true, data: { status: result.status } };
		}
	} catch (error) {
		logger.error({ error }, "Failed to record a travel expense recovery");
		return { success: false, error: "Failed to record the recovery" };
	}
}
