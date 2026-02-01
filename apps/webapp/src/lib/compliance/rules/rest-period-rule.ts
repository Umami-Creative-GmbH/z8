/**
 * Rest Period Rule
 *
 * Detects violations of the minimum rest period between work periods.
 * (e.g., 11-hour rest period required by German ArbZG)
 */

import { DateTime } from "luxon";
import type { RestPeriodInsufficientEvidence } from "@/db/schema/compliance-finding";
import {
	calculateSeverityForShortfall,
	type ComplianceFindingResult,
	type ComplianceRule,
	type RuleDetectionInput,
} from "./types";

const DEFAULT_REST_PERIOD_MINUTES = 660; // 11 hours

export class RestPeriodRule implements ComplianceRule {
	readonly name = "rest_period";
	readonly type = "rest_period_insufficient" as const;
	readonly description = "Detects insufficient rest periods between work shifts";

	async detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]> {
		const { employee, workPeriods, thresholdOverrides } = input;
		const findings: ComplianceFindingResult[] = [];

		// Determine the required rest period
		const requiredRestMinutes =
			thresholdOverrides?.restPeriodMinutes ??
			employee.policy?.minRestPeriodMinutes ??
			DEFAULT_REST_PERIOD_MINUTES;

		// Filter to completed work periods only and sort by end time
		const completedPeriods = workPeriods
			.filter((wp) => wp.endTime !== null && !wp.isActive)
			.sort((a, b) => a.endTime!.getTime() - b.endTime!.getTime());

		if (completedPeriods.length < 2) {
			return findings; // Need at least 2 periods to check rest
		}

		// Check gap between consecutive work periods
		for (let i = 0; i < completedPeriods.length - 1; i++) {
			const currentPeriod = completedPeriods[i];
			const nextPeriod = completedPeriods[i + 1];

			const currentEndTime = DateTime.fromJSDate(currentPeriod.endTime!, {
				zone: employee.timezone,
			});
			const nextStartTime = DateTime.fromJSDate(nextPeriod.startTime, {
				zone: employee.timezone,
			});

			// Calculate rest period in minutes
			const restMinutes = nextStartTime.diff(currentEndTime, "minutes").minutes;

			// Check if rest period is insufficient
			if (restMinutes < requiredRestMinutes) {
				const shortfallMinutes = requiredRestMinutes - restMinutes;
				const severity = calculateSeverityForShortfall(restMinutes, requiredRestMinutes);

				const evidence: RestPeriodInsufficientEvidence = {
					type: "rest_period_insufficient",
					lastClockOutTime: currentEndTime.toISO()!,
					nextClockInTime: nextStartTime.toISO()!,
					actualRestMinutes: Math.round(restMinutes),
					requiredRestMinutes,
					shortfallMinutes: Math.round(shortfallMinutes),
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: nextStartTime.toJSDate(),
					periodStart: currentEndTime.toJSDate(),
					periodEnd: nextStartTime.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		}

		return findings;
	}
}
