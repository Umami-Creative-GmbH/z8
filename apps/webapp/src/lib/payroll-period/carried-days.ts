import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { payrollExportCarriedDay } from "@/db/schema";
import type { CollectedPayrollWork } from "@/lib/payroll-collection/payroll-work-collection";
import { loadPeriodSources } from "./legacy-sources";
import { buildPayrollPeriodRows } from "./period-rows";
import { settledDayValues } from "./settlement-values";
import type { PayrollPeriodEmployee, PayrollSettledDayValues } from "./types";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * One employee-day a payroll file carried, with the values it carried (#1899): its
 * credited minutes and approved absences, read like a settled day's copy. Confirming
 * the export as paid settles exactly these days with exactly these values.
 */
export interface PayrollCarriedDay extends PayrollSettledDayValues {
	employeeId: string;
	/** Employee-local calendar date. */
	date: string;
	timezone: string;
}

/**
 * The employee-days a file of the period and employees carries, by the same day
 * attribution as the Days tab: every period day of each employee, with zero-minute days
 * too, so work added to such a day later is changed since settled, never paid silently.
 *
 * `collectedWork` is the work the file was built from under scoped collection (#322);
 * without it the work is read as the legacy export reads it.
 *
 * #1898 leaves settled and changed-since-settled days out of the file; it filters the
 * same days out of this list, so a confirmation only settles what the file paid.
 */
export async function readExportCarriedDays(input: {
	organizationId: string;
	startDate: string;
	endDate: string;
	employeeIds: readonly string[];
	collectedWork?: readonly Pick<
		CollectedPayrollWork,
		"recordId" | "employeeId" | "startAt" | "endExclusive" | "minutes"
	>[];
}): Promise<PayrollCarriedDay[]> {
	if (input.employeeIds.length === 0) return [];
	const { sources } = await loadPeriodSources(input.organizationId, input.employeeIds, {
		startDate: input.startDate,
		endDate: input.endDate,
		label: `${input.startDate} – ${input.endDate}`,
	});
	const rows = buildPayrollPeriodRows({
		period: { startDate: input.startDate, endDate: input.endDate },
		employees: sources.employees,
		work: input.collectedWork
			? input.collectedWork.map((line) => ({
					recordId: line.recordId,
					employeeId: line.employeeId,
					startAt: Temporal.Instant.from(line.startAt),
					endExclusive: Temporal.Instant.from(line.endExclusive),
					minutes: line.minutes,
				}))
			: sources.work,
		absences: sources.absences,
	});
	return carriedDaysOf(rows.employees);
}

/**
 * Each employee's period days as carried values. For an employee who left (#1894), the
 * empty days after the last working day are not carried: the file pays nothing for them.
 */
export function carriedDaysOf(employees: readonly PayrollPeriodEmployee[]): PayrollCarriedDay[] {
	return employees.flatMap((employee) =>
		employee.days.flatMap((day) => {
			const values = settledDayValues(day);
			const afterLeaving =
				employee.departure != null && day.date > employee.departure.lastWorkingDay;
			if (afterLeaving && values.creditedMinutes === 0 && values.absences.length === 0) return [];
			return [{ employeeId: employee.id, date: day.date, timezone: employee.timezone, ...values }];
		}),
	);
}

/** Records what a completed file carried, in the transaction that completes the job. */
export async function insertExportCarriedDays(
	tx: Pick<Database, "insert"> | Pick<Transaction, "insert">,
	input: { organizationId: string; jobId: string; days: readonly PayrollCarriedDay[] },
): Promise<void> {
	if (input.days.length === 0) return;
	await tx
		.insert(payrollExportCarriedDay)
		.values(
			input.days.map((day) => ({
				organizationId: input.organizationId,
				jobId: input.jobId,
				employeeId: day.employeeId,
				date: day.date,
				timezone: day.timezone,
				creditedMinutes: day.creditedMinutes,
				absences: day.absences,
			})),
		)
		// A retried job carries the same days; the first record stays.
		.onConflictDoNothing();
}

/** The employee-days an export carried, organization-scoped. */
export async function loadExportCarriedDays(
	database: Pick<Database, "select"> | Pick<Transaction, "select">,
	input: { organizationId: string; jobId: string },
): Promise<PayrollCarriedDay[]> {
	return database
		.select({
			employeeId: payrollExportCarriedDay.employeeId,
			date: payrollExportCarriedDay.date,
			timezone: payrollExportCarriedDay.timezone,
			creditedMinutes: payrollExportCarriedDay.creditedMinutes,
			absences: payrollExportCarriedDay.absences,
		})
		.from(payrollExportCarriedDay)
		.where(
			and(
				eq(payrollExportCarriedDay.organizationId, input.organizationId),
				eq(payrollExportCarriedDay.jobId, input.jobId),
			),
		)
		.orderBy(asc(payrollExportCarriedDay.employeeId), asc(payrollExportCarriedDay.date));
}
