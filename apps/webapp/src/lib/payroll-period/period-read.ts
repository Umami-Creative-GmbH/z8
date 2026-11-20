import type { DateTime } from "luxon";
import { buildPayrollSummaryFromRows } from "@/lib/payroll-workspace/summary";
import type { PayrollBlocker, PayrollPeriod } from "@/lib/payroll-workspace/types";
import { buildPayrollPeriodRows } from "./period-rows";
import type {
	CreditedWorkSpan,
	PayrollPeriodAbsenceSource,
	PayrollPeriodEmployee,
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
	const sources = withoutDepartedEmployeesWithoutData(input.sources);
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
	const settledDays = days.filter(
		(day) => day.settlement !== undefined && day.settlement.state !== "unsettled",
	).length;
	const changedBlockers = changedSinceSettledBlockers(rows.employees);
	const summary = buildPayrollSummaryFromRows({
		organizationId: input.organizationId,
		organizationName: sources.organizationName,
		period: input.period,
		generatedAt: input.generatedAt,
		generatedBy: input.generatedBy,
		employees: sources.employees.map(
			({ timezone: _timezone, departure: _departure, ...employee }) => employee,
		),
		workRows: [],
		collectedWork: rows.employees.map((row) => ({
			employeeId: row.id,
			minutes: row.totals.creditedMinutes,
		})),
		absenceRows: sources.absences.filter((row) => row.approvalState === "approved"),
		blockers: [...sources.blockers, ...changedBlockers],
	});

	return {
		organizationId: input.organizationId,
		period: input.period,
		employees: rows.employees.toSorted(
			(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
		),
		absences: rows.absences,
		settlement: {
			settledDays,
			changedSinceSettledDays: changedBlockers.length,
			unsettledDays: days.length - settledDays,
		},
		blockers: summary.blockers,
		summary,
	};
}

/**
 * One blocker per changed-since-settled day (#1897), such as "+1.5 h since settled":
 * the officer handles the difference deliberately, it is never paid automatically.
 */
function changedSinceSettledBlockers(
	employees: readonly PayrollPeriodEmployee[],
): PayrollBlocker[] {
	return employees.flatMap((employee) =>
		employee.days.flatMap((day): PayrollBlocker[] => {
			if (day.settlement?.state !== "changed_since_settled") return [];
			const { creditedMinutesDifference, absencesChanged } = day.settlement.change;
			return [
				{
					id: day.settlement.settledDayId,
					employeeId: employee.id,
					type: "changed_since_settled",
					label: changedSinceSettledLabel(creditedMinutesDifference, absencesChanged),
					date: day.date,
					time: null,
					settledChange: { creditedMinutesDifference, absencesChanged },
				},
			];
		}),
	);
}

/** The blocker's plain-text label; the workspace shows a translated one. */
function changedSinceSettledLabel(minutes: number, absencesChanged: boolean): string {
	const hours = minutes === 0 ? null : `${formatSignedHours(minutes)} since settled`;
	if (!absencesChanged) return hours ?? "Changed since settled";
	return hours
		? `${formatSignedHours(minutes)} and absence changed since settled`
		: "Absence changed since settled";
}

/** Signed hours with up to two decimals: 90 -> "+1.5 h", -480 -> "-8 h". */
export function formatSignedHours(minutes: number): string {
	const hours = Math.round((Math.abs(minutes) / 60) * 100) / 100;
	return `${minutes < 0 ? "-" : "+"}${hours} h`;
}

/**
 * Employees who left are read when they have data in the period (#1894): credited
 * work, an absence, a blocker or a settled day. Without any, they are left out of
 * every view.
 */
function withoutDepartedEmployeesWithoutData(sources: PayrollPeriodSources): PayrollPeriodSources {
	if (!sources.employees.some((row) => row.departure)) return sources;
	const withData = new Set([
		...sources.work.map((row) => row.employeeId),
		...sources.absences.map((row) => row.employeeId),
		...sources.blockers.map((row) => row.employeeId),
		...(sources.settledDays ?? []).map((row) => row.employeeId),
	]);
	return {
		...sources,
		employees: sources.employees.filter((row) => !row.departure || withData.has(row.id)),
	};
}
