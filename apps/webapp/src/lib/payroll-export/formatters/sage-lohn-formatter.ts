/**
 * Sage Lohn CSV formatter
 * Supports both DATEV-compatible and Sage-native CSV formats
 *
 * Sage-native format specification:
 * - Delimiter: Semicolon (;)
 * - Text quoting: Double quotes (") - always quoted
 * - Decimal separator: Period (.) for DATEV-compatible, Comma (,) for Sage-native
 * - Required columns: Personalnummer, Lohnart, Wert/Betrag, Datum, Bemerkung
 * - Line endings: Windows CRLF (\r\n)
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type {
	AbsenceData,
	ExportResult,
	IPayrollExportFormatter,
	SageLohnConfig,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";

const logger = createLogger("SageLohnFormatter");

/**
 * Default wage type code for unmapped categories
 */
const DEFAULT_WAGE_TYPE_CODE = "1000";

/**
 * Maximum work periods for synchronous export
 */
const SYNC_THRESHOLD = 500;

/**
 * Sage Lohn CSV formatter
 */
export class SageLohnFormatter implements IPayrollExportFormatter {
	readonly formatId = "sage_lohn";
	readonly formatName = "Sage Lohn";
	readonly version = "2024.1";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	validateConfig(config: Record<string, unknown>): { valid: boolean; errors?: string[] } {
		const errors: string[] = [];
		const sageConfig = config as Partial<SageLohnConfig>;

		if (
			!sageConfig.personnelNumberType ||
			!["employeeNumber", "employeeId"].includes(sageConfig.personnelNumberType)
		) {
			errors.push("Personnel number type must be 'employeeNumber' or 'employeeId'");
		}

		if (
			!sageConfig.outputFormat ||
			!["datev_compatible", "sage_native"].includes(sageConfig.outputFormat)
		) {
			errors.push("Output format must be 'datev_compatible' or 'sage_native'");
		}

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}

	transform(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): ExportResult {
		logger.info(
			{ workPeriodCount: workPeriods.length, absenceCount: absences.length },
			"Transforming to Sage Lohn format",
		);

		const sageConfig = config as unknown as SageLohnConfig;

		// Build mapping lookups
		const workCategoryMappings = new Map<string, WageTypeMapping>();
		const absenceCategoryMappings = new Map<string, WageTypeMapping>();
		const specialCategoryMappings = new Map<string, WageTypeMapping>();

		for (const mapping of mappings) {
			if (mapping.workCategoryId) {
				workCategoryMappings.set(mapping.workCategoryId, mapping);
			}
			if (mapping.absenceCategoryId) {
				absenceCategoryMappings.set(mapping.absenceCategoryId, mapping);
			}
			if (mapping.specialCategory) {
				specialCategoryMappings.set(mapping.specialCategory, mapping);
			}
		}

		// Group work periods by employee and date
		const aggregatedData = this.aggregateWorkPeriods(
			workPeriods,
			workCategoryMappings,
			sageConfig,
		);

		// Add absence data
		this.addAbsenceData(absences, absenceCategoryMappings, aggregatedData, sageConfig);

		// Generate CSV content based on output format
		const lines: string[] = [];

		// Header row
		lines.push(this.generateHeaderRow(sageConfig));

		// Data rows - sorted by personnel number, date
		const sortedEmployees = Array.from(aggregatedData.keys()).sort();
		for (const personnelNumber of sortedEmployees) {
			const employeeData = aggregatedData.get(personnelNumber)!;
			const sortedDates = Array.from(employeeData.keys()).sort();

			for (const dateStr of sortedDates) {
				const wageTypes = employeeData.get(dateStr)!;
				const sortedWageTypes = Array.from(wageTypes.entries()).sort((a, b) =>
					a[0].localeCompare(b[0]),
				);

				for (const [wageTypeCode, data] of sortedWageTypes) {
					if (data.hours > 0 || sageConfig.includeZeroHours) {
						lines.push(
							this.generateDataRow(
								personnelNumber,
								wageTypeCode,
								data.hours,
								dateStr,
								data.note,
								sageConfig,
							),
						);
					}
				}
			}
		}

		// Calculate metadata
		const uniqueEmployees = new Set(workPeriods.map((p) => p.employeeId));
		absences.forEach((a) => uniqueEmployees.add(a.employeeId));

		const dateRange = this.getDateRange(workPeriods, absences);
		const fileName = this.generateFileName(dateRange);

		logger.info(
			{
				lineCount: lines.length,
				employeeCount: uniqueEmployees.size,
				fileName,
				outputFormat: sageConfig.outputFormat,
			},
			"Sage Lohn export generated",
		);

		// Join with Windows-style line endings (required for German payroll software)
		const csvContent = lines.join("\r\n");

		return {
			fileName,
			content: csvContent,
			mimeType: "text/csv",
			encoding: "utf-8",
			metadata: {
				workPeriodCount: workPeriods.length,
				employeeCount: uniqueEmployees.size,
				dateRange: {
					start: dateRange.start?.toISODate() || "",
					end: dateRange.end?.toISODate() || "",
				},
			},
		};
	}

	/**
	 * Aggregate work periods by employee, date, and wage type
	 * Returns: Map<PersonnelNumber, Map<Date, Map<WageTypeCode, AggregatedData>>>
	 */
	private aggregateWorkPeriods(
		workPeriods: WorkPeriodData[],
		workCategoryMappings: Map<string, WageTypeMapping>,
		config: SageLohnConfig,
	): Map<string, Map<string, Map<string, { hours: number; note: string }>>> {
		const result = new Map<string, Map<string, Map<string, { hours: number; note: string }>>>();

		for (const period of workPeriods) {
			if (!period.durationMinutes || !period.endTime) continue;

			const personnelNumber = this.getPersonnelNumber(period, config);
			const dateStr = period.startTime.toISODate()!;
			const hours = period.durationMinutes / 60;

			// Determine wage type code (prefer Sage-specific, fall back to DATEV, then legacy)
			let wageTypeCode = DEFAULT_WAGE_TYPE_CODE;
			let note = "";

			if (period.workCategoryId) {
				const mapping = workCategoryMappings.get(period.workCategoryId);
				const mappedCode =
					mapping?.sageWageTypeCode ||
					mapping?.datevWageTypeCode ||
					mapping?.wageTypeCode;
				if (mapping && mappedCode) {
					wageTypeCode = mappedCode;
					note =
						mapping.sageWageTypeName ||
						mapping.datevWageTypeName ||
						mapping.wageTypeName ||
						period.workCategoryName ||
						"";
				} else {
					note = period.workCategoryName || "";
				}
			}

			// Add project name to note if present
			if (period.projectName) {
				note = note ? `${note} - ${period.projectName}` : period.projectName;
			}

			// Initialize nested maps if needed
			if (!result.has(personnelNumber)) {
				result.set(personnelNumber, new Map());
			}
			const employeeData = result.get(personnelNumber)!;

			if (!employeeData.has(dateStr)) {
				employeeData.set(dateStr, new Map());
			}
			const dateData = employeeData.get(dateStr)!;

			// Aggregate hours
			const existing = dateData.get(wageTypeCode) || { hours: 0, note: "" };
			dateData.set(wageTypeCode, {
				hours: existing.hours + hours,
				note: note || existing.note,
			});
		}

		return result;
	}

	/**
	 * Add absence data to aggregated results
	 */
	private addAbsenceData(
		absences: AbsenceData[],
		absenceCategoryMappings: Map<string, WageTypeMapping>,
		aggregatedData: Map<string, Map<string, Map<string, { hours: number; note: string }>>>,
		config: SageLohnConfig,
	): void {
		for (const absence of absences) {
			const mapping = absenceCategoryMappings.get(absence.absenceCategoryId);
			// Prefer Sage-specific, fall back to DATEV, then legacy
			const mappedCode =
				mapping?.sageWageTypeCode || mapping?.datevWageTypeCode || mapping?.wageTypeCode;
			if (!mapping || !mappedCode) continue; // Skip if no mapping

			const personnelNumber = this.getPersonnelNumberFromAbsence(absence, config);
			const wageTypeCode = mappedCode;
			const note =
				mapping.sageWageTypeName ||
				mapping.datevWageTypeName ||
				mapping.wageTypeName ||
				absence.absenceCategoryName ||
				"";

			// Calculate days
			const startDate = DateTime.fromISO(absence.startDate).startOf("day");
			const endDate = DateTime.fromISO(absence.endDate).startOf("day");
			const days = Math.floor(endDate.diff(startDate, "days").days) + 1;

			// Add an entry for each day of the absence
			for (let i = 0; i < days; i++) {
				const currentDate = startDate.plus({ days: i });
				const dateStr = currentDate.toISODate()!;

				// Initialize nested maps if needed
				if (!aggregatedData.has(personnelNumber)) {
					aggregatedData.set(personnelNumber, new Map());
				}
				const employeeData = aggregatedData.get(personnelNumber)!;

				if (!employeeData.has(dateStr)) {
					employeeData.set(dateStr, new Map());
				}
				const dateData = employeeData.get(dateStr)!;

				// For absences, we typically record 8 hours (full day)
				const existing = dateData.get(wageTypeCode) || { hours: 0, note: "" };
				dateData.set(wageTypeCode, {
					hours: existing.hours + 8, // Full day
					note: note || existing.note,
				});
			}
		}
	}

	/**
	 * Get personnel number from work period based on config
	 */
	private getPersonnelNumber(period: WorkPeriodData, config: SageLohnConfig): string {
		if (config.personnelNumberType === "employeeNumber") {
			if (period.employeeNumber) {
				return period.employeeNumber;
			}
			logger.warn(
				{ employeeId: period.employeeId, periodId: period.id },
				"Employee number not set, falling back to employeeId",
			);
		}
		return period.employeeId;
	}

	/**
	 * Get personnel number from absence based on config
	 */
	private getPersonnelNumberFromAbsence(absence: AbsenceData, config: SageLohnConfig): string {
		if (config.personnelNumberType === "employeeNumber") {
			if (absence.employeeNumber) {
				return absence.employeeNumber;
			}
			logger.warn(
				{ employeeId: absence.employeeId, absenceId: absence.id },
				"Employee number not set, falling back to employeeId for absence",
			);
		}
		return absence.employeeId;
	}

	/**
	 * Generate CSV header row
	 */
	private generateHeaderRow(config: SageLohnConfig): string {
		// Sage uses same column names as DATEV
		return [
			"Personalnummer",
			"Lohnart",
			"Betrag",
			"Datum",
			"Bemerkung",
		]
			.map((col) => this.escapeCSV(col))
			.join(";");
	}

	/**
	 * Generate CSV data row
	 */
	private generateDataRow(
		personnelNumber: string,
		wageTypeCode: string,
		hours: number,
		dateStr: string,
		note: string,
		config: SageLohnConfig,
	): string {
		return [
			this.escapeCSV(personnelNumber),
			this.escapeCSV(wageTypeCode),
			this.escapeCSV(this.formatHours(hours, config)), // Quote the hours value to handle comma decimal separator
			this.escapeCSV(dateStr),
			this.escapeCSV(note),
		].join(";");
	}

	/**
	 * Escape value for CSV (Sage uses semicolon as separator)
	 */
	private escapeCSV(value: string): string {
		if (!value) return '""';
		// Always wrap in quotes and escape internal quotes
		return `"${value.replace(/"/g, '""')}"`;
	}

	/**
	 * Format hours as decimal
	 * DATEV-compatible: period as decimal separator (8.50)
	 * Sage-native: comma as decimal separator (8,50)
	 */
	private formatHours(hours: number, config: SageLohnConfig): string {
		const formatted = hours.toFixed(2);
		if (config.outputFormat === "sage_native") {
			return formatted.replace(".", ",");
		}
		return formatted;
	}

	/**
	 * Get date range from work periods and absences
	 */
	private getDateRange(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
	): { start: DateTime | null; end: DateTime | null } {
		let start: DateTime | null = null;
		let end: DateTime | null = null;

		for (const period of workPeriods) {
			if (!start || period.startTime < start) {
				start = period.startTime;
			}
			if (period.endTime && (!end || period.endTime > end)) {
				end = period.endTime;
			}
		}

		for (const absence of absences) {
			const absStart = DateTime.fromISO(absence.startDate);
			const absEnd = DateTime.fromISO(absence.endDate);

			if (!start || absStart < start) {
				start = absStart;
			}
			if (!end || absEnd > end) {
				end = absEnd;
			}
		}

		return { start, end };
	}

	/**
	 * Generate file name based on date range
	 */
	private generateFileName(dateRange: { start: DateTime | null; end: DateTime | null }): string {
		const now = DateTime.now();
		const dateStr = dateRange.start
			? dateRange.start.toFormat("yyyy-MM")
			: now.toFormat("yyyy-MM");
		return `sage_lohn_${dateStr}_${now.toFormat("yyyyMMdd_HHmmss")}.csv`;
	}
}

/**
 * Singleton instance
 */
export const sageLohnFormatter = new SageLohnFormatter();
