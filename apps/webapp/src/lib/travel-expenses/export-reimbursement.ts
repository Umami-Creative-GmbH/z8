import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	travelExpenseExportBatch,
	travelExpenseExportBatchRevision,
	travelExpenseReport,
} from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { loadAdjustmentOriginals } from "./adjustment-read";
import {
	type BulkReimbursementAccount,
	type BulkReimbursementOutcome,
	type BulkReimbursementResult,
	recordBulkReimbursement,
} from "./bulk-reimbursement";
import type { OfficerScope } from "./officer-scope";
import { isSourceInOfficerScope } from "./officer-scope-read";
import { fullReimbursementLine, type SettlementPayment } from "./settlement";
import {
	buildSettlementAccounts,
	employeeNameColumn,
	type SettlementAccount,
	type SettlementActor,
	type SettlementSource,
	type SettlementTitle,
} from "./settlement-store";

/**
 * "Mark as reimbursed" on a completed export batch (#755). The batch's report
 * revisions become settlement accounts: an adjustment revision counts against
 * its original report's account (#615), and each account appears once. The
 * accounts then go through the bulk reimbursement service (#754), which pays
 * each in full and names the batch on every entry it records. Exporting stays
 * "not a payment"; this is the explicit step that records money moving.
 *
 * The caller checks that the actor sees the batch (`export-store.ts`).
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Why an account of the batch is not offered for reimbursement. */
export type ExportReimbursementSkip = Extract<
	BulkReimbursementOutcome,
	"out_of_scope" | "own_expense" | "already_reimbursed" | "overpaid_or_review"
>;

export interface ExportBatchReimbursementAccount {
	source: SettlementSource;
	employeeName: string | null;
	title: SettlementTitle;
	/** Null outside the reader's reimbursement scope: such an account is only named. */
	account: SettlementAccount | null;
	/** Null when one payment of its balance reimburses the account in full. */
	skip: ExportReimbursementSkip | null;
}

type BatchState = { status: "not_found" } | { status: "not_completed" } | { status: "completed" };

async function batchState(
	database: Executor,
	input: { organizationId: string; batchId: string },
): Promise<BatchState> {
	const [row] = await database
		.select({ status: travelExpenseExportBatch.status })
		.from(travelExpenseExportBatch)
		.where(
			and(
				eq(travelExpenseExportBatch.id, input.batchId),
				eq(travelExpenseExportBatch.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!row) return { status: "not_found" };
	// Completed is terminal (an UPDATE trigger enforces it), so this check cannot go stale.
	return row.status === "completed" ? { status: "completed" } : { status: "not_completed" };
}

/**
 * The settlement accounts a batch's revisions belong to: an adjustment's
 * account is its original report's. Each account once, by report id.
 */
async function loadExportBatchAccountSources(
	database: Executor,
	input: { organizationId: string; batchId: string },
): Promise<SettlementSource[]> {
	const revisions = await database
		.select({ reportId: travelExpenseExportBatchRevision.reportId })
		.from(travelExpenseExportBatchRevision)
		.where(
			and(
				eq(travelExpenseExportBatchRevision.batchId, input.batchId),
				eq(travelExpenseExportBatchRevision.organizationId, input.organizationId),
			),
		);
	const reportIds = revisions.map((revision) => revision.reportId);
	const originals = await loadAdjustmentOriginals(database, {
		organizationId: input.organizationId,
		reportIds,
	});
	const accountIds = new Set(reportIds.map((reportId) => originals.get(reportId) ?? reportId));
	return [...accountIds].toSorted().map((id) => ({ type: "report", id }));
}

async function loadAccounts(
	database: Executor,
	organizationId: string,
	sources: readonly SettlementSource[],
): Promise<SettlementAccount[]> {
	if (sources.length === 0) return [];
	const reports = await database
		.select({ row: travelExpenseReport, ...employeeNameColumn })
		.from(travelExpenseReport)
		.leftJoin(
			employee,
			and(
				eq(employee.id, travelExpenseReport.employeeId),
				eq(employee.organizationId, travelExpenseReport.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(travelExpenseReport.organizationId, organizationId),
				inArray(
					travelExpenseReport.id,
					sources.map((source) => source.id),
				),
			),
		)
		.orderBy(asc(travelExpenseReport.id));
	return buildSettlementAccounts(database, organizationId, reports, []);
}

function skipOf(
	account: SettlementAccount,
	actorEmployeeId: string,
): ExportReimbursementSkip | null {
	if (account.employeeId === actorEmployeeId) return "own_expense";
	if (account.approved && account.summary.state === "settled") return "already_reimbursed";
	return account.approved && fullReimbursementLine(account) ? null : "overpaid_or_review";
}

export type ExportBatchReimbursementPreview =
	| { status: "not_found" }
	| { status: "not_completed" }
	| { status: "ready"; accounts: ExportBatchReimbursementAccount[] };

/**
 * What marking the batch would do, for the dialog: every account of the batch,
 * with the reader's own (in their reimbursement scope) and why any is skipped.
 */
export async function loadExportBatchReimbursement(
	database: Database,
	input: {
		organizationId: string;
		batchId: string;
		/** The reader's reimbursement scope; other accounts are only named. */
		scope: OfficerScope;
		actorEmployeeId: string;
	},
): Promise<ExportBatchReimbursementPreview> {
	const state = await batchState(database, input);
	if (state.status !== "completed") return state;
	const sources = await loadExportBatchAccountSources(database, input);
	const accounts = await loadAccounts(database, input.organizationId, sources);
	const rows: ExportBatchReimbursementAccount[] = [];
	for (const account of accounts) {
		// Few accounts per batch (at most the batch's revisions): one scope read each.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		const inScope = await isSourceInOfficerScope(database, input.scope, {
			organizationId: input.organizationId,
			source: account.source,
			employeeId: account.employeeId,
		});
		rows.push({
			source: account.source,
			employeeName: account.employeeName,
			title: account.title,
			account: inScope ? account : null,
			skip: inScope ? skipOf(account, input.actorEmployeeId) : "out_of_scope",
		});
	}
	return {
		status: "ready",
		accounts: rows.toSorted(
			(left, right) =>
				(left.employeeName ?? "").localeCompare(right.employeeName ?? "") ||
				(left.source.id < right.source.id ? -1 : 1),
		),
	};
}

export type ExportBatchReimbursementResult =
	| { status: "not_found" }
	| { status: "not_completed" }
	/** An account that does not belong to the batch: nothing was recorded. */
	| { status: "not_in_batch" }
	| BulkReimbursementResult;

/**
 * Reimburses the batch's accounts the officer confirmed, each in full and at
 * the balance they saw (`recordBulkReimbursement`); every new entry names the
 * batch. Repeating the request with the same key records nothing new, and a
 * later request finds the accounts already reimbursed.
 */
export async function recordExportBatchReimbursement(
	database: Database,
	input: {
		actor: SettlementActor;
		scope: OfficerScope;
		batchId: string;
		requestKey: string;
		accounts: readonly BulkReimbursementAccount[];
		payment: SettlementPayment;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<ExportBatchReimbursementResult> {
	const { actor, batchId } = input;
	const state = await batchState(database, { organizationId: actor.organizationId, batchId });
	if (state.status !== "completed") return state;
	// A completed batch's revisions never change, so this set is fixed.
	const sources = await loadExportBatchAccountSources(database, {
		organizationId: actor.organizationId,
		batchId,
	});
	const inBatch = new Set(sources.map((source) => `${source.type}:${source.id}`));
	if (!input.accounts.every(({ source }) => inBatch.has(`${source.type}:${source.id}`))) {
		return { status: "not_in_batch" };
	}
	return recordBulkReimbursement(
		database,
		{
			actor,
			scope: input.scope,
			requestKey: input.requestKey,
			accounts: input.accounts,
			payment: input.payment,
			exportBatchId: batchId,
		},
		now,
	);
}
