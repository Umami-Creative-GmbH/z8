/**
 * Vacation Reports
 *
 * Generate various vacation-related reports for organizations.
 */

import { eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	type EmployeeEmployments,
	type EmployeeVacationOverride,
	loadEmployeeEmployments,
	loadEmployeeVacationOverrides,
} from "@/lib/absences/prorated-allowance-store";
import type { VacationBalanceConfiguration } from "@/lib/absences/types";
import { getVacationSummary } from "@/lib/absences/vacation.service";
import {
	accruingEmployments,
	policyPeriodMonthlyAccrualDays,
} from "@/lib/absences/vacation-accrual";
import { loadVacationBalances } from "@/lib/absences/vacation-balance-store";
import { isAccrualPolicy } from "@/lib/absences/vacation-policy-settings";
import { format } from "@/lib/datetime/luxon-utils";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	getEmployeesWithExpiringCarryover,
	getPendingVacationRequests,
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
	/** Frozen transfer timezone, or the organization zone for legacy carryover. */
	timezone?: string;
	employeeId: string;
	employeeName: string;
	email: string;
	configuration: VacationBalanceConfiguration | null;
	totalAllowance: number | null;
	carryover: number | null;
	adjustments: number | null;
	used: number | null;
	pending: number | null;
	remaining: number | null;
	carryoverExpiryDate: Date | null;
	utilizationRate: number | null;
}

function configurationLabel(
	configuration: VacationBalanceConfiguration | null,
): string {
	switch (configuration?.status) {
		case "resolved":
			return "Resolved";
		case "legacy":
			return "Legacy";
		case "missing":
			return "Missing vacation policy";
		case "conflict":
			return "Conflicting vacation policies";
		default:
			return "Vacation balance unavailable";
	}
}

function reportTotals(reports: IndividualBalanceReport[]) {
	const available = reports.filter((report) => report.totalAllowance !== null);
	return {
		unavailable: reports.length - available.length,
		totalAllowance: available.reduce(
			(sum, report) => sum + (report.totalAllowance ?? 0),
			0,
		),
		totalUsed: available.reduce((sum, report) => sum + (report.used ?? 0), 0),
		totalPending: available.reduce(
			(sum, report) => sum + (report.pending ?? 0),
			0,
		),
		totalRemaining: available.reduce(
			(sum, report) => sum + (report.remaining ?? 0),
			0,
		),
	};
}

function csvText(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function htmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function reportNumber(value: number | null): string {
	return value === null ? "N/A" : value.toFixed(1);
}

export interface ExpirationReport {
	/** Frozen transfer timezone, or the organization zone for legacy carryover. */
	timezone?: string;
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
	return requests.flatMap((r) => {
		const reqStart = new Date(r.startDate);
		const reqEnd = new Date(r.endDate);
		if (reqStart > endDate || reqEnd < startDate) {
			return [];
		}

		return [
			{
				employeeId: r.employeeId,
				employeeName: r.employeeName,
				startDate: reqStart,
				endDate: reqEnd,
				days: r.days,
				status: "pending" as const,
			},
		];
	});
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
		configuration: emp.configuration,
		totalAllowance: emp.totalAllowance,
		carryover: emp.carryover,
		adjustments: emp.adjustments,
		used: emp.used,
		pending: emp.pending,
		remaining: emp.remaining,
		carryoverExpiryDate: emp.carryoverExpiryDate,
		timezone: emp.timezone,
		utilizationRate:
			emp.totalAllowance === null || emp.used === null || emp.pending === null
				? null
				: emp.totalAllowance > 0
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
	const expiring = await getEmployeesWithExpiringCarryover(
		organizationId,
		year,
		daysAhead,
	);

	return expiring.map((emp) => ({
		employeeId: emp.employeeId,
		employeeName: emp.employeeName,
		carryoverDays: emp.carryoverDays,
		expiresAt: emp.expiresAt,
		timezone: emp.timezone,
		daysUntilExpiry: emp.daysUntilExpiry,
		urgency:
			emp.daysUntilExpiry <= 7
				? "critical"
				: emp.daysUntilExpiry <= 30
					? "warning"
					: "info",
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
	return (
		await generateAccrualProjectionResult(employeeId, year, organizationId)
	).projections;
}

/** A policy gap or conflict remains visible to callers that display projection availability. */
export async function generateAccrualProjectionResult(
	employeeId: string,
	year: number,
	organizationId: string,
): Promise<{
	configuration: VacationBalanceConfiguration | null;
	projections: AccrualProjection[];
}> {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	const result = await loadVacationBalances(db, {
		organizationId,
		employeeIds: [employeeId],
		year,
		timezone: org?.timezone || "UTC",
	});
	const configuration = result.configurations.get(employeeId) ?? null;
	const policy = result.policies.get(employeeId);
	const balance = result.balances.get(employeeId);
	if (!policy || !balance) return { configuration, projections: [] };

	const accrual = isAccrualPolicy(policy);
	const [employments, overrides] = accrual
		? await Promise.all([
				configuration?.status === "resolved"
					? loadEmployeeEmployments(db, {
							organizationId,
							employeeIds: [employeeId],
						})
					: new Map<string, EmployeeEmployments>(),
				loadEmployeeVacationOverrides(db, {
					organizationId,
					employeeIds: [employeeId],
					year,
				}),
			])
		: [
				new Map<string, EmployeeEmployments>(),
				new Map<string, EmployeeVacationOverride>(),
			];
	const employment = employments.get(employeeId);
	const stints = employment ? accruingEmployments(employment) : [];
	const customAnnualDays = overrides.get(employeeId)?.customAnnualDays;
	const annualDays = accrual
		? Number(customAnnualDays ?? policy.defaultAnnualDays)
		: configuration?.status === "legacy"
			? balance.totalDays
			: balance.allowanceDays;
	const projectedUsed = balance.usedDays + balance.pendingDays;
	let cumulativeAccrued = 0;
	const projections: AccrualProjection[] = [];
	for (let month = 1; month <= 12; month++) {
		const monthStart = Temporal.PlainDate.from({ year, month, day: 1 });
		let accrued = annualDays / 12;
		if (accrual) {
			// Before rollout, preserve the existing full-month projection; the custom allowance still
			// applies, and each month converts to the working week in effect in it (Absences ADR 0003).
			accrued =
				configuration?.status === "legacy"
					? (policyPeriodMonthlyAccrualDays({
							periods: result.periods.get(employeeId) ?? [],
							workingWeeks: result.workingWeeks.get(employeeId),
							customAnnualDays,
							year,
							month,
							employments: [{ startDate: null, lastWorkingDay: null }],
						}) ?? 0)
					: (policyPeriodMonthlyAccrualDays({
							periods: result.periods.get(employeeId) ?? [],
							workingWeeks: result.workingWeeks.get(employeeId),
							customAnnualDays,
							year,
							month,
							employments: stints,
						}) ?? 0);
			cumulativeAccrued += accrued;
		} else if (month === policy.accrualStartMonth) {
			cumulativeAccrued = annualDays;
		}
		projections.push({
			month,
			monthName: monthStart.toLocaleString("en-US", { month: "long" }),
			accrued,
			cumulativeAccrued: Math.round(cumulativeAccrued * 10) / 10,
			projectedUsed: Math.round(projectedUsed * 10) / 10,
			projectedBalance:
				Math.round((cumulativeAccrued - projectedUsed) * 10) / 10,
		});
	}
	return { configuration, projections };
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
		"Employee,Status,Total Allowance,Carryover,Adjustments,Used,Pending,Remaining,Utilization %,Carryover Expires",
	);

	// Data rows
	for (const report of reports) {
		const expiryStr = report.carryoverExpiryDate
			? instantFromDate(report.carryoverExpiryDate)
					.toZonedDateTimeISO(report.timezone ?? "UTC")
					.toPlainDate()
					.toString()
			: "N/A";

		lines.push(
			`${csvText(report.employeeName)},${configurationLabel(report.configuration)},${reportNumber(report.totalAllowance)},${reportNumber(report.carryover)},${reportNumber(report.adjustments)},${reportNumber(report.used)},${reportNumber(report.pending)},${reportNumber(report.remaining)},${report.utilizationRate === null ? "N/A" : `${report.utilizationRate}%`},${expiryStr}`,
		);
	}

	// Summary
	lines.push("");
	lines.push("Summary");
	const {
		totalAllowance,
		totalUsed,
		totalPending,
		totalRemaining,
		unavailable,
	} = reportTotals(reports);

	lines.push(`Total Employees,${reports.length}`);
	lines.push(`Employees Requiring Policy Review,${unavailable}`);
	if (unavailable > 0)
		lines.push("Totals include employees with resolved balances only");
	lines.push(`Total Allowance,${totalAllowance.toFixed(1)}`);
	lines.push(`Total Used,${totalUsed.toFixed(1)}`);
	lines.push(`Total Pending,${totalPending.toFixed(1)}`);
	lines.push(`Total Remaining,${totalRemaining.toFixed(1)}`);
	lines.push(
		`Average Utilization,${(totalAllowance > 0 ? ((totalUsed + totalPending) / totalAllowance) * 100 : 0).toFixed(1)}%`,
	);

	return lines.join("\n");
}

/**
 * Export expiration report as CSV
 */
export function exportExpirationReportAsCsv(
	reports: ExpirationReport[],
): string {
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
			`"${report.employeeName}",${report.carryoverDays.toFixed(1)},${instantFromDate(
				report.expiresAt,
			)
				.toZonedDateTimeISO(report.timezone ?? "UTC")
				.toPlainDate()
				.toString()},${report.daysUntilExpiry},${report.urgency}`,
		);
	}

	// Summary
	lines.push("");
	lines.push("Summary");
	lines.push(`Total Employees with Expiring Carryover,${reports.length}`);
	lines.push(
		`Total Days Expiring,${reports.reduce((sum, r) => sum + r.carryoverDays, 0).toFixed(1)}`,
	);
	lines.push(
		`Critical (7 days or less),${reports.filter((r) => r.urgency === "critical").length}`,
	);
	lines.push(
		`Warning (30 days or less),${reports.filter((r) => r.urgency === "warning").length}`,
	);

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
	const {
		totalAllowance,
		totalUsed,
		totalPending,
		totalRemaining,
		unavailable,
	} = reportTotals(reports);
	const avgUtilization =
		totalAllowance > 0
			? ((totalUsed + totalPending) / totalAllowance) * 100
			: 0;

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
  <p><strong>${htmlText(organizationName)}</strong> - Year ${year}</p>
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

  ${unavailable > 0 ? `<p>${unavailable} employees require policy review. Totals include employees with resolved balances only.</p>` : ""}
  <h2>Employee Balances</h2>
  <table>
    <tr>
      <th>Employee</th>
      <th>Status</th>
      <th>Total</th>
      <th>Carryover</th>
      <th>Used</th>
      <th>Pending</th>
      <th>Remaining</th>
      <th>Utilization</th>
    </tr>`;

	for (const report of reports) {
		const rowClass =
			report.remaining !== null && report.remaining <= 2 ? "low-balance" : "";

		html += `
    <tr class="${rowClass}">
      <td>${htmlText(report.employeeName)}</td>
      <td>${configurationLabel(report.configuration)}</td>
      <td>${reportNumber(report.totalAllowance)}</td>
      <td>${reportNumber(report.carryover)}</td>
      <td>${reportNumber(report.used)}</td>
      <td>${reportNumber(report.pending)}</td>
      <td>${reportNumber(report.remaining)}</td>
      <td>${report.utilizationRate === null ? "N/A" : `${report.utilizationRate}%`}</td>
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
    <strong>${report.employeeName}</strong> - ${report.carryoverDays.toFixed(1)} days expiring on ${instantFromDate(
			report.expiresAt,
		)
			.toZonedDateTimeISO(report.timezone ?? "UTC")
			.toPlainDate()
			.toLocaleString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
			})} (${report.daysUntilExpiry} days remaining)
  </div>`;
		}
	}

	if (warning.length > 0) {
		html += `
  <h2>Warning - Expiring within 30 days</h2>`;
		for (const report of warning) {
			html += `
  <div class="warning">
    <strong>${report.employeeName}</strong> - ${report.carryoverDays.toFixed(1)} days expiring on ${instantFromDate(
			report.expiresAt,
		)
			.toZonedDateTimeISO(report.timezone ?? "UTC")
			.toPlainDate()
			.toLocaleString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
			})} (${report.daysUntilExpiry} days remaining)
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
