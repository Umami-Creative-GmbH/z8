/**
 * Compliance Adaptive Card Builder
 *
 * Builds the compliance summary card showing violations, alerts, and pending exceptions.
 * Uses color-coding to highlight severity levels.
 */

import { DateTime } from "luxon";
import type { ComplianceSummary, ComplianceAlert, ComplianceExceptionSummary } from "@/lib/effect/services/teams-compliance.service";

// ============================================
// TYPES
// ============================================

export interface ComplianceCardInput {
	summary: ComplianceSummary;
	daysBack: number;
	appUrl: string;
	locale: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getSeverityColor(severity: "warning" | "critical" | "violation"): string {
	switch (severity) {
		case "violation":
			return "attention"; // Red
		case "critical":
			return "warning"; // Yellow/Orange
		case "warning":
		default:
			return "default";
	}
}

function getSeverityIcon(severity: "warning" | "critical" | "violation"): string {
	switch (severity) {
		case "violation":
			return "🔴";
		case "critical":
			return "🟠";
		case "warning":
		default:
			return "🟡";
	}
}

function getExceptionTypeLabel(type: string): string {
	switch (type) {
		case "rest_period":
			return "Rest Period";
		case "overtime_daily":
			return "Daily Overtime";
		case "overtime_weekly":
			return "Weekly Overtime";
		case "overtime_monthly":
			return "Monthly Overtime";
		default:
			return type;
	}
}

function formatDate(date: Date, timezone?: string): string {
	const dt = timezone ? DateTime.fromJSDate(date).setZone(timezone) : DateTime.fromJSDate(date);
	return dt.toFormat("MMM d");
}

// ============================================
// CARD BUILDER
// ============================================

export function buildComplianceCard(input: ComplianceCardInput): Record<string, unknown> {
	const { summary, daysBack, appUrl } = input;

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: summary.criticalAlertsCount > 0 ? "attention" : "emphasis",
			items: [
				{
					type: "TextBlock",
					text: "⚠️ Compliance Summary",
					weight: "bolder",
					size: "large",
					color: summary.criticalAlertsCount > 0 ? "attention" : "default",
				},
				{
					type: "TextBlock",
					text: `Last ${daysBack} days`,
					spacing: "none",
					isSubtle: true,
				},
			],
			bleed: true,
			padding: "default",
		},
		// Summary Stats
		{
			type: "Container",
			spacing: "medium",
			items: [
				{
					type: "ColumnSet",
					columns: [
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Violations",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: summary.recentViolationsCount.toString(),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: summary.recentViolationsCount > 0 ? "attention" : "good",
								},
							],
						},
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Critical",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: summary.criticalAlertsCount.toString(),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: summary.criticalAlertsCount > 0 ? "warning" : "good",
								},
							],
						},
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Pending",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: summary.pendingExceptions.length.toString(),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: summary.pendingExceptions.length > 0 ? "accent" : "default",
								},
							],
						},
					],
				},
			],
		},
	];

	// Violations Section
	if (summary.alerts.length > 0) {
		const violationItems: Array<Record<string, unknown>> = [
			{
				type: "TextBlock",
				text: "Recent Violations",
				weight: "bolder",
				size: "medium",
			},
		];

		for (const alert of summary.alerts.slice(0, 5)) {
			violationItems.push({
				type: "ColumnSet",
				spacing: "small",
				columns: [
					{
						type: "Column",
						width: "auto",
						items: [
							{
								type: "TextBlock",
								text: getSeverityIcon(alert.severity),
							},
						],
					},
					{
						type: "Column",
						width: "stretch",
						items: [
							{
								type: "TextBlock",
								text: `**${alert.employeeName}**`,
								wrap: true,
							},
							{
								type: "TextBlock",
								text: `${alert.details}${alert.hasException ? " (exception used)" : ""}`,
								size: "small",
								isSubtle: true,
								spacing: "none",
								wrap: true,
							},
						],
					},
					{
						type: "Column",
						width: "auto",
						items: [
							{
								type: "TextBlock",
								text: formatDate(alert.date),
								size: "small",
								isSubtle: true,
							},
						],
					},
				],
			});
		}

		if (summary.alerts.length > 5) {
			violationItems.push({
				type: "TextBlock",
				text: `_+${summary.alerts.length - 5} more violations_`,
				size: "small",
				isSubtle: true,
			});
		}

		body.push({
			type: "Container",
			spacing: "medium",
			separator: true,
			items: violationItems,
		});
	}

	// Pending Exceptions Section
	if (summary.pendingExceptions.length > 0) {
		const exceptionItems: Array<Record<string, unknown>> = [
			{
				type: "TextBlock",
				text: "Pending Exception Requests",
				weight: "bolder",
				size: "medium",
			},
		];

		for (const exception of summary.pendingExceptions.slice(0, 5)) {
			exceptionItems.push({
				type: "ColumnSet",
				spacing: "small",
				columns: [
					{
						type: "Column",
						width: "auto",
						items: [
							{
								type: "TextBlock",
								text: "📝",
							},
						],
					},
					{
						type: "Column",
						width: "stretch",
						items: [
							{
								type: "TextBlock",
								text: `**${exception.employeeName}**`,
								wrap: true,
							},
							{
								type: "TextBlock",
								text: `${getExceptionTypeLabel(exception.exceptionType)} - ${exception.reason}`,
								size: "small",
								isSubtle: true,
								spacing: "none",
								wrap: true,
							},
						],
					},
					{
						type: "Column",
						width: "auto",
						items: [
							{
								type: "TextBlock",
								text: formatDate(exception.requestedAt),
								size: "small",
								isSubtle: true,
							},
						],
					},
				],
			});
		}

		if (summary.pendingExceptions.length > 5) {
			exceptionItems.push({
				type: "TextBlock",
				text: `_+${summary.pendingExceptions.length - 5} more requests_`,
				size: "small",
				isSubtle: true,
			});
		}

		body.push({
			type: "Container",
			spacing: "medium",
			separator: true,
			items: exceptionItems,
		});
	}

	// Legend
	body.push({
		type: "Container",
		spacing: "medium",
		separator: true,
		items: [
			{
				type: "TextBlock",
				text: "🔴 Violation  🟠 Critical  🟡 Warning  📝 Pending Request",
				size: "small",
				isSubtle: true,
				horizontalAlignment: "center",
				wrap: true,
			},
		],
	});

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body,
		actions: [
			{
				type: "Action.OpenUrl",
				title: "View Compliance Dashboard",
				url: `${appUrl}/settings/compliance`,
			},
			...(summary.pendingExceptions.length > 0
				? [
						{
							type: "Action.OpenUrl",
							title: "Review Exceptions",
							url: `${appUrl}/approvals`,
						},
					]
				: []),
		],
	};
}

/**
 * Build text-only compliance summary (fallback for non-card clients)
 */
export function buildComplianceText(input: ComplianceCardInput): string {
	const { summary, daysBack } = input;

	const lines: string[] = [
		`**⚠️ Compliance Summary - Last ${daysBack} days**`,
		"",
		`**Violations:** ${summary.recentViolationsCount}`,
		`**Critical Alerts:** ${summary.criticalAlertsCount}`,
		`**Pending Exceptions:** ${summary.pendingExceptions.length}`,
		"",
	];

	if (summary.alerts.length > 0) {
		lines.push("**Recent Violations:**");
		for (const alert of summary.alerts.slice(0, 5)) {
			const icon = getSeverityIcon(alert.severity);
			lines.push(`${icon} ${alert.employeeName} - ${alert.details}`);
		}
		if (summary.alerts.length > 5) {
			lines.push(`  +${summary.alerts.length - 5} more`);
		}
		lines.push("");
	}

	if (summary.pendingExceptions.length > 0) {
		lines.push("**Pending Requests:**");
		for (const exception of summary.pendingExceptions.slice(0, 5)) {
			lines.push(`📝 ${exception.employeeName} - ${getExceptionTypeLabel(exception.exceptionType)}`);
		}
		if (summary.pendingExceptions.length > 5) {
			lines.push(`  +${summary.pendingExceptions.length - 5} more`);
		}
	}

	return lines.join("\n");
}
