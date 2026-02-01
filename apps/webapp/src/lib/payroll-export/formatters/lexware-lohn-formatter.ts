/**
 * Lexware lohn+gehalt CSV formatter
 * Implements Lexware ASCII import format specification for payroll data
 *
 * Format specification (from Lexware documentation):
 * - Delimiter: Semicolon (;)
 * - Decimal separator: Comma (,)
 * - Required columns: Jahr, Monat, Personalnummer, Lohnartennummer, Wert
 * - Optional columns: Stunden, Stundensatz
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type {
	AbsenceData,
	ExportResult,
	IPayrollExportFormatter,
	LexwareLohnConfig,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";

const logger = createLogger("LexwareLohnFormatter");

/**
 * Default wage type code for unmapped categories
 */
const DEFAULT_WAGE_TYPE_CODE = "100";

/**
 * Maximum work periods for synchronous export
 */
const SYNC_THRESHOLD = 500;

/**
 * Lexware lohn+gehalt CSV formatter
 */
export class LexwareLohnFormatter implements IPayrollExportFormatter {
	readonly formatId = "lexware_lohn";
	readonly formatName = "Lexware lohn+gehalt";
	readonly version = "2024.1";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	validateConfig(config: Record<string, unknown>): { valid: boolean; errors?: string[] } {
		const errors: string[] = [];
		const lexwareConfig = config as Partial<LexwareLohnConfig>;

		if (
			!lexwareConfig.personnelNumberType ||
			!["employeeNumber", "employeeId"].includes(lexwareConfig.personnelNumberType)
		) {
			errors.push("Personnel number type must be 'employeeNumber' or 'employeeId'");
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
			"Transforming to Lexware lohn+gehalt format",
		);

		const lexwareConfig = config as unknown as LexwareLohnConfig;

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

		// Group work periods by employee, year, month, and wage type
		const aggregatedData = this.aggregateWorkPeriods(
			workPeriods,
			workCategoryMappings,
			lexwareConfig,
		);

		// Add absence data
		this.addAbsenceData(absences, absenceCategoryMappings, aggregatedData, lexwareConfig);

		// Generate CSV content
		const lines: string[] = [];

		// Header row
		lines.push(this.generateHeaderRow(lexwareConfig));

		// Data rows - sorted by personnel number, year, month
		const sortedEmployees = Array.from(aggregatedData.keys()).sort();
		for (const personnelNumber of sortedEmployees) {
			const employeeData = aggregatedData.get(personnelNumber)!;
			const sortedKeys = Array.from(employeeData.keys()).sort();

			for (const key of sortedKeys) {
				const wageTypes = employeeData.get(key)!;
				const [year, month] = key.split("-");
				const sortedWageTypes = Array.from(wageTypes.entries()).sort((a, b) =>
					a[0].localeCompare(b[0]),
				);

				for (const [wageTypeCode, data] of sortedWageTypes) {
					if (data.value > 0 || lexwareConfig.includeZeroHours) {
						lines.push(
							this.generateDataRow(
								personnelNumber,
								year,
								month,
								wageTypeCode,
								data.value,
								data.hours,
								data.hourlyRate,
								lexwareConfig,
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
			},
			"Lexware lohn+gehalt export generated",
		);

		// Join with Windows-style line endings
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
	 * Aggregate work periods by employee, year-month, and wage type
	 * Returns: Map<PersonnelNumber, Map<Year-Month, Map<WageTypeCode, AggregatedData>>>
	 */
	private aggregateWorkPeriods(
		workPeriods: WorkPeriodData[],
		workCategoryMappings: Map<string, WageTypeMapping>,
		config: LexwareLohnConfig,
	): Map<string, Map<string, Map<string, { value: number; hours: number; hourlyRate: number | null }>>> {
		const result = new Map<string, Map<string, Map<string, { value: number; hours: number; hourlyRate: number | null }>>>();

		for (const period of workPeriods) {
			if (!period.durationMinutes || !period.endTime) continue;

			const personnelNumber = this.getPersonnelNumber(period, config);
			const year = period.startTime.toFormat("yyyy");
			const month = period.startTime.toFormat("MM");
			const yearMonth = `${year}-${month}`;
			const hours = period.durationMinutes / 60;

			// Determine wage type code (use Lexware-specific column)
			let wageTypeCode = DEFAULT_WAGE_TYPE_CODE;

			if (period.workCategoryId) {
				const mapping = workCategoryMappings.get(period.workCategoryId);
				// Prefer lexwareWageTypeCode, fall back to legacy wageTypeCode
				const mappedCode = mapping?.lexwareWageTypeCode || mapping?.wageTypeCode;
				if (mapping && mappedCode) {
					wageTypeCode = mappedCode;
				}
			}

			// Initialize nested maps if needed
			if (!result.has(personnelNumber)) {
				result.set(personnelNumber, new Map());
			}
			const employeeData = result.get(personnelNumber)!;

			if (!employeeData.has(yearMonth)) {
				employeeData.set(yearMonth, new Map());
			}
			const monthData = employeeData.get(yearMonth)!;

			// Aggregate hours and value (Wert = hours for time-based entries)
			const existing = monthData.get(wageTypeCode) || { value: 0, hours: 0, hourlyRate: null };
			monthData.set(wageTypeCode, {
				value: existing.value + hours,
				hours: existing.hours + hours,
				hourlyRate: existing.hourlyRate, // Could be derived from employee rate
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
		aggregatedData: Map<string, Map<string, Map<string, { value: number; hours: number; hourlyRate: number | null }>>>,
		config: LexwareLohnConfig,
	): void {
		for (const absence of absences) {
			const mapping = absenceCategoryMappings.get(absence.absenceCategoryId);
			// Prefer lexwareWageTypeCode, fall back to legacy wageTypeCode
			const mappedCode = mapping?.lexwareWageTypeCode || mapping?.wageTypeCode;
			if (!mapping || !mappedCode) continue; // Skip if no mapping

			const personnelNumber = this.getPersonnelNumberFromAbsence(absence, config);
			const wageTypeCode = mappedCode;

			// Calculate days
			const startDate = DateTime.fromISO(absence.startDate).startOf("day");
			const endDate = DateTime.fromISO(absence.endDate).startOf("day");
			const days = Math.floor(endDate.diff(startDate, "days").days) + 1;

			// Add an entry for each day of the absence (grouped by month)
			for (let i = 0; i < days; i++) {
				const currentDate = startDate.plus({ days: i });
				const year = currentDate.toFormat("yyyy");
				const month = currentDate.toFormat("MM");
				const yearMonth = `${year}-${month}`;

				// Initialize nested maps if needed
				if (!aggregatedData.has(personnelNumber)) {
					aggregatedData.set(personnelNumber, new Map());
				}
				const employeeData = aggregatedData.get(personnelNumber)!;

				if (!employeeData.has(yearMonth)) {
					employeeData.set(yearMonth, new Map());
				}
				const monthData = employeeData.get(yearMonth)!;

				// For absences, we typically record 8 hours (full day)
				const existing = monthData.get(wageTypeCode) || { value: 0, hours: 0, hourlyRate: null };
				monthData.set(wageTypeCode, {
					value: existing.value + 8, // Full day = 8 hours
					hours: existing.hours + 8,
					hourlyRate: existing.hourlyRate,
				});
			}
		}
	}

	/**
	 * Get personnel number from work period based on config
	 */
	private getPersonnelNumber(period: WorkPeriodData, config: LexwareLohnConfig): string {
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
	private getPersonnelNumberFromAbsence(absence: AbsenceData, config: LexwareLohnConfig): string {
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
	private generateHeaderRow(config: LexwareLohnConfig): string {
		const headers = [
			"Jahr",
			"Monat",
			"Personalnummer",
			"Lohnartennummer",
			"Wert",
		];

		if (config.includeStunden) {
			headers.push("Stunden");
		}
		if (config.includeStundensatz) {
			headers.push("Stundensatz");
		}

		return headers.map((col) => this.escapeCSV(col)).join(";");
	}

	/**
	 * Generate CSV data row
	 */
	private generateDataRow(
		personnelNumber: string,
		year: string,
		month: string,
		wageTypeCode: string,
		value: number,
		hours: number,
		hourlyRate: number | null,
		config: LexwareLohnConfig,
	): string {
		const fields = [
			this.escapeCSV(year),
			this.escapeCSV(month),
			this.escapeCSV(personnelNumber),
			this.escapeCSV(wageTypeCode),
			this.formatDecimal(value), // Wert with comma as decimal separator
		];

		if (config.includeStunden) {
			fields.push(this.formatDecimal(hours));
		}
		if (config.includeStundensatz) {
			fields.push(hourlyRate !== null ? this.formatDecimal(hourlyRate) : "");
		}

		return fields.join(";");
	}

	/**
	 * Escape value for CSV (Lexware uses semicolon as separator)
	 */
	private escapeCSV(value: string): string {
		if (!value) return "";
		// Only wrap in quotes if necessary
		if (value.includes(";") || value.includes('"') || value.includes("\n")) {
			return `"${value.replace(/"/g, '""')}"`;
		}
		return value;
	}

	/**
	 * Format number as decimal with comma separator (German format)
	 * Lexware requires comma as decimal separator, no leading zeros
	 */
	private formatDecimal(value: number): string {
		// Format with 2 decimal places and replace period with comma
		return value.toFixed(2).replace(".", ",");
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
		return `lexware_lohn_${dateStr}_${now.toFormat("yyyyMMdd_HHmmss")}.csv`;
	}
}

/**
 * Singleton instance
 */
export const lexwareLohnFormatter = new LexwareLohnFormatter();
