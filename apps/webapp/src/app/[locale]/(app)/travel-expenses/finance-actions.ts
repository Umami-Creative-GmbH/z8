"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import {
	latestCalendarDate,
	parseSettlementCommand,
	type SettlementCommandFieldError,
	type SettlementPlanRefusal,
} from "@/lib/travel-expenses/settlement";
import {
	type FinanceQueueFilter,
	listFinanceQueue,
	listOwnSettlementAccounts,
	loadSettlementAccount,
	recordSettlementEntry,
	type SettlementAccount,
	type SettlementSource,
} from "@/lib/travel-expenses/settlement-store";

/**
 * Finance queue and recorded reimbursements (#612). Finance access is its own
 * permission (`TravelExpenseFinance`); the employee sees only their own
 * balances. Recording never moves money.
 */

const sourceSchema = z.object({
	type: z.enum(["report", "legacy_claim"]),
	id: z.uuid(),
});
const filterSchema = z.enum(["open", "settled", "all"]);

export interface SettlementAccountView {
	account: SettlementAccount;
	/** `owner`: the employee's own expense. `finance`: an authorized finance user. */
	viewer: "owner" | "finance";
	canSettle: boolean;
}

function ownerView(account: SettlementAccount): SettlementAccount {
	return {
		...account,
		entries: account.entries.map((entry) => ({
			...entry,
			recordedByUserId: null,
			recordedByName: null,
		})),
	};
}

export async function getTravelExpenseFinanceQueue(
	filter: FinanceQueueFilter,
): Promise<ServerActionResult<{ accounts: SettlementAccount[]; canSettle: boolean }>> {
	try {
		const parsed = filterSchema.safeParse(filter);
		if (!parsed.success) return { success: false, error: "Invalid filter" };
		const actor = await loadFinanceActor();
		if (!actor?.canRead) return { success: false, error: "Unauthorized" };
		const accounts = await listFinanceQueue(db, {
			organizationId: actor.organizationId,
			filter: parsed.data,
		});
		return { success: true, data: { accounts, canSettle: actor.canSettle } };
	} catch (error) {
		logger.error({ error }, "Failed to load the travel expense finance queue");
		return { success: false, error: "Failed to load the finance queue" };
	}
}

/**
 * One settlement account: to the employee whose expense it is, or to finance.
 * Anyone else, including the expense's reviewer, is told it does not exist.
 */
export async function getTravelExpenseSettlement(
	source: SettlementSource,
): Promise<ServerActionResult<SettlementAccountView | null>> {
	try {
		const parsed = sourceSchema.safeParse(source);
		if (!parsed.success) return { success: false, error: "Not found" };
		const auth = await getAuthContext();
		if (!auth?.employee) return { success: false, error: "Unauthorized" };
		const account = await loadSettlementAccount(db, {
			organizationId: auth.employee.organizationId,
			source: parsed.data,
		});
		if (!account) return { success: false, error: "Not found" };
		if (account.employeeId === auth.employee.id) {
			return {
				success: true,
				data: { account: ownerView(account), viewer: "owner", canSettle: false },
			};
		}
		const actor = await loadFinanceActor();
		if (!actor?.canRead || !account.approved) return { success: false, error: "Not found" };
		return {
			success: true,
			data: { account, viewer: "finance", canSettle: actor.canSettle },
		};
	} catch (error) {
		logger.error({ error }, "Failed to load a travel expense settlement");
		return { success: false, error: "Failed to load the settlement" };
	}
}

/** Balances of the employee's own approved reports and claims, keyed `type:id`. */
export async function getMyTravelExpenseSettlements(): Promise<
	ServerActionResult<Record<string, Pick<SettlementAccount, "summary" | "currency">>>
> {
	try {
		const auth = await getAuthContext();
		if (!auth?.employee) return { success: false, error: "Unauthorized" };
		const accounts = await listOwnSettlementAccounts(db, {
			organizationId: auth.employee.organizationId,
			employeeId: auth.employee.id,
		});
		return {
			success: true,
			data: Object.fromEntries(
				accounts
					.filter((account) => account.approved)
					.map((account) => [
						`${account.source.type}:${account.source.id}`,
						{ summary: account.summary, currency: account.currency },
					]),
			),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load own travel expense settlements");
		return { success: false, error: "Failed to load balances" };
	}
}

const recordSchema = z.object({
	source: sourceSchema,
	idempotencyKey: z.uuid(),
	amount: z.string().max(40),
	occurredOn: z.string().max(10),
	reference: z.string().max(400),
	note: z.string().max(2000).nullable().optional(),
	expectedBalance: z.object({ currency: z.string().max(3), amount: z.string().max(40) }),
});

export type RecordReimbursementResult =
	| { status: "recorded"; replayed: boolean; account: SettlementAccount }
	| { status: "invalid"; errors: SettlementCommandFieldError[] }
	| { status: "refused"; reason: SettlementPlanRefusal; account: SettlementAccount }
	| { status: "idempotency_conflict" | "not_approved" | "own_expense" | "adjustment_report" };

/**
 * Records a reimbursement finance paid outside Z8. Retrying with the same
 * `idempotencyKey` returns the recorded entry instead of recording it again.
 */
export async function recordTravelExpenseReimbursementAction(
	input: z.input<typeof recordSchema>,
): Promise<ServerActionResult<RecordReimbursementResult>> {
	try {
		const parsed = recordSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid reimbursement" };
		const actor = await loadFinanceActor();
		if (!actor?.canSettle) return { success: false, error: "Unauthorized" };
		const now = systemClock.nowInstant();
		const command = parseSettlementCommand(
			{
				kind: "reimbursement",
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
						action: AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_RECORDED,
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
					}).catch((error) => logger.error({ error }, "Failed to audit a reimbursement"));
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
		logger.error({ error }, "Failed to record a travel expense reimbursement");
		return { success: false, error: "Failed to record the reimbursement" };
	}
}
