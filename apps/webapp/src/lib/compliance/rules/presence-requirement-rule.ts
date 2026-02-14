/**
 * Presence Requirement Rule
 *
 * Detects when an employee does not meet on-site presence requirements.
 * Supports two modes:
 * - minimum_count: requires N on-site days per evaluation period
 * - fixed_days: requires presence on specific days of the week
 */

import { DateTime } from "luxon";
import type { PresenceRequirementEvidence } from "@/db/schema/compliance-finding";
import type {
	ComplianceFindingResult,
	ComplianceRule,
	RuleDetectionInput,
	WorkPeriodData,
} from "./types";
import type { ComplianceFindingSeverity } from "@/db/schema/compliance-finding";

// ============================================
// Extended interfaces for presence detection
// ============================================

/**
 * Work period with location type information
 */
export interface WorkPeriodWithLocation extends WorkPeriodData {
	workLocationType: string | null;
}

/**
 * A day the employee was absent (sick, vacation, etc.)
 */
export interface AbsenceDay {
	/** ISO date string (e.g. "2026-02-10") */
	date: string;
	/** Reason for absence (e.g. "sick", "vacation") */
	reason: string;
}

/**
 * A public/company holiday
 */
export interface HolidayDay {
	/** ISO date string (e.g. "2026-02-14") */
	date: string;
}

/**
 * Presence configuration for an employee/team/org
 */
export interface PresenceConfig {
	/** "minimum_count" or "fixed_days" */
	presenceMode: "minimum_count" | "fixed_days";
	/** Number of required on-site days per period (for minimum_count mode) */
	requiredOnsiteDays: number;
	/** Required days of week (1=Monday..7=Sunday) for fixed_days mode */
	requiredOnsiteFixedDays: number[];
	/** Optional location constraint (null = any office/field location) */
	locationId: string | null;
	/** Evaluation period type */
	evaluationPeriod: "week" | "month";
	/** Enforcement level: "none" skips detection */
	enforcement: "none" | "soft" | "hard";
}

/**
 * Extended detection input with presence-specific data
 */
export interface PresenceRuleDetectionInput extends RuleDetectionInput {
	workPeriods: WorkPeriodWithLocation[];
	presenceConfig: PresenceConfig;
	absenceDays: AbsenceDay[];
	holidayDays: HolidayDay[];
}

// ============================================
// Helpers
// ============================================

const ONSITE_LOCATION_TYPES = new Set(["office", "field"]);

const WEEKDAY_NAMES: Record<number, string> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

/**
 * Check if a work location type counts as on-site
 */
function isOnsite(workLocationType: string | null): boolean {
	return workLocationType !== null && ONSITE_LOCATION_TYPES.has(workLocationType);
}

/**
 * Calculate severity based on shortfall percentage.
 * Uses presence-specific thresholds: >= 66% = critical, >= 33% = warning, else info
 */
function calculatePresenceSeverity(
	actualDays: number,
	requiredDays: number,
): ComplianceFindingSeverity {
	if (requiredDays <= 0) return "info";

	const shortfallPercent = ((requiredDays - actualDays) / requiredDays) * 100;

	if (shortfallPercent >= 66) return "critical";
	if (shortfallPercent >= 33) return "warning";
	return "info";
}

/**
 * Get all weekday dates (Mon-Fri) in a date range (inclusive), in the given timezone
 */
function getWeekdayDates(start: DateTime, end: DateTime): DateTime[] {
	const days: DateTime[] = [];
	let current = start.startOf("day");
	const endDay = end.startOf("day");

	while (current <= endDay) {
		if (current.weekday >= 1 && current.weekday <= 5) {
			days.push(current);
		}
		current = current.plus({ days: 1 });
	}

	return days;
}

export class PresenceRequirementRule implements ComplianceRule {
	readonly name = "presence_requirement";
	readonly type = "presence_requirement" as const;
	readonly description = "Detects when on-site presence requirements are not met";

	async detectViolations(
		input: RuleDetectionInput,
	): Promise<ComplianceFindingResult[]> {
		// This rule requires the extended input type
		const presenceInput = input as PresenceRuleDetectionInput;

		const { employee, workPeriods, dateRange, presenceConfig, absenceDays, holidayDays } =
			presenceInput;

		// Skip if enforcement is disabled
		if (presenceConfig.enforcement === "none") {
			return [];
		}

		const findings: ComplianceFindingResult[] = [];
		const timezone = employee.timezone;

		// Filter to completed work periods only
		const completedPeriods = workPeriods.filter(
			(wp) => wp.endTime !== null && !wp.isActive,
		);

		// Build set of excluded dates (absences + holidays)
		const excludedDates = new Set<string>();
		const excludedReasons: string[] = [];

		for (const absence of absenceDays) {
			excludedDates.add(absence.date);
			excludedReasons.push(absence.reason);
		}
		for (const holiday of holidayDays) {
			excludedDates.add(holiday.date);
			excludedReasons.push("holiday");
		}

		// Determine on-site days: group work periods by calendar date in employee timezone
		const onsiteDateSet = new Set<string>();
		const onsiteWorkPeriodIds: string[] = [];

		for (const period of completedPeriods) {
			if (!isOnsite(period.workLocationType)) continue;

			const dt = DateTime.fromJSDate(period.startTime, { zone: timezone });
			const dateKey = dt.toISODate()!;
			onsiteDateSet.add(dateKey);
			onsiteWorkPeriodIds.push(period.id);
		}

		const actualOnsiteDays = onsiteDateSet.size;

		// Get evaluation period boundaries
		const periodStart = dateRange.start.setZone(timezone).startOf("day");
		const periodEnd = dateRange.end.setZone(timezone).startOf("day");

		if (presenceConfig.presenceMode === "minimum_count") {
			// Calculate available working days
			const allWeekdays = getWeekdayDates(periodStart, periodEnd);
			const availableWeekdays = allWeekdays.filter(
				(d) => !excludedDates.has(d.toISODate()!),
			);
			const workingDayCount = availableWeekdays.length;

			// Cap requirement to available days
			const adjustedRequirement = Math.min(
				presenceConfig.requiredOnsiteDays,
				workingDayCount,
			);

			// Check for violation
			if (actualOnsiteDays < adjustedRequirement) {
				const severity = calculatePresenceSeverity(actualOnsiteDays, adjustedRequirement);

				const evidence: PresenceRequirementEvidence = {
					type: "presence_requirement",
					mode: "minimum_count",
					evaluationStart: periodStart.toISODate()!,
					evaluationEnd: periodEnd.toISODate()!,
					requiredDays: adjustedRequirement,
					actualOnsiteDays,
					excludedDays: Array.from(excludedDates),
					excludedReasons,
					onsiteWorkPeriodIds,
					locationId: presenceConfig.locationId,
					locationName: null,
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: periodEnd.toJSDate(),
					periodStart: periodStart.toJSDate(),
					periodEnd: periodEnd.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		} else if (presenceConfig.presenceMode === "fixed_days") {
			// Check each required day of week
			const missedDays: string[] = [];

			for (const requiredWeekday of presenceConfig.requiredOnsiteFixedDays) {
				// Find all dates in the period matching this weekday
				let current = periodStart;
				while (current <= periodEnd) {
					if (current.weekday === requiredWeekday) {
						const dateKey = current.toISODate()!;

						// If it's an excluded day (absence/holiday), it's excused
						if (!excludedDates.has(dateKey)) {
							// Check if there's an on-site work period on this date
							if (!onsiteDateSet.has(dateKey)) {
								const dayName = WEEKDAY_NAMES[requiredWeekday] ?? `day_${requiredWeekday}`;
								if (!missedDays.includes(dayName)) {
									missedDays.push(dayName);
								}
							}
						}
					}
					current = current.plus({ days: 1 });
				}
			}

			if (missedDays.length > 0) {
				const requiredCount = presenceConfig.requiredOnsiteFixedDays.length;
				const metCount = requiredCount - missedDays.length;
				const severity = calculatePresenceSeverity(metCount, requiredCount);

				const evidence: PresenceRequirementEvidence = {
					type: "presence_requirement",
					mode: "fixed_days",
					evaluationStart: periodStart.toISODate()!,
					evaluationEnd: periodEnd.toISODate()!,
					requiredDays: requiredCount,
					actualOnsiteDays,
					missedDays,
					excludedDays: Array.from(excludedDates),
					excludedReasons,
					onsiteWorkPeriodIds,
					locationId: presenceConfig.locationId,
					locationName: null,
				};

				findings.push({
					employeeId: employee.id,
					type: this.type,
					severity,
					occurrenceDate: periodEnd.toJSDate(),
					periodStart: periodStart.toJSDate(),
					periodEnd: periodEnd.toJSDate(),
					evidence,
					workPolicyId: employee.policy?.policyId ?? null,
				});
			}
		}

		return findings;
	}
}
