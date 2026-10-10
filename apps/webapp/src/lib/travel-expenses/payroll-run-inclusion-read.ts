import { and, asc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	payrollExportConfig,
	payrollExportFormat,
	payrollExportJob,
	type TravelExpensePayrollRunInclusionLine,
	travelExpensePayrollRunInclusion,
} from "@/db/schema";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";

/**
 * Which unconfirmed payroll run includes a report (#852): the check every
 * reimbursement path makes, and what officers see. One indexed read for any
 * number of reports; the partial unique index guarantees at most one run each.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** A payroll run as every list names it: its export job, format and period. */
export interface PayrollRunHeader {
	/** The payroll export job that is the run. */
	jobId: string;
	formatId: string;
	/** The file format's product name, e.g. "DATEV Lohn & Gehalt". */
	formatName: string;
	/** The payroll period, as logical dates. */
	periodStart: string;
	periodEnd: string;
	/** When the export job was created. */
	exportedAt: string;
}

/** The jobs' payroll runs of the organization, by job id; unknown jobs are absent. */
export async function loadPayrollRunHeaders(
	database: Executor,
	input: { organizationId: string; jobIds: readonly string[] },
): Promise<Map<string, PayrollRunHeader>> {
	const headers = new Map<string, PayrollRunHeader>();
	if (input.jobIds.length === 0) return headers;
	const rows = await database
		.select({
			jobId: payrollExportJob.id,
			filters: payrollExportJob.filters,
			createdAt: payrollExportJob.createdAt,
			formatId: payrollExportConfig.formatId,
			formatName: payrollExportFormat.name,
		})
		.from(payrollExportJob)
		.innerJoin(payrollExportConfig, eq(payrollExportConfig.id, payrollExportJob.configId))
		.innerJoin(payrollExportFormat, eq(payrollExportFormat.id, payrollExportConfig.formatId))
		.where(
			and(
				eq(payrollExportJob.organizationId, input.organizationId),
				inArray(payrollExportJob.id, [...new Set(input.jobIds)]),
			),
		);
	for (const row of rows) {
		headers.set(row.jobId, {
			jobId: row.jobId,
			formatId: row.formatId,
			formatName: row.formatName,
			periodStart: row.filters.dateRange.start,
			periodEnd: row.filters.dateRange.end,
			exportedAt: instantToCanonicalString(instantFromDate(row.createdAt)),
		});
	}
	return headers;
}

/** The run of payroll export job `jobId`; null when the organization has no such job. */
export async function loadPayrollRunHeader(
	database: Executor,
	input: { organizationId: string; jobId: string },
): Promise<PayrollRunHeader | null> {
	const headers = await loadPayrollRunHeaders(database, {
		organizationId: input.organizationId,
		jobIds: [input.jobId],
	});
	return headers.get(input.jobId) ?? null;
}

export interface IncludedPayrollRun extends Omit<PayrollRunHeader, "exportedAt"> {
	includedAt: string;
	/**
	 * Confirmed as paid for some other report (#853): payroll paid the run's
	 * file, so no later export takes its remaining reports over.
	 */
	partlyConfirmed: boolean;
}

/** The organization's payroll runs that still include a report: its unconfirmed runs. */
export async function countRunsIncludingReports(
	database: Pick<Database, "selectDistinct">,
	organizationId: string,
): Promise<number> {
	const rows = await database
		.selectDistinct({ jobId: travelExpensePayrollRunInclusion.payrollExportJobId })
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
			),
		);
	return rows.length;
}

/**
 * Whether a payroll run carries or carried any of the reports: an unconfirmed
 * run includes it, or a confirmed run paid it (#853). Such a report counts as
 * exported: a correction is an adjustment, never a reopen.
 */
export async function isCarriedByPayrollRun(
	database: Executor,
	input: { organizationId: string; reportIds: readonly string[] },
): Promise<boolean> {
	if (input.reportIds.length === 0) return false;
	const [row] = await database
		.select({ id: travelExpensePayrollRunInclusion.id })
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, input.organizationId),
				inArray(travelExpensePayrollRunInclusion.state, ["included", "confirmed"]),
				inArray(travelExpensePayrollRunInclusion.reportId, [...input.reportIds]),
			),
		)
		.limit(1);
	return Boolean(row);
}

/** A confirmed payroll run that paid a report (#853), as its account shows it. */
export interface ConfirmedPayrollRun extends Omit<PayrollRunHeader, "exportedAt"> {
	confirmedAt: string;
	/** The lines the run carried: what earlier payroll runs paid, per wage type (decision 17). */
	lines: TravelExpensePayrollRunInclusionLine[];
}

/** Each report's confirmed payroll runs, oldest confirmation first. */
export async function loadConfirmedPayrollRuns(
	database: Executor,
	input: { organizationId: string; reportIds: readonly string[] },
): Promise<Map<string, ConfirmedPayrollRun[]>> {
	const runs = new Map<string, ConfirmedPayrollRun[]>();
	if (input.reportIds.length === 0) return runs;
	const rows = await database
		.select({
			reportId: travelExpensePayrollRunInclusion.reportId,
			jobId: travelExpensePayrollRunInclusion.payrollExportJobId,
			confirmedAt: travelExpensePayrollRunInclusion.endedAt,
			lines: travelExpensePayrollRunInclusion.lines,
		})
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, input.organizationId),
				eq(travelExpensePayrollRunInclusion.state, "confirmed"),
				inArray(travelExpensePayrollRunInclusion.reportId, [...input.reportIds]),
			),
		)
		.orderBy(
			asc(travelExpensePayrollRunInclusion.endedAt),
			asc(travelExpensePayrollRunInclusion.id),
		);
	const headers = await loadPayrollRunHeaders(database, {
		organizationId: input.organizationId,
		jobIds: rows.map((row) => row.jobId),
	});
	for (const row of rows) {
		const header = headers.get(row.jobId);
		if (!header) continue;
		const list = runs.get(row.reportId) ?? [];
		list.push({
			jobId: row.jobId,
			formatId: header.formatId,
			formatName: header.formatName,
			periodStart: header.periodStart,
			periodEnd: header.periodEnd,
			// A confirmed inclusion always has its end (the ended check).
			confirmedAt: row.confirmedAt
				? instantToCanonicalString(instantFromDate(row.confirmedAt))
				: "",
			lines: row.lines,
		});
		runs.set(row.reportId, list);
	}
	return runs;
}

export async function loadIncludedPayrollRuns(
	database: Executor,
	input: { organizationId: string; reportIds: readonly string[] },
): Promise<Map<string, IncludedPayrollRun>> {
	const runs = new Map<string, IncludedPayrollRun>();
	if (input.reportIds.length === 0) return runs;
	const rows = await database
		.select({
			reportId: travelExpensePayrollRunInclusion.reportId,
			jobId: travelExpensePayrollRunInclusion.payrollExportJobId,
			includedAt: travelExpensePayrollRunInclusion.includedAt,
		})
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, input.organizationId),
				eq(travelExpensePayrollRunInclusion.state, "included"),
				inArray(travelExpensePayrollRunInclusion.reportId, [...input.reportIds]),
			),
		);
	const jobIds = [...new Set(rows.map((row) => row.jobId))];
	const [headers, partlyConfirmed] = await Promise.all([
		loadPayrollRunHeaders(database, { organizationId: input.organizationId, jobIds }),
		partlyConfirmedRuns(database, { organizationId: input.organizationId, jobIds }),
	]);
	for (const row of rows) {
		const header = headers.get(row.jobId);
		if (!header) continue;
		runs.set(row.reportId, {
			jobId: row.jobId,
			formatId: header.formatId,
			formatName: header.formatName,
			periodStart: header.periodStart,
			periodEnd: header.periodEnd,
			includedAt: instantToCanonicalString(instantFromDate(row.includedAt)),
			partlyConfirmed: partlyConfirmed.has(row.jobId),
		});
	}
	return runs;
}

/** Those of the jobs' runs confirmed as paid for at least one report (#853). */
export async function partlyConfirmedRuns(
	database: Executor,
	input: { organizationId: string; jobIds: readonly string[] },
): Promise<Set<string>> {
	if (input.jobIds.length === 0) return new Set();
	const rows = await database
		.selectDistinct({ jobId: travelExpensePayrollRunInclusion.payrollExportJobId })
		.from(travelExpensePayrollRunInclusion)
		.where(
			and(
				eq(travelExpensePayrollRunInclusion.organizationId, input.organizationId),
				eq(travelExpensePayrollRunInclusion.state, "confirmed"),
				inArray(travelExpensePayrollRunInclusion.payrollExportJobId, [...input.jobIds]),
			),
		);
	return new Set(rows.map((row) => row.jobId));
}
