/**
 * Audit Report Generator
 *
 * Generates various audit reports for compliance and analysis purposes.
 */

import { getAuditLogs, getAuditLogStats, type AuditLogResult } from "@/lib/query/audit.queries";
import { format } from "@/lib/datetime/luxon-utils";

export interface AuditReportOptions {
	organizationId: string;
	startDate: Date;
	endDate: Date;
	includeMetadata?: boolean;
	includeChanges?: boolean;
}

export interface DailySummary {
	date: string;
	totalEvents: number;
	uniqueUsers: number;
	byAction: Record<string, number>;
}

export interface UserActivityReport {
	userId: string;
	userName: string;
	userEmail: string;
	totalActions: number;
	actionBreakdown: Record<string, number>;
	firstAction: Date;
	lastAction: Date;
	ipAddresses: string[];
}

export interface ComplianceReport {
	reportPeriod: {
		start: string;
		end: string;
	};
	summary: {
		totalEvents: number;
		uniqueUsers: number;
		uniqueEntities: number;
	};
	dailySummaries: DailySummary[];
	topUsers: UserActivityReport[];
	actionBreakdown: Array<{ action: string; count: number; percentage: number }>;
	entityBreakdown: Array<{ entityType: string; count: number; percentage: number }>;
	securityEvents: AuditLogResult[];
	warnings: string[];
}

/**
 * Generate a daily audit summary
 */
export async function generateDailySummary(
	organizationId: string,
	date: Date
): Promise<DailySummary> {
	const startOfDay = new Date(date);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(date);
	endOfDay.setHours(23, 59, 59, 999);

	const result = await getAuditLogs({
		organizationId,
		startDate: startOfDay,
		endDate: endOfDay,
		limit: 10000,
	});

	const uniqueUsers = new Set(result.logs.map((l) => l.performedBy));
	const byAction: Record<string, number> = {};

	for (const log of result.logs) {
		byAction[log.action] = (byAction[log.action] || 0) + 1;
	}

	return {
		date: format(date, "yyyy-MM-dd"),
		totalEvents: result.total,
		uniqueUsers: uniqueUsers.size,
		byAction,
	};
}

/**
 * Generate user activity report
 */
export async function generateUserActivityReport(
	organizationId: string,
	startDate: Date,
	endDate: Date
): Promise<UserActivityReport[]> {
	const result = await getAuditLogs({
		organizationId,
		startDate,
		endDate,
		limit: 10000,
	});

	const userMap = new Map<
		string,
		{
			userName: string;
			userEmail: string;
			actions: AuditLogResult[];
			ipAddresses: Set<string>;
		}
	>();

	for (const log of result.logs) {
		const existing = userMap.get(log.performedBy) || {
			userName: log.performedByName || "Unknown",
			userEmail: log.performedByEmail || "",
			actions: [],
			ipAddresses: new Set<string>(),
		};

		existing.actions.push(log);
		if (log.ipAddress) {
			existing.ipAddresses.add(log.ipAddress);
		}

		userMap.set(log.performedBy, existing);
	}

	const reports: UserActivityReport[] = [];

	for (const [userId, data] of userMap) {
		const actionBreakdown: Record<string, number> = {};
		for (const action of data.actions) {
			actionBreakdown[action.action] = (actionBreakdown[action.action] || 0) + 1;
		}

		const sortedActions = data.actions.sort(
			(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
		);

		reports.push({
			userId,
			userName: data.userName,
			userEmail: data.userEmail,
			totalActions: data.actions.length,
			actionBreakdown,
			firstAction: new Date(sortedActions[0].timestamp),
			lastAction: new Date(sortedActions[sortedActions.length - 1].timestamp),
			ipAddresses: Array.from(data.ipAddresses),
		});
	}

	return reports.sort((a, b) => b.totalActions - a.totalActions);
}

/**
 * Generate a comprehensive compliance report
 */
export async function generateComplianceReport(
	options: AuditReportOptions
): Promise<ComplianceReport> {
	const { organizationId, startDate, endDate } = options;

	// Get all logs in date range
	const result = await getAuditLogs({
		organizationId,
		startDate,
		endDate,
		limit: 10000,
	});

	// Get statistics
	const stats = await getAuditLogStats(organizationId, startDate, endDate);

	// Calculate unique entities
	const uniqueEntities = new Set(result.logs.map((l) => `${l.entityType}:${l.entityId}`));

	// Generate daily summaries
	const dailySummaries: DailySummary[] = [];
	const currentDate = new Date(startDate);
	while (currentDate <= endDate) {
		const summary = await generateDailySummary(organizationId, new Date(currentDate));
		if (summary.totalEvents > 0) {
			dailySummaries.push(summary);
		}
		currentDate.setDate(currentDate.getDate() + 1);
	}

	// Get user activity reports
	const userReports = await generateUserActivityReport(organizationId, startDate, endDate);

	// Calculate action breakdown with percentages
	const actionBreakdown = stats.byAction.map((a) => ({
		action: a.action,
		count: a.count,
		percentage: Math.round((a.count / stats.totalEvents) * 100),
	}));

	// Calculate entity breakdown with percentages
	const entityBreakdown = stats.byEntityType.map((e) => ({
		entityType: e.entityType,
		count: e.count,
		percentage: Math.round((e.count / stats.totalEvents) * 100),
	}));

	// Identify security events
	const securityEvents = result.logs.filter(
		(log) =>
			log.action.startsWith("auth.") ||
			log.action.includes("permission") ||
			log.action.includes("rejected") ||
			log.action.includes("failed")
	);

	// Generate warnings
	const warnings: string[] = [];

	// Check for unusual patterns
	if (securityEvents.filter((e) => e.action === "auth.login_failed").length > 10) {
		warnings.push("High number of failed login attempts detected");
	}

	const uniqueIps = new Set(result.logs.filter((l) => l.ipAddress).map((l) => l.ipAddress));
	if (uniqueIps.size > 50) {
		warnings.push(`High number of unique IP addresses (${uniqueIps.size}) accessing the system`);
	}

	// Check for off-hours activity
	const offHoursEvents = result.logs.filter((log) => {
		const hour = new Date(log.timestamp).getHours();
		return hour < 6 || hour > 22;
	});
	if (offHoursEvents.length > result.logs.length * 0.1) {
		warnings.push("Significant off-hours activity detected (>10% of events outside 6AM-10PM)");
	}

	return {
		reportPeriod: {
			start: format(startDate, "yyyy-MM-dd"),
			end: format(endDate, "yyyy-MM-dd"),
		},
		summary: {
			totalEvents: stats.totalEvents,
			uniqueUsers: stats.byUser.length,
			uniqueEntities: uniqueEntities.size,
		},
		dailySummaries,
		topUsers: userReports.slice(0, 10),
		actionBreakdown,
		entityBreakdown,
		securityEvents: securityEvents.slice(0, 100), // Limit to 100 security events
		warnings,
	};
}

/**
 * Export compliance report as CSV
 */
export function exportComplianceReportAsCsv(report: ComplianceReport): string {
	const lines: string[] = [];

	// Header
	lines.push("Audit Compliance Report");
	lines.push(`Period: ${report.reportPeriod.start} to ${report.reportPeriod.end}`);
	lines.push("");

	// Summary
	lines.push("Summary");
	lines.push(`Total Events,${report.summary.totalEvents}`);
	lines.push(`Unique Users,${report.summary.uniqueUsers}`);
	lines.push(`Unique Entities,${report.summary.uniqueEntities}`);
	lines.push("");

	// Warnings
	if (report.warnings.length > 0) {
		lines.push("Warnings");
		for (const warning of report.warnings) {
			lines.push(`"${warning}"`);
		}
		lines.push("");
	}

	// Action breakdown
	lines.push("Action Breakdown");
	lines.push("Action,Count,Percentage");
	for (const action of report.actionBreakdown) {
		lines.push(`"${action.action}",${action.count},${action.percentage}%`);
	}
	lines.push("");

	// Entity breakdown
	lines.push("Entity Breakdown");
	lines.push("Entity Type,Count,Percentage");
	for (const entity of report.entityBreakdown) {
		lines.push(`"${entity.entityType}",${entity.count},${entity.percentage}%`);
	}
	lines.push("");

	// Top users
	lines.push("Top Users by Activity");
	lines.push("User,Email,Total Actions,First Action,Last Action");
	for (const user of report.topUsers) {
		lines.push(
			`"${user.userName}","${user.userEmail}",${user.totalActions},"${format(user.firstAction, "yyyy-MM-dd HH:mm")}","${format(user.lastAction, "yyyy-MM-dd HH:mm")}"`
		);
	}
	lines.push("");

	// Daily summary
	lines.push("Daily Summary");
	lines.push("Date,Total Events,Unique Users");
	for (const day of report.dailySummaries) {
		lines.push(`${day.date},${day.totalEvents},${day.uniqueUsers}`);
	}

	return lines.join("\n");
}

/**
 * Format compliance report as HTML for email
 */
export function formatComplianceReportAsHtml(report: ComplianceReport): string {
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
    .warning { background-color: #fef3c7; padding: 10px; border-left: 4px solid #f59e0b; margin-bottom: 10px; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat-card { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #2563eb; }
    .stat-label { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Audit Compliance Report</h1>
  <p>Period: ${report.reportPeriod.start} to ${report.reportPeriod.end}</p>

  <div class="summary">
    <div class="stat-card">
      <div class="stat-value">${report.summary.totalEvents.toLocaleString()}</div>
      <div class="stat-label">Total Events</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${report.summary.uniqueUsers}</div>
      <div class="stat-label">Unique Users</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${report.summary.uniqueEntities}</div>
      <div class="stat-label">Unique Entities</div>
    </div>
  </div>`;

	// Warnings
	if (report.warnings.length > 0) {
		html += `<h2>Warnings</h2>`;
		for (const warning of report.warnings) {
			html += `<div class="warning">${warning}</div>`;
		}
	}

	// Action breakdown
	html += `
  <h2>Action Breakdown</h2>
  <table>
    <tr><th>Action</th><th>Count</th><th>Percentage</th></tr>`;
	for (const action of report.actionBreakdown.slice(0, 10)) {
		html += `<tr><td>${action.action}</td><td>${action.count}</td><td>${action.percentage}%</td></tr>`;
	}
	html += `</table>`;

	// Top users
	html += `
  <h2>Top Users</h2>
  <table>
    <tr><th>User</th><th>Email</th><th>Actions</th><th>Last Active</th></tr>`;
	for (const user of report.topUsers.slice(0, 10)) {
		html += `<tr><td>${user.userName}</td><td>${user.userEmail}</td><td>${user.totalActions}</td><td>${format(user.lastAction, "MMM d, yyyy HH:mm")}</td></tr>`;
	}
	html += `</table>`;

	// Security events
	if (report.securityEvents.length > 0) {
		html += `
  <h2>Security Events (${report.securityEvents.length})</h2>
  <table>
    <tr><th>Timestamp</th><th>Action</th><th>User</th><th>IP Address</th></tr>`;
		for (const event of report.securityEvents.slice(0, 20)) {
			html += `<tr><td>${format(new Date(event.timestamp), "MMM d HH:mm")}</td><td>${event.action}</td><td>${event.performedByName}</td><td>${event.ipAddress || "-"}</td></tr>`;
		}
		html += `</table>`;
	}

	html += `
  <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
    This report was generated automatically. For full details, access the Audit Log in Settings.
  </p>
</body>
</html>`;

	return html;
}
