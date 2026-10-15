import "server-only";

import { db } from "@/db";
import {
	classifyPayrollRunCandidates,
	exportIsPayrollRun,
} from "@/lib/travel-expenses/payroll-run";
import { fetchOvertimePayoutsForExport, resolvePayrollRunEmployeeIds } from "./data-fetcher";
import { overtimePayoutCodeFormat } from "./formatters/overtime-payouts";
import type { PayrollExportFilters } from "./types";

/** The export's period as logical dates (`YYYY-MM-DD`). */
export function logicalPeriod(filters: PayrollExportFilters): {
	startDate: string;
	endDate: string;
} {
	const startDate = filters.dateRange.start.toISODate();
	const endDate = filters.dateRange.end.toISODate();
	if (!startDate || !endDate) {
		throw new Error("Invalid payroll export date range");
	}
	return { startDate, endDate };
}

/**
 * The employees an export of `formatId` carries rows for without any work or
 * absence: overtime payouts (#1001) when the format writes them, and the
 * expense lines a payroll run of the format would include (#852). The export
 * and payroll readiness read them the same way, organization-scoped.
 */
export async function employeesWithPayoutsOrExpenseLines(input: {
	organizationId: string;
	formatId: string;
	filters: PayrollExportFilters;
}): Promise<Set<string>> {
	const employeeIds = new Set<string>();
	if (overtimePayoutCodeFormat(input.formatId)) {
		const payouts = await fetchOvertimePayoutsForExport(input.organizationId, input.filters);
		for (const payout of payouts) employeeIds.add(payout.employeeId);
	}
	if (
		await exportIsPayrollRun(db, { organizationId: input.organizationId, formatId: input.formatId })
	) {
		const candidates = await classifyPayrollRunCandidates(db, {
			organizationId: input.organizationId,
			format: input.formatId,
			period: logicalPeriod(input.filters),
			employeeIds: await resolvePayrollRunEmployeeIds(input.organizationId, input.filters),
		});
		for (const candidate of candidates) {
			if (candidate.classification.outcome === "include") {
				employeeIds.add(candidate.account.employeeId);
			}
		}
	}
	return employeeIds;
}
