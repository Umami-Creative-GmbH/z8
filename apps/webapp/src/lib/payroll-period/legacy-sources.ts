import "server-only";

import { DateTime } from "luxon";
import { loadPayrollPeriodSources } from "@/lib/payroll-workspace/summary";
import type { PayrollPeriodRange } from "./types";

/**
 * The database part of a payroll period read, for already grant-scoped employees. The
 * one place the period module crosses into the Luxon-based workspace loader; the module's
 * own types carry dates as ISO strings and instants as Temporal.
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
			start: DateTime.fromISO(period.startDate, { zone: "utc" }),
			end: DateTime.fromISO(period.endDate, { zone: "utc" }),
			label: period.label,
		},
	});
}
