/**
 * Compliance Rule Engine Types
 *
 * Defines the interfaces for extensible compliance detection rules.
 */

import type { DateTime } from "luxon";
import type {
	ComplianceFindingEvidence,
	ComplianceFindingSeverity,
	ComplianceFindingType,
} from "@/db/schema/compliance-finding";

/**
 * Work period data used for compliance detection
 */
export interface WorkPeriodData {
	id: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	isActive: boolean;
}

/**
 * Employee with effective work policy
 */
export interface EmployeeWithPolicy {
	id: string;
	organizationId: string;
	firstName: string | null;
	lastName: string | null;
	timezone: string;
	policy: EffectivePolicy | null;
}

/**
 * Effective policy thresholds for compliance detection
 */
export interface EffectivePolicy {
	policyId: string;
	policyName: string;
	// Regulation limits
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	minRestPeriodMinutes: number | null;
	maxConsecutiveDays: number | null;
}

/**
 * Configuration overrides from compliance config
 */
export interface ComplianceThresholds {
	restPeriodMinutes: number | null;
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	maxConsecutiveDays: number | null;
}

/**
 * Input parameters for rule detection
 */
export interface RuleDetectionInput {
	employee: EmployeeWithPolicy;
	workPeriods: WorkPeriodData[];
	dateRange: {
		start: DateTime;
		end: DateTime;
	};
	thresholdOverrides: ComplianceThresholds | null;
}

/**
 * Result of a compliance rule detection
 */
export interface ComplianceFindingResult {
	employeeId: string;
	type: ComplianceFindingType;
	severity: ComplianceFindingSeverity;
	occurrenceDate: Date;
	periodStart: Date;
	periodEnd: Date;
	evidence: ComplianceFindingEvidence;
	workPolicyId: string | null;
}

/**
 * Interface for compliance detection rules
 *
 * Each rule implements this interface to detect specific violations.
 * Rules are composable and can be enabled/disabled per organization.
 */
export interface ComplianceRule {
	/** Unique identifier for this rule */
	readonly name: string;

	/** Type of finding this rule produces */
	readonly type: ComplianceFindingType;

	/** Human-readable description */
	readonly description: string;

	/**
	 * Detect violations for the given input
	 * @returns Array of findings (empty if no violations)
	 */
	detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]>;
}

/**
 * Calculate severity based on percentage over threshold
 */
export function calculateSeverity(
	actualValue: number,
	thresholdValue: number,
): ComplianceFindingSeverity {
	const percentOver = ((actualValue - thresholdValue) / thresholdValue) * 100;

	if (percentOver >= 25) {
		return "critical";
	}
	if (percentOver >= 10) {
		return "warning";
	}
	return "info";
}

/**
 * Calculate severity for shortfall (e.g., rest period too short)
 */
export function calculateSeverityForShortfall(
	actualValue: number,
	requiredValue: number,
): ComplianceFindingSeverity {
	const shortfallPercent = ((requiredValue - actualValue) / requiredValue) * 100;

	if (shortfallPercent >= 25) {
		return "critical";
	}
	if (shortfallPercent >= 10) {
		return "warning";
	}
	return "info";
}
