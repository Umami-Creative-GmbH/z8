import {
	comparePlainDates,
	type PlainDate,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type {
	ComplianceFinding,
	EmployeeScheduleComplianceInput,
	ScheduleComplianceInput,
	ScheduleComplianceResult,
	ScheduleComplianceWindow,
} from "./types";

function tryParse<T>(parse: (value: string) => T, value: string): T | null {
	try {
		return parse(value);
	} catch {
		return null;
	}
}

/** Whether the days `[start, endExclusive)` share at least one day with the window. */
function overlapsWindow(
	start: PlainDate,
	endExclusive: PlainDate,
	window: ScheduleComplianceWindow,
): boolean {
	return (
		comparePlainDates(start, window.endExclusive) < 0 &&
		comparePlainDates(endExclusive, window.start) > 0
	);
}

function isDateInWindow(date: PlainDate, window: ScheduleComplianceWindow): boolean {
	return overlapsWindow(date, date.add({ days: 1 }), window);
}

interface DayTotal {
	day: string;
	date: PlainDate;
	totalMinutes: number;
}

interface PeriodTotal {
	start: PlainDate;
	endExclusive: PlainDate;
	totalMinutes: number;
}

/** Actual plus scheduled minutes per organization-local day; unreadable day keys are skipped. */
function toCombinedDayTotals(employee: EmployeeScheduleComplianceInput): DayTotal[] {
	const dailyMinutes = new Map<string, number>();

	for (const [day, minutes] of Object.entries(employee.actualMinutesByDay)) {
		dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + minutes);
	}

	for (const [day, minutes] of Object.entries(employee.scheduledMinutesByDay)) {
		dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + minutes);
	}

	return [...dailyMinutes].flatMap(([day, totalMinutes]) => {
		const date = tryParse(parsePlainDate, day);
		return date ? [{ day, date, totalMinutes }] : [];
	});
}

/** Sums day totals into the period `period` assigns each day to, keyed by the period's key. */
function toPeriodTotals(
	days: DayTotal[],
	period: (date: PlainDate) => { key: string; start: PlainDate; endExclusive: PlainDate },
): Map<string, PeriodTotal> {
	const totals = new Map<string, PeriodTotal>();
	for (const { date, totalMinutes } of days) {
		const { key, start, endExclusive } = period(date);
		const existing = totals.get(key);
		totals.set(key, {
			start,
			endExclusive,
			totalMinutes: (existing?.totalMinutes ?? 0) + totalMinutes,
		});
	}
	return totals;
}

function isoWeekOf(date: PlainDate) {
	const start = date.subtract({ days: date.dayOfWeek - 1 });
	return { key: start.toString(), start, endExclusive: start.add({ weeks: 1 }) };
}

function monthOf(date: PlainDate) {
	const start = date.with({ day: 1 });
	return {
		key: date.toPlainYearMonth().toString(),
		start,
		endExclusive: start.add({ months: 1 }),
	};
}

function collectRestTimeFindings(input: ScheduleComplianceInput): ComplianceFinding[] {
	const findings: ComplianceFinding[] = [];
	const minRestPeriodMinutes = input.regulation.minRestPeriodMinutes;

	if (minRestPeriodMinutes == null) {
		return findings;
	}

	for (const employee of input.employees) {
		for (const transition of employee.restTransitions) {
			const from = tryParse(parseInstant, transition.fromEndIso);
			const to = tryParse(parseInstant, transition.toStartIso);
			// Only rest before an interval that starts inside the window is judged.
			if (!from || !to || !isDateInWindow(plainDateAt(to, input.timezone), input.window)) {
				continue;
			}

			const restMinutes = Math.round((to.epochMilliseconds - from.epochMilliseconds) / 60_000);
			if (restMinutes < minRestPeriodMinutes) {
				findings.push({
					type: "restTime",
					employeeId: employee.employeeId,
					fromEndIso: transition.fromEndIso,
					toStartIso: transition.toStartIso,
					restMinutes,
					minRestPeriodMinutes,
				});
			}
		}
	}

	return findings;
}

function collectMaxHoursFindings(input: ScheduleComplianceInput): ComplianceFinding[] {
	const findings: ComplianceFinding[] = [];
	const maxDailyMinutes = input.regulation.maxDailyMinutes;

	if (maxDailyMinutes == null) {
		return findings;
	}

	for (const employee of input.employees) {
		for (const { day, date, totalMinutes } of toCombinedDayTotals(employee)) {
			if (totalMinutes > maxDailyMinutes && isDateInWindow(date, input.window)) {
				findings.push({
					type: "maxHours",
					employeeId: employee.employeeId,
					day,
					totalMinutes,
					maxDailyMinutes,
				});
			}
		}
	}

	return findings;
}

function collectOvertimeFindings(input: ScheduleComplianceInput): ComplianceFinding[] {
	const findings: ComplianceFinding[] = [];
	const {
		overtimeDailyThresholdMinutes,
		overtimeWeeklyThresholdMinutes,
		overtimeMonthlyThresholdMinutes,
	} = input.regulation;

	if (
		overtimeDailyThresholdMinutes == null &&
		overtimeWeeklyThresholdMinutes == null &&
		overtimeMonthlyThresholdMinutes == null
	) {
		return findings;
	}

	for (const employee of input.employees) {
		const days = toCombinedDayTotals(employee);

		if (overtimeDailyThresholdMinutes != null) {
			for (const { day, date, totalMinutes } of days) {
				if (totalMinutes > overtimeDailyThresholdMinutes && isDateInWindow(date, input.window)) {
					findings.push({
						type: "overtime",
						employeeId: employee.employeeId,
						period: "daily",
						periodKey: day,
						totalMinutes,
						thresholdMinutes: overtimeDailyThresholdMinutes,
					});
				}
			}
		}

		// Lookback days count toward a period's total; only periods overlapping the window are judged.
		if (overtimeWeeklyThresholdMinutes != null) {
			for (const [periodKey, week] of toPeriodTotals(days, isoWeekOf)) {
				const { totalMinutes } = week;
				if (
					totalMinutes > overtimeWeeklyThresholdMinutes &&
					overlapsWindow(week.start, week.endExclusive, input.window)
				) {
					findings.push({
						type: "overtime",
						employeeId: employee.employeeId,
						period: "weekly",
						periodKey,
						totalMinutes,
						thresholdMinutes: overtimeWeeklyThresholdMinutes,
					});
				}
			}
		}

		if (overtimeMonthlyThresholdMinutes != null) {
			for (const [periodKey, month] of toPeriodTotals(days, monthOf)) {
				const { totalMinutes } = month;
				if (
					totalMinutes > overtimeMonthlyThresholdMinutes &&
					overlapsWindow(month.start, month.endExclusive, input.window)
				) {
					findings.push({
						type: "overtime",
						employeeId: employee.employeeId,
						period: "monthly",
						periodKey,
						totalMinutes,
						thresholdMinutes: overtimeMonthlyThresholdMinutes,
					});
				}
			}
		}
	}

	return findings;
}

function summarizeFindings(findings: ComplianceFinding[]): ScheduleComplianceResult {
	const summary = {
		totalFindings: findings.length,
		byType: {
			restTime: 0,
			maxHours: 0,
			overtime: 0,
		},
	};

	for (const finding of findings) {
		summary.byType[finding.type] += 1;
	}

	return {
		findings,
		summary,
	};
}

export function evaluateScheduleCompliance(
	input: ScheduleComplianceInput,
): ScheduleComplianceResult {
	if (input.employees.length === 0) {
		return summarizeFindings([]);
	}

	const findings = [
		...collectRestTimeFindings(input),
		...collectMaxHoursFindings(input),
		...collectOvertimeFindings(input),
	];

	return summarizeFindings(findings);
}
