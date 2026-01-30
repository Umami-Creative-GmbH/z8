/**
 * PDF exporter for employee reports
 * Uses @react-pdf/renderer for React-based PDF generation
 * NOTE: The library is dynamically imported to reduce initial bundle size (bundle-dynamic-imports)
 */

import { format } from "@/lib/datetime/luxon-utils";
import type { ReportData } from "../types";

// Helper to format currency
const formatCurrency = (amount: number, currency: string): string => {
	return new Intl.NumberFormat("de-DE", {
		style: "currency",
		currency: currency,
	}).format(amount);
};

// Style definitions (plain object, used by StyleSheet.create at runtime)
const styleDefinitions = {
	page: {
		padding: 40,
		fontSize: 10,
		fontFamily: "Helvetica",
	},
	title: {
		fontSize: 20,
		marginBottom: 20,
		fontWeight: "bold",
		textAlign: "center",
	},
	sectionHeader: {
		fontSize: 14,
		fontWeight: "bold",
		marginTop: 15,
		marginBottom: 10,
		backgroundColor: "#E0E0E0",
		padding: 5,
	},
	row: {
		flexDirection: "row",
		marginBottom: 5,
	},
	label: {
		width: "40%",
		fontWeight: "bold",
	},
	value: {
		width: "60%",
	},
	table: {
		marginTop: 10,
		marginBottom: 10,
	},
	tableHeader: {
		flexDirection: "row",
		backgroundColor: "#4472C4",
		padding: 5,
		fontWeight: "bold",
		color: "white",
	},
	tableRow: {
		flexDirection: "row",
		borderBottomWidth: 1,
		borderBottomColor: "#CCCCCC",
		padding: 5,
	},
	tableCell: {
		flex: 1,
	},
	tableCellLabel: {
		flex: 2,
	},
	taxSection: {
		marginTop: 20,
		padding: 15,
		border: "2px solid #FF0000",
		backgroundColor: "#FFFACD",
	},
	taxTitle: {
		fontSize: 14,
		fontWeight: "bold",
		color: "#FF0000",
		marginBottom: 10,
		textAlign: "center",
	},
	earningsSection: {
		marginTop: 20,
		padding: 15,
		border: "2px solid #22C55E",
		backgroundColor: "#F0FDF4",
	},
	earningsTitle: {
		fontSize: 14,
		fontWeight: "bold",
		color: "#22C55E",
		marginBottom: 10,
		textAlign: "center",
	},
	footer: {
		position: "absolute",
		bottom: 30,
		left: 40,
		right: 40,
		textAlign: "center",
		fontSize: 8,
		color: "#666666",
	},
	spacer: {
		marginTop: 10,
	},
} as const;

/**
 * Export report data to PDF format
 * Dynamically imports @react-pdf/renderer to avoid loading the heavy library upfront
 * @param reportData - The report data to export
 * @returns PDF file as Uint8Array
 */
export async function exportToPDF(reportData: ReportData): Promise<Uint8Array> {
	// Dynamic import - only loads when user actually exports to PDF
	const { Document, Page, pdf, StyleSheet, Text, View } = await import("@react-pdf/renderer");

	// Create styles at runtime after dynamic import
	const styles = StyleSheet.create(styleDefinitions);

	// Define the PDF document component inline (closure over dynamic imports)
	const EmployeeReportPDF = () => (
		<Document>
			<Page size="A4" style={styles.page}>
				{/* Title */}
				<Text style={styles.title}>Employee Report</Text>

				{/* Employee Information */}
				<Text style={styles.sectionHeader}>Employee Information</Text>
				<View style={styles.row}>
					<Text style={styles.label}>Name:</Text>
					<Text style={styles.value}>{reportData.employee.name}</Text>
				</View>
				{reportData.employee.employeeNumber && (
					<View style={styles.row}>
						<Text style={styles.label}>Employee Number:</Text>
						<Text style={styles.value}>{reportData.employee.employeeNumber}</Text>
					</View>
				)}
				{reportData.employee.position && (
					<View style={styles.row}>
						<Text style={styles.label}>Position:</Text>
						<Text style={styles.value}>{reportData.employee.position}</Text>
					</View>
				)}
				{reportData.employee.email && (
					<View style={styles.row}>
						<Text style={styles.label}>Email:</Text>
						<Text style={styles.value}>{reportData.employee.email}</Text>
					</View>
				)}
				<View style={styles.row}>
					<Text style={styles.label}>Contract Type:</Text>
					<Text style={styles.value}>
						{reportData.employee.contractType === "hourly" ? "Hourly" : "Fixed"}
					</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Report Period:</Text>
					<Text style={styles.value}>{reportData.period.label}</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Generated On:</Text>
					<Text style={styles.value}>{format(new Date(), "yyyy-MM-dd HH:mm:ss")}</Text>
				</View>

				{/* Work Hours Summary */}
				<Text style={styles.sectionHeader}>Work Hours Summary</Text>
				<View style={styles.row}>
					<Text style={styles.label}>Total Hours:</Text>
					<Text style={styles.value}>{reportData.workHours.totalHours}h</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Work Days:</Text>
					<Text style={styles.value}>{reportData.workHours.workDays}</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Average Hours per Day:</Text>
					<Text style={styles.value}>{reportData.workHours.averagePerDay}h</Text>
				</View>

				{/* Monthly Breakdown */}
				{reportData.workHours.byMonth.size > 0 && (
					<>
						<View style={styles.spacer} />
						<Text style={{ fontSize: 12, fontWeight: "bold", marginBottom: 5 }}>
							Monthly Breakdown
						</Text>
						<View style={styles.table}>
							<View style={styles.tableHeader}>
								<Text style={styles.tableCellLabel}>Month</Text>
								<Text style={styles.tableCell}>Hours</Text>
								<Text style={styles.tableCell}>Days</Text>
							</View>
							{Array.from(reportData.workHours.byMonth).map(([month, data]) => (
								<View key={month} style={styles.tableRow}>
									<Text style={styles.tableCellLabel}>{month}</Text>
									<Text style={styles.tableCell}>{data.hours}h</Text>
									<Text style={styles.tableCell}>{data.days}</Text>
								</View>
							))}
						</View>
					</>
				)}

				{/* Earnings Summary - Only for hourly employees */}
				{reportData.employee.contractType === "hourly" && reportData.hourlyEarnings && (
					<View style={styles.earningsSection}>
						<Text style={styles.earningsTitle}>EARNINGS SUMMARY (HOURLY EMPLOYEE)</Text>
						<View style={styles.row}>
							<Text style={styles.label}>Total Hours:</Text>
							<Text style={styles.value}>{reportData.hourlyEarnings.totalHours}h</Text>
						</View>
						<View style={styles.row}>
							<Text style={styles.label}>Total Earnings:</Text>
							<Text style={styles.value}>
								{formatCurrency(
									reportData.hourlyEarnings.totalEarnings,
									reportData.hourlyEarnings.currency,
								)}
							</Text>
						</View>

						{reportData.hourlyEarnings.byRatePeriod.length > 0 && (
							<>
								<View style={styles.spacer} />
								<Text style={{ fontWeight: "bold", marginBottom: 5 }}>
									Earnings by Rate Period:
								</Text>
								<View style={styles.table}>
									<View style={styles.tableHeader}>
										<Text style={styles.tableCell}>Period</Text>
										<Text style={styles.tableCell}>Rate</Text>
										<Text style={styles.tableCell}>Hours</Text>
										<Text style={styles.tableCell}>Earnings</Text>
									</View>
									{reportData.hourlyEarnings.byRatePeriod.map((period, index) => (
										<View key={index} style={styles.tableRow}>
											<Text style={styles.tableCell}>
												{format(period.periodStart, "MMM dd")} -{" "}
												{format(period.periodEnd, "MMM dd")}
											</Text>
											<Text style={styles.tableCell}>
												{formatCurrency(period.rate, period.currency)}/h
											</Text>
											<Text style={styles.tableCell}>{period.hours}h</Text>
											<Text style={styles.tableCell}>
												{formatCurrency(period.earnings, period.currency)}
											</Text>
										</View>
									))}
								</View>
							</>
						)}
					</View>
				)}

				{/* Absences Summary */}
				<Text style={styles.sectionHeader}>Absences Summary</Text>
				<View style={styles.row}>
					<Text style={styles.label}>Total Absence Days:</Text>
					<Text style={styles.value}>{reportData.absences.totalDays}</Text>
				</View>
				<View style={styles.spacer} />
				<Text style={{ fontWeight: "bold", marginBottom: 5 }}>By Type:</Text>
				<View style={styles.row}>
					<Text style={styles.label}>Vacation (Approved):</Text>
					<Text style={styles.value}>{reportData.absences.vacation.approved} days</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Vacation (Pending):</Text>
					<Text style={styles.value}>{reportData.absences.vacation.pending} days</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Sick Leave (Approved):</Text>
					<Text style={styles.value}>{reportData.absences.sick.approved} days</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Sick Leave (Pending):</Text>
					<Text style={styles.value}>{reportData.absences.sick.pending} days</Text>
				</View>

				{/* HOME OFFICE SUMMARY - TAX RELEVANT */}
				<View style={styles.taxSection}>
					<Text style={styles.taxTitle}>HOME OFFICE SUMMARY (TAX RELEVANT)</Text>
					<View style={styles.row}>
						<Text style={styles.label}>Total Home Office Days:</Text>
						<Text style={styles.value}>{reportData.absences.homeOffice.days}</Text>
					</View>
					<View style={styles.row}>
						<Text style={styles.label}>Hours Worked from Home:</Text>
						<Text style={styles.value}>{reportData.absences.homeOffice.hoursWorked}h</Text>
					</View>

					{reportData.absences.homeOffice.dateDetails.length > 0 && (
						<>
							<View style={styles.spacer} />
							<Text style={{ fontWeight: "bold", marginBottom: 5 }}>Date-by-Date Breakdown:</Text>
							<View style={styles.table}>
								<View style={styles.tableHeader}>
									<Text style={styles.tableCellLabel}>Date</Text>
									<Text style={styles.tableCell}>Hours Worked</Text>
								</View>
								{reportData.absences.homeOffice.dateDetails.map((detail) => (
									<View key={detail.date.toISOString()} style={styles.tableRow}>
										<Text style={styles.tableCellLabel}>{format(detail.date, "yyyy-MM-dd")}</Text>
										<Text style={styles.tableCell}>{detail.hours}h</Text>
									</View>
								))}
							</View>
						</>
					)}
				</View>

				{/* Compliance Metrics */}
				<Text style={styles.sectionHeader}>Compliance Metrics</Text>
				<View style={styles.row}>
					<Text style={styles.label}>Attendance Percentage:</Text>
					<Text style={styles.value}>{reportData.complianceMetrics.attendancePercentage}%</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Overtime:</Text>
					<Text style={styles.value}>
						{Math.round((reportData.complianceMetrics.overtimeMinutes / 60) * 100) / 100}h
					</Text>
				</View>
				<View style={styles.row}>
					<Text style={styles.label}>Undertime:</Text>
					<Text style={styles.value}>
						{Math.round((reportData.complianceMetrics.underTimeMinutes / 60) * 100) / 100}h
					</Text>
				</View>

				{/* Footer */}
				<Text style={styles.footer}>
					Generated by Z8 Time Tracking | {format(new Date(), "yyyy-MM-dd HH:mm:ss")}
				</Text>
			</Page>
		</Document>
	);

	const blob = await pdf(<EmployeeReportPDF />).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Generate a filename for the PDF export
 * @param reportData - The report data
 * @returns Suggested filename
 */
export function generatePDFFilename(reportData: ReportData): string {
	const employeeName = reportData.employee.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const timestamp = Date.now();
	return `report-${employeeName}-${timestamp}.pdf`;
}
