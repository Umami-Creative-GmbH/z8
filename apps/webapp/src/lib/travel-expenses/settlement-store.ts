import { createHash } from "node:crypto";
import { and, asc, eq, inArray, max, type SQL, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalDecisionEvidence,
	employee,
	payrollExportJob,
	travelExpenseClaim,
	travelExpenseExportBatch,
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
import { loadAdjustmentOriginals, loadApprovedAdjustments } from "./adjustment-read";
import type { OfficerScope } from "./officer-scope";
import { isSourceInOfficerScope } from "./officer-scope-read";
import { OWNER_SELF_APPROVAL_REASON } from "./owner-self-approval";
import {
	type ConfirmedPayrollRun,
	type IncludedPayrollRun,
	loadConfirmedPayrollRuns,
	loadIncludedPayrollRuns,
} from "./payroll-run-inclusion-read";
import {
	computeSettlement,
	type EntitlementComponent,
	planSettlementEntry,
	type SettlementCommand,
	type SettlementPlanRefusal,
	type SettlementSummary,
} from "./settlement";
import { notifySettlementRecorded } from "./settlement-notifications";

/**
 * Settlement accounts of approved travel expenses (#612). An account belongs
 * to one source: a travel expense report, or an approved legacy claim. Its
 * entitlement comes from approval facts (the approved frozen revision, the
 * decided claim) and its money from immutable `travel_expense_settlement_entry`
 * rows; the balance is always derived (`settlement.ts`).
 *
 * #615: a report account's entitlement includes the frozen signed delta of
 * every approved adjustment of the report (`adjustment-read.ts`), once each;
 * an adjustment report itself has no account (`adjustmentOf`). Recoveries are
 * recorded with `kind: "recovery"` against an overpayment.
 *
 * Extension points for later slices (NOTES/progress-612.md):
 * - #614 reopen: lock the report row (the same lock recording takes) and refuse
 *   when `hasRecordedSettlement` (or a #613 export) is true.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export type SettlementSource =
	| { type: "report"; id: string }
	| { type: "legacy_claim"; id: string };

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
	/** The export batch the reimbursement was recorded for (#755). Finance views only. */
	exportBatch: SettlementEntryExportBatch | null;
	/**
	 * The payroll run whose confirmation recorded the reimbursement (#853). The
	 * employee sees it too: it names the payslip that paid them.
	 */
	payrollRun: SettlementEntryPayrollRun | null;
}

export interface SettlementEntryExportBatch {
	id: string;
	requestedAt: string;
}

export interface SettlementEntryPayrollRun {
	/** The payroll export job that is the run. */
	id: string;
	/** The payroll period, as logical dates. */
	periodStart: string;
	periodEnd: string;
}

export interface SettlementBasis {
	/** Report: the approved frozen revision. Legacy claim: the decided claim. */
	evidence: "frozen_revision" | "legacy_claim";
	revisionId: string | null;
	submissionCycle: number | null;
	approvedAt: string | null;
	/** Set when no reviewer decided: the owner's self-approval (#679). Null for claims. */
	approvalBasis: typeof OWNER_SELF_APPROVAL_REASON | null;
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
	/** Approved adjustments included in `entitlement` (#615), oldest approval first. */
	adjustments: SettlementAdjustmentView[];
	/**
	 * Set on an adjustment report (#615): the report whose account it corrects.
	 * Such a report has no account of its own (empty entitlement); nothing is
	 * recorded against it.
	 */
	adjustmentOf: string | null;
	/** An approved adjustment report's frozen signed delta (#615); null otherwise. */
	adjustmentDelta: string | null;
	/**
	 * The unconfirmed payroll run that includes the report (#852): no other way
	 * of recording money works until it is removed or the run is confirmed.
	 * Finance views only; null in the employee's own view and for legacy claims.
	 */
	payrollRun: IncludedPayrollRun | null;
	/**
	 * The payroll runs confirmed as having paid the report (#853), oldest first:
	 * their lines are what payroll already carried, and a run that paid more
	 * than was owed is flagged as overpaid by payroll. Finance views only; empty
	 * in the employee's own view and for legacy claims.
	 */
	confirmedPayrollRuns: ConfirmedPayrollRun[];
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

/** An approved adjustment (#615) as its original report's account shows it. */
export interface SettlementAdjustmentView {
	reportId: string;
	revisionId: string;
	delta: string;
	currency: string;
	reason: string;
	approvedAt: string;
}

/**
 * #615: approved signed adjustments of report accounts, each counted exactly
 * once (`adjustment-read.ts`). Legacy claims have no adjustments.
 */
async function loadApprovedAdjustmentComponents(
	database: Executor,
	input: { organizationId: string; sources: readonly SettlementSource[] },
): Promise<Map<string, SettlementAdjustmentView[]>> {
	const approved = await loadApprovedAdjustments(database, {
		organizationId: input.organizationId,
		originalReportIds: input.sources.filter((s) => s.type === "report").map((s) => s.id),
	});
	return new Map(
		[...approved.entries()].map(([originalReportId, adjustments]) => [
			sourceKey({ type: "report", id: originalReportId }),
			adjustments
				.toSorted(
					(left, right) =>
						left.approvedAt.epochMilliseconds - right.approvedAt.epochMilliseconds ||
						(left.reportId < right.reportId ? -1 : 1),
				)
				.map((adjustment) => ({
					reportId: adjustment.reportId,
					revisionId: adjustment.revisionId,
					delta: adjustment.delta,
					currency: adjustment.currency,
					reason: adjustment.reason,
					approvedAt: instantToCanonicalString(adjustment.approvedAt),
				})),
		]),
	);
}

function adjustmentComponents(views: readonly SettlementAdjustmentView[]): EntitlementComponent[] {
	return views.map((view) => ({
		kind: "approved_adjustment",
		id: view.revisionId,
		currency: view.currency,
		amount: view.delta,
	}));
}

function sourceKey(source: SettlementSource): string {
	return `${source.type}:${source.id}`;
}

function plainDateText(value: Date | string | null): string | null {
	if (value === null) return null;
	return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

interface ApprovedRevisionDecision {
	approvedAt: Instant;
	/** Set when no reviewer decided: the owner's self-approval (#679). */
	approvalBasis: typeof OWNER_SELF_APPROVAL_REASON | null;
}

async function loadApprovedRevisionDecisions(
	database: Executor,
	organizationId: string,
	revisionIds: string[],
): Promise<Map<string, ApprovedRevisionDecision>> {
	const decided = new Map<string, ApprovedRevisionDecision>();
	if (revisionIds.length === 0) return decided;
	const rows = await database
		.select({
			revisionId: approvalDecisionEvidence.submittedRevisionId,
			decidedAt: max(approvalDecisionEvidence.decidedAt),
			// `isOwnerSelfApprovalDecision` (owner-self-approval.ts) as an aggregate.
			selfApproved: sql<boolean>`bool_or(${approvalDecisionEvidence.operationKind} = 'submission_activation' and ${approvalDecisionEvidence.result}->>'reason' = ${OWNER_SELF_APPROVAL_REASON})`,
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
		if (!row.decidedAt) continue;
		decided.set(row.revisionId, {
			approvedAt: instantFromDate(row.decidedAt),
			approvalBasis: row.selfApproved ? OWNER_SELF_APPROVAL_REASON : null,
		});
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
			.select(entryColumns())
			.from(travelExpenseSettlementEntry)
			.leftJoin(user, eq(user.id, travelExpenseSettlementEntry.recordedByUserId))
			.leftJoin(travelExpenseExportBatch, entryExportBatchJoin())
			.leftJoin(payrollExportJob, entryPayrollRunJoin())
			.where(and(eq(travelExpenseSettlementEntry.organizationId, organizationId), scope))
			.orderBy(asc(travelExpenseSettlementEntry.recordedAt), asc(travelExpenseSettlementEntry.id));
		for (const row of rows) {
			const { entry } = row;
			const key =
				entry.sourceType === "report"
					? sourceKey({ type: "report", id: entry.reportId ?? "" })
					: sourceKey({ type: "legacy_claim", id: entry.legacyClaimId ?? "" });
			const list = entries.get(key) ?? [];
			list.push(toEntryView(row));
			entries.set(key, list);
		}
	}
	return entries;
}

// Functions, not constants: nothing here reads the schema while the module loads.
function entryColumns() {
	return {
		entry: travelExpenseSettlementEntry,
		recordedByName: user.name,
		exportBatchRequestedAt: travelExpenseExportBatch.requestedAt,
		payrollRunFilters: payrollExportJob.filters,
	};
}

function entryExportBatchJoin() {
	return and(
		eq(travelExpenseExportBatch.id, travelExpenseSettlementEntry.exportBatchId),
		eq(travelExpenseExportBatch.organizationId, travelExpenseSettlementEntry.organizationId),
	);
}

function entryPayrollRunJoin() {
	return and(
		eq(payrollExportJob.id, travelExpenseSettlementEntry.payrollRunId),
		eq(payrollExportJob.organizationId, travelExpenseSettlementEntry.organizationId),
	);
}

function toEntryView({
	entry,
	recordedByName,
	exportBatchRequestedAt,
	payrollRunFilters,
}: {
	entry: typeof travelExpenseSettlementEntry.$inferSelect;
	recordedByName: string | null;
	exportBatchRequestedAt: Date | null;
	payrollRunFilters: (typeof payrollExportJob.$inferSelect)["filters"] | null;
}): SettlementEntryView {
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
		exportBatch:
			entry.exportBatchId && exportBatchRequestedAt
				? {
						id: entry.exportBatchId,
						requestedAt: instantToCanonicalString(instantFromDate(exportBatchRequestedAt)),
					}
				: null,
		payrollRun:
			entry.payrollRunId && payrollRunFilters
				? {
						id: entry.payrollRunId,
						periodStart: payrollRunFilters.dateRange.start,
						periodEnd: payrollRunFilters.dateRange.end,
					}
				: null,
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

/**
 * Builds the accounts of many reports and claims with a fixed number of reads:
 * the reports' accounts in their order, then the claims'.
 */
export async function buildSettlementAccounts(
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
	const approvedReportIds = approvedReports.map(({ row }) => row.id);
	const [decisions, entries, adjustments, adjustmentOriginals, payrollRuns, confirmedRuns] =
		await Promise.all([
			loadApprovedRevisionDecisions(
				database,
				organizationId,
				[...revisions.values()].map((revision) => revision.id),
			),
			loadEntries(database, organizationId, sources),
			loadApprovedAdjustmentComponents(database, { organizationId, sources }),
			loadAdjustmentOriginals(database, {
				organizationId,
				reportIds: reports.map(({ row }) => row.id),
			}),
			loadIncludedPayrollRuns(database, { organizationId, reportIds: approvedReportIds }),
			loadConfirmedPayrollRuns(database, { organizationId, reportIds: approvedReportIds }),
		]);

	const accounts: SettlementAccount[] = [];
	for (const { row, employeeName } of reports) {
		const source: SettlementSource = { type: "report", id: row.id };
		const revision = row.status === "approved" ? revisions.get(row.id) : undefined;
		const decision = revision ? decisions.get(revision.id) : undefined;
		const approvedAt = decision?.approvedAt;
		// Approved means: the report is approved now, its current cycle is frozen
		// and the decision evidence of that revision records the approval.
		const approved = Boolean(revision && approvedAt);
		const adjustmentOf = adjustmentOriginals.get(row.id) ?? null;
		const accountAdjustments = approved ? (adjustments.get(sourceKey(source)) ?? []) : [];
		// An adjustment report's delta belongs to its original's account (#615).
		const entitlement: EntitlementComponent[] =
			revision && approved && !adjustmentOf
				? [
						{
							kind: "approved_submission",
							id: revision.id,
							currency: revision.facts.totals.currency,
							amount: revision.facts.totals.reimbursable,
						},
						...adjustmentComponents(accountAdjustments),
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
							approvalBasis: decision?.approvalBasis ?? null,
							companyPaid: revision.facts.totals.companyPaid,
						}
					: null,
			entitlement,
			entries: accountEntries,
			summary: computeSettlement({ entitlement, entries: accountEntries }),
			title: reportTitle(row, revision),
			adjustments: accountAdjustments,
			adjustmentOf,
			adjustmentDelta:
				adjustmentOf && approved ? (revision?.facts.adjustment?.delta.amount ?? null) : null,
			payrollRun: payrollRuns.get(row.id) ?? null,
			confirmedPayrollRuns: confirmedRuns.get(row.id) ?? [],
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
						approvalBasis: null,
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
			adjustments: [],
			adjustmentOf: null,
			adjustmentDelta: null,
			// Legacy claims are never included in a payroll run (#745, decision 6).
			payrollRun: null,
			confirmedPayrollRuns: [],
		});
	}
	return accounts;
}

export const employeeNameColumn = { employeeName: user.name };

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
		const [account] = await buildSettlementAccounts(
			database,
			organizationId,
			[{ row: found.row, employeeName }],
			[],
		);
		return account ?? null;
	}
	const query = database
		.select({ row: travelExpenseClaim })
		.from(travelExpenseClaim)
		.where(
			and(
				eq(travelExpenseClaim.id, source.id),
				eq(travelExpenseClaim.organizationId, organizationId),
			),
		)
		.limit(1);
	const [found] = options.lock ? await query.for("update") : await query;
	if (!found) return null;
	const employeeName = await loadEmployeeName(database, organizationId, found.row.employeeId);
	const [account] = await buildSettlementAccounts(
		database,
		organizationId,
		[],
		[{ row: found.row, employeeName }],
	);
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
	const accounts = await buildSettlementAccounts(
		database,
		owner.organizationId,
		reports.map(({ row }) => ({ row, employeeName: null })),
		claims.map(({ row }) => ({ row, employeeName: null })),
	);
	// An adjustment's balance is its original report's (#615).
	return accounts.filter((account) => account.adjustmentOf === null);
}

export function settlementCommandFingerprint(
	source: SettlementSource,
	command: SettlementCommand,
	exportBatchId: string | null = null,
	payrollRunId: string | null = null,
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
		// Appended only when set, so every fingerprint recorded before #755 stays valid.
		...(exportBatchId ? [exportBatchId] : []),
		// Likewise for #853; tagged so a run id never reads as a batch id.
		...(payrollRunId ? ["payroll_run", payrollRunId] : []),
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
	/** An adjustment report (#615): money is recorded on the report it corrects. */
	| { status: "adjustment_report" }
	/** Finance cannot record money for their own expenses. */
	| { status: "own_expense" }
	/**
	 * An unconfirmed payroll run includes the report (#852): it is paid with
	 * that run, or removed from it before anything else is recorded.
	 */
	| { status: "in_payroll_run"; payrollRun: IncludedPayrollRun }
	| {
			status: "refused";
			reason: SettlementPlanRefusal;
			balance: string;
			account: SettlementAccount;
	  };

export interface RecordSettlementInput {
	actor: SettlementActor;
	/** The officer scope the actor records money in (#747); any other account is not found. */
	scope: OfficerScope;
	source: SettlementSource;
	idempotencyKey: string;
	command: SettlementCommand;
	expectedBalance: { currency: string; amount: string };
	/** Bulk reimbursement (#754): refused unless the entry leaves the whole account reimbursed. */
	inFull?: boolean;
	/** The completed export batch the reimbursement is recorded for (#755); the caller checked it. */
	exportBatchId?: string;
	/**
	 * The payroll run being confirmed (#853): the one run whose inclusion of the
	 * report does not refuse the entry. The caller confirms the inclusion in the
	 * same transaction.
	 */
	payrollRunId?: string;
}

/**
 * Records money that moved outside Z8 for one approved source. The source row
 * lock serializes every write to the account; the idempotency key makes a
 * retried command return the entry it already recorded instead of a second
 * one; `expectedBalance` refuses a command based on a balance that changed in
 * between (a concurrent reimbursement, an adjustment). Nothing is transferred.
 *
 * After commit, a newly recorded entry notifies the employee (#752); a replay
 * does not, so every path recording money through here notifies exactly once.
 */
export async function recordSettlementEntry(
	database: Database,
	input: RecordSettlementInput,
	now: Instant = systemClock.nowInstant(),
): Promise<RecordSettlementResult> {
	const result = await database.transaction((tx) =>
		recordSettlementEntryInTransaction(tx, input, now),
	);
	if (result.status === "recorded" && !result.replayed) {
		await notifySettlementRecorded(database, {
			account: result.account,
			entry: result.entry,
			idempotencyKey: input.idempotencyKey,
		});
	}
	return result;
}

/**
 * `recordSettlementEntry` inside the caller's transaction, for a caller that
 * writes more in the same transaction (#853 confirms the payroll run's
 * inclusion). The caller notifies after commit (`notifySettlementRecorded`)
 * when an entry was recorded and not replayed.
 */
export async function recordSettlementEntryInTransaction(
	tx: Transaction,
	input: RecordSettlementInput,
	now: Instant,
): Promise<RecordSettlementResult> {
	const { actor, source, command } = input;
	const exportBatchId = input.exportBatchId ?? null;
	const payrollRunId = input.payrollRunId ?? null;
	const fingerprint = settlementCommandFingerprint(source, command, exportBatchId, payrollRunId);
	const account = await loadSettlementAccount(
		tx,
		{ organizationId: actor.organizationId, source },
		{ lock: true },
	);
	if (!account) return { status: "not_found" } as const;
	const inScope = await isSourceInOfficerScope(tx, input.scope, {
		organizationId: actor.organizationId,
		source,
		employeeId: account.employeeId,
	});
	if (!inScope) return { status: "not_found" } as const;
	const replay = await findByIdempotencyKey(tx, actor.organizationId, input.idempotencyKey);
	if (replay) return replayResult(replay, fingerprint, account);
	// Read under the report lock that including and removing take too (#852).
	if (account.payrollRun && account.payrollRun.jobId !== payrollRunId) {
		return { status: "in_payroll_run", payrollRun: account.payrollRun } as const;
	}
	if (account.adjustmentOf) return { status: "adjustment_report" } as const;
	if (!account.approved) return { status: "not_approved" } as const;
	if (account.employeeId === actor.employeeId) return { status: "own_expense" } as const;
	const plan = planSettlementEntry(account.summary, command, input.expectedBalance, {
		inFull: input.inFull,
	});
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
			exportBatchId,
			payrollRunId,
		})
		.onConflictDoNothing({
			target: [
				travelExpenseSettlementEntry.organizationId,
				travelExpenseSettlementEntry.idempotencyKey,
			],
		})
		.returning({ id: travelExpenseSettlementEntry.id });
	if (inserted.length === 0) {
		// The same key committed concurrently for another account.
		const raced = await findByIdempotencyKey(tx, actor.organizationId, input.idempotencyKey);
		if (!raced) throw new Error("Settlement idempotency key vanished");
		return replayResult(raced, fingerprint, account);
	}
	const updated = await loadSettlementAccount(tx, {
		organizationId: actor.organizationId,
		source,
	});
	const entry = updated?.entries.find((candidate) => candidate.id === inserted[0]?.id);
	if (!updated || !entry) throw new Error("Recorded settlement entry not readable");
	return { status: "recorded", replayed: false, entry, account: updated } as const;
}

async function findByIdempotencyKey(tx: Transaction, organizationId: string, key: string) {
	const [row] = await tx
		.select(entryColumns())
		.from(travelExpenseSettlementEntry)
		.leftJoin(user, eq(user.id, travelExpenseSettlementEntry.recordedByUserId))
		.leftJoin(travelExpenseExportBatch, entryExportBatchJoin())
		.leftJoin(payrollExportJob, entryPayrollRunJoin())
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
	return { status: "recorded", replayed: true, entry: toEntryView(found), account };
}
