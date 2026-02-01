/**
 * Consecutive Days Rule
 *
 * Detects when an employee works too many consecutive days without a day off.
 * (e.g., max 6 consecutive days per German ArbZG)
 */

import { DateTime } from "luxon";
import type { ConsecutiveDaysExceededEvidence } from "@/db/schema/compliance-finding";
import {
	calculateSeverity,
	type ComplianceFindingResult,
	type ComplianceRule,
	type RuleDetectionInput,
} from "./types";

const DEFAULT_MAX_CONSECUTIVE_DAYS = 6;

export class ConsecutiveDaysRule implements ComplianceRule {
	readonly name = "consecutive_days";
	readonly type = "consecutive_days_exceeded" as const;
	readonly description = "Detects when employees work too many consecutive days without rest";

	async detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]> {
		const { employee, workPeriods, dateRange, thresholdOverrides } = input;
		const findings: ComplianceFindingResult[] = [];

		// Determine the max consecutive days
		const maxConsecutiveDays =
			thresholdOverrides?.maxConsecutiveDays ??
			employee.policy?.maxConsecutiveDays ??
			DEFAULT_MAX_CONSECUTIVE_DAYS;

		// Filter to completed work periods
		const completedPeriods = workPeriods.filter(
			(wp) => wp.endTime !== null && !wp.isActive && wp.durationMinutes !== null,
		);

		if (completedPeriods.length === 0) {
			return findings;
		}

		// Get unique work dates (in employee's timezone)
		const workDatesSet = new Set<string>();
		for (const period of completedPeriods) {
			const dateKey = DateTime.fromJSDate(period.startTime, { zone: employee.timezone })
				.startOf("day")
				.toISODate()!;
			workDatesSet.add(dateKey);
		}

		// Sort dates
		const workDates = Array.from(workDatesSet).sort();

		if (workDates.length === 0) {
			return findings;
		}

		// Find streaks of consecutive days
		let streakStart = 0;
		let streakDates: string[] = [workDates[0]];

		for (let i = 1; i < workDates.length; i++) {
			const prevDate = DateTime.fromISO(workDates[i - 1], { zone: employee.timezone });
			const currDate = DateTime.fromISO(workDates[i], { zone: employee.timezone });

			// Check if dates are consecutive
			const daysDiff = currDate.diff(prevDate, "days").days;

			if (daysDiff === 1) {
				// Continue the streak
				streakDates.push(workDates[i]);
			} else {
				// Streak broken - check if it was a violation
				if (streakDates.length > maxConsecutiveDays) {
					const finding = this.createFinding(
						employee,
						streakDates,
						maxConsecutiveDays,
						dateRange,
					);
					if (finding) {
						findings.push(finding);
					}
				}

				// Start new streak
				streakStart = i;
				streakDates = [workDates[i]];
			}
		}

		// Check final streak
		if (streakDates.length > maxConsecutiveDays) {
			const finding = this.createFinding(employee, streakDates, maxConsecutiveDays, dateRange);
			if (finding) {
				findings.push(finding);
			}
		}

		return findings;
	}

	private createFinding(
		employee: RuleDetectionInput["employee"],
		streakDates: string[],
		maxConsecutiveDays: number,
		dateRange: RuleDetectionInput["dateRange"],
	): ComplianceFindingResult | null {
		const startDate = DateTime.fromISO(streakDates[0], { zone: employee.timezone });
		const endDate = DateTime.fromISO(streakDates[streakDates.length - 1], {
			zone: employee.timezone,
		});

		// Only create finding if the streak ends within the detection range
		if (endDate < dateRange.start || endDate > dateRange.end) {
			return null;
		}

		const consecutiveDays = streakDates.length;
		const severity = calculateSeverity(consecutiveDays, maxConsecutiveDays);

		const evidence: ConsecutiveDaysExceededEvidence = {
			type: "consecutive_days_exceeded",
			consecutiveDays,
			maxAllowedDays: maxConsecutiveDays,
			startDate: streakDates[0],
			endDate: streakDates[streakDates.length - 1],
			workDates: streakDates,
		};

		return {
			employeeId: employee.id,
			type: this.type,
			severity,
			occurrenceDate: endDate.toJSDate(),
			periodStart: startDate.toJSDate(),
			periodEnd: endDate.toJSDate(),
			evidence,
			workPolicyId: employee.policy?.policyId ?? null,
		};
	}
}
