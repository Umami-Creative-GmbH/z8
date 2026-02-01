/**
 * Absence transformation for SAP SuccessFactors
 * Transforms AbsenceData to SAP SuccessFactors absence/time-off requests
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type { AbsenceData, WageTypeMapping } from "../../../types";
import type {
	SFAbsenceRequest,
	SuccessFactorsConfig,
	SuccessFactorsEmployeeMatchStrategy,
} from "../types";
import { getEmployeeIdFromAbsence, logMatchingStats } from "./employee-matcher";

const logger = createLogger("SFAbsenceTransformer");

/**
 * Transform absences to SAP SuccessFactors absence requests
 *
 * @param absences - Absences to transform
 * @param mappings - Wage type mappings for time-off type codes
 * @param config - SAP SuccessFactors configuration
 * @returns Array of absence requests with their source absence IDs, or null for skipped
 */
export function transformAbsences(
	absences: AbsenceData[],
	mappings: WageTypeMapping[],
	config: SuccessFactorsConfig,
): Array<{ request: SFAbsenceRequest; sourceId: string } | null> {
	const results: Array<{ request: SFAbsenceRequest; sourceId: string } | null> = [];

	// Build mapping lookup by absence category ID
	const absenceCategoryMappings = new Map<string, WageTypeMapping>();
	for (const mapping of mappings) {
		if (mapping.absenceCategoryId) {
			absenceCategoryMappings.set(mapping.absenceCategoryId, mapping);
		}
	}

	let matchedCount = 0;
	let unmatchedCount = 0;
	let skippedNoMapping = 0;

	for (const absence of absences) {
		// Get mapping for this absence category
		const mapping = absenceCategoryMappings.get(absence.absenceCategoryId);

		// Get SAP SuccessFactors time type code
		const timeType = getTimeTypeForAbsence(mapping);
		if (!timeType) {
			skippedNoMapping++;
			logger.debug(
				{ absenceId: absence.id, categoryId: absence.absenceCategoryId },
				"No SAP SuccessFactors time type mapping for absence category, skipping",
			);
			results.push(null);
			continue;
		}

		// Get employee identifier
		const userId = getEmployeeIdFromAbsence(absence, config.employeeMatchStrategy);
		if (!userId) {
			unmatchedCount++;
			logger.warn(
				{ absenceId: absence.id, employeeId: absence.employeeId },
				"Cannot determine SAP SuccessFactors user ID for absence",
			);
			results.push(null);
			continue;
		}
		matchedCount++;

		// Calculate duration in days
		const startDate = DateTime.fromISO(absence.startDate);
		const endDate = DateTime.fromISO(absence.endDate);
		const quantityInDays = Math.floor(endDate.diff(startDate, "days").days) + 1;

		const request: SFAbsenceRequest = {
			userId,
			timeType,
			startDate: absence.startDate,
			endDate: absence.endDate,
			quantityInDays,
			comment: absence.absenceCategoryName || undefined,
			externalCode: absence.id, // Track source for sync records
		};

		results.push({ request, sourceId: absence.id });
	}

	if (skippedNoMapping > 0) {
		logger.info(
			{ skippedNoMapping, total: absences.length },
			`${skippedNoMapping} absences skipped due to missing wage type mapping`,
		);
	}

	logMatchingStats(
		absences.length - skippedNoMapping,
		matchedCount,
		unmatchedCount,
		"absences",
	);

	logger.info(
		{
			inputCount: absences.length,
			outputCount: results.filter((r) => r !== null).length,
			skipped: skippedNoMapping + unmatchedCount,
		},
		"Transformed absences to SAP SuccessFactors time-off requests",
	);

	return results;
}

/**
 * Get SAP SuccessFactors time type code for an absence
 */
function getTimeTypeForAbsence(mapping: WageTypeMapping | undefined): string | null {
	if (!mapping) {
		return null;
	}

	// Try SAP SuccessFactors-specific code first, then fall back to other codes
	const timeType =
		mapping.successFactorsTimeTypeCode ||
		mapping.datevWageTypeCode ||
		mapping.wageTypeCode;

	return timeType || null;
}

/**
 * Aggregate absences by employee for CSV export
 * Expands multi-day absences into daily entries
 */
export function aggregateAbsencesForCSV(
	absences: AbsenceData[],
	mappings: WageTypeMapping[],
	strategy: SuccessFactorsEmployeeMatchStrategy,
	aggregatedData: Map<string, Map<string, Map<string, { hours: number; note: string }>>>,
): void {
	// Build mapping lookup
	const absenceCategoryMappings = new Map<string, WageTypeMapping>();
	for (const mapping of mappings) {
		if (mapping.absenceCategoryId) {
			absenceCategoryMappings.set(mapping.absenceCategoryId, mapping);
		}
	}

	for (const absence of absences) {
		const mapping = absenceCategoryMappings.get(absence.absenceCategoryId);
		const timeType = getTimeTypeForAbsence(mapping);
		if (!timeType) continue;

		const userId = getEmployeeIdFromAbsence(absence, strategy);
		if (!userId) continue;

		const note = absence.absenceCategoryName || "";

		// Expand multi-day absences into daily entries
		const startDate = DateTime.fromISO(absence.startDate).startOf("day");
		const endDate = DateTime.fromISO(absence.endDate).startOf("day");
		const days = Math.floor(endDate.diff(startDate, "days").days) + 1;

		for (let i = 0; i < days; i++) {
			const currentDate = startDate.plus({ days: i });
			const dateStr = currentDate.toISODate()!;

			// Initialize nested maps if needed
			if (!aggregatedData.has(userId)) {
				aggregatedData.set(userId, new Map());
			}
			const employeeData = aggregatedData.get(userId)!;

			if (!employeeData.has(dateStr)) {
				employeeData.set(dateStr, new Map());
			}
			const dateData = employeeData.get(dateStr)!;

			// Add 8 hours per day for absences
			const existing = dateData.get(timeType) || { hours: 0, note: "" };
			dateData.set(timeType, {
				hours: existing.hours + 8,
				note: note || existing.note,
			});
		}
	}
}
