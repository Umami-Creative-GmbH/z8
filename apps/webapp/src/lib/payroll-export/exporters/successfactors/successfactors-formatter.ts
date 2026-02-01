/**
 * SAP SuccessFactors CSV Formatter
 * Generates CSV files compatible with SAP SuccessFactors import
 *
 * CSV format specification:
 * - Delimiter: Semicolon (;)
 * - Text quoting: Double quotes (") - always quoted
 * - Encoding: UTF-8 with BOM for Excel compatibility
 * - Line endings: CRLF (\r\n)
 * - Columns: User ID, Date, Time Type, Hours, Comment
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { validateSuccessFactorsConfig } from "./shared/config-validator";
import {
	aggregateWorkPeriodsForCSV,
} from "./shared/time-transformer";
import { aggregateAbsencesForCSV } from "./shared/absence-transformer";
import type {
	IPayrollExportFormatter,
	WorkPeriodData,
	AbsenceData,
	WageTypeMapping,
	ExportResult,
} from "../../types";
import type { SuccessFactorsConfig } from "./types";
import { DEFAULT_SUCCESSFACTORS_CONFIG } from "./types";

const logger = createLogger("SuccessFactorsFormatter");

const SYNC_THRESHOLD = 500;

/**
 * SAP SuccessFactors CSV Formatter
 */
export class SuccessFactorsFormatter implements IPayrollExportFormatter {
	readonly formatId = "successfactors_csv";
	readonly formatName = "SAP SuccessFactors (CSV)";
	readonly version = "1.0.0";

	getSyncThreshold(): number {
		return SYNC_THRESHOLD;
	}

	validateConfig(config: Record<string, unknown>): { valid: boolean; errors?: string[] } {
		return validateSuccessFactorsConfig(config);
	}

	transform(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
	): ExportResult {
		logger.info(
			{ workPeriodCount: workPeriods.length, absenceCount: absences.length },
			"Transforming to SAP SuccessFactors CSV format",
		);

		const sfConfig = {
			...DEFAULT_SUCCESSFACTORS_CONFIG,
			...config,
		} as SuccessFactorsConfig;

		// Aggregate work periods
		const aggregatedData = aggregateWorkPeriodsForCSV(
			workPeriods,
			mappings,
			sfConfig.employeeMatchStrategy,
			sfConfig.includeZeroHours,
		);

		// Add absences to aggregated data
		aggregateAbsencesForCSV(
			absences,
			mappings,
			sfConfig.employeeMatchStrategy,
			aggregatedData,
		);

		// Generate CSV content
		const lines: string[] = [];

		// Header row - SAP SuccessFactors import format
		lines.push(
			[
				this.escapeCSV("User ID"),
				this.escapeCSV("Date"),
				this.escapeCSV("Time Type"),
				this.escapeCSV("Hours"),
				this.escapeCSV("Comment"),
			].join(";"),
		);

		// Data rows - sorted by user ID, date, time type
		const sortedUserIds = Array.from(aggregatedData.keys()).sort();
		for (const userId of sortedUserIds) {
			const employeeData = aggregatedData.get(userId)!;
			const sortedDates = Array.from(employeeData.keys()).sort();

			for (const dateStr of sortedDates) {
				const timeTypes = employeeData.get(dateStr)!;
				const sortedTimeTypes = Array.from(timeTypes.entries()).sort((a, b) =>
					a[0].localeCompare(b[0]),
				);

				for (const [timeType, data] of sortedTimeTypes) {
					if (data.hours > 0 || sfConfig.includeZeroHours) {
						lines.push(
							this.generateDataRow(
								userId,
								dateStr,
								timeType,
								data.hours,
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
			"SAP SuccessFactors CSV export generated",
		);

		// Join with Windows-style line endings
		// Add UTF-8 BOM for Excel compatibility
		const bom = "\uFEFF";
		const csvContent = bom + lines.join("\r\n");

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
	 * Generate CSV data row
	 */
	private generateDataRow(
		userId: string,
		dateStr: string,
		timeType: string,
		hours: number,
		note: string,
	): string {
		return [
			this.escapeCSV(userId),
			this.escapeCSV(dateStr),
			this.escapeCSV(timeType),
			this.escapeCSV(this.formatHours(hours)),
			this.escapeCSV(note),
		].join(";");
	}

	/**
	 * Escape value for CSV (semicolon separator)
	 */
	private escapeCSV(value: string): string {
		if (!value) return '""';
		// Always wrap in quotes and escape internal quotes
		return `"${value.replace(/"/g, '""')}"`;
	}

	/**
	 * Format hours as decimal with period separator
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
	private generateFileName(dateRange: {
		start: DateTime | null;
		end: DateTime | null;
	}): string {
		const now = DateTime.now();
		const dateStr = dateRange.start
			? dateRange.start.toFormat("yyyy-MM")
			: now.toFormat("yyyy-MM");
		return `sap_successfactors_${dateStr}_${now.toFormat("yyyyMMdd_HHmmss")}.csv`;
	}
}

/**
 * Singleton instance
 */
export const successFactorsFormatter = new SuccessFactorsFormatter();
