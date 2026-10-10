import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	payrollExportConfig,
	payrollExportJob,
	type TravelExpensePayrollRunInclusionLine,
	travelExpenseClaim,
	travelExpensePayrollRunInclusion,
	travelExpenseReport,
} from "@/db/schema";
import { loadTravelExpenseReportSubmittedRevisions } from "@/lib/approvals/evidence/travel-expense-report-store";
import { AuditAction } from "@/lib/audit-logger";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { formatUnits, parseUnits } from "@/lib/money/exact-decimal";
import { getExpenseWageTypeMappings } from "@/lib/payroll-export/expense-wage-type";
import {
	type ExpensePayrollFormat,
	isExpensePayrollFormat,
} from "@/lib/payroll-export/expense-wage-type.types";
import type { ExpenseLineData } from "@/lib/payroll-export/types";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { latestApprovedAdjustment, loadApprovedAdjustments } from "./adjustment-read";
import { isAwaitingReimbursement } from "./finance-queue-store";
import { STORED_AMOUNT_SCALE } from "./money";
import type { OfficerScope } from "./officer-scope";
import { isSourceInOfficerScope } from "./officer-scope-read";
import type { PayrollRevision } from "./payroll-lines";
import {
	classifyPayrollRunCandidate,
	type PayrollRunClassification,
	type PayrollRunSkip,
} from "./payroll-run-classification";
import { notifyReportsLeftOutOfPayrollRun } from "./ready-for-reimbursement";
import { paysThroughPayrollRuns } from "./reimbursement-channel";
import {
	buildSettlementAccounts,
	type SettlementAccount,
	type SettlementActor,
	type SettlementSource,
} from "./settlement-store";

/**
 * Payroll runs (#852, ADR 0003). With the payroll reimbursement channel, a
 * payroll file export is a payroll run: it takes the reports awaiting
 * reimbursement of the employees it covers, freezes their payroll lines with
 * the wage-type codes of its format, and its file carries them as money lines.
 * It records no reimbursement; until the run is confirmed (#853), an included
 * report cannot be reimbursed any other way.
 *
 * Every write here locks the reports' rows first, the lock every settlement
 * write takes, so including, removing and recording money never interleave.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export type { PayrollRunSkip, PayrollRunSkipReason } from "./payroll-run-classification";

/** A report or legacy claim awaiting reimbursement that a run does not take, and why. */
export type PayrollRunSkipped = PayrollRunSkip & { source: SettlementSource; employeeId: string };

export interface PayrollRunInclusionResult {
	/** The money lines the run's file carries, one per employee and wage type. */
	expenseLines: ExpenseLineData[];
	includedReportIds: string[];
	skipped: PayrollRunSkipped[];
}

/** One report or legacy claim awaiting reimbursement in a run's scope, and what the run does with it. */
export interface PayrollRunCandidate {
	account: SettlementAccount;
	classification: PayrollRunClassification;
}

const EMPTY_RESULT: PayrollRunInclusionResult = {
	expenseLines: [],
	includedReportIds: [],
	skipped: [],
};

/**
 * Whether an export of `formatId` is a payroll run: a file format that carries
 * expense lines, for an organization paying with the payroll run while it
 * passes the preview gate. API connectors and bank transfer never are.
 */
export async function exportIsPayrollRun(
	database: Executor,
	input: { organizationId: string; formatId: string },
): Promise<boolean> {
	if (!isExpensePayrollFormat(input.formatId)) return false;
	return paysThroughPayrollRuns(database, input.organizationId);
}

export { paysThroughPayrollRuns };

/**
 * Every report and legacy claim awaiting reimbursement in a run's scope, each
 * with what a run of `format` does with it: awaiting reimbursement, approved
 * on or before the period's last day (in the organization's zone), and of an
 * employee of `employeeIds`. Approved adjustment reports have no account of
 * their own and are not candidates. The export includes exactly the candidates
 * it classifies `include`; payroll readiness (#854) lists exactly the others.
 *
 * With `lock`, the reports' rows are locked first, in a fixed order: the lock
 * every settlement write takes.
 */
export async function classifyPayrollRunCandidates(
	database: Executor,
	input: {
		organizationId: string;
		format: string;
		period: { startDate: string; endDate: string };
		employeeIds: readonly string[];
	},
	options: { lock?: boolean } = {},
): Promise<PayrollRunCandidate[]> {
	const { organizationId, period } = input;
	if (input.employeeIds.length === 0) return [];
	const employeeIds = [...input.employeeIds];
	const reportQuery = database
		.select({ row: travelExpenseReport })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.organizationId, organizationId),
				eq(travelExpenseReport.status, "approved"),
				inArray(travelExpenseReport.employeeId, employeeIds),
			),
		)
		.orderBy(asc(travelExpenseReport.id));
	const [reports, claims] = await Promise.all([
		options.lock ? reportQuery.for("update") : reportQuery,
		database
			.select({ row: travelExpenseClaim })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.organizationId, organizationId),
					eq(travelExpenseClaim.status, "approved"),
					inArray(travelExpenseClaim.employeeId, employeeIds),
				),
			)
			.orderBy(asc(travelExpenseClaim.id)),
	]);

	const accounts = await buildSettlementAccounts(
		database,
		organizationId,
		reports.map(({ row }) => ({ row, employeeName: null })),
		claims.map(({ row }) => ({ row, employeeName: null })),
	);
	const periodEnd = await periodEndExclusive(database, organizationId, period.endDate);
	const awaiting = accounts.filter(
		(account) =>
			account.approved &&
			account.adjustmentOf === null &&
			account.basis?.approvedAt &&
			compareInstants(parseInstant(account.basis.approvedAt), periodEnd) < 0 &&
			isAwaitingReimbursement(account),
	);
	if (awaiting.length === 0) return [];

	const awaitingReports = awaiting.filter((account) => account.source.type === "report");
	const [revisions, codes] = await Promise.all([
		latestApprovedRevisions(database, {
			organizationId,
			reports: awaitingReports.map((account) => ({
				reportId: account.source.id,
				revisionId: account.basis?.revisionId ?? "",
				submissionCycle: account.basis?.submissionCycle ?? 0,
			})),
		}),
		isExpensePayrollFormat(input.format)
			? wageTypeCodes(database, organizationId, input.format)
			: new Map<string, string>(),
	]);

	return awaiting.map((account) => {
		let revision: { id: string; facts: PayrollRevision } | null = null;
		if (account.source.type === "report") {
			const loaded = revisions.get(account.source.id);
			if (!loaded) throw new Error(`Approved revision of report ${account.source.id} not readable`);
			revision = { id: loaded.id, facts: loaded.facts };
		}
		return {
			account,
			classification: classifyPayrollRunCandidate({
				account,
				revision,
				format: input.format,
				period,
				codes,
				// What earlier confirmed runs carried (#853, decision 17).
				priorLines: account.confirmedPayrollRuns.flatMap((run) =>
					run.lines.map(({ kind, amount, currency }) => ({ kind, amount, currency })),
				),
			}),
		};
	});
}

/**
 * Includes in the run of `jobId` every report that awaits reimbursement, was
 * approved on or before the period's last day (in the organization's zone),
 * belongs to an employee of `employeeIds` and is not included in an
 * unconfirmed run of another period. Each is passed to `computePayrollLines`;
 * only reports whose every line kind is mapped are included. Which ones is
 * decided by `classifyPayrollRunCandidates`, as payroll readiness decides it.
 *
 * Exporting the same period again moves to this run the reports earlier
 * unconfirmed runs of that period included for these employees: their
 * inclusions there are superseded. A report this run cannot take (its kinds
 * are no longer mapped, say) stays in the earlier run rather than in none, so
 * it is never freed for a bank transfer while a payroll file may still pay
 * it. A retried export of the same job first discards what it included before.
 *
 * Runs inside the caller's transaction, so the inclusions commit with the
 * file the caller writes from the returned lines, or not at all.
 */
export async function includeReportsInPayrollRun(
	tx: Transaction,
	input: {
		organizationId: string;
		jobId: string;
		format: ExpensePayrollFormat;
		period: { startDate: string; endDate: string };
		employeeIds: readonly string[];
	},
	now: Instant = systemClock.nowInstant(),
): Promise<PayrollRunInclusionResult> {
	const { organizationId, jobId, period } = input;
	const endedAt = dateFromInstant(now);
	await tx
		.update(travelExpensePayrollRunInclusion)
		.set({ state: "discarded", endedAt })
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.payrollExportJobId, jobId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
			),
		);
	const candidates = await classifyPayrollRunCandidates(
		tx,
		{ organizationId, format: input.format, period, employeeIds: input.employeeIds },
		{ lock: true },
	);
	if (candidates.length === 0) return EMPTY_RESULT;

	const skipped: PayrollRunSkipped[] = [];
	const included: Array<{
		reportId: string;
		employeeId: string;
		basisRevisionId: string;
		lines: TravelExpensePayrollRunInclusionLine[];
	}> = [];
	// Reports an earlier unconfirmed run of the same period holds, which this run takes over.
	const takenOver: string[] = [];
	for (const { account, classification } of candidates) {
		if (classification.outcome === "skip") {
			skipped.push({
				...classification.skip,
				source: account.source,
				employeeId: account.employeeId,
			});
			continue;
		}
		const reportId = account.source.id;
		if (classification.takesOver) takenOver.push(reportId);
		included.push({
			reportId,
			employeeId: account.employeeId,
			basisRevisionId: classification.basisRevisionId,
			lines: classification.lines,
		});
	}
	if (takenOver.length > 0) {
		// Superseded before the new rows exist: a report is never included twice.
		await tx
			.update(travelExpensePayrollRunInclusion)
			.set({ state: "superseded", endedAt, supersededByJobId: jobId })
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.state, "included"),
					inArray(travelExpensePayrollRunInclusion.reportId, takenOver),
				),
			);
	}
	if (included.length > 0) {
		await tx.insert(travelExpensePayrollRunInclusion).values(
			included.map((inclusion) => ({
				organizationId,
				payrollExportJobId: jobId,
				...inclusion,
				includedAt: endedAt,
			})),
		);
	}
	return {
		expenseLines: await expenseLines(tx, organizationId, included, period.endDate),
		includedReportIds: included.map((inclusion) => inclusion.reportId),
		skipped,
	};
}

/** The instant the period's last day ends in the organization's zone. */
async function periodEndExclusive(
	tx: Executor,
	organizationId: string,
	endDate: string,
): Promise<Instant> {
	const timezone = await loadOrganizationTimezone(tx, organizationId);
	return localDayRange(endDate, timezone).endExclusive;
}

/**
 * Each report's latest approved revision: the latest approved adjustment's,
 * which holds the whole corrected report, else the original's.
 */
async function latestApprovedRevisions(
	tx: Executor,
	input: {
		organizationId: string;
		reports: ReadonlyArray<{ reportId: string; revisionId: string; submissionCycle: number }>;
	},
) {
	const adjustments = await loadApprovedAdjustments(tx, {
		organizationId: input.organizationId,
		originalReportIds: input.reports.map((report) => report.reportId),
	});
	const sources = new Map(
		input.reports.map((report) => {
			const latest = latestApprovedAdjustment(adjustments.get(report.reportId) ?? []);
			return [
				report.reportId,
				latest
					? { reportId: latest.reportId, submissionCycle: latest.submissionCycle }
					: { reportId: report.reportId, submissionCycle: report.submissionCycle },
			];
		}),
	);
	const loaded = await loadTravelExpenseReportSubmittedRevisions(tx, {
		organizationId: input.organizationId,
		cycles: [...sources.values()],
	});
	return new Map(
		[...sources.entries()].flatMap(([reportId, source]) => {
			const revision = loaded.get(source.reportId);
			return revision ? [[reportId, revision] as const] : [];
		}),
	);
}

async function wageTypeCodes(
	tx: Executor,
	organizationId: string,
	format: ExpensePayrollFormat,
): Promise<Map<string, string>> {
	const mappings = await getExpenseWageTypeMappings(organizationId, { database: tx });
	return new Map(
		mappings.flatMap((mapping) => {
			const code = mapping.codes[format];
			return code ? [[mapping.kind, code] as const] : [];
		}),
	);
}

/** One money line per employee and wage type, summed over the included reports. */
async function expenseLines(
	tx: Transaction,
	organizationId: string,
	included: ReadonlyArray<{ employeeId: string; lines: TravelExpensePayrollRunInclusionLine[] }>,
	date: string,
): Promise<ExpenseLineData[]> {
	if (included.length === 0) return [];
	const totals = new Map<string, { employeeId: string; wageTypeCode: string; units: bigint }>();
	for (const inclusion of included) {
		for (const line of inclusion.lines) {
			const key = `${inclusion.employeeId}\u0000${line.wageTypeCode}`;
			const units = parseUnits(line.amount, STORED_AMOUNT_SCALE);
			if (units === null) throw new RangeError(`Not a stored amount: ${line.amount}`);
			const total = totals.get(key) ?? {
				employeeId: inclusion.employeeId,
				wageTypeCode: line.wageTypeCode,
				units: BigInt(0),
			};
			total.units += units;
			totals.set(key, total);
		}
	}
	const people = await tx
		.select({
			id: employee.id,
			employeeNumber: employee.employeeNumber,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				inArray(employee.id, [...new Set(included.map((inclusion) => inclusion.employeeId))]),
			),
		);
	const byId = new Map(people.map((person) => [person.id, person]));
	return [...totals.values()].map((total) => {
		const person = byId.get(total.employeeId);
		return {
			employeeId: total.employeeId,
			employeeNumber: person?.employeeNumber ?? null,
			email: person?.email ?? null,
			firstName: person?.firstName ?? null,
			lastName: person?.lastName ?? null,
			wageTypeCode: total.wageTypeCode,
			amount: formatUnits(total.units, STORED_AMOUNT_SCALE),
			currency: "EUR",
			date,
		};
	});
}

/** How many reports each of the jobs' runs still includes; jobs without any are absent. */
export async function countIncludedReportsByRun(
	database: Executor,
	input: { organizationId: string; jobIds: readonly string[] },
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	if (input.jobIds.length === 0) return counts;
	const rows = await database
		.select({ jobId: travelExpensePayrollRunInclusion.payrollExportJobId })
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, input.organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
				inArray(travelExpensePayrollRunInclusion.payrollExportJobId, [...input.jobIds]),
			),
		);
	for (const { jobId } of rows) counts.set(jobId, (counts.get(jobId) ?? 0) + 1);
	return counts;
}

export interface UnconfirmedPayrollRun {
	jobId: string;
	formatId: string;
	periodStart: string;
	periodEnd: string;
	exportedAt: string;
	includedReports: number;
	/** The employees whose reports the run includes. */
	employeeIds: string[];
	/** Confirmed as paid for some report (#853): final, so it can no longer be discarded. */
	partlyConfirmed: boolean;
}

/** The organization's unconfirmed payroll runs, most recently exported first. */
export async function listUnconfirmedPayrollRuns(
	database: Executor,
	organizationId: string,
): Promise<UnconfirmedPayrollRun[]> {
	const rows = await database
		.select({
			jobId: travelExpensePayrollRunInclusion.payrollExportJobId,
			employeeId: travelExpensePayrollRunInclusion.employeeId,
			filters: payrollExportJob.filters,
			createdAt: payrollExportJob.createdAt,
			formatId: payrollExportConfig.formatId,
		})
		.from(travelExpensePayrollRunInclusion)
		.innerJoin(
			payrollExportJob,
			and(
				eq(payrollExportJob.id, travelExpensePayrollRunInclusion.payrollExportJobId),
				eq(payrollExportJob.organizationId, travelExpensePayrollRunInclusion.organizationId),
			),
		)
		.innerJoin(payrollExportConfig, eq(payrollExportConfig.id, payrollExportJob.configId))
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
			),
		);
	const runs = new Map<string, UnconfirmedPayrollRun>();
	for (const row of rows) {
		const run = runs.get(row.jobId) ?? {
			jobId: row.jobId,
			formatId: row.formatId,
			periodStart: row.filters.dateRange.start,
			periodEnd: row.filters.dateRange.end,
			exportedAt: instantToCanonicalString(instantFromDate(row.createdAt)),
			includedReports: 0,
			employeeIds: [],
			partlyConfirmed: false,
		};
		run.includedReports += 1;
		if (!run.employeeIds.includes(row.employeeId)) run.employeeIds.push(row.employeeId);
		runs.set(row.jobId, run);
	}
	if (runs.size > 0) {
		const confirmed = await database
			.selectDistinct({ jobId: travelExpensePayrollRunInclusion.payrollExportJobId })
			.from(travelExpensePayrollRunInclusion)
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.state, "confirmed"),
					inArray(travelExpensePayrollRunInclusion.payrollExportJobId, [...runs.keys()]),
				),
			);
		for (const { jobId } of confirmed) {
			const run = runs.get(jobId);
			if (run) run.partlyConfirmed = true;
		}
	}
	return [...runs.values()].toSorted((left, right) =>
		right.exportedAt.localeCompare(left.exportedAt),
	);
}

export type DiscardPayrollRunResult =
	| { status: "discarded"; reportIds: string[] }
	/** The run includes no report (any more): nothing to discard. */
	| { status: "not_found" }
	/** It includes reports of employees outside the actor's payroll scope. */
	| { status: "out_of_scope" }
	/**
	 * Confirmed as paid for some report (#853): a confirmed run is final. Its
	 * remaining reports can still be removed one by one.
	 */
	| { status: "confirmed" };

/**
 * Discards an unconfirmed payroll run: every report it still includes is
 * free again for the next export or a bank-transfer reimbursement. Whoever may
 * start payroll exports may discard: administrators any run (`"all"`), a
 * payroll access holder a run of employees in their payroll scope only.
 * Audited in the same transaction.
 */
export async function discardPayrollRun(
	database: Database,
	input: {
		organizationId: string;
		jobId: string;
		actorUserId: string;
		employeeScope: "all" | readonly string[];
	},
	now: Instant = systemClock.nowInstant(),
): Promise<DiscardPayrollRunResult> {
	const { organizationId, jobId } = input;
	const result = await database.transaction(async (tx): Promise<DiscardPayrollRunResult> => {
		const held = await tx
			.select({
				id: travelExpensePayrollRunInclusion.id,
				reportId: travelExpensePayrollRunInclusion.reportId,
				employeeId: travelExpensePayrollRunInclusion.employeeId,
			})
			.from(travelExpensePayrollRunInclusion)
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.payrollExportJobId, jobId),
					eq(travelExpensePayrollRunInclusion.state, "included"),
				),
			)
			.orderBy(asc(travelExpensePayrollRunInclusion.id))
			.for("update");
		if (held.length === 0) return { status: "not_found" };
		const [confirmed] = await tx
			.select({ id: travelExpensePayrollRunInclusion.id })
			.from(travelExpensePayrollRunInclusion)
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.payrollExportJobId, jobId),
					eq(travelExpensePayrollRunInclusion.state, "confirmed"),
				),
			)
			.limit(1);
		if (confirmed) return { status: "confirmed" };
		const scope = input.employeeScope;
		if (scope !== "all" && !held.every((inclusion) => scope.includes(inclusion.employeeId))) {
			return { status: "out_of_scope" };
		}
		const endedAt = dateFromInstant(now);
		await tx
			.update(travelExpensePayrollRunInclusion)
			.set({ state: "discarded", endedAt, endedByUserId: input.actorUserId })
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					inArray(
						travelExpensePayrollRunInclusion.id,
						held.map((inclusion) => inclusion.id),
					),
				),
			);
		const reportIds = held.map((inclusion) => inclusion.reportId);
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "payroll_export_job",
			entityId: jobId,
			action: AuditAction.PAYROLL_RUN_DISCARDED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({ reportIds }),
			timestamp: endedAt,
		});
		return { status: "discarded", reportIds };
	});
	if (result.status === "discarded") {
		// Freed reports may need a bank transfer now (#855).
		await notifyReportsLeftOutOfPayrollRun(database, {
			organizationId,
			reportIds: result.reportIds,
			exceptUserId: input.actorUserId,
		});
	}
	return result;
}

export type RemoveFromPayrollRunResult =
	| { status: "removed"; jobId: string }
	/** Not a report of the organization in the actor's reimbursement scope. */
	| { status: "not_found" }
	/** No unconfirmed run includes it. */
	| { status: "not_included" };

/**
 * Takes one report out of the unconfirmed run that includes it, so it can be
 * paid by bank transfer or taken by the next export. For officers who record
 * reimbursements (`scope` is their reimbursement scope), owners and admins.
 * Audited in the same transaction.
 */
export async function removeReportFromPayrollRun(
	database: Database,
	input: { actor: SettlementActor; scope: OfficerScope; reportId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<RemoveFromPayrollRunResult> {
	const { actor, reportId } = input;
	const { organizationId } = actor;
	const result = await database.transaction(async (tx): Promise<RemoveFromPayrollRunResult> => {
		const [report] = await tx
			.select({ employeeId: travelExpenseReport.employeeId })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, reportId),
					eq(travelExpenseReport.organizationId, organizationId),
				),
			)
			.limit(1)
			.for("update");
		if (!report) return { status: "not_found" };
		const inScope = await isSourceInOfficerScope(tx, input.scope, {
			organizationId,
			source: { type: "report", id: reportId },
			employeeId: report.employeeId,
		});
		if (!inScope) return { status: "not_found" };
		const endedAt = dateFromInstant(now);
		const [removed] = await tx
			.update(travelExpensePayrollRunInclusion)
			.set({ state: "removed", endedAt, endedByUserId: actor.userId })
			.where(
				and(
					eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
					eq(travelExpensePayrollRunInclusion.reportId, reportId),
					eq(travelExpensePayrollRunInclusion.state, "included"),
				),
			)
			.returning({ jobId: travelExpensePayrollRunInclusion.payrollExportJobId });
		if (!removed) return { status: "not_included" };
		await tx.insert(auditLog).values({
			organizationId,
			entityType: "travel_expense_report",
			entityId: reportId,
			action: AuditAction.TRAVEL_EXPENSE_PAYROLL_RUN_REPORT_REMOVED,
			performedBy: actor.userId,
			changes: JSON.stringify({ payrollExportJobId: removed.jobId }),
			timestamp: endedAt,
		});
		return { status: "removed", jobId: removed.jobId };
	});
	if (result.status === "removed") {
		// The report may need a bank transfer now (#855); its remover knows.
		await notifyReportsLeftOutOfPayrollRun(database, {
			organizationId,
			reportIds: [reportId],
			exceptUserId: actor.userId,
		});
	}
	return result;
}
