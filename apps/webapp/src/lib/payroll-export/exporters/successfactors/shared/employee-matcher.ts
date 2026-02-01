/**
 * Employee matching utilities for SAP SuccessFactors
 * Maps local employees to SAP SuccessFactors user identifiers
 */
import { createLogger } from "@/lib/logger";
import type { WorkPeriodData, AbsenceData } from "../../../types";
import type { SuccessFactorsEmployeeMatchStrategy } from "../types";

const logger = createLogger("SFEmployeeMatcher");

/**
 * Employee data that can be used for matching
 */
interface MatchableEmployee {
	employeeId: string;
	employeeNumber: string | null;
	firstName: string | null;
	lastName: string | null;
}

/**
 * Get employee identifier for SAP SuccessFactors based on matching strategy
 *
 * @param employee - Work period or absence data containing employee info
 * @param strategy - The matching strategy to use
 * @returns The identifier to use in SAP SuccessFactors, or null if not available
 */
export function getEmployeeIdentifier(
	employee: MatchableEmployee,
	strategy: SuccessFactorsEmployeeMatchStrategy,
): string | null {
	switch (strategy) {
		case "userId":
			// Use employee number as SAP SuccessFactors userId
			if (employee.employeeNumber) {
				return employee.employeeNumber;
			}
			logger.warn(
				{ employeeId: employee.employeeId },
				"Employee number not set for userId matching strategy, falling back to employeeId",
			);
			return employee.employeeId;

		case "personIdExternal":
			// Use employee number as personIdExternal (external HR system ID)
			if (employee.employeeNumber) {
				return employee.employeeNumber;
			}
			logger.warn(
				{ employeeId: employee.employeeId },
				"Employee number not set for personIdExternal matching, cannot match",
			);
			return null;

		case "email":
			// Email matching requires email field which is not in current data types
			// Fall back to employee number with warning
			logger.warn(
				{ employeeId: employee.employeeId },
				"Email matching not available in current data, falling back to employeeNumber",
			);
			return employee.employeeNumber || null;

		default:
			logger.error({ strategy }, "Unknown employee matching strategy");
			return null;
	}
}

/**
 * Get employee identifier from a work period
 */
export function getEmployeeIdFromWorkPeriod(
	period: WorkPeriodData,
	strategy: SuccessFactorsEmployeeMatchStrategy,
): string | null {
	return getEmployeeIdentifier(period, strategy);
}

/**
 * Get employee identifier from an absence
 */
export function getEmployeeIdFromAbsence(
	absence: AbsenceData,
	strategy: SuccessFactorsEmployeeMatchStrategy,
): string | null {
	return getEmployeeIdentifier(absence, strategy);
}

/**
 * Log statistics about employee matching results
 */
export function logMatchingStats(
	total: number,
	matched: number,
	unmatched: number,
	context: string,
): void {
	if (unmatched > 0) {
		logger.warn(
			{ total, matched, unmatched, context },
			`${unmatched} of ${total} ${context} could not be matched to SAP SuccessFactors employees`,
		);
	} else {
		logger.info(
			{ total, matched, context },
			`All ${total} ${context} matched to SAP SuccessFactors employees`,
		);
	}
}
