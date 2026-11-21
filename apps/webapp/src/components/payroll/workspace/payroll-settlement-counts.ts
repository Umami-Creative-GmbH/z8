import { dayHasEntries } from "@/lib/payroll-period/day-entries";
import type { PayrollPeriodEmployee } from "@/lib/payroll-period/types";

/** The employee-days of a selection by whether they can be, or have been, settled. */
export interface PayrollSettlementDayCounts {
	/** Days with an active settlement, changed since or not. */
	settledDays: number;
	/** The settled days whose values changed since settling (#1897). */
	changedSinceSettledDays: number;
	/** Unsettled days with entries: what settling by hand can settle. */
	unsettledDays: number;
	/** Unsettled days nobody recorded anything on: never settled by hand. */
	withoutEntriesDays: number;
}

/**
 * Counts the loaded employee-days in the range, of the named employees (all when
 * `employeeIds` is undefined), for the Settlement tab.
 */
export function countSettlementDays(
	employees: readonly PayrollPeriodEmployee[],
	selection: { startDate: string; endDate: string; employeeIds?: readonly string[] },
): PayrollSettlementDayCounts {
	const counts: PayrollSettlementDayCounts = {
		settledDays: 0,
		changedSinceSettledDays: 0,
		unsettledDays: 0,
		withoutEntriesDays: 0,
	};
	const named = selection.employeeIds ? new Set(selection.employeeIds) : null;
	for (const employee of employees) {
		if (named && !named.has(employee.id)) continue;
		for (const day of employee.days) {
			if (day.date < selection.startDate || day.date > selection.endDate) continue;
			const state = day.settlement?.state ?? "unsettled";
			if (state === "unsettled") {
				if (dayHasEntries(day)) counts.unsettledDays += 1;
				else counts.withoutEntriesDays += 1;
				continue;
			}
			counts.settledDays += 1;
			if (state === "changed_since_settled") counts.changedSinceSettledDays += 1;
		}
	}
	return counts;
}
