/**
 * Vacation Reports
 *
 * Generate various vacation-related reports for organizations.
 */

import { DateTime } from "luxon";
import { getEnhancedVacationBalance, getVacationSummary } from "@/lib/absences/vacation.service";
import { format } from "@/lib/datetime/luxon-utils";
import {
	getEmployeesWithExpiringCarryover,
	getPendingVacationRequests,
	getVacationAllowance,
} from "@/lib/query/vacation.queries";

export interface TeamVacationCalendarEntry {
	employeeId: string;
	employeeName: string;
	startDate: Date;
	endDate: Date;
	days: number;
	status: "approved" | "pending";
}

export interface IndividualBalanceReport {
	employeeId: string;
	employeeName: string;
	email: string;
	totalAllowance: number;
	carryover: number;
	adjustments: number;
	used: number;
	pending: number;
	remaining: number;
	carryoverExpiryDate: Date | null;
	utilizationRate: number;
}

export interface ExpirationReport {
	employeeId: string;
	employeeName: string;
	carryoverDays: number;
	expiresAt: Date;
	daysUntilExpiry: number;
	urgency: "critical" | "warning" | "info";
}

export interface CarryoverHistoryEntry {
	year: number;
	originalBalance: number;
	carriedOver: number;
	expired: number;
	used: number;
}

export interface AccrualProjection {
	month: number;
	monthName: string;
	accrued: number;
	cumulativeAccrued: number;
	projectedUsed: number;
	projectedBalance: number;
}

/**
 * Generate team vacation calendar report
 */
export async function generateTeamVacationCalendar(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<TeamVacationCalendarEntry[]> {
	const requests = await getPendingVacationRequests(organizationId);

	// Filter requests that fall within the date range
	return requests
		.filter((r) => {
			const reqStart = new Date(r.startDate);
			const reqEnd = new Date(r.endDate);
			return reqStart <= endDate && reqEnd >= startDate;
		})
		.map((r) => ({
			employeeId: r.employeeId,
			employeeName: r.employeeName,
			startDate: r.startDate,
			endDate: r.endDate,
			days: r.days,
			status: "pending" as const,
		}));
}

/**
 * Generate individual vacation balance report for all employees
 */
export async function generateIndividualBalanceReport(
	organizationId: string,
	year: number,
): Promise<IndividualBalanceReport[]> {
	const summary = await getVacationSummary(organizationId, year);

	return summary.map((emp) => ({
		employeeId: emp.employeeId,
		employeeName: emp.employeeName,
		email: "", // Would need to join with user table for email
		totalAllowance: emp.totalAllowance,
		carryover: emp.carryover,
		adjustments: emp.adjustments,
		used: emp.used,
		pending: emp.pending,
		remaining: emp.remaining,
		carryoverExpiryDate: emp.carryoverExpiryDate,
		utilizationRate:
			emp.totalAllowance > 0
				? Math.round(((emp.used + emp.pending) / emp.totalAllowance) * 100)
				: 0,
	}));
}

/**
 * Generate upcoming carryover expiration report
 */
export async function generateExpirationReport(
	organizationId: string,
	year: number,
	daysAhead: number = 90,
): Promise<ExpirationReport[]> {
	const expiring = await getEmployeesWithExpiringCarryover(organizationId, year, daysAhead);

	return expiring.map((emp) => ({
		employeeId: emp.employeeId,
		employeeName: emp.employeeName,
		carryoverDays: emp.carryoverDays,
		expiresAt: emp.expiresAt,
		daysUntilExpiry: emp.daysUntilExpiry,
		urgency: emp.daysUntilExpiry <= 7 ? "critical" : emp.daysUntilExpiry <= 30 ? "warning" : "info",
	}));
}

/**
 * Generate accrual projection report for an employee
 */
export async function generateAccrualProjection(
	employeeId: string,
	year: number,
	organizationId: string,
): Promise<AccrualProjection[]> {
	const policy = await getVacationAllowance(organizationId, year);

	if (!policy) {
		return [];
	}

	const balance = await getEnhancedVacationBalance({
		employeeId,
		year,
	});

	const annualDays = balance?.totalDays || parseFloat(policy.defaultAnnualDays);
	const currentUsed = balance?.usedDays || 0;
	const currentPending = balance?.pendingDays || 0;

	const projections: AccrualProjection[] = [];
	let cumulativeAccrued = 0;
	const projectedUsed = currentUsed + currentPending;

	// Calculate monthly accrual based on policy type
	const monthlyAccrual =
		policy.accrualType === "monthly"
			? annualDays / 12
			: policy.accrualType === "biweekly"
				? (annualDays / 26) * 2
				: annualDays / 12; // Default to monthly

	for (let month = 1; month <= 12; month++) {
		const monthDT = DateTime.utc(year, month, 1);

		if (policy.accrualType === "annual" && month === policy.accrualStartMonth) {
			cumulativeAccrued = annualDays;
		} else if (policy.accrualType !== "annual") {
			cumulativeAccrued += monthlyAccrual;
		}

		projections.push({
			month,
			monthName: monthDT.toFormat("MMMM"),
			accrued: monthlyAccrual,
			cumulativeAccrued: Math.round(cumulativeAccrued * 10) / 10,
			projectedUsed: Math.round(projectedUsed * 10) / 10,
			projectedBalance: Math.round((cumulativeAccrued - projectedUsed) * 10) / 10,
		});
	}

	return projections;
}

/**
 * Export vacation balance report as CSV
 */
export function exportVacationBalanceAsCsv(
	reports: IndividualBalanceReport[],
	year: number,
): string {
	const lines: string[] = [];

	// Header
	lines.push(`Vacation Balance Report - ${year}`);
	lines.push(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`);
	lines.push("");

	// Column headers
	lines.push(
		"Employee,Total Allowance,Carryover,Adjustments,Used,Pending,Remaining,Utilization %,Carryover Expires",
	);

	// Data rows
	for (const report of reports) {
		const expiryStr = report.carryoverExpiryDate
			? format(report.carryoverExpiryDate, "yyyy-MM-dd")
			: "N/A";

		lines.push(
			`"${report.employeeName}",${report.totalAllowance.toFixed(1)},${report.carryover.toFixed(1)},${report.adjustments.toFixed(1)},${report.used.toFixed(1)},${report.pending.toFixed(1)},${report.remaining.toFixed(1)},${report.utilizationRate}%,${expiryStr}`,
		);
	}

	// Summary
	lines.push("");
	lines.push("Summary");
	const totalAllowance = reports.reduce((sum, r) => sum + r.totalAllowance, 0);
	const totalUsed = reports.reduce((sum, r) => sum + r.used, 0);
	const totalPending = reports.reduce((sum, r) => sum + r.pending, 0);
	const totalRemaining = reports.reduce((sum, r) => sum + r.remaining, 0);

	lines.push(`Total Employees,${reports.length}`);
	lines.push(`Total Allowance,${totalAllowance.toFixed(1)}`);
	lines.push(`Total Used,${totalUsed.toFixed(1)}`);
	lines.push(`Total Pending,${totalPending.toFixed(1)}`);
	lines.push(`Total Remaining,${totalRemaining.toFixed(1)}`);
	lines.push(
		`Average Utilization,${(((totalUsed + totalPending) / totalAllowance) * 100).toFixed(1)}%`,
	);

	return lines.join("\n");
}

/**
 * Export expiration report as CSV
 */
export function exportExpirationReportAsCsv(reports: ExpirationReport[]): string {
	const lines: string[] = [];

	// Header
	lines.push("Carryover Expiration Report");
	lines.push(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`);
	lines.push("");

	// Column headers
	lines.push("Employee,Carryover Days,Expires At,Days Until Expiry,Urgency");

	// Data rows
	for (const report of reports) {
		lines.push(
			`"${report.employeeName}",${report.carryoverDays.toFixed(1)},${format(report.expiresAt, "yyyy-MM-dd")},${report.daysUntilExpiry},${report.urgency}`,
		);
	}

	// Summary
	lines.push("");
	lines.push("Summary");
	lines.push(`Total Employees with Expiring Carryover,${reports.length}`);
	lines.push(
		`Total Days Expiring,${reports.reduce((sum, r) => sum + r.carryoverDays, 0).toFixed(1)}`,
	);
	lines.push(`Critical (7 days or less),${reports.filter((r) => r.urgency === "critical").length}`);
	lines.push(`Warning (30 days or less),${reports.filter((r) => r.urgency === "warning").length}`);

	return lines.join("\n");
}

/**
 * Format vacation balance report as HTML for email
 */
export function formatVacationBalanceAsHtml(
	reports: IndividualBalanceReport[],
	year: number,
	organizationName: string,
): string {
	const totalAllowance = reports.reduce((sum, r) => sum + r.totalAllowance, 0);
	const totalUsed = reports.reduce((sum, r) => sum + r.used, 0);
	const totalPending = reports.reduce((sum, r) => sum + r.pending, 0);
	const totalRemaining = reports.reduce((sum, r) => sum + r.remaining, 0);
	const avgUtilization =
		totalAllowance > 0 ? ((totalUsed + totalPending) / totalAllowance) * 100 : 0;

	let html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    h1 { color: #2563eb; }
    h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background-color: #f9fafb; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-card { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; min-width: 120px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #2563eb; }
    .stat-label { color: #6b7280; font-size: 14px; }
    .low-balance { background-color: #fef3c7; }
    .expiring-soon { color: #dc2626; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Vacation Balance Report</h1>
  <p><strong>${organizationName}</strong> - Year ${year}</p>
  <p>Generated: ${format(new Date(), "MMMM d, yyyy 'at' HH:mm")}</p>

  <div class="summary">
    <div class="stat-card">
      <div class="stat-value">${reports.length}</div>
      <div class="stat-label">Employees</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalAllowance.toFixed(0)}</div>
      <div class="stat-label">Total Days</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalUsed.toFixed(0)}</div>
      <div class="stat-label">Used</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalRemaining.toFixed(0)}</div>
      <div class="stat-label">Remaining</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${avgUtilization.toFixed(0)}%</div>
      <div class="stat-label">Utilization</div>
    </div>
  </div>

  <h2>Employee Balances</h2>
  <table>
    <tr>
      <th>Employee</th>
      <th>Total</th>
      <th>Carryover</th>
      <th>Used</th>
      <th>Pending</th>
      <th>Remaining</th>
      <th>Utilization</th>
    </tr>`;

	for (const report of reports) {
		const rowClass = report.remaining <= 2 ? "low-balance" : "";

		html += `
    <tr class="${rowClass}">
      <td>${report.employeeName}</td>
      <td>${report.totalAllowance.toFixed(1)}</td>
      <td>${report.carryover.toFixed(1)}</td>
      <td>${report.used.toFixed(1)}</td>
      <td>${report.pending.toFixed(1)}</td>
      <td>${report.remaining.toFixed(1)}</td>
      <td>${report.utilizationRate}%</td>
    </tr>`;
	}

	html += `
  </table>

  <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
    This report was generated automatically. For detailed information, access the Vacation Management section in Settings.
  </p>
</body>
</html>`;

	return html;
}

/**
 * Format expiration warning email
 */
export function formatExpirationWarningEmail(
	reports: ExpirationReport[],
	organizationName: string,
): string {
	const critical = reports.filter((r) => r.urgency === "critical");
	const warning = reports.filter((r) => r.urgency === "warning");

	let html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    h1 { color: #dc2626; }
    h2 { color: #374151; }
    .critical { background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 10px; margin-bottom: 10px; }
    .warning { background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px; margin-bottom: 10px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background-color: #f9fafb; }
  </style>
</head>
<body>
  <h1>Vacation Carryover Expiration Warning</h1>
  <p><strong>${organizationName}</strong></p>
  <p>The following employees have carryover days that will expire soon:</p>`;

	if (critical.length > 0) {
		html += `
  <h2>Critical - Expiring within 7 days</h2>`;
		for (const report of critical) {
			html += `
  <div class="critical">
    <strong>${report.employeeName}</strong> - ${report.carryoverDays.toFixed(1)} days expiring on ${format(report.expiresAt, "MMMM d, yyyy")} (${report.daysUntilExpiry} days remaining)
  </div>`;
		}
	}

	if (warning.length > 0) {
		html += `
  <h2>Warning - Expiring within 30 days</h2>`;
		for (const report of warning) {
			html += `
  <div class="warning">
    <strong>${report.employeeName}</strong> - ${report.carryoverDays.toFixed(1)} days expiring on ${format(report.expiresAt, "MMMM d, yyyy")} (${report.daysUntilExpiry} days remaining)
  </div>`;
		}
	}

	const totalExpiring = reports.reduce((sum, r) => sum + r.carryoverDays, 0);

	html += `
  <h2>Summary</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Employees Affected</td><td>${reports.length}</td></tr>
    <tr><td>Total Days Expiring</td><td>${totalExpiring.toFixed(1)}</td></tr>
    <tr><td>Critical Cases</td><td>${critical.length}</td></tr>
    <tr><td>Warning Cases</td><td>${warning.length}</td></tr>
  </table>

  <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
    Please remind affected employees to use their carryover days before they expire.
  </p>
</body>
</html>`;

	return html;
}
