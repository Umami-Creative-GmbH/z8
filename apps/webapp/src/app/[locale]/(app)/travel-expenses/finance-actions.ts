"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";
import { listReimbursingOfficers } from "@/lib/travel-expenses/expense-officer-grant-store";
import { financeActorReads, loadFinanceActor } from "@/lib/travel-expenses/finance-access";
import {
	FINANCE_QUEUE_STATUSES,
	type FinanceQueueView,
} from "@/lib/travel-expenses/finance-queue-params";
import {
	countAwaitingReimbursement,
	type FinanceQueueFilterOptions,
	listFinanceQueue,
	listFinanceQueueFilterOptions,
} from "@/lib/travel-expenses/finance-queue-store";
import { latestCalendarDate } from "@/lib/travel-expenses/future-dates";
import {
	loadOfficerCoverageGap,
	type OfficerCoverageGap,
} from "@/lib/travel-expenses/officer-coverage";
import type { ReimbursingOfficer } from "@/lib/travel-expenses/officer-scope";
import { isSourceInOfficerScope } from "@/lib/travel-expenses/officer-scope-read";
import {
	parseSettlementCommand,
	type SettlementCommandFieldError,
	type SettlementPlanRefusal,
} from "@/lib/travel-expenses/settlement";
import {
	listOwnSettlementAccounts,
	loadSettlementAccount,
	recordSettlementEntry,
	type SettlementAccount,
	type SettlementSource,
} from "@/lib/travel-expenses/settlement-store";

/**
 * Finance queue and recorded reimbursements (#612). Finance access is its own
 * (owners, admins and expense officers within their scope, #747); the
 * employee sees only their own balances. Recording never moves money.
 */

const sourceSchema = z.object({
	type: z.enum(["report", "legacy_claim"]),
	id: z.uuid(),
});
const queueViewSchema = z.object({
	status: z.enum(FINANCE_QUEUE_STATUSES),
	employeeId: z.uuid().nullable(),
	teamId: z.uuid().nullable(),
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/)
		.nullable(),
	notExported: z.boolean(),
	page: z.number().int().min(1).max(100_000),
});
const coverageSchema = z.enum(["uncovered"]);

export type FinanceQueueCoverage = z.infer<typeof coverageSchema>;

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

export interface FinanceQueueResult {
	accounts: SettlementAccount[];
	canSettle: boolean;
	/** 1-based. */
	page: number;
	hasMore: boolean;
}

/**
 * One page of the finance queue in the reader's officer scope (#747),
 * filtered (#753). `coverage: "uncovered"` lists only what awaits
 * reimbursement and no expense officer can reimburse (#756), for owners and
 * admins of the organization.
 */
export async function getTravelExpenseFinanceQueue(
	view: FinanceQueueView,
	coverage?: FinanceQueueCoverage,
): Promise<ServerActionResult<FinanceQueueResult>> {
	try {
		const parsed = queueViewSchema.safeParse(view);
		const parsedCoverage = coverageSchema.optional().safeParse(coverage);
		if (!parsed.success || !parsedCoverage.success) {
			return { success: false, error: "Invalid filter" };
		}
		const actor = await loadFinanceActor();
		if (!actor?.scopes.read) return { success: false, error: "Unauthorized" };
		let uncoveredBy: ReimbursingOfficer[] | undefined;
		if (parsedCoverage.data === "uncovered") {
			const administrator = await requireExpenseAdministrator();
			if ("error" in administrator || administrator.organizationId !== actor.organizationId) {
				return { success: false, error: "Unauthorized" };
			}
			uncoveredBy = await listReimbursingOfficers(db, { organizationId: actor.organizationId });
		}
		const { page, ...filters } = parsed.data;
		const result = await listFinanceQueue(
			db,
			{ organizationId: actor.organizationId, scope: actor.scopes.read, uncoveredBy, ...filters },
			{ page },
		);
		return { success: true, data: { ...result, canSettle: actor.canSettle } };
	} catch (error) {
		logger.error({ error }, "Failed to load the travel expense finance queue");
		return { success: false, error: "Failed to load the finance queue" };
	}
}

/** The employees, recorded teams and currencies the queue's filters offer. */
export async function getTravelExpenseFinanceQueueFilterOptions(): Promise<
	ServerActionResult<FinanceQueueFilterOptions>
> {
	try {
		const actor = await loadFinanceActor();
		if (!actor?.scopes.read) return { success: false, error: "Unauthorized" };
		return {
			success: true,
			data: await listFinanceQueueFilterOptions(db, {
				organizationId: actor.organizationId,
				scope: actor.scopes.read,
			}),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the travel expense finance queue filters");
		return { success: false, error: "Failed to load the finance queue filters" };
	}
}

/** The sidebar Finance item's count: in-scope accounts awaiting reimbursement (#753). */
export async function getTravelExpenseFinanceAwaitingCount(): Promise<
	ServerActionResult<{ count: number }>
> {
	try {
		const actor = await loadFinanceActor();
		if (!actor?.scopes.read) return { success: false, error: "Unauthorized" };
		const count = await countAwaitingReimbursement(db, {
			organizationId: actor.organizationId,
			scope: actor.scopes.read,
		});
		return { success: true, data: { count } };
	} catch (error) {
		logger.error({ error }, "Failed to count travel expenses awaiting reimbursement");
		return { success: false, error: "Failed to count expenses awaiting reimbursement" };
	}
}

/**
 * The coverage-gap warning (#756) for owners and admins: how many approved
 * expenses await reimbursement that no expense officer can reimburse. Null
 * for anyone else, and while the organization has no expense officer grant.
 */
export async function getExpenseOfficerCoverageGap(): Promise<
	ServerActionResult<OfficerCoverageGap | null>
> {
	try {
		const administrator = await requireExpenseAdministrator();
		if ("error" in administrator) return { success: true, data: null };
		return {
			success: true,
			data: await loadOfficerCoverageGap(db, { organizationId: administrator.organizationId }),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the expense officer coverage gap");
		return { success: false, error: "Failed to load the coverage gap" };
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
		const subject = { source: parsed.data, employeeId: account.employeeId };
		// Out of the officer's scope (#747) reads as not found.
		if (!account.approved || !(await financeActorReads(actor, subject))) {
			return { success: false, error: "Not found" };
		}
		const canSettle = await isSourceInOfficerScope(db, actor?.scopes.settle ?? null, {
			organizationId: auth.employee.organizationId,
			...subject,
		});
		return { success: true, data: { account, viewer: "finance", canSettle } };
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
		if (!actor?.scopes.settle) return { success: false, error: "Unauthorized" };
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
				scope: actor.scopes.settle,
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
