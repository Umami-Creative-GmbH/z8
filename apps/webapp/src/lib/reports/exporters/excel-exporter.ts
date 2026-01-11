/**
 * Excel exporter for employee reports
 * Creates formatted XLSX files with multiple worksheets
 */

import ExcelJS from "exceljs";
import { format } from "@/lib/datetime/luxon-utils";
import type { ReportData } from "../types";

/**
 * Export report data to Excel format
 * @param reportData - The report data to export
 * @returns Excel file buffer
 */
export async function exportToExcel(reportData: ReportData): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();

	// Set workbook properties
	workbook.creator = "Z8 Time Tracking";
	workbook.created = new Date();
	workbook.modified = new Date();

	// Create worksheets
	await createSummarySheet(workbook, reportData);
	await createWorkHoursSheet(workbook, reportData);
	await createAbsencesSheet(workbook, reportData);
	await createHomeOfficeSheet(workbook, reportData);

	const buffer = await workbook.xlsx.writeBuffer();
	return Buffer.from(buffer);
}

/**
 * Create summary worksheet
 */
async function createSummarySheet(
	workbook: ExcelJS.Workbook,
	reportData: ReportData,
): Promise<void> {
	const sheet = workbook.addWorksheet("Summary");

	// Set column widths
	sheet.columns = [{ width: 30 }, { width: 25 }];

	// Title
	sheet.mergeCells("A1:B1");
	const titleCell = sheet.getCell("A1");
	titleCell.value = "Employee Report";
	titleCell.font = { size: 16, bold: true };
	titleCell.alignment = { horizontal: "center" };

	sheet.addRow([]);

	// Employee Information
	const infoHeaderRow = sheet.addRow(["Employee Information", ""]);
	infoHeaderRow.font = { bold: true, size: 12 };
	infoHeaderRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	sheet.addRow(["Name", reportData.employee.name]);
	if (reportData.employee.employeeNumber) {
		sheet.addRow(["Employee Number", reportData.employee.employeeNumber]);
	}
	if (reportData.employee.position) {
		sheet.addRow(["Position", reportData.employee.position]);
	}
	if (reportData.employee.email) {
		sheet.addRow(["Email", reportData.employee.email]);
	}
	sheet.addRow(["Report Period", reportData.period.label]);
	sheet.addRow(["Generated On", format(new Date(), "yyyy-MM-dd HH:mm:ss")]);

	sheet.addRow([]);

	// Work Hours Summary
	const workHeaderRow = sheet.addRow(["Work Hours Summary", ""]);
	workHeaderRow.font = { bold: true, size: 12 };
	workHeaderRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	sheet.addRow(["Total Hours", reportData.workHours.totalHours]);
	sheet.addRow(["Work Days", reportData.workHours.workDays]);
	sheet.addRow(["Average Hours per Day", reportData.workHours.averagePerDay]);

	sheet.addRow([]);

	// Absences Summary
	const absenceHeaderRow = sheet.addRow(["Absences Summary", ""]);
	absenceHeaderRow.font = { bold: true, size: 12 };
	absenceHeaderRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	sheet.addRow(["Total Absence Days", reportData.absences.totalDays]);
	sheet.addRow(["Vacation Days (Approved)", reportData.absences.vacation.approved]);
	sheet.addRow(["Sick Days (Approved)", reportData.absences.sick.approved]);
	sheet.addRow(["Home Office Days", reportData.absences.homeOffice.days]);
	sheet.addRow(["Home Office Hours Worked", reportData.absences.homeOffice.hoursWorked]);

	sheet.addRow([]);

	// Compliance Metrics
	const complianceHeaderRow = sheet.addRow(["Compliance Metrics", ""]);
	complianceHeaderRow.font = { bold: true, size: 12 };
	complianceHeaderRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	sheet.addRow(["Attendance Percentage", `${reportData.complianceMetrics.attendancePercentage}%`]);
	sheet.addRow([
		"Overtime Hours",
		Math.round((reportData.complianceMetrics.overtimeMinutes / 60) * 100) / 100,
	]);
	sheet.addRow([
		"Undertime Hours",
		Math.round((reportData.complianceMetrics.underTimeMinutes / 60) * 100) / 100,
	]);
}

/**
 * Create work hours breakdown worksheet
 */
async function createWorkHoursSheet(
	workbook: ExcelJS.Workbook,
	reportData: ReportData,
): Promise<void> {
	const sheet = workbook.addWorksheet("Work Hours");

	// Set column widths
	sheet.columns = [
		{ header: "Month", key: "month", width: 15 },
		{ header: "Hours", key: "hours", width: 12 },
		{ header: "Days", key: "days", width: 12 },
	];

	// Style header row
	const headerRow = sheet.getRow(1);
	headerRow.font = { bold: true };
	headerRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FF4472C4" },
	};
	headerRow.font = { color: { argb: "FFFFFFFF" }, bold: true };

	// Add data
	let _rowIndex = 2;
	for (const [month, data] of reportData.workHours.byMonth) {
		sheet.addRow({
			month,
			hours: data.hours,
			days: data.days,
		});
		_rowIndex++;
	}

	// Add totals
	sheet.addRow({});
	const totalRow = sheet.addRow({
		month: "TOTAL",
		hours: reportData.workHours.totalHours,
		days: reportData.workHours.workDays,
	});
	totalRow.font = { bold: true };
	totalRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	// Add borders
	sheet.eachRow((row, _rowNumber) => {
		row.eachCell((cell) => {
			cell.border = {
				top: { style: "thin" },
				left: { style: "thin" },
				bottom: { style: "thin" },
				right: { style: "thin" },
			};
		});
	});
}

/**
 * Create absences breakdown worksheet
 */
async function createAbsencesSheet(
	workbook: ExcelJS.Workbook,
	reportData: ReportData,
): Promise<void> {
	const sheet = workbook.addWorksheet("Absences");

	// Set column widths
	sheet.columns = [
		{ header: "Category", key: "category", width: 25 },
		{ header: "Days", key: "days", width: 12 },
	];

	// Style header row
	const headerRow = sheet.getRow(1);
	headerRow.font = { bold: true };
	headerRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FF4472C4" },
	};
	headerRow.font = { color: { argb: "FFFFFFFF" }, bold: true };

	// Add data
	for (const [category, data] of reportData.absences.byCategory) {
		sheet.addRow({
			category,
			days: data.days,
		});
	}

	// Add totals
	sheet.addRow({});
	const totalRow = sheet.addRow({
		category: "TOTAL",
		days: reportData.absences.totalDays,
	});
	totalRow.font = { bold: true };
	totalRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFE0E0E0" },
	};

	// Add borders
	sheet.eachRow((row, _rowNumber) => {
		row.eachCell((cell) => {
			cell.border = {
				top: { style: "thin" },
				left: { style: "thin" },
				bottom: { style: "thin" },
				right: { style: "thin" },
			};
		});
	});
}

/**
 * Create home office worksheet - CRITICAL FOR TAX
 */
async function createHomeOfficeSheet(
	workbook: ExcelJS.Workbook,
	reportData: ReportData,
): Promise<void> {
	const sheet = workbook.addWorksheet("Home Office (Tax)");

	// Title with emphasis
	sheet.mergeCells("A1:B1");
	const titleCell = sheet.getCell("A1");
	titleCell.value = "HOME OFFICE SUMMARY - TAX RELEVANT";
	titleCell.font = { size: 14, bold: true, color: { argb: "FFFF0000" } };
	titleCell.alignment = { horizontal: "center" };
	titleCell.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFFFFF00" },
	};

	sheet.addRow([]);

	// Summary
	sheet.addRow(["Total Home Office Days", reportData.absences.homeOffice.days]);
	sheet.addRow(["Total Hours Worked from Home", reportData.absences.homeOffice.hoursWorked]);

	sheet.addRow([]);
	sheet.addRow([]);

	// Detailed breakdown header
	const detailHeaderRow = sheet.addRow(["Date", "Hours Worked"]);
	detailHeaderRow.font = { bold: true };
	detailHeaderRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FF4472C4" },
	};
	detailHeaderRow.font = { color: { argb: "FFFFFFFF" }, bold: true };

	// Set column widths
	sheet.getColumn(1).width = 15;
	sheet.getColumn(2).width = 15;

	// Add date details
	for (const detail of reportData.absences.homeOffice.dateDetails) {
		sheet.addRow([format(detail.date, "yyyy-MM-dd"), detail.hours]);
	}

	// Add total
	sheet.addRow([]);
	const totalRow = sheet.addRow(["TOTAL", reportData.absences.homeOffice.hoursWorked]);
	totalRow.font = { bold: true };
	totalRow.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FFFFFF00" },
	};

	// Add borders to all cells
	sheet.eachRow((row, rowNumber) => {
		row.eachCell((cell) => {
			if (rowNumber >= 6) {
				// Only add borders to the table
				cell.border = {
					top: { style: "thin" },
					left: { style: "thin" },
					bottom: { style: "thin" },
					right: { style: "thin" },
				};
			}
		});
	});
}

/**
 * Generate a filename for the Excel export
 * @param reportData - The report data
 * @returns Suggested filename
 */
export function generateExcelFilename(reportData: ReportData): string {
	const employeeName = reportData.employee.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const timestamp = Date.now();
	return `report-${employeeName}-${timestamp}.xlsx`;
}
