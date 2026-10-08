import { and, asc, desc, eq, inArray, isNull, notExists, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	team,
	travelExpenseClaim,
	travelExpenseExportBatchRevision,
	travelExpenseReport,
} from "@/db/schema";
import { mergeNewestFirst, type QueueEntry, takeQueuePage } from "./finance-queue-paging";
import type { FinanceQueueFilters, FinanceQueueStatus } from "./finance-queue-params";
import type { OfficerScope } from "./officer-scope";
import {
	claimInOfficerScope,
	claimRecordedWithTeam,
	reportInOfficerScope,
	reportRecordedWithTeam,
} from "./officer-scope-read";
import {
	buildSettlementAccounts,
	employeeNameColumn,
	type SettlementAccount,
} from "./settlement-store";

/**
 * The finance queue (#612, #753): approved reports and approved legacy claims
 * of one organization with their balances, in the reader's officer scope
 * (#747), newest decision first. Only currently approved sources are listed,
 * so a report returned for correction (#603/#614) drops out.
 *
 * Employee, team (recorded at approval), currency and "not yet exported" are
 * SQL conditions; whether an account is open depends on recorded money and
 * approved adjustments (`settlement.ts`), so the status is decided per account
 * while the sources are read, never by a row cap. An old open account is found
 * however many reimbursed accounts were decided after it.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Accounts per queue page. */
export const FINANCE_QUEUE_PAGE_SIZE = 50;
/** Approved sources of one kind read (and priced) per database round trip. */
export const FINANCE_QUEUE_SCAN_SIZE = 500;

export interface FinanceQueueQuery extends Partial<Omit<FinanceQueueFilters, "status">> {
	organizationId: string;
	status: FinanceQueueStatus;
	/** Only the reports and claims in this officer scope (#747); every one without. */
	scope?: OfficerScope;
	/** Also list approved adjustment reports (#615), which have no account of their own; exports need them. */
	includeAdjustments?: boolean;
	/** List approved legacy claims too (default true); exports have no use for them. */
	includeLegacyClaims?: boolean;
}

export interface FinanceQueuePage {
	accounts: SettlementAccount[];
	/** 1-based. */
	page: number;
	hasMore: boolean;
}

function matchesStatus(account: SettlementAccount, query: FinanceQueueQuery): boolean {
	if (!account.approved) return false;
	if (!query.includeAdjustments && account.adjustmentOf !== null) return false;
	// The SQL condition reads the report's currency; the account's is the approved one.
	if (query.currency && account.currency !== query.currency) return false;
	switch (query.status) {
		case "all":
			return true;
		case "reimbursed":
			return account.summary.state === "settled";
		case "open":
			return account.summary.state !== "settled";
	}
}

function notInActiveExportBatch(database: Executor): SQL {
	return notExists(
		database
			.select({ reportId: travelExpenseExportBatchRevision.reportId })
			.from(travelExpenseExportBatchRevision)
			.where(
				and(
					eq(travelExpenseExportBatchRevision.organizationId, travelExpenseReport.organizationId),
					eq(travelExpenseExportBatchRevision.reportId, travelExpenseReport.id),
					eq(travelExpenseExportBatchRevision.submissionCycle, travelExpenseReport.submissionCount),
					// A cancelled batch releases its revisions.
					isNull(travelExpenseExportBatchRevision.releasedAt),
				),
			),
	);
}

function reportConditions(database: Executor, query: FinanceQueueQuery): SQL | undefined {
	return and(
		eq(travelExpenseReport.organizationId, query.organizationId),
		eq(travelExpenseReport.status, "approved"),
		query.scope ? reportInOfficerScope(query.scope) : undefined,
		query.employeeId ? eq(travelExpenseReport.employeeId, query.employeeId) : undefined,
		query.teamId ? reportRecordedWithTeam(query.teamId) : undefined,
		query.currency ? eq(travelExpenseReport.reimbursementCurrency, query.currency) : undefined,
		query.notExported ? notInActiveExportBatch(database) : undefined,
	);
}

function claimConditions(query: FinanceQueueQuery): SQL | undefined {
	return and(
		eq(travelExpenseClaim.organizationId, query.organizationId),
		eq(travelExpenseClaim.status, "approved"),
		query.scope ? claimInOfficerScope(query.scope) : undefined,
		query.employeeId ? eq(travelExpenseClaim.employeeId, query.employeeId) : undefined,
		query.teamId ? claimRecordedWithTeam(query.teamId) : undefined,
		query.currency ? eq(travelExpenseClaim.calculatedCurrency, query.currency) : undefined,
	);
}

async function* reportEntries(
	database: Executor,
	query: FinanceQueueQuery,
	scanSize: number,
): AsyncGenerator<QueueEntry<SettlementAccount>> {
	const where = reportConditions(database, query);
	for (let offset = 0; ; offset += scanSize) {
		const rows = await database
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
			.where(where)
			.orderBy(sql`${travelExpenseReport.decidedAt} desc nulls last`, desc(travelExpenseReport.id))
			.limit(scanSize)
			.offset(offset);
		const accounts = await buildSettlementAccounts(database, query.organizationId, rows, []);
		for (const [index, account] of accounts.entries()) {
			if (!matchesStatus(account, query)) continue;
			const decidedAt = rows[index]?.row.decidedAt ?? null;
			yield {
				type: "report",
				id: account.source.id,
				decidedAt: decidedAt?.getTime() ?? null,
				item: account,
			};
		}
		if (rows.length < scanSize) return;
	}
}

async function* claimEntries(
	database: Executor,
	query: FinanceQueueQuery,
	scanSize: number,
): AsyncGenerator<QueueEntry<SettlementAccount>> {
	// Legacy claims are never exported, so none waits for an export either.
	if (query.includeLegacyClaims === false || query.notExported) return;
	const where = claimConditions(query);
	for (let offset = 0; ; offset += scanSize) {
		const rows = await database
			.select({ row: travelExpenseClaim, ...employeeNameColumn })
			.from(travelExpenseClaim)
			.leftJoin(
				employee,
				and(
					eq(employee.id, travelExpenseClaim.employeeId),
					eq(employee.organizationId, travelExpenseClaim.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(where)
			.orderBy(sql`${travelExpenseClaim.decidedAt} desc nulls last`, desc(travelExpenseClaim.id))
			.limit(scanSize)
			.offset(offset);
		const accounts = await buildSettlementAccounts(database, query.organizationId, [], rows);
		for (const [index, account] of accounts.entries()) {
			if (!matchesStatus(account, query)) continue;
			const decidedAt = rows[index]?.row.decidedAt ?? null;
			yield {
				type: "legacy_claim",
				id: account.source.id,
				decidedAt: decidedAt?.getTime() ?? null,
				item: account,
			};
		}
		if (rows.length < scanSize) return;
	}
}

function queueAccounts(
	database: Executor,
	query: FinanceQueueQuery,
	scanSize = FINANCE_QUEUE_SCAN_SIZE,
): AsyncGenerator<SettlementAccount> {
	return mergeNewestFirst([
		reportEntries(database, query, scanSize),
		claimEntries(database, query, scanSize),
	]);
}

/** One page of the queue; `hasMore` says whether a next page exists. */
export async function listFinanceQueue(
	database: Executor,
	query: FinanceQueueQuery,
	options: { page?: number; pageSize?: number; scanSize?: number } = {},
): Promise<FinanceQueuePage> {
	const page = Math.max(1, Math.trunc(options.page ?? 1));
	const pageSize = options.pageSize ?? FINANCE_QUEUE_PAGE_SIZE;
	const { items, hasMore } = await takeQueuePage(queueAccounts(database, query, options.scanSize), {
		offset: (page - 1) * pageSize,
		limit: pageSize,
	});
	return { accounts: items, page, hasMore };
}

/** Every account matching the query, for exports (#613), which need all of them. */
export async function listAllFinanceQueueAccounts(
	database: Executor,
	query: FinanceQueueQuery,
	options: { scanSize?: number } = {},
): Promise<SettlementAccount[]> {
	const accounts: SettlementAccount[] = [];
	for await (const account of queueAccounts(database, query, options.scanSize))
		accounts.push(account);
	return accounts;
}

/**
 * The accounts in the scope still owing the employee money, in full or in
 * part (glossary: awaiting reimbursement), for the sidebar's Finance item.
 */
export async function countAwaitingReimbursement(
	database: Executor,
	input: { organizationId: string; scope: OfficerScope },
): Promise<number> {
	let count = 0;
	for await (const account of queueAccounts(database, { ...input, status: "open" })) {
		if (account.summary.currencies.some((line) => line.state === "outstanding")) count++;
	}
	return count;
}

export interface FinanceQueueFilterOptions {
	employees: Array<{ id: string; name: string | null }>;
	/** The teams recorded at approval on the approved expenses in scope. */
	teams: Array<{ id: string; name: string }>;
	currencies: string[];
}

/** What the queue's filters offer: only values of approved expenses in the scope. */
export async function listFinanceQueueFilterOptions(
	database: Executor,
	input: { organizationId: string; scope: OfficerScope },
): Promise<FinanceQueueFilterOptions> {
	const query: FinanceQueueQuery = { ...input, status: "all" };
	const reports = reportConditions(database, query);
	const claims = claimConditions(query);
	const employeeOf = (employeeId: PgColumn) =>
		and(eq(employee.id, employeeId), eq(employee.organizationId, input.organizationId));
	const [
		reportEmployees,
		claimEmployees,
		reportTeams,
		claimTeams,
		reportCurrencies,
		claimCurrencies,
	] = await Promise.all([
		database
			.selectDistinct({ id: employee.id, name: user.name })
			.from(travelExpenseReport)
			.innerJoin(employee, employeeOf(travelExpenseReport.employeeId))
			.leftJoin(user, eq(user.id, employee.userId))
			.where(reports),
		database
			.selectDistinct({ id: employee.id, name: user.name })
			.from(travelExpenseClaim)
			.innerJoin(employee, employeeOf(travelExpenseClaim.employeeId))
			.leftJoin(user, eq(user.id, employee.userId))
			.where(claims),
		database
			.selectDistinct({ id: sql<string>`unnest(${travelExpenseReport.approvalTeamIds})` })
			.from(travelExpenseReport)
			.where(reports),
		database
			.selectDistinct({ id: sql<string>`unnest(${travelExpenseClaim.approvalTeamIds})` })
			.from(travelExpenseClaim)
			.where(claims),
		database
			.selectDistinct({ currency: travelExpenseReport.reimbursementCurrency })
			.from(travelExpenseReport)
			.where(reports),
		database
			.selectDistinct({ currency: travelExpenseClaim.calculatedCurrency })
			.from(travelExpenseClaim)
			.where(claims),
	]);
	const employees = new Map(
		[...reportEmployees, ...claimEmployees].map((row) => [row.id, row.name] as const),
	);
	const teamIds = [...new Set([...reportTeams, ...claimTeams].map((row) => row.id))];
	const teams =
		teamIds.length === 0
			? []
			: await database
					.select({ id: team.id, name: team.name })
					.from(team)
					.where(and(eq(team.organizationId, input.organizationId), inArray(team.id, teamIds)))
					.orderBy(asc(team.name), asc(team.id));
	return {
		employees: [...employees]
			.map(([id, name]) => ({ id, name }))
			.toSorted(
				(left, right) =>
					(left.name ?? "").localeCompare(right.name ?? "") || left.id.localeCompare(right.id),
			),
		teams,
		currencies: [
			...new Set([...reportCurrencies, ...claimCurrencies].map((row) => row.currency)),
		].toSorted(),
	};
}
