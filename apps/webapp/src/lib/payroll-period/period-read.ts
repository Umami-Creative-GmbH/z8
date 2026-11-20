import type { DateTime } from "luxon";
import { buildPayrollSummaryFromRows } from "@/lib/payroll-workspace/summary";
import type { PayrollBlocker, PayrollPeriod } from "@/lib/payroll-workspace/types";
import { buildPayrollPeriodRows } from "./period-rows";
import type {
	CreditedWorkSpan,
	PayrollPeriodAbsenceSource,
	PayrollPeriodEmployeeSource,
	PayrollPeriodHolidaySource,
	PayrollPeriodRead,
	PayrollSettledDaySource,
} from "./types";

/** Everything the database part reads for one organization, scope and period. */
export interface PayrollPeriodSources {
	organizationName: string;
	employees: PayrollPeriodEmployeeSource[];
	/** Work credited to the period by the payroll credit rule. */
	work: CreditedWorkSpan[];
	/** Approved and pending absences overlapping the period. */
	absences: PayrollPeriodAbsenceSource[];
	blockers: PayrollBlocker[];
	requirements?: ReadonlyMap<string, Readonly<Record<string, { requiredMinutes: number }>>>;
	holidays?: ReadonlyMap<string, readonly PayrollPeriodHolidaySource[]>;
	/** Active settlements of the employees' period days (#1896). */
	settledDays?: readonly PayrollSettledDaySource[];
}

/**
 * The read model of a payroll period: the day rows and the Overview summary built
 * from them, so the summary's worked hours are each row's total and never a second
 * calculation.
 */
export function buildPayrollPeriodRead(input: {
	organizationId: string;
	period: PayrollPeriod;
	generatedAt: DateTime;
	generatedBy: { id: string; name: string };
	sources: PayrollPeriodSources;
}): PayrollPeriodRead {
	const { sources } = input;
	const rows = buildPayrollPeriodRows({
		period: { startDate: input.period.start, endDate: input.period.end },
		employees: sources.employees,
		work: sources.work,
		absences: sources.absences,
		requirements: sources.requirements,
		holidays: sources.holidays,
		settledDays: sources.settledDays,
	});
	const days = rows.employees.flatMap((row) => row.days);
	const settledDays = days.filter((day) => day.settlement?.state === "settled").length;
	const summary = buildPayrollSummaryFromRows({
		organizationId: input.organizationId,
		organizationName: sources.organizationName,
		period: input.period,
		generatedAt: input.generatedAt,
		generatedBy: input.generatedBy,
		employees: sources.employees.map(({ timezone: _timezone, ...employee }) => employee),
		workRows: [],
		collectedWork: rows.employees.map((row) => ({
			employeeId: row.id,
			minutes: row.totals.creditedMinutes,
		})),
		absenceRows: sources.absences.filter((row) => row.approvalState === "approved"),
		blockers: sources.blockers,
	});

	return {
		organizationId: input.organizationId,
		period: input.period,
		employees: rows.employees.toSorted(
			(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
		),
		absences: rows.absences,
		settlement: { settledDays, unsettledDays: days.length - settledDays },
		blockers: summary.blockers,
		summary,
	};
}
