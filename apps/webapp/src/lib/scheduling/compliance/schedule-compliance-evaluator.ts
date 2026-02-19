import { DateTime } from "luxon";
import type {
	ComplianceFinding,
	EmployeeScheduleComplianceInput,
	ScheduleComplianceInput,
	ScheduleComplianceResult,
} from "./types";

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
			const from = DateTime.fromISO(transition.fromEndIso, { setZone: true });
			const to = DateTime.fromISO(transition.toStartIso, { setZone: true });
			if (!from.isValid || !to.isValid) {
				continue;
			}

			const restMinutes = Math.round(to.diff(from, "minutes").minutes);
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
			if (totalMinutes > maxDailyMinutes) {
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
	const { overtimeDailyThresholdMinutes, overtimeWeeklyThresholdMinutes, overtimeMonthlyThresholdMinutes } =
		input.regulation;

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
				if (totalMinutes > overtimeDailyThresholdMinutes) {
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
				const weekKey = DateTime.fromISO(day, { zone: input.timezone }).startOf("week").toISODate();
				if (!weekKey) {
					continue;
				}
				weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) ?? 0) + totalMinutes);
			}

			for (const [periodKey, totalMinutes] of weeklyTotals) {
				if (totalMinutes > overtimeWeeklyThresholdMinutes) {
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
				const monthKey = DateTime.fromISO(day, { zone: input.timezone }).toFormat("yyyy-MM");
				monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + totalMinutes);
			}

			for (const [periodKey, totalMinutes] of monthlyTotals) {
				if (totalMinutes > overtimeMonthlyThresholdMinutes) {
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

export function evaluateScheduleCompliance(input: ScheduleComplianceInput): ScheduleComplianceResult {
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
