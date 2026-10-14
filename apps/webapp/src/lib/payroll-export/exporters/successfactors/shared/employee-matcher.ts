/**
 * Employee matching utilities for SAP SuccessFactors
 * Maps local employees to SAP SuccessFactors user identifiers
 */
import { createLogger } from "@/lib/logger";
import {
	CUSTOM_FIELD_IDENTIFIER,
	type PayrollIdentityRow,
	requirePersonnelIdentifier,
} from "../../../personnel-identifier";
import type { AbsenceData, WorkPeriodData } from "../../../types";
import type { SuccessFactorsEmployeeMatchStrategy } from "../types";

const logger = createLogger("SFEmployeeMatcher");

/**
 * Employee data that can be used for matching
 */
interface MatchableEmployee extends PayrollIdentityRow {
	firstName: string | null;
	lastName: string | null;
}

/**
 * The value SAP SuccessFactors matches an employee by, or null when the row
 * has none. Shared by the API exporter, the CSV formatter and the
 * duplicate-identifier check (#1199), so the check compares exactly what is
 * sent. Pure: a missing custom field value yields null here.
 */
export function successFactorsMatchValue(
	employee: PayrollIdentityRow,
	strategy: SuccessFactorsEmployeeMatchStrategy,
): string | null {
	switch (strategy) {
		case "userId":
			// The employee number is the userId; without one, the employee ID.
			return employee.employeeNumber || employee.employeeId;
		case "personIdExternal":
		// Email matching is not supported; email matches by employee number too.
		case "email":
			return employee.employeeNumber || null;
		case CUSTOM_FIELD_IDENTIFIER:
			// The frozen custom field value is the userId (#821); it never falls back.
			return employee.personnelIdentifier || null;
		default:
			return null;
	}
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
	if (strategy === CUSTOM_FIELD_IDENTIFIER) return requirePersonnelIdentifier(employee);
	warnAboutWeakMatch(employee, strategy);
	return successFactorsMatchValue(employee, strategy);
}

function warnAboutWeakMatch(
	employee: MatchableEmployee,
	strategy: SuccessFactorsEmployeeMatchStrategy,
): void {
	const context = { employeeId: employee.employeeId };
	switch (strategy) {
		case "userId":
			if (!employee.employeeNumber) {
				logger.warn(
					context,
					"Employee number not set for userId matching strategy, falling back to employeeId",
				);
			}
			return;
		case "personIdExternal":
			if (!employee.employeeNumber) {
				logger.warn(context, "Employee number not set for personIdExternal matching, cannot match");
			}
			return;
		case "email":
			logger.warn(
				context,
				"Email matching not available in current data, falling back to employeeNumber",
			);
			return;
		default:
			logger.error({ strategy }, "Unknown employee matching strategy");
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
