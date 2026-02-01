/**
 * DATEV Lohn & Gehalt CSV formatter
 * Implements DATEV ASCII format specification for payroll data
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import type {
	AbsenceData,
	DatevLohnConfig,
	ExportResult,
	IPayrollExportFormatter,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";

const logger = createLogger("DatevLohnFormatter");

/**
 * Default wage type code for unmapped categories
 */
const DEFAULT_WAGE_TYPE_CODE = "1000";

/**
 * Maximum work periods for synchronous export
 */
const SYNC_THRESHOLD = 500;

/**
 * DATEV Lohn & Gehalt CSV formatter
 */
export class DatevLohnFormatter implements IPayrollExportFormatter {
	readonly formatId = "datev_lohn";
	readonly formatName = "DATEV Lohn & Gehalt";
	readonly version = "2024.1";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	validateConfig(config: Record<string, unknown>): { valid: boolean; errors?: string[] } {
		const errors: string[] = [];
		const datevConfig = config as Partial<DatevLohnConfig>;

		if (!datevConfig.mandantennummer) {
			errors.push("Mandantennummer (client number) is required");
		} else if (!/^\d{1,5}$/.test(datevConfig.mandantennummer)) {
			errors.push("Mandantennummer must be 1-5 digits");
		}

		if (!datevConfig.beraternummer) {
			errors.push("Beraternummer (consultant number) is required");
		} else if (!/^\d{1,7}$/.test(datevConfig.beraternummer)) {
			errors.push("Beraternummer must be 1-7 digits");
		}

		if (
			!datevConfig.personnelNumberType ||
			!["employeeNumber", "employeeId"].includes(datevConfig.personnelNumberType)
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
			"Transforming to DATEV Lohn format",
		);

		const datevConfig = config as unknown as DatevLohnConfig;

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
			datevConfig,
		);

		// Add absence data
		this.addAbsenceData(absences, absenceCategoryMappings, aggregatedData, datevConfig);

		// Generate CSV content
		const lines: string[] = [];

		// Header row
		lines.push(this.generateHeaderRow());

		// Data rows
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
					if (data.hours > 0 || datevConfig.includeZeroHours) {
						lines.push(
							this.generateDataRow(
								personnelNumber,
								wageTypeCode,
								data.hours,
								dateStr,
								data.note,
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
			"DATEV Lohn export generated",
		);

		// Join with Windows-style line endings (required by DATEV)
		const csvContent = lines.join("\r\n");

		return {
			fileName,
			content: csvContent,
			mimeType: "text/csv",
			encoding: "utf-8", // DATEV supports UTF-8 since 2020
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
	 */
	private aggregateWorkPeriods(
		workPeriods: WorkPeriodData[],
		workCategoryMappings: Map<string, WageTypeMapping>,
		config: DatevLohnConfig,
	): Map<string, Map<string, Map<string, { hours: number; note: string }>>> {
		const result = new Map<string, Map<string, Map<string, { hours: number; note: string }>>>();

		for (const period of workPeriods) {
			if (!period.durationMinutes || !period.endTime) continue;

			const personnelNumber = this.getPersonnelNumber(period, config);
			const dateStr = period.startTime.toISODate()!;
			const hours = period.durationMinutes / 60;

			// Determine wage type code
			let wageTypeCode = DEFAULT_WAGE_TYPE_CODE;
			let note = "";

			if (period.workCategoryId) {
				const mapping = workCategoryMappings.get(period.workCategoryId);
				if (mapping && mapping.wageTypeCode) {
					wageTypeCode = mapping.wageTypeCode;
					note = mapping.wageTypeName || period.workCategoryName || "";
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
		config: DatevLohnConfig,
	): void {
		for (const absence of absences) {
			const mapping = absenceCategoryMappings.get(absence.absenceCategoryId);
			if (!mapping || !mapping.wageTypeCode) continue; // Skip if no mapping

			const personnelNumber = this.getPersonnelNumberFromAbsence(absence, config);
			const wageTypeCode = mapping.wageTypeCode;
			const note = mapping.wageTypeName || absence.absenceCategoryName || "";

			// Calculate days (DATEV typically uses days for absences, not hours)
			// Use startOf('day') to ensure consistent date comparison
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
				// This could be configurable based on the employee's work schedule
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
	private getPersonnelNumber(period: WorkPeriodData, config: DatevLohnConfig): string {
		if (config.personnelNumberType === "employeeNumber" && period.employeeNumber) {
			return period.employeeNumber;
		}
		return period.employeeId;
	}

	/**
	 * Get personnel number from absence based on config
	 */
	private getPersonnelNumberFromAbsence(absence: AbsenceData, config: DatevLohnConfig): string {
		if (config.personnelNumberType === "employeeNumber" && absence.employeeNumber) {
			return absence.employeeNumber;
		}
		return absence.employeeId;
	}

	/**
	 * Generate CSV header row
	 */
	private generateHeaderRow(): string {
		// DATEV Lohn standard columns
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
	): string {
		return [
			this.escapeCSV(personnelNumber),
			this.escapeCSV(wageTypeCode),
			this.formatHours(hours),
			this.escapeCSV(dateStr),
			this.escapeCSV(note),
		].join(";");
	}

	/**
	 * Escape value for CSV (DATEV uses semicolon as separator)
	 */
	private escapeCSV(value: string): string {
		if (!value) return '""';
		// Always wrap in quotes and escape internal quotes
		return `"${value.replace(/"/g, '""')}"`;
	}

	/**
	 * Format hours as decimal with 2 decimal places
	 */
	private formatHours(hours: number): string {
		return hours.toFixed(2);
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
		return `datev_lohn_${dateStr}_${now.toFormat("yyyyMMdd_HHmmss")}.csv`;
	}
}

/**
 * Singleton instance
 */
export const datevLohnFormatter = new DatevLohnFormatter();
