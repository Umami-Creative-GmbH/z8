/**
 * DATEV Lohn & Gehalt CSV formatter
 * Implements DATEV ASCII format specification for payroll data
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { personnelNumberTypeError } from "../personnel-identifier";
import type {
	AbsenceData,
	DatevLohnConfig,
	ExpenseLineData,
	ExportResult,
	IPayrollExportFormatter,
	OvertimePayoutData,
	WageTypeMapping,
	WorkPeriodData,
} from "../types";
import { wageTypeCodeFor } from "../wage-type-code";
import {
	expenseLinesInFileOrder,
	GERMAN_EXPENSE_LINE_NOTE,
	germanPersonnelNumber,
} from "./expense-lines";
import {
	addOvertimePayoutHours,
	GERMAN_OVERTIME_PAYOUT_NOTE,
	overtimePayoutsForFormat,
	widenDateRangeByPayouts,
} from "./overtime-payouts";

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

		const personnelNumberError = personnelNumberTypeError(config);
		if (personnelNumberError) errors.push(personnelNumberError);

		return {
			valid: errors.length === 0,
			errors: errors.length > 0 ? errors : undefined,
		};
	}

	transform(
		workPeriods: WorkPeriodData[],
		absences: AbsenceData[],
		expenseLines: ExpenseLineData[],
		mappings: WageTypeMapping[],
		config: Record<string, unknown>,
		overtimePayouts: OvertimePayoutData[] = [],
	): ExportResult {
		logger.info(
			{ workPeriodCount: workPeriods.length, absenceCount: absences.length },
			"Transforming to DATEV Lohn format",
		);

		const datevConfig = config as unknown as DatevLohnConfig;

		// Build mapping lookups
		const workCategoryMappings = new Map<string, WageTypeMapping>();
		const absenceCategoryMappings = new Map<string, WageTypeMapping>();

		for (const mapping of mappings) {
			if (mapping.workCategoryId) {
				workCategoryMappings.set(mapping.workCategoryId, mapping);
			}
			if (mapping.absenceCategoryId) {
				absenceCategoryMappings.set(mapping.absenceCategoryId, mapping);
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

		// Overtime payouts (#1001): hours on the payout's day under the "overtime" wage type.
		const payouts = overtimePayoutsForFormat(overtimePayouts, mappings, "datev");
		addOvertimePayoutHours(aggregatedData, payouts.mapped, {
			personnelNumber: (payout) => this.personnelNumber(payout, datevConfig),
			period: (payout) => payout.day,
			add: (existing, hours) => ({
				hours: (existing?.hours ?? 0) + hours,
				note: existing?.note || GERMAN_OVERTIME_PAYOUT_NOTE,
			}),
		});

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
							this.generateDataRow(personnelNumber, wageTypeCode, data.hours, dateStr, data.note),
						);
					}
				}
			}
		}

		// Expense money lines (#852): a euro Betrag on the period's last day, labeled as money.
		for (const { personnelNumber, line } of expenseLinesInFileOrder(expenseLines, (line) =>
			germanPersonnelNumber(line, datevConfig),
		)) {
			lines.push(
				[
					this.escapeCSV(personnelNumber),
					this.escapeCSV(line.wageTypeCode),
					line.amount,
					this.escapeCSV(line.date),
					this.escapeCSV(GERMAN_EXPENSE_LINE_NOTE),
				].join(";"),
			);
		}

		// Calculate metadata
		const uniqueEmployees = new Set(workPeriods.map((p) => p.employeeId));
		absences.forEach((a) => uniqueEmployees.add(a.employeeId));
		for (const line of expenseLines) uniqueEmployees.add(line.employeeId);
		for (const { payout } of payouts.mapped) uniqueEmployees.add(payout.employeeId);

		const dateRange = widenDateRangeByPayouts(
			this.getDateRange(workPeriods, absences),
			payouts.mapped,
		);
		const fileName = this.generateFileName(dateRange);

		logger.info(
			{
				lineCount: lines.length,
				employeeCount: uniqueEmployees.size,
				unmappedOvertimePayoutCount: payouts.unmapped.length,
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
				unmappedOvertimePayouts: payouts.unmapped,
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

			const personnelNumber = this.personnelNumber(period, config);
			const dateStr = period.startTime.toISODate()!;
			const hours = period.durationMinutes / 60;

			// Determine wage type code (use DATEV-specific column)
			let wageTypeCode = DEFAULT_WAGE_TYPE_CODE;
			let note = "";

			if (period.workCategoryId) {
				const mapping = workCategoryMappings.get(period.workCategoryId);
				const mappedCode = wageTypeCodeFor(mapping, "datev");
				if (mapping && mappedCode) {
					wageTypeCode = mappedCode;
					note = mapping.datevWageTypeName || period.workCategoryName || "";
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
			const mappedCode = wageTypeCodeFor(mapping, "datev");
			if (!mapping || !mappedCode) continue; // Skip if no mapping

			const personnelNumber = this.personnelNumber(absence, config);
			const wageTypeCode = mappedCode;
			const note = mapping.datevWageTypeName || absence.absenceCategoryName || "";

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
	 * The row's personnel number (`germanPersonnelNumber`, shared with expense
	 * lines); an employee number that isn't set is logged before the fallback.
	 */
	private personnelNumber(
		row: WorkPeriodData | AbsenceData | OvertimePayoutData,
		config: DatevLohnConfig,
	): string {
		if (config.personnelNumberType === "employeeNumber" && !row.employeeNumber) {
			logger.warn(
				{ employeeId: row.employeeId, rowId: row.id },
				"Employee number not set, falling back to employeeId",
			);
		}
		return germanPersonnelNumber(row, config);
	}


	/**
	 * Generate CSV header row
	 */
	private generateHeaderRow(): string {
		// DATEV Lohn standard columns
		return ["Personalnummer", "Lohnart", "Betrag", "Datum", "Bemerkung"]
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
		const dateStr = dateRange.start ? dateRange.start.toFormat("yyyy-MM") : now.toFormat("yyyy-MM");
		return `datev_lohn_${dateStr}_${now.toFormat("yyyyMMdd_HHmmss")}.csv`;
	}
}

/**
 * Singleton instance
 */
export const datevLohnFormatter = new DatevLohnFormatter();
