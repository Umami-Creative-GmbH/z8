import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, max, type SQL } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalDecisionEvidence,
	employee,
	travelExpenseClaim,
	travelExpenseReport,
	travelExpenseSettlementEntry,
} from "@/db/schema";
import {
	loadTravelExpenseReportSubmittedRevisions,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "@/lib/approvals/evidence/travel-expense-report-store";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	computeSettlement,
	type EntitlementComponent,
	planSettlementEntry,
	type SettlementCommand,
	type SettlementPlanRefusal,
	type SettlementSummary,
} from "./settlement";

/**
 * Settlement accounts of approved travel expenses (#612). An account belongs
 * to one source: a travel expense report, or an approved legacy claim. Its
 * entitlement comes from approval facts (the approved frozen revision, the
 * decided claim) and its money from immutable `travel_expense_settlement_entry`
 * rows; the balance is always derived (`settlement.ts`).
 *
 * Extension points for later slices (NOTES/progress-612.md):
 * - #615 adjustments: return approved signed deltas from
 *   `loadApprovedAdjustmentComponents`; every account read picks them up.
 * - #615 recoveries: `recordSettlementEntry` already accepts `kind: "recovery"`.
 * - #614 reopen: lock the report row (the same lock recording takes) and refuse
 *   when `hasRecordedSettlement` (or a #613 export) is true.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export type SettlementSource = { type: "report"; id: string } | { type: "legacy_claim"; id: string };

export interface SettlementEntryView {
	id: string;
	kind: SettlementCommand["kind"];
	amount: string;
	currency: string;
	occurredOn: string;
	reference: string;
	note: string | null;
	/** Account balance the entry was recorded against. */
	balanceBefore: string;
	recordedAt: string;
	/** Finance views only; null in the employee's own view. */
	recordedByUserId: string | null;
	recordedByName: string | null;
}

export interface SettlementBasis {
	/** Report: the approved frozen revision. Legacy claim: the decided claim. */
	evidence: "frozen_revision" | "legacy_claim";
	revisionId: string | null;
	submissionCycle: number | null;
	approvedAt: string | null;
	/** Company-paid costs of the approved revision; never owed to the employee. Null for claims. */
	companyPaid: string | null;
}

export interface SettlementAccount {
	source: SettlementSource;
	organizationId: string;
	employeeId: string;
	employeeName: string | null;
	/** Approved and eligible for settlement now. */
	approved: boolean;
	/** The currency money is recorded in; null while nothing is approved. */
	currency: string | null;
	basis: SettlementBasis | null;
	entitlement: EntitlementComponent[];
	entries: SettlementEntryView[];
	summary: SettlementSummary;
	/** Report kind/title facts for lists. */
	title: SettlementTitle;
}

export type SettlementTitle =
	| { kind: "trip"; purpose: string | null; startDate: string | null; endDate: string | null }
	| { kind: "standalone"; description: string | null; expenseDate: string | null }
	| {
			kind: "legacy_claim";
			claimType: "receipt" | "mileage" | "per_diem";
			startDate: string | null;
			endDate: string | null;
	  };

type ReportRow = typeof travelExpenseReport.$inferSelect;
type ClaimRow = typeof travelExpenseClaim.$inferSelect;

/**
 * #615: approved signed adjustments of an account, each counted exactly once.
 * No adjustment model exists yet, so every account has none.
 */
async function loadApprovedAdjustmentComponents(
	_database: Executor,
	_input: { organizationId: string; sources: readonly SettlementSource[] },
): Promise<Map<string, EntitlementComponent[]>> {
	return new Map();
}

function sourceKey(source: SettlementSource): string {
	return `${source.type}:${source.id}`;
}

function plainDateText(value: Date | string | null): string | null {
	if (value === null) return null;
	return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

async function loadApprovedRevisionDecisions(
	database: Executor,
	organizationId: string,
	revisionIds: string[],
): Promise<Map<string, Instant>> {
	const decided = new Map<string, Instant>();
	if (revisionIds.length === 0) return decided;
	const rows = await database
		.select({
			revisionId: approvalDecisionEvidence.submittedRevisionId,
			decidedAt: max(approvalDecisionEvidence.decidedAt),
		})
		.from(approvalDecisionEvidence)
		.where(
			and(
				eq(approvalDecisionEvidence.organizationId, organizationId),
				eq(approvalDecisionEvidence.authority, "legacy"),
				inArray(approvalDecisionEvidence.submittedRevisionId, revisionIds),
				eq(approvalDecisionEvidence.requestOutcome, "approved"),
			),
		)
		.groupBy(approvalDecisionEvidence.submittedRevisionId);
	for (const row of rows) {
		if (row.decidedAt) decided.set(row.revisionId, instantFromDate(row.decidedAt));
	}
	return decided;
}

async function loadEntries(
	database: Executor,
	organizationId: string,
	sources: readonly SettlementSource[],
): Promise<Map<string, SettlementEntryView[]>> {
	const entries = new Map<string, SettlementEntryView[]>();
	const reportIds = sources.filter((s) => s.type === "report").map((s) => s.id);
	const claimIds = sources.filter((s) => s.type === "legacy_claim").map((s) => s.id);
	const scopes: SQL[] = [];
	if (reportIds.length > 0) scopes.push(inArray(travelExpenseSettlementEntry.reportId, reportIds));
	if (claimIds.length > 0) {
		scopes.push(inArray(travelExpenseSettlementEntry.legacyClaimId, claimIds));
	}
	for (const scope of scopes) {
		const rows = await database
			.select({ entry: travelExpenseSettlementEntry, recordedByName: user.name })
			.from(travelExpenseSettlementEntry)
			.leftJoin(user, eq(user.id, travelExpenseSettlementEntry.recordedByUserId))
			.where(and(eq(travelExpenseSettlementEntry.organizationId, organizationId), scope))
			.orderBy(asc(travelExpenseSettlementEntry.recordedAt), asc(travelExpenseSettlementEntry.id));
		for (const { entry, recordedByName } of rows) {
			const key =
				entry.sourceType === "report"
					? sourceKey({ type: "report", id: entry.reportId ?? "" })
					: sourceKey({ type: "legacy_claim", id: entry.legacyClaimId ?? "" });
			const list = entries.get(key) ?? [];
			list.push(toEntryView(entry, recordedByName));
			entries.set(key, list);
		}
	}
	return entries;
}

function toEntryView(
	entry: typeof travelExpenseSettlementEntry.$inferSelect,
	recordedByName: string | null,
): SettlementEntryView {
	return {
		id: entry.id,
		kind: entry.kind,
		amount: entry.amount,
		currency: entry.currency,
		occurredOn: entry.occurredOn,
		reference: entry.reference,
		note: entry.note,
		balanceBefore: entry.balanceBefore,
		recordedAt: instantToCanonicalString(instantFromDate(entry.recordedAt)),
		recordedByUserId: entry.recordedByUserId,
		recordedByName,
	};
}

function reportTitle(
	report: ReportRow,
	revision: TravelExpenseReportSubmittedRevisionRecord | undefined,
): SettlementTitle {
	if (report.kind === "trip") {
		const trip = revision?.facts.trip;
		return {
			kind: "trip",
			purpose: trip ? trip.purpose : report.tripPurpose,
			startDate: trip ? trip.startDate : plainDateText(report.tripStartDate),
			endDate: trip ? trip.endDate : plainDateText(report.tripEndDate),
		};
	}
	const first = revision?.facts.items[0];
	return {
		kind: "standalone",
		description: first?.description ?? null,
		expenseDate: first?.expenseDate ?? null,
	};
}

/** Builds the accounts of many reports and claims with a fixed number of reads. */
async function buildAccounts(
	database: Executor,
	organizationId: string,
	reports: ReadonlyArray<{ row: ReportRow; employeeName: string | null }>,
	claims: ReadonlyArray<{ row: ClaimRow; employeeName: string | null }>,
): Promise<SettlementAccount[]> {
	const approvedReports = reports.filter(({ row }) => row.status === "approved");
	const revisions = await loadTravelExpenseReportSubmittedRevisions(database, {
		organizationId,
		cycles: approvedReports.map(({ row }) => ({
			reportId: row.id,
			submissionCycle: row.submissionCount,
		})),
	});
	const sources: SettlementSource[] = [
		...reports.map(({ row }) => ({ type: "report" as const, id: row.id })),
		...claims.map(({ row }) => ({ type: "legacy_claim" as const, id: row.id })),
	];
	const [decisions, entries, adjustments] = await Promise.all([
		loadApprovedRevisionDecisions(
			database,
			organizationId,
			[...revisions.values()].map((revision) => revision.id),
		),
		loadEntries(database, organizationId, sources),
		loadApprovedAdjustmentComponents(database, { organizationId, sources }),
	]);

	const accounts: SettlementAccount[] = [];
	for (const { row, employeeName } of reports) {
		const source: SettlementSource = { type: "report", id: row.id };
		const revision = row.status === "approved" ? revisions.get(row.id) : undefined;
		const approvedAt = revision ? decisions.get(revision.id) : undefined;
		// Approved means: the report is approved now, its current cycle is frozen
		// and the decision evidence of that revision records the approval.
		const approved = Boolean(revision && approvedAt);
		const entitlement: EntitlementComponent[] =
			revision && approved
				? [
						{
							kind: "approved_submission",
							id: revision.id,
							currency: revision.facts.totals.currency,
							amount: revision.facts.totals.reimbursable,
						},
						...(adjustments.get(sourceKey(source)) ?? []),
					]
				: [];
		const accountEntries = entries.get(sourceKey(source)) ?? [];
		accounts.push({
			source,
			organizationId,
			employeeId: row.employeeId,
			employeeName,
			approved,
			currency: approved && revision ? revision.facts.totals.currency : null,
			basis:
				revision && approvedAt
					? {
							evidence: "frozen_revision",
							revisionId: revision.id,
							submissionCycle: revision.submissionCycle,
							approvedAt: instantToCanonicalString(approvedAt),
							companyPaid: revision.facts.totals.companyPaid,
						}
					: null,
			entitlement,
			entries: accountEntries,
			summary: computeSettlement({ entitlement, entries: accountEntries }),
			title: reportTitle(row, revision),
		});
	}
	for (const { row, employeeName } of claims) {
		const source: SettlementSource = { type: "legacy_claim", id: row.id };
		const approved = row.status === "approved";
		// A decided legacy claim is never edited again: its calculated amount is
		// the entitlement it was approved with. Legacy claims record no payer.
		const entitlement: EntitlementComponent[] = approved
			? [
					{
						kind: "legacy_claim",
						id: row.id,
						currency: row.calculatedCurrency,
						amount: row.calculatedAmount,
					},
					...(adjustments.get(sourceKey(source)) ?? []),
				]
			: [];
		const accountEntries = entries.get(sourceKey(source)) ?? [];
		accounts.push({
			source,
			organizationId,
			employeeId: row.employeeId,
			employeeName,
			approved,
			currency: approved ? row.calculatedCurrency : null,
			basis: approved
				? {
						evidence: "legacy_claim",
						revisionId: null,
						submissionCycle: null,
						approvedAt: row.decidedAt
							? instantToCanonicalString(instantFromDate(row.decidedAt))
							: null,
						companyPaid: null,
					}
				: null,
			entitlement,
			entries: accountEntries,
			summary: computeSettlement({ entitlement, entries: accountEntries }),
			title: {
				kind: "legacy_claim",
				claimType: row.type,
				startDate: plainDateText(row.tripStartDate),
				endDate: plainDateText(row.tripEndDate),
			},
		});
	}
	return accounts;
}

const employeeNameColumn = { employeeName: user.name };

/**
 * One account, scoped to the organization; null when the source does not
 * exist there. With `lock`, the source row is locked `FOR UPDATE` first: the
 * lock every settlement write (and #614's reopen) takes.
 */
export async function loadSettlementAccount(
	database: Executor,
	input: { organizationId: string; source: SettlementSource },
	options: { lock?: boolean } = {},
): Promise<SettlementAccount | null> {
	const { organizationId, source } = input;
	if (source.type === "report") {
		const query = database
			.select({ row: travelExpenseReport })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, source.id),
					eq(travelExpenseReport.organizationId, organizationId),
				),
			)
			.limit(1);
		const [found] = options.lock ? await query.for("update") : await query;
		if (!found) return null;
		const employeeName = await loadEmployeeName(database, organizationId, found.row.employeeId);
		const [account] = await buildAccounts(database, organizationId, [
			{ row: found.row, employeeName },
		], []);
		return account ?? null;
	}
	const query = database
		.select({ row: travelExpenseClaim })
		.from(travelExpenseClaim)
		.where(
			and(eq(travelExpenseClaim.id, source.id), eq(travelExpenseClaim.organizationId, organizationId)),
		)
		.limit(1);
	const [found] = options.lock ? await query.for("update") : await query;
	if (!found) return null;
	const employeeName = await loadEmployeeName(database, organizationId, found.row.employeeId);
	const [account] = await buildAccounts(database, organizationId, [], [
		{ row: found.row, employeeName },
	]);
	return account ?? null;
}

async function loadEmployeeName(
	database: Executor,
	organizationId: string,
	employeeId: string,
): Promise<string | null> {
	const [row] = await database
		.select(employeeNameColumn)
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	return row?.employeeName ?? null;
}

/** Whether any money was recorded for the source (#614 refuses reopening then). */
export async function hasRecordedSettlement(
	database: Executor,
	input: { organizationId: string; source: SettlementSource },
): Promise<boolean> {
	const [row] = await database
		.select({ id: travelExpenseSettlementEntry.id })
		.from(travelExpenseSettlementEntry)
		.where(
			and(
				eq(travelExpenseSettlementEntry.organizationId, input.organizationId),
				input.source.type === "report"
					? eq(travelExpenseSettlementEntry.reportId, input.source.id)
					: eq(travelExpenseSettlementEntry.legacyClaimId, input.source.id),
			),
		)
		.limit(1);
	return Boolean(row);
}

/** Most queue rows read at once; older approvals beyond it need filtering (#619). */
export const FINANCE_QUEUE_SOURCE_LIMIT = 500;

export type FinanceQueueFilter = "open" | "settled" | "all";

/**
 * The finance queue: approved reports and approved legacy claims of one
 * organization with their balances. `open` lists anything not settled
 * (outstanding or overpaid). Only currently approved sources are listed, so a
 * report returned for correction (#603/#614) drops out.
 */
export async function listFinanceQueue(
	database: Executor,
	input: { organizationId: string; filter: FinanceQueueFilter },
): Promise<SettlementAccount[]> {
	const [reports, claims] = await Promise.all([
		database
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
					eq(travelExpenseReport.organizationId, input.organizationId),
					eq(travelExpenseReport.status, "approved"),
				),
			)
			.orderBy(desc(travelExpenseReport.decidedAt), desc(travelExpenseReport.id))
			.limit(FINANCE_QUEUE_SOURCE_LIMIT),
		database
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
			.where(
				and(
					eq(travelExpenseClaim.organizationId, input.organizationId),
					eq(travelExpenseClaim.status, "approved"),
				),
			)
			.orderBy(desc(travelExpenseClaim.decidedAt), desc(travelExpenseClaim.id))
			.limit(FINANCE_QUEUE_SOURCE_LIMIT),
	]);
	const accounts = await buildAccounts(database, input.organizationId, reports, claims);
	return accounts
		.filter((account) => account.approved)
		.filter((account) =>
			input.filter === "all"
				? true
				: input.filter === "settled"
					? account.summary.state === "settled"
					: account.summary.state !== "settled",
		)
		.sort((left, right) =>
			(right.basis?.approvedAt ?? "").localeCompare(left.basis?.approvedAt ?? ""),
		);
}

/** The employee's own approved reports and claims with their balances. */
export async function listOwnSettlementAccounts(
	database: Executor,
	owner: { organizationId: string; employeeId: string },
): Promise<SettlementAccount[]> {
	const [reports, claims] = await Promise.all([
		database
			.select({ row: travelExpenseReport })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.organizationId, owner.organizationId),
					eq(travelExpenseReport.employeeId, owner.employeeId),
					eq(travelExpenseReport.status, "approved"),
				),
			),
		database
			.select({ row: travelExpenseClaim })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, owner.organizationId),
					eq(travelExpenseClaim.employeeId, owner.employeeId),
					eq(travelExpenseClaim.status, "approved"),
				),
			),
	]);
	return buildAccounts(
		database,
		owner.organizationId,
		reports.map(({ row }) => ({ row, employeeName: null })),
		claims.map(({ row }) => ({ row, employeeName: null })),
	);
}

export function settlementCommandFingerprint(
	source: SettlementSource,
	command: SettlementCommand,
): string {
	const canonical = JSON.stringify([
		"travel_expense_settlement:v1",
		source.type,
		source.id,
		command.kind,
		command.amount,
		command.currency,
		command.occurredOn,
		command.reference,
		command.note,
	]);
	return `travel_expense_settlement:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}

export interface SettlementActor {
	organizationId: string;
	employeeId: string;
	userId: string;
}

export type RecordSettlementResult =
	| {
			status: "recorded";
			/** True when this exact command was already recorded: nothing new was written. */
			replayed: boolean;
			entry: SettlementEntryView;
			account: SettlementAccount;
	  }
	| { status: "not_found" }
	/** The key was used for a different command. */
	| { status: "idempotency_conflict" }
	| { status: "not_approved" }
	/** Finance cannot record money for their own expenses. */
	| { status: "own_expense" }
	| { status: "refused"; reason: SettlementPlanRefusal; balance: string; account: SettlementAccount };

/**
 * Records money that moved outside Z8 for one approved source. The source row
 * lock serializes every write to the account; the idempotency key makes a
 * retried command return the entry it already recorded instead of a second
 * one; `expectedBalance` refuses a command based on a balance that changed in
 * between (a concurrent reimbursement, an adjustment). Nothing is transferred.
 */
export async function recordSettlementEntry(
	database: Database,
	input: {
		actor: SettlementActor;
		source: SettlementSource;
		idempotencyKey: string;
		command: SettlementCommand;
		expectedBalance: { currency: string; amount: string };
	},
	now: Instant = systemClock.nowInstant(),
): Promise<RecordSettlementResult> {
	const { actor, source, command } = input;
	const fingerprint = settlementCommandFingerprint(source, command);
	return database.transaction(async (tx) => {
		const account = await loadSettlementAccount(
			tx,
			{ organizationId: actor.organizationId, source },
			{ lock: true },
		);
		if (!account) return { status: "not_found" } as const;
		const replay = await findByIdempotencyKey(tx, actor.organizationId, input.idempotencyKey);
		if (replay) return replayResult(replay, fingerprint, account);
		if (!account.approved) return { status: "not_approved" } as const;
		if (account.employeeId === actor.employeeId) return { status: "own_expense" } as const;
		const plan = planSettlementEntry(account.summary, command, input.expectedBalance);
		if (!plan.ok) {
			return { status: "refused", reason: plan.reason, balance: plan.balance, account } as const;
		}
		const inserted = await tx
			.insert(travelExpenseSettlementEntry)
			.values({
				organizationId: actor.organizationId,
				sourceType: source.type,
				reportId: source.type === "report" ? source.id : null,
				legacyClaimId: source.type === "legacy_claim" ? source.id : null,
				kind: command.kind,
				amount: command.amount,
				currency: command.currency,
				occurredOn: command.occurredOn,
				reference: command.reference,
				note: command.note,
				basisRevisionId: source.type === "report" ? (account.basis?.revisionId ?? null) : null,
				basisSubmissionCycle:
					source.type === "report" ? (account.basis?.submissionCycle ?? null) : null,
				balanceBefore: plan.balanceBefore,
				idempotencyKey: input.idempotencyKey,
				commandFingerprint: fingerprint,
				recordedByEmployeeId: actor.employeeId,
				recordedByUserId: actor.userId,
				recordedAt: dateFromInstant(now),
			})
			.onConflictDoNothing({
				target: [travelExpenseSettlementEntry.organizationId, travelExpenseSettlementEntry.idempotencyKey],
			})
			.returning({ id: travelExpenseSettlementEntry.id });
		if (inserted.length === 0) {
			// The same key committed concurrently for another account.
			const raced = await findByIdempotencyKey(tx, actor.organizationId, input.idempotencyKey);
			if (!raced) throw new Error("Settlement idempotency key vanished");
			return replayResult(raced, fingerprint, account);
		}
		const updated = await loadSettlementAccount(tx, { organizationId: actor.organizationId, source });
		const entry = updated?.entries.find((candidate) => candidate.id === inserted[0]?.id);
		if (!updated || !entry) throw new Error("Recorded settlement entry not readable");
		return { status: "recorded", replayed: false, entry, account: updated } as const;
	});
}

async function findByIdempotencyKey(tx: Transaction, organizationId: string, key: string) {
	const [row] = await tx
		.select({ entry: travelExpenseSettlementEntry, recordedByName: user.name })
		.from(travelExpenseSettlementEntry)
		.leftJoin(user, eq(user.id, travelExpenseSettlementEntry.recordedByUserId))
		.where(
			and(
				eq(travelExpenseSettlementEntry.organizationId, organizationId),
				eq(travelExpenseSettlementEntry.idempotencyKey, key),
			),
		)
		.limit(1);
	return row ?? null;
}

function replayResult(
	found: NonNullable<Awaited<ReturnType<typeof findByIdempotencyKey>>>,
	fingerprint: string,
	account: SettlementAccount,
): RecordSettlementResult {
	if (found.entry.commandFingerprint !== fingerprint) return { status: "idempotency_conflict" };
	return {
		status: "recorded",
		replayed: true,
		entry: toEntryView(found.entry, found.recordedByName),
		account,
	};
}
