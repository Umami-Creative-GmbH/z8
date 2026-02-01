/**
 * Work period transformation for SAP SuccessFactors
 * Transforms WorkPeriodData to SAP SuccessFactors time record requests
 */
import { createLogger } from "@/lib/logger";
import type { WorkPeriodData, WageTypeMapping } from "../../../types";
import type {
	SFTimeRecordRequest,
	SuccessFactorsConfig,
	SuccessFactorsEmployeeMatchStrategy,
} from "../types";
import { getEmployeeIdFromWorkPeriod, logMatchingStats } from "./employee-matcher";

const logger = createLogger("SFTimeTransformer");

/**
 * Default time type code when no mapping exists
 */
const DEFAULT_TIME_TYPE = "REGULAR";

/**
 * Transform work periods to SAP SuccessFactors time record requests
 *
 * @param workPeriods - Work periods to transform
 * @param mappings - Wage type mappings for time type codes
 * @param config - SAP SuccessFactors configuration
 * @returns Array of time record requests with their source work period IDs
 */
export function transformWorkPeriods(
	workPeriods: WorkPeriodData[],
	mappings: WageTypeMapping[],
	config: SuccessFactorsConfig,
): Array<{ request: SFTimeRecordRequest; sourceId: string }> {
	const results: Array<{ request: SFTimeRecordRequest; sourceId: string }> = [];

	// Build mapping lookup by work category ID
	const workCategoryMappings = new Map<string, WageTypeMapping>();
	for (const mapping of mappings) {
		if (mapping.workCategoryId) {
			workCategoryMappings.set(mapping.workCategoryId, mapping);
		}
	}

	let matchedCount = 0;
	let unmatchedCount = 0;

	for (const period of workPeriods) {
		// Skip incomplete periods
		if (!period.endTime || period.durationMinutes === null) {
			logger.debug({ periodId: period.id }, "Skipping incomplete work period");
			continue;
		}

		// Skip zero-hour periods if configured
		if (!config.includeZeroHours && period.durationMinutes === 0) {
			continue;
		}

		// Get employee identifier
		const userId = getEmployeeIdFromWorkPeriod(period, config.employeeMatchStrategy);
		if (!userId) {
			unmatchedCount++;
			logger.warn(
				{ periodId: period.id, employeeId: period.employeeId },
				"Cannot determine SAP SuccessFactors user ID for work period",
			);
			continue;
		}
		matchedCount++;

		// Determine time type from mapping
		const timeType = getTimeTypeForWorkPeriod(period, workCategoryMappings);

		// Build comment from category and project
		const commentParts: string[] = [];
		if (period.workCategoryName) commentParts.push(period.workCategoryName);
		if (period.projectName) commentParts.push(period.projectName);

		// Calculate hours as decimal
		const quantityInHours = period.durationMinutes / 60;

		const request: SFTimeRecordRequest = {
			userId,
			startDate: period.startTime.toISODate()!,
			startTime: period.startTime.toFormat("HH:mm"),
			endDate: period.endTime.toISODate()!,
			endTime: period.endTime.toFormat("HH:mm"),
			timeType,
			quantityInHours: Math.round(quantityInHours * 100) / 100, // Round to 2 decimal places
			comment: commentParts.length > 0 ? commentParts.join(" - ") : undefined,
			externalCode: period.id, // Track source for sync records
		};

		results.push({ request, sourceId: period.id });
	}

	logMatchingStats(
		workPeriods.length,
		matchedCount,
		unmatchedCount,
		"work periods",
	);

	logger.info(
		{ inputCount: workPeriods.length, outputCount: results.length },
		"Transformed work periods to SAP SuccessFactors time records",
	);

	return results;
}

/**
 * Get SAP SuccessFactors time type code for a work period
 */
function getTimeTypeForWorkPeriod(
	period: WorkPeriodData,
	mappings: Map<string, WageTypeMapping>,
): string {
	if (!period.workCategoryId) {
		return DEFAULT_TIME_TYPE;
	}

	const mapping = mappings.get(period.workCategoryId);
	if (!mapping) {
		return DEFAULT_TIME_TYPE;
	}

	// Try SAP SuccessFactors-specific code first, then fall back to other codes
	const timeType =
		mapping.successFactorsTimeTypeCode ||
		mapping.datevWageTypeCode ||
		mapping.wageTypeCode;

	return timeType || DEFAULT_TIME_TYPE;
}

/**
 * Aggregate work periods by employee and date for CSV export
 * Returns aggregated data suitable for CSV generation
 */
export function aggregateWorkPeriodsForCSV(
	workPeriods: WorkPeriodData[],
	mappings: WageTypeMapping[],
	strategy: SuccessFactorsEmployeeMatchStrategy,
	includeZeroHours: boolean,
): Map<string, Map<string, Map<string, { hours: number; note: string }>>> {
	const result = new Map<
		string,
		Map<string, Map<string, { hours: number; note: string }>>
	>();

	// Build mapping lookup
	const workCategoryMappings = new Map<string, WageTypeMapping>();
	for (const mapping of mappings) {
		if (mapping.workCategoryId) {
			workCategoryMappings.set(mapping.workCategoryId, mapping);
		}
	}

	for (const period of workPeriods) {
		if (!period.endTime || period.durationMinutes === null) continue;
		if (!includeZeroHours && period.durationMinutes === 0) continue;

		const userId = getEmployeeIdFromWorkPeriod(period, strategy);
		if (!userId) continue;

		const dateStr = period.startTime.toISODate()!;
		const hours = period.durationMinutes / 60;
		const timeType = getTimeTypeForWorkPeriod(period, workCategoryMappings);

		// Build note
		const noteParts: string[] = [];
		if (period.workCategoryName) noteParts.push(period.workCategoryName);
		if (period.projectName) noteParts.push(period.projectName);
		const note = noteParts.join(" - ");

		// Initialize nested maps
		if (!result.has(userId)) {
			result.set(userId, new Map());
		}
		const employeeData = result.get(userId)!;

		if (!employeeData.has(dateStr)) {
			employeeData.set(dateStr, new Map());
		}
		const dateData = employeeData.get(dateStr)!;

		// Aggregate hours
		const existing = dateData.get(timeType) || { hours: 0, note: "" };
		dateData.set(timeType, {
			hours: existing.hours + hours,
			note: note || existing.note,
		});
	}

	return result;
}
