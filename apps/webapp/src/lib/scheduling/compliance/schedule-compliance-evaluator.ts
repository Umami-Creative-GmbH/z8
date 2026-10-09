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

function isInWindow(date: PlainDate, window: ScheduleComplianceWindow): boolean {
	return overlapsWindow(date, date.add({ days: 1 }), window);
}

function isDayInWindow(day: string, window: ScheduleComplianceWindow): boolean {
	const date = tryParse(parsePlainDate, day);
	return date != null && isInWindow(date, window);
}

function toCombinedDailyMinutes(employee: EmployeeScheduleComplianceInput): Map<string, number> {
	const dailyMinutes = new Map<string, number>();

	for (const [day, minutes] of Object.entries(employee.actualMinutesByDay)) {
		dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + minutes);
	}

	for (const [day, minutes] of Object.entries(employee.scheduledMinutesByDay)) {
		dailyMinutes.set(day, (dailyMinutes.get(day) ?? 0) + minutes);
	}

	return dailyMinutes;
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
			if (!from || !to || !isInWindow(plainDateAt(to, input.timezone), input.window)) {
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
		const dailyMinutes = toCombinedDailyMinutes(employee);
		for (const [day, totalMinutes] of dailyMinutes) {
			if (totalMinutes > maxDailyMinutes && isDayInWindow(day, input.window)) {
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
		const dailyMinutes = toCombinedDailyMinutes(employee);

		if (overtimeDailyThresholdMinutes != null) {
			for (const [day, totalMinutes] of dailyMinutes) {
				if (totalMinutes > overtimeDailyThresholdMinutes && isDayInWindow(day, input.window)) {
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

		if (overtimeWeeklyThresholdMinutes != null) {
			const weeklyTotals = new Map<string, number>();
			for (const [day, totalMinutes] of dailyMinutes) {
				const date = tryParse(parsePlainDate, day);
				if (!date) {
					continue;
				}
				// ISO weeks start on Monday.
				const weekKey = date.subtract({ days: date.dayOfWeek - 1 }).toString();
				weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) ?? 0) + totalMinutes);
			}

			for (const [periodKey, totalMinutes] of weeklyTotals) {
				const weekStart = parsePlainDate(periodKey);
				if (
					totalMinutes > overtimeWeeklyThresholdMinutes &&
					overlapsWindow(weekStart, weekStart.add({ weeks: 1 }), input.window)
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
			const monthlyTotals = new Map<string, number>();
			for (const [day, totalMinutes] of dailyMinutes) {
				const date = tryParse(parsePlainDate, day);
				if (!date) {
					continue;
				}
				const monthKey = date.toPlainYearMonth().toString();
				monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + totalMinutes);
			}

			for (const [periodKey, totalMinutes] of monthlyTotals) {
				const monthStart = parsePlainDate(`${periodKey}-01`);
				if (
					totalMinutes > overtimeMonthlyThresholdMinutes &&
					overlapsWindow(monthStart, monthStart.add({ months: 1 }), input.window)
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
