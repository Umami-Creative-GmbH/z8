import "server-only";

import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { payrollSettledDay } from "@/db/schema";
import type { SettledDaysReader } from "./settled-days-store";

/** An employee-day with an active settlement, in the employee's timezone at settling. */
export interface PayrollSettledDayKey {
	employeeId: string;
	/** Employee-local calendar date. */
	date: string;
	timezone: string;
}

/**
 * The employee-days of the scope and period that payroll files leave out (#1898): every
 * day with an active settlement. A changed-since-settled day still has its settlement, so
 * it is left out too; the officer handles it through its blocker.
 *
 * Organization-scoped. The caller passes employees it already resolved, as the export
 * pipeline does for the file's employees.
 */
export async function settledDaysFor(
	organizationId: string,
	scope: { employeeIds: readonly string[] },
	period: { startDate: string; endDate: string },
	database: SettledDaysReader = db,
): Promise<PayrollSettledDayKey[]> {
	if (scope.employeeIds.length === 0) return [];
	return database
		.select({
			employeeId: payrollSettledDay.employeeId,
			date: payrollSettledDay.date,
			timezone: payrollSettledDay.timezone,
		})
		.from(payrollSettledDay)
		.where(
			and(
				eq(payrollSettledDay.organizationId, organizationId),
				inArray(payrollSettledDay.employeeId, [...scope.employeeIds]),
				gte(payrollSettledDay.date, period.startDate),
				lte(payrollSettledDay.date, period.endDate),
				isNull(payrollSettledDay.unsettledAt),
			),
		)
		.orderBy(asc(payrollSettledDay.employeeId), asc(payrollSettledDay.date));
}
