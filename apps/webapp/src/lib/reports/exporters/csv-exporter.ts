/**
 * CSV exporter for employee reports
 * Simple text-based export suitable for spreadsheet import
 */

import { format } from "@/lib/datetime/luxon-utils";
import type { ReportData } from "../types";

/**
 * Export report data to CSV format
 * @param reportData - The report data to export
 * @returns CSV string
 */
export function exportToCSV(reportData: ReportData): string {
	const lines: string[] = [];

	// Helper function to escape CSV fields
	const escape = (value: string | number | undefined): string => {
		if (value === undefined || value === null) return "";
		const str = String(value);
		// Escape quotes and wrap in quotes if contains comma, quote, or newline
		if (str.includes(",") || str.includes('"') || str.includes("\n")) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	};

	// Header Section
	lines.push("Employee Report");
	lines.push("");

	// Employee Information
	lines.push("Employee Information");
	lines.push(`Name,${escape(reportData.employee.name)}`);
	if (reportData.employee.employeeNumber) {
		lines.push(`Employee Number,${escape(reportData.employee.employeeNumber)}`);
	}
	if (reportData.employee.position) {
		lines.push(`Position,${escape(reportData.employee.position)}`);
	}
	if (reportData.employee.email) {
		lines.push(`Email,${escape(reportData.employee.email)}`);
	}
	lines.push(`Report Period,${escape(reportData.period.label)}`);
	lines.push(`Generated On,${format(new Date(), "yyyy-MM-dd HH:mm:ss")}`);
	lines.push("");

	// Work Hours Summary
	lines.push("Work Hours Summary");
	lines.push(`Total Hours,${reportData.workHours.totalHours}`);
	lines.push(`Total Minutes,${reportData.workHours.totalMinutes}`);
	lines.push(`Work Days,${reportData.workHours.workDays}`);
	lines.push(`Average Hours per Day,${reportData.workHours.averagePerDay}`);
	lines.push("");

	// Monthly Breakdown
	if (reportData.workHours.byMonth.size > 0) {
		lines.push("Work Hours by Month");
		lines.push("Month,Hours,Days");
		for (const [month, data] of reportData.workHours.byMonth) {
			lines.push(`${month},${data.hours},${data.days}`);
		}
		lines.push("");
	}

	// Absences Summary
	lines.push("Absences Summary");
	lines.push(`Total Absence Days,${reportData.absences.totalDays}`);
	lines.push("");

	lines.push("Vacation");
	lines.push(`Approved,${reportData.absences.vacation.approved}`);
	lines.push(`Pending,${reportData.absences.vacation.pending}`);
	lines.push("");

	lines.push("Sick Leave");
	lines.push(`Approved,${reportData.absences.sick.approved}`);
	lines.push(`Pending,${reportData.absences.sick.pending}`);
	lines.push("");

	lines.push("Other Absences");
	lines.push(`Approved,${reportData.absences.other.approved}`);
	lines.push(`Pending,${reportData.absences.other.pending}`);
	lines.push("");

	// Absences by Category
	if (reportData.absences.byCategory.size > 0) {
		lines.push("Absences by Category");
		lines.push("Category,Days");
		for (const [category, data] of reportData.absences.byCategory) {
			lines.push(`${escape(category)},${data.days}`);
		}
		lines.push("");
	}

	// HOME OFFICE SUMMARY - CRITICAL FOR TAX
	lines.push("========================================");
	lines.push("HOME OFFICE SUMMARY (TAX RELEVANT)");
	lines.push("========================================");
	lines.push(`Total Home Office Days,${reportData.absences.homeOffice.days}`);
	lines.push(
		`Total Hours Worked from Home,${reportData.absences.homeOffice.hoursWorked}`,
	);
	lines.push("");

	if (reportData.absences.homeOffice.dateDetails.length > 0) {
		lines.push("Home Office Details by Date");
		lines.push("Date,Hours Worked");
		for (const detail of reportData.absences.homeOffice.dateDetails) {
			lines.push(`${format(detail.date, "yyyy-MM-dd")},${detail.hours}`);
		}
		lines.push("");
	}

	// Compliance Metrics
	lines.push("Compliance Metrics");
	lines.push(`Attendance Percentage,${reportData.complianceMetrics.attendancePercentage}%`);
	lines.push(`Overtime Minutes,${reportData.complianceMetrics.overtimeMinutes}`);
	lines.push(
		`Overtime Hours,${Math.round((reportData.complianceMetrics.overtimeMinutes / 60) * 100) / 100}`,
	);
	lines.push(`Undertime Minutes,${reportData.complianceMetrics.underTimeMinutes}`);
	lines.push(
		`Undertime Hours,${Math.round((reportData.complianceMetrics.underTimeMinutes / 60) * 100) / 100}`,
	);

	return lines.join("\n");
}

/**
 * Generate a filename for the CSV export
 * @param reportData - The report data
 * @returns Suggested filename
 */
export function generateCSVFilename(reportData: ReportData): string {
	const employeeName = reportData.employee.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const timestamp = Date.now();
	return `report-${employeeName}-${timestamp}.csv`;
}
