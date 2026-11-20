import "server-only";

import { db } from "@/db";
import { loadActiveSettledDays, type SettledDaysReader } from "./settled-days-store";

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
	const settled = await loadActiveSettledDays(database, {
		organizationId,
		employeeIds: scope.employeeIds,
		...period,
	});
	return settled.map(({ employeeId, date, timezone }) => ({ employeeId, date, timezone }));
}
