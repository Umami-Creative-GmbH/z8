import "server-only";

import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { payrollSettledDay } from "@/db/schema";
import type { PayrollSettledDaySource } from "./types";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type SettledDaysReader = Pick<Database, "select"> | Pick<Transaction, "select">;

/**
 * The active settlements of the employees' days in the inclusive date range (#1896),
 * organization-scoped. Callers resolve the employees through the payroll access grant.
 * This is the read `settledDaysFor` (#1898) builds on.
 */
export async function loadActiveSettledDays(
	database: SettledDaysReader,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		startDate: string;
		endDate: string;
	},
): Promise<PayrollSettledDaySource[]> {
	if (input.employeeIds.length === 0) return [];
	const rows = await database
		.select({
			id: payrollSettledDay.id,
			employeeId: payrollSettledDay.employeeId,
			date: payrollSettledDay.date,
			method: payrollSettledDay.method,
			payrollExportJobId: payrollSettledDay.payrollExportJobId,
			settledAt: payrollSettledDay.settledAt,
			creditedMinutes: payrollSettledDay.creditedMinutes,
			absences: payrollSettledDay.absences,
		})
		.from(payrollSettledDay)
		.where(
			and(
				eq(payrollSettledDay.organizationId, input.organizationId),
				inArray(payrollSettledDay.employeeId, [...input.employeeIds]),
				gte(payrollSettledDay.date, input.startDate),
				lte(payrollSettledDay.date, input.endDate),
				isNull(payrollSettledDay.unsettledAt),
			),
		)
		.orderBy(asc(payrollSettledDay.employeeId), asc(payrollSettledDay.date));
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		date: row.date,
		method: row.method,
		payrollExportJobId: row.payrollExportJobId,
		settledAt: row.settledAt.toISOString(),
		paid: { creditedMinutes: row.creditedMinutes, absences: row.absences },
	}));
}
