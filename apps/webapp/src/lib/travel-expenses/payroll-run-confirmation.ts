import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	auditLog,
	payrollExportConfig,
	payrollExportFormat,
	payrollExportJob,
	type TravelExpensePayrollRunInclusionLine,
	travelExpensePayrollRunInclusion,
	travelExpenseReport,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { logger } from "@/lib/logger";
import { formatUnits, parseUnits } from "@/lib/money/exact-decimal";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { latestCalendarDate } from "./future-dates";
import { STORED_AMOUNT_SCALE } from "./money";
import type { OfficerScope } from "./officer-scope";
import { isSourceInOfficerScope, reportInOfficerScope } from "./officer-scope-read";
import { payrollPeriodText } from "./payroll-run-period";
import {
	parseSettlementPayment,
	SETTLEMENT_REFERENCE_MAX_LENGTH,
	type SettlementCommandFieldError,
	type SettlementPayment,
} from "./settlement";
import { notifySettlementRecorded } from "./settlement-notifications";
import {
	loadSettlementAccount,
	type RecordSettlementResult,
	recordSettlementEntryInTransaction,
	type SettlementActor,
	type SettlementSource,
} from "./settlement-store";

/**
 * Confirming a payroll run as paid (#853, ADR 0003). An expense officer who
 * records reimbursements, an owner or an admin confirms that payroll paid the
 * run; each included report in their officer scope, never their own, then
 * gets a reimbursement of the amount the run froze: what payroll paid, even
 * beyond what the account still owes (the excess shows as an overpayment,
 * recovered by hand). Every report goes through `recordSettlementEntry` in its own
 * transaction (row lock, idempotency key per run and report) together with
 * its inclusion's confirmation, so partial success is expected and each report
 * reports its own outcome. Reports outside the confirmer's scope stay included
 * for someone with scope; a confirmed inclusion is final.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

const PAYROLL_CURRENCY = "EUR";
const ZERO = BigInt(0);

export const PAYROLL_RUN_CONFIRMATION_OUTCOMES = [
	/** The frozen amount is recorded as reimbursed. */
	"confirmed",
	/** The account owed less than the run paid: recorded in full, the account is now overpaid. */
	"overpaid_by_payroll",
	/** The confirmer's own report: it stays included for someone else. */
	"own_expense",
	/** Outside the confirmer's officer scope: it stays included for someone with scope. */
	"out_of_scope",
	"failed",
] as const;
export type PayrollRunConfirmationOutcome = (typeof PAYROLL_RUN_CONFIRMATION_OUTCOMES)[number];

export interface PayrollRunConfirmationRow {
	reportId: string;
	employeeName: string | null;
	outcome: PayrollRunConfirmationOutcome;
	/** What the run carried for the report, in EUR. */
	frozenAmount: string;
	/** The reimbursement recorded; null when nothing was recorded. */
	amount: string | null;
	/** Overpaid by payroll: what the run paid beyond what was owed. */
	overpaid: string | null;
	/** What still awaits reimbursement after confirming: the next run takes it. */
	remaining: string | null;
}

export type ConfirmPayrollRunResult =
	/** No payroll run of the organization. */
	| { status: "not_found" }
	/** The payday is invalid; nothing was recorded. */
	| { status: "invalid"; errors: SettlementCommandFieldError[] }
	/** One row per report the run still included; empty when nothing was left to confirm. */
	| { status: "processed"; rows: PayrollRunConfirmationRow[] };

export interface PayrollRunHeader {
	jobId: string;
	formatName: string;
	periodStart: string;
	periodEnd: string;
}

/**
 * The payday a confirmation records when the confirmer picks none: the end of
 * the run's period, or today when the period has not ended yet. Never later
 * than today.
 */
export function defaultPayday(periodEnd: string, today: string): string {
	return comparePlainDates(parsePlainDate(periodEnd), parsePlainDate(today)) > 0
		? today
		: periodEnd;
}

/** The reference every reimbursement of the run carries; the UI names the run from its join. */
export function payrollRunReference(
	run: Pick<PayrollRunHeader, "formatName" | "periodStart" | "periodEnd">,
) {
	const reference = `Payroll run ${payrollPeriodText(run.periodStart, run.periodEnd)} (${run.formatName})`;
	return reference.slice(0, SETTLEMENT_REFERENCE_MAX_LENGTH);
}

/** One key per run and report: confirming again never records a second reimbursement. */
export function payrollRunConfirmationKey(jobId: string, reportId: string): string {
	return `payroll-run:${jobId}:report:${reportId}`;
}

/** The run of payroll export job `jobId`: its format's name and period. */
export async function loadPayrollRunHeader(
	database: Executor,
	input: { organizationId: string; jobId: string },
): Promise<PayrollRunHeader | null> {
	const [row] = await database
		.select({
			jobId: payrollExportJob.id,
			filters: payrollExportJob.filters,
			formatName: payrollExportFormat.name,
		})
		.from(payrollExportJob)
		.innerJoin(payrollExportConfig, eq(payrollExportConfig.id, payrollExportJob.configId))
		.innerJoin(payrollExportFormat, eq(payrollExportFormat.id, payrollExportConfig.formatId))
		.where(
			and(
				eq(payrollExportJob.id, input.jobId),
				eq(payrollExportJob.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!row) return null;
	return {
		jobId: row.jobId,
		formatName: row.formatName,
		periodStart: row.filters.dateRange.start,
		periodEnd: row.filters.dateRange.end,
	};
}

function units(amount: string): bigint {
	const parsed = parseUnits(amount, STORED_AMOUNT_SCALE);
	if (parsed === null) throw new RangeError(`Not a stored amount: ${amount}`);
	return parsed;
}

function frozenTotal(lines: readonly TravelExpensePayrollRunInclusionLine[]): bigint {
	return lines.reduce((total, line) => total + units(line.amount), ZERO);
}

const text = (value: bigint) => formatUnits(value, STORED_AMOUNT_SCALE);

/**
 * Confirms the run as paid for every report it still includes in the actor's
 * scope. `payday` is the date payroll paid; null takes `defaultPayday`.
 */
export async function confirmPayrollRun(
	database: Database,
	input: {
		actor: SettlementActor;
		/** The actor's reimbursement scope; reports outside it stay included. */
		scope: OfficerScope;
		jobId: string;
		payday: string | null;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<ConfirmPayrollRunResult> {
	const { actor, jobId } = input;
	const { organizationId } = actor;
	const run = await loadPayrollRunHeader(database, { organizationId, jobId });
	if (!run) return { status: "not_found" };
	const inclusions = await database
		.select({
			id: travelExpensePayrollRunInclusion.id,
			reportId: travelExpensePayrollRunInclusion.reportId,
			state: travelExpensePayrollRunInclusion.state,
		})
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.payrollExportJobId, jobId),
			),
		)
		.orderBy(asc(travelExpensePayrollRunInclusion.reportId));
	// An export that never was a payroll run.
	if (inclusions.length === 0) return { status: "not_found" };

	const timezone = await loadOrganizationTimezone(database, organizationId);
	const today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
	const reference = payrollRunReference(run);
	const shared = parseSettlementPayment(
		{ occurredOn: input.payday ?? defaultPayday(run.periodEnd, today), reference, note: null },
		{ latestDate: latestCalendarDate(now) },
	);
	if (!shared.ok) return { status: "invalid", errors: shared.errors };
	const { payment } = shared;

	const rows: PayrollRunConfirmationRow[] = [];
	for (const inclusion of inclusions.filter((candidate) => candidate.state === "included")) {
		const source: SettlementSource = { type: "report", id: inclusion.reportId };
		const idempotencyKey = payrollRunConfirmationKey(jobId, inclusion.reportId);
		try {
			const confirmed = await database.transaction((tx) =>
				confirmInclusion(tx, {
					actor,
					scope: input.scope,
					inclusionId: inclusion.id,
					source,
					jobId,
					idempotencyKey,
					payment,
					now,
				}),
			);
			if (!confirmed) continue;
			rows.push(confirmed.row);
			// After commit, as `recordSettlementEntry` does: never for a replay.
			if (confirmed.recorded && !confirmed.recorded.replayed) {
				await notifySettlementRecorded(database, {
					account: confirmed.recorded.account,
					entry: confirmed.recorded.entry,
					idempotencyKey,
				});
			}
		} catch (error) {
			logger.error(
				{ error, organizationId, jobId, reportId: inclusion.reportId },
				"Failed to confirm a report of a payroll run",
			);
			rows.push({
				reportId: inclusion.reportId,
				employeeName: null,
				outcome: "failed",
				frozenAmount: "0.00",
				amount: null,
				overpaid: null,
				remaining: null,
			});
		}
	}
	return { status: "processed", rows };
}

/**
 * One report under its row lock: the inclusion is read again, so a report a
 * concurrent confirmation or removal ended is skipped (null).
 */
async function confirmInclusion(
	tx: Transaction,
	input: {
		actor: SettlementActor;
		scope: OfficerScope;
		inclusionId: string;
		source: SettlementSource;
		jobId: string;
		idempotencyKey: string;
		payment: SettlementPayment;
		now: Instant;
	},
): Promise<{
	row: PayrollRunConfirmationRow;
	recorded: Extract<RecordSettlementResult, { status: "recorded" }> | null;
} | null> {
	const { actor, source, now } = input;
	const { organizationId } = actor;
	// The report row first: the lock every settlement write and every inclusion change takes.
	const account = await loadSettlementAccount(tx, { organizationId, source }, { lock: true });
	if (!account) return null;
	const [inclusion] = await tx
		.select({ lines: travelExpensePayrollRunInclusion.lines })
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.id, input.inclusionId),
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
			),
		)
		.limit(1)
		.for("update");
	if (!inclusion) return null;
	const frozen = frozenTotal(inclusion.lines);
	const row = (
		outcome: PayrollRunConfirmationOutcome,
		values: Partial<Pick<PayrollRunConfirmationRow, "amount" | "overpaid" | "remaining">> = {},
	): PayrollRunConfirmationRow => ({
		reportId: source.id,
		employeeName: account.employeeName,
		outcome,
		frozenAmount: text(frozen),
		amount: values.amount ?? null,
		overpaid: values.overpaid ?? null,
		remaining: values.remaining ?? null,
	});

	const inScope = await isSourceInOfficerScope(tx, input.scope, {
		organizationId,
		source,
		employeeId: account.employeeId,
	});
	if (!inScope) return { row: row("out_of_scope"), recorded: null };
	if (account.employeeId === actor.employeeId) return { row: row("own_expense"), recorded: null };

	// Payroll paid the frozen amount: it is recorded in full (decision 11). When an
	// adjustment lowered what is owed since the export, the balance goes negative,
	// the account shows as overpaid and an officer records the recovery by hand.
	const line = account.summary.currencies.find((entry) => entry.currency === PAYROLL_CURRENCY);
	const balance = line ? units(line.balance) : ZERO;
	const owed = balance > ZERO ? balance : ZERO;
	const overpaid = frozen > owed ? frozen - owed : ZERO;
	const result = await recordSettlementEntryInTransaction(
		tx,
		{
			actor,
			scope: input.scope,
			source,
			idempotencyKey: input.idempotencyKey,
			command: {
				kind: "reimbursement",
				amount: text(frozen),
				currency: PAYROLL_CURRENCY,
				...input.payment,
			},
			// Read under the same lock, so it can only be stale if the lock is broken.
			expectedBalance: { currency: PAYROLL_CURRENCY, amount: text(balance) },
			payrollRunId: input.jobId,
		},
		now,
	);
	if (result.status !== "recorded") {
		logger.warn(
			{ organizationId, jobId: input.jobId, reportId: source.id, status: result.status },
			"A payroll run's report could not be recorded as reimbursed",
		);
		return {
			row: row(result.status === "own_expense" ? "own_expense" : "failed"),
			recorded: null,
		};
	}
	const endedAt = dateFromInstant(now);
	await tx
		.update(travelExpensePayrollRunInclusion)
		.set({ state: "confirmed", endedAt, endedByUserId: actor.userId })
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.id, input.inclusionId),
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
			),
		);
	await tx.insert(auditLog).values({
		organizationId,
		entityType: "travel_expense_report",
		entityId: source.id,
		action: AuditAction.TRAVEL_EXPENSE_PAYROLL_RUN_REPORT_CONFIRMED,
		performedBy: actor.userId,
		changes: JSON.stringify({
			payrollExportJobId: input.jobId,
			entryId: result.entry.id,
			amount: result.entry.amount,
			currency: PAYROLL_CURRENCY,
			occurredOn: input.payment.occurredOn,
			overpaid: overpaid > ZERO ? text(overpaid) : null,
		}),
		timestamp: endedAt,
	});
	const after = result.account.summary.currencies.find(
		(entry) => entry.currency === PAYROLL_CURRENCY,
	);
	return {
		row: row(overpaid > ZERO ? "overpaid_by_payroll" : "confirmed", {
			amount: result.entry.amount,
			overpaid: overpaid > ZERO ? text(overpaid) : null,
			remaining: after?.state === "outstanding" ? after.balance : null,
		}),
		recorded: result,
	};
}

export interface PayrollRunToConfirm {
	jobId: string;
	formatName: string;
	periodStart: string;
	periodEnd: string;
	exportedAt: string;
	/** The reports the run still includes. */
	includedReports: number;
	/** Those the reader may confirm: in their scope and not their own. */
	confirmableReports: number;
	/** What the run carries for the confirmable reports, in EUR. */
	confirmableAmount: string;
	/** The payday a confirmation records unless the reader picks one. */
	defaultPayday: string;
}

/**
 * The organization's unconfirmed payroll runs that include a report the
 * reader may confirm, most recently exported first.
 */
export async function listPayrollRunsToConfirm(
	database: Database,
	input: { organizationId: string; scope: OfficerScope; actorEmployeeId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<PayrollRunToConfirm[]> {
	const { organizationId } = input;
	const rows = await database
		.select({
			jobId: travelExpensePayrollRunInclusion.payrollExportJobId,
			reportId: travelExpensePayrollRunInclusion.reportId,
			employeeId: travelExpensePayrollRunInclusion.employeeId,
			lines: travelExpensePayrollRunInclusion.lines,
		})
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
			),
		);
	if (rows.length === 0) return [];
	const reportIds = [...new Set(rows.map((row) => row.reportId))];
	const inScope = new Set(
		(
			await database
				.select({ id: travelExpenseReport.id })
				.from(travelExpenseReport)
				.where(
					and(
						eq(travelExpenseReport.organizationId, organizationId),
						inArray(travelExpenseReport.id, reportIds),
						reportInOfficerScope(input.scope),
					),
				)
		).map((report) => report.id),
	);
	const timezone = await loadOrganizationTimezone(database, organizationId);
	const today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
	const runs = new Map<string, { included: number; confirmable: number; amount: bigint }>();
	for (const row of rows) {
		const run = runs.get(row.jobId) ?? { included: 0, confirmable: 0, amount: ZERO };
		run.included += 1;
		if (inScope.has(row.reportId) && row.employeeId !== input.actorEmployeeId) {
			run.confirmable += 1;
			run.amount += frozenTotal(row.lines);
		}
		runs.set(row.jobId, run);
	}
	const confirmable = [...runs.entries()].filter(([, run]) => run.confirmable > 0);
	if (confirmable.length === 0) return [];
	const headers = await database
		.select({
			jobId: payrollExportJob.id,
			filters: payrollExportJob.filters,
			createdAt: payrollExportJob.createdAt,
			formatName: payrollExportFormat.name,
		})
		.from(payrollExportJob)
		.innerJoin(payrollExportConfig, eq(payrollExportConfig.id, payrollExportJob.configId))
		.innerJoin(payrollExportFormat, eq(payrollExportFormat.id, payrollExportConfig.formatId))
		.where(
			and(
				eq(payrollExportJob.organizationId, organizationId),
				inArray(
					payrollExportJob.id,
					confirmable.map(([jobId]) => jobId),
				),
			),
		);
	return headers
		.flatMap((header): PayrollRunToConfirm[] => {
			const run = runs.get(header.jobId);
			if (!run) return [];
			return [
				{
					jobId: header.jobId,
					formatName: header.formatName,
					periodStart: header.filters.dateRange.start,
					periodEnd: header.filters.dateRange.end,
					exportedAt: instantToCanonicalString(instantFromDate(header.createdAt)),
					includedReports: run.included,
					confirmableReports: run.confirmable,
					confirmableAmount: text(run.amount),
					defaultPayday: defaultPayday(header.filters.dateRange.end, today),
				},
			];
		})
		.toSorted((left, right) => right.exportedAt.localeCompare(left.exportedAt));
}
