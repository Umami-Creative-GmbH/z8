/**
 * Max Daily Hours Rule
 *
 * Detects when an employee works more than the daily maximum hours.
 * (e.g., 10 hours max per German ArbZG)
 */

import { DateTime } from "luxon";
import type { MaxHoursDailyExceededEvidence } from "@/db/schema/compliance-finding";
import {
	calculateSeverity,
	type ComplianceFindingResult,
	type ComplianceRule,
	type RuleDetectionInput,
} from "./types";

const DEFAULT_MAX_DAILY_MINUTES = 600; // 10 hours

export class MaxDailyHoursRule implements ComplianceRule {
	readonly name = "max_daily_hours";
	readonly type = "max_hours_daily_exceeded" as const;
	readonly description = "Detects when daily work hours exceed the maximum limit";

	async detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]> {
		const { employee, workPeriods, dateRange, thresholdOverrides } = input;
		const findings: ComplianceFindingResult[] = [];

		// Determine the daily limit
		const maxDailyMinutes =
			thresholdOverrides?.maxDailyMinutes ??
			employee.policy?.maxDailyMinutes ??
			DEFAULT_MAX_DAILY_MINUTES;

		// Filter to completed work periods
		const completedPeriods = workPeriods.filter(
			(wp) => wp.endTime !== null && !wp.isActive && wp.durationMinutes !== null,
		);

		if (completedPeriods.length === 0) {
			return findings;
		}

		// Group work periods by date (in employee's timezone)
		const periodsByDate = new Map<string, typeof completedPeriods>();

		for (const period of completedPeriods) {
			const dateKey = DateTime.fromJSDate(period.startTime, { zone: employee.timezone })
				.startOf("day")
				.toISODate()!;

			const existing = periodsByDate.get(dateKey) || [];
			existing.push(period);
			periodsByDate.set(dateKey, existing);
		}

		// Check each date for violations
		for (const [dateKey, periods] of periodsByDate) {
			const date = DateTime.fromISO(dateKey, { zone: employee.timezone });

			// Skip dates outside the detection range
			if (date < dateRange.start.startOf("day") || date > dateRange.end.endOf("day")) {
				continue;
			}

			// Sum duration for the day
			const totalMinutes = periods.reduce((sum, p) => sum + (p.durationMinutes ?? 0), 0);

			// Check if exceeded
			if (totalMinutes > maxDailyMinutes) {
				const exceedanceMinutes = totalMinutes - maxDailyMinutes;
				const severity = calculateSeverity(totalMinutes, maxDailyMinutes);

				const evidence: MaxHoursDailyExceededEvidence = {
					type: "max_hours_daily_exceeded",
					date: dateKey,
					workedMinutes: Math.round(totalMinutes),
					limitMinutes: maxDailyMinutes,
					exceedanceMinutes: Math.round(exceedanceMinutes),
					workPeriodIds: periods.map((p) => p.id),
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: date.toJSDate(),
					periodStart: date.startOf("day").toJSDate(),
					periodEnd: date.endOf("day").toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		}

		return findings;
	}
}
