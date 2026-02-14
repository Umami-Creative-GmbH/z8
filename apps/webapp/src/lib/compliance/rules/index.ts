/**
 * Compliance Rules Registry
 *
 * Exports all compliance detection rules and provides a registry
 * for the detection service to iterate over.
 */

export * from "./types";
export * from "./rest-period-rule";
export * from "./max-daily-hours-rule";
export * from "./max-weekly-hours-rule";
export * from "./consecutive-days-rule";
export * from "./presence-requirement-rule";

import type { ComplianceRule } from "./types";
import { RestPeriodRule } from "./rest-period-rule";
import { MaxDailyHoursRule } from "./max-daily-hours-rule";
import { MaxWeeklyHoursRule } from "./max-weekly-hours-rule";
import { ConsecutiveDaysRule } from "./consecutive-days-rule";
import { PresenceRequirementRule } from "./presence-requirement-rule";

/**
 * All available compliance rules
 */
export const COMPLIANCE_RULES: ComplianceRule[] = [
	new RestPeriodRule(),
	new MaxDailyHoursRule(),
	new MaxWeeklyHoursRule(),
	new ConsecutiveDaysRule(),
	new PresenceRequirementRule(),
];

/**
 * Get a rule by its type
 */
export function getRuleByType(type: string): ComplianceRule | undefined {
	return COMPLIANCE_RULES.find((rule) => rule.type === type);
}

/**
 * Get rules filtered by enabled types
 */
export function getEnabledRules(enabledTypes: {
	restPeriod: boolean;
	maxHoursDaily: boolean;
	maxHoursWeekly: boolean;
	consecutiveDays: boolean;
	presenceRequirement: boolean;
}): ComplianceRule[] {
	return COMPLIANCE_RULES.filter((rule) => {
		switch (rule.type) {
			case "rest_period_insufficient":
				return enabledTypes.restPeriod;
			case "max_hours_daily_exceeded":
				return enabledTypes.maxHoursDaily;
			case "max_hours_weekly_exceeded":
				return enabledTypes.maxHoursWeekly;
			case "consecutive_days_exceeded":
				return enabledTypes.consecutiveDays;
			case "presence_requirement":
				return enabledTypes.presenceRequirement;
			default:
				return false;
		}
	});
}
