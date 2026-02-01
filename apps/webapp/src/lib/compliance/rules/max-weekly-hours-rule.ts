/**
 * Max Weekly Hours Rule
 *
 * Detects when an employee works more than the weekly maximum hours.
 * (e.g., 48 hours max per EU Working Time Directive)
 */

import { DateTime } from "luxon";
import type { MaxHoursWeeklyExceededEvidence } from "@/db/schema/compliance-finding";
import {
	calculateSeverity,
	type ComplianceFindingResult,
	type ComplianceRule,
	type RuleDetectionInput,
} from "./types";

const DEFAULT_MAX_WEEKLY_MINUTES = 2880; // 48 hours

export class MaxWeeklyHoursRule implements ComplianceRule {
	readonly name = "max_weekly_hours";
	readonly type = "max_hours_weekly_exceeded" as const;
	readonly description = "Detects when weekly work hours exceed the maximum limit";

	async detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]> {
		const { employee, workPeriods, dateRange, thresholdOverrides } = input;
		const findings: ComplianceFindingResult[] = [];

		// Determine the weekly limit
		const maxWeeklyMinutes =
			thresholdOverrides?.maxWeeklyMinutes ??
			employee.policy?.maxWeeklyMinutes ??
			DEFAULT_MAX_WEEKLY_MINUTES;

		// Filter to completed work periods
		const completedPeriods = workPeriods.filter(
			(wp) => wp.endTime !== null && !wp.isActive && wp.durationMinutes !== null,
		);

		if (completedPeriods.length === 0) {
			return findings;
		}

		// Group work periods by ISO week (in employee's timezone)
		const periodsByWeek = new Map<string, typeof completedPeriods>();

		for (const period of completedPeriods) {
			const dt = DateTime.fromJSDate(period.startTime, { zone: employee.timezone });
			const weekKey = `${dt.weekYear}-W${dt.weekNumber.toString().padStart(2, "0")}`;

			const existing = periodsByWeek.get(weekKey) || [];
			existing.push(period);
			periodsByWeek.set(weekKey, existing);
		}

		// Check each week for violations
		for (const [weekKey, periods] of periodsByWeek) {
			// Parse week key back to DateTime
			const [yearStr, weekStr] = weekKey.split("-W");
			const weekStart = DateTime.fromObject(
				{ weekYear: parseInt(yearStr), weekNumber: parseInt(weekStr), weekday: 1 },
				{ zone: employee.timezone },
			).startOf("day");
			const weekEnd = weekStart.endOf("week");

			// Skip weeks outside the detection range
			if (weekEnd < dateRange.start || weekStart > dateRange.end) {
				continue;
			}

			// Sum duration for the week
			const totalMinutes = periods.reduce((sum, p) => sum + (p.durationMinutes ?? 0), 0);

			// Check if exceeded
			if (totalMinutes > maxWeeklyMinutes) {
				const exceedanceMinutes = totalMinutes - maxWeeklyMinutes;
				const severity = calculateSeverity(totalMinutes, maxWeeklyMinutes);

				const evidence: MaxHoursWeeklyExceededEvidence = {
					type: "max_hours_weekly_exceeded",
					weekStartDate: weekStart.toISODate()!,
					weekEndDate: weekEnd.toISODate()!,
					workedMinutes: Math.round(totalMinutes),
					limitMinutes: maxWeeklyMinutes,
					exceedanceMinutes: Math.round(exceedanceMinutes),
					workPeriodIds: periods.map((p) => p.id),
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: weekEnd.toJSDate(), // Report at end of week
					periodStart: weekStart.toJSDate(),
					periodEnd: weekEnd.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		}

		return findings;
	}
}
