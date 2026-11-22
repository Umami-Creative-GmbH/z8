import "server-only";

import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadPayrollPeriodSources } from "@/lib/payroll-workspace/summary";
import type { PayrollPeriodRange } from "./types";

/**
 * The database part of a payroll period read, for already grant-scoped employees.
 */
export function loadPeriodSources(
	organizationId: string,
	employeeIds: readonly string[],
	period: PayrollPeriodRange,
) {
	return loadPayrollPeriodSources({
		organizationId,
		allowedEmployeeIds: employeeIds,
		period: {
			start: parsePlainDate(period.startDate),
			end: parsePlainDate(period.endDate),
			label: period.label,
		},
	});
}
