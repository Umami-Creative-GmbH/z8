import type { db as appDb } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { logger } from "@/lib/logger";
import { latestCalendarDate } from "./future-dates";
import type { OfficerScope } from "./officer-scope";
import {
	parseSettlementCommand,
	parseSettlementPayment,
	type SettlementCommandFieldError,
	type SettlementPayment,
} from "./settlement";
import {
	type RecordSettlementResult,
	recordSettlementEntry,
	type SettlementActor,
	type SettlementSource,
} from "./settlement-store";

/**
 * Bulk "Mark as reimbursed" (#754): one reimbursement of the full outstanding
 * amount per account, in the account's currency, with a shared payment date,
 * reference and note. Every account goes through `recordSettlementEntry` in
 * its own transaction (row lock, idempotency key, expected balance), so
 * partial success is expected and each account reports its own outcome. The
 * export-batch action (#755) reuses this with the batch's accounts.
 */

type Database = typeof appDb;

export const BULK_REIMBURSEMENT_OUTCOMES = [
	"reimbursed",
	"own_expense",
	"overpaid_or_review",
	"already_reimbursed",
	"balance_changed",
	"out_of_scope",
	"failed",
] as const;
export type BulkReimbursementOutcome = (typeof BULK_REIMBURSEMENT_OUTCOMES)[number];

export interface BulkReimbursementAccount {
	source: SettlementSource;
	/** The outstanding balance the officer saw; exactly this is reimbursed, or nothing. */
	expectedBalance: { currency: string; amount: string };
}

export interface BulkReimbursementRow {
	source: SettlementSource;
	outcome: BulkReimbursementOutcome;
	/** True when this request already recorded the reimbursement: nothing new was written. */
	replayed: boolean;
	/** The reimbursed amount and currency; null for every skipped or failed row. */
	amount: string | null;
	currency: string | null;
}

export type BulkReimbursementResult =
	/** The shared payment details are invalid; nothing was recorded. */
	| { status: "invalid"; errors: SettlementCommandFieldError[] }
	| { status: "processed"; rows: BulkReimbursementRow[] };

function sourceKey(source: SettlementSource): string {
	return `${source.type}:${source.id}`;
}

/**
 * One request records each account under its own key, so repeating the same
 * request replays what it recorded instead of recording it again.
 */
export function bulkReimbursementIdempotencyKey(requestKey: string, source: SettlementSource) {
	return `bulk-reimbursement:${requestKey}:${sourceKey(source)}`;
}

function outcomeOf(result: RecordSettlementResult): BulkReimbursementOutcome {
	switch (result.status) {
		case "recorded":
			return "reimbursed";
		case "own_expense":
			return "own_expense";
		case "not_found":
			// Out of scope reads as not found everywhere (#747).
			return "out_of_scope";
		case "refused":
			// What the account is now decides, not which check refused first.
			switch (result.account.summary.state) {
				case "settled":
					return "already_reimbursed";
				case "overpaid":
				case "mixed":
					return "overpaid_or_review";
				default:
					return result.reason === "stale_balance" ? "balance_changed" : "failed";
			}
		default:
			return "failed";
	}
}

function row(
	source: SettlementSource,
	outcome: BulkReimbursementOutcome,
	recorded?: Extract<RecordSettlementResult, { status: "recorded" }>,
): BulkReimbursementRow {
	return {
		source,
		outcome,
		replayed: recorded?.replayed ?? false,
		amount: recorded?.entry.amount ?? null,
		currency: recorded?.entry.currency ?? null,
	};
}

export async function recordBulkReimbursement(
	database: Database,
	input: {
		actor: SettlementActor;
		/** The officer scope the actor records reimbursements in; other accounts are skipped. */
		scope: OfficerScope;
		/** One per request; repeating the request with it records nothing new. */
		requestKey: string;
		accounts: readonly BulkReimbursementAccount[];
		payment: SettlementPayment;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<BulkReimbursementResult> {
	const { actor } = input;
	const latestDate = latestCalendarDate(now);
	// The shared details are checked once, before any account is touched.
	const shared = parseSettlementPayment(input.payment, { latestDate });
	if (!shared.ok) return { status: "invalid", errors: shared.errors };
	const { payment } = shared;

	const seen = new Set<string>();
	const rows: BulkReimbursementRow[] = [];
	for (const account of input.accounts) {
		const key = sourceKey(account.source);
		if (seen.has(key)) continue;
		seen.add(key);
		const command = parseSettlementCommand(
			{
				kind: "reimbursement",
				amount: account.expectedBalance.amount,
				currency: account.expectedBalance.currency,
				...payment,
			},
			{ latestDate },
		);
		if (!command.ok) {
			rows.push(row(account.source, "failed"));
			continue;
		}
		try {
			const result = await recordSettlementEntry(
				database,
				{
					actor,
					scope: input.scope,
					source: account.source,
					idempotencyKey: bulkReimbursementIdempotencyKey(input.requestKey, account.source),
					command: command.command,
					expectedBalance: account.expectedBalance,
					inFull: true,
				},
				now,
			);
			if (result.status === "recorded") {
				if (!result.replayed) await auditReimbursement(actor, account.source, result, now);
				rows.push(row(account.source, "reimbursed", result));
			} else {
				rows.push(row(account.source, outcomeOf(result)));
			}
		} catch (error) {
			logger.error(
				{ error, organizationId: actor.organizationId, source: account.source },
				"Failed to record a bulk reimbursement",
			);
			rows.push(row(account.source, "failed"));
		}
	}
	return { status: "processed", rows };
}

async function auditReimbursement(
	actor: SettlementActor,
	source: SettlementSource,
	result: Extract<RecordSettlementResult, { status: "recorded" }>,
	now: Instant,
) {
	await logAudit({
		action: AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_RECORDED,
		actorId: actor.userId,
		employeeId: result.account.employeeId,
		targetId: source.id,
		targetType: "approval",
		organizationId: actor.organizationId,
		metadata: {
			sourceType: source.type,
			entryId: result.entry.id,
			amount: result.entry.amount,
			currency: result.entry.currency,
			occurredOn: result.entry.occurredOn,
			bulk: true,
		},
		timestamp: dateFromInstant(now),
	});
}
