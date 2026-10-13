import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { employee, vacationAdjustment } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";

/**
 * The sum of each employee's vacation adjustments (`vacation_adjustment.days`) for a year, the
 * one lookup every vacation balance reader adds to the allowance (#1105). Only employees of the
 * organization get an entry; one without adjustments gets 0.
 */
export async function loadVacationAdjustmentTotals(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeIds: readonly string[]; year: number },
): Promise<Map<string, number>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	const rows = await database
		.select({
			employeeId: employee.id,
			total: sql<string>`COALESCE(SUM(${vacationAdjustment.days}), 0)`,
		})
		.from(employee)
		.leftJoin(
			vacationAdjustment,
			and(eq(vacationAdjustment.employeeId, employee.id), eq(vacationAdjustment.year, input.year)),
		)
		.where(
			and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
		)
		.groupBy(employee.id);

	return new Map(rows.map((row) => [row.employeeId, Number.parseFloat(row.total)]));
}

/** One employee's adjustment total for a year; 0 for an employee outside the organization. */
export async function loadVacationAdjustmentTotal(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; year: number },
): Promise<number> {
	const totals = await loadVacationAdjustmentTotals(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
	});
	return totals.get(input.employeeId) ?? 0;
}
