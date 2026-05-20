/**
 * Compliance Adaptive Card Builder
 *
 * Builds the compliance summary card showing violations, alerts, and pending exceptions.
 * Uses color-coding to highlight severity levels.
 */

import { DateTime } from "luxon";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import type { ComplianceSummary, ComplianceAlert, ComplianceExceptionSummary } from "@/lib/effect/services/teams-compliance.service";
import { fmtShortDate } from "@/lib/bot-platform/i18n";

// ============================================
// TYPES
// ============================================

export interface ComplianceCardInput {
	summary: ComplianceSummary;
	daysBack: number;
	appUrl: string;
	locale: string;
	t?: BotTranslateFn;
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

function getExceptionTypeLabel(type: string, t: BotTranslateFn): string {
	switch (type) {
		case "rest_period":
			return t("teamsBot:exceptionTypes.rest_period", "Rest Period");
		case "overtime_daily":
			return t("teamsBot:exceptionTypes.overtime_daily", "Daily Overtime");
		case "overtime_weekly":
			return t("teamsBot:exceptionTypes.overtime_weekly", "Weekly Overtime");
		case "overtime_monthly":
			return t("teamsBot:exceptionTypes.overtime_monthly", "Monthly Overtime");
		default:
			return type;
	}
}

function formatDate(date: Date, locale: string, timezone?: string): string {
	const dt = timezone ? DateTime.fromJSDate(date).setZone(timezone) : DateTime.fromJSDate(date);
	return fmtShortDate(dt, locale);
}

// ============================================
// CARD BUILDER
// ============================================

export function buildComplianceCard(input: ComplianceCardInput): Record<string, unknown> {
	const { summary, daysBack, appUrl, locale } = input;
	const t = input.t ?? ((_key, defaultValue) => defaultValue);

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: summary.criticalAlertsCount > 0 ? "attention" : "emphasis",
			items: [
				{
					type: "TextBlock",
					text: t("teamsBot:commands.compliance.titleWithIcon", "⚠️ Compliance Summary"),
					weight: "bolder",
					size: "large",
					color: summary.criticalAlertsCount > 0 ? "attention" : "default",
				},
				{
					type: "TextBlock",
					text: t("teamsBot:commands.compliance.lastDays", "Last {days} days", { days: daysBack }),
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
									text: t("teamsBot:commands.compliance.violations", "Violations"),
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
									text: t("teamsBot:commands.compliance.critical", "Critical"),
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
									text: t("teamsBot:commands.compliance.pending", "Pending"),
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
				text: t("teamsBot:commands.compliance.recentViolations", "Recent Violations"),
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
								text: alert.hasException
									? t("teamsBot:commands.compliance.exceptionUsedDetails", "{details} (exception used)", { details: alert.details })
									: alert.details,
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
								text: formatDate(alert.date, locale),
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
				text: t("teamsBot:commands.compliance.moreViolationsMarkdown", "_+{count} more violations_", { count: summary.alerts.length - 5 }),
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
				text: t("teamsBot:commands.compliance.pendingExceptions", "Pending Exception Requests"),
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
								text: t("teamsBot:commands.compliance.exceptionSummary", "{type} - {reason}", {
									type: getExceptionTypeLabel(exception.exceptionType, t),
									reason: exception.reason,
								}),
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
								text: formatDate(exception.requestedAt, locale),
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
				text: t("teamsBot:commands.compliance.moreRequestsMarkdown", "_+{count} more requests_", { count: summary.pendingExceptions.length - 5 }),
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
				text: t(
					"teamsBot:commands.compliance.legend",
					"🔴 Violation  🟠 Critical  🟡 Warning  📝 Pending Request",
				),
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
				title: t("teamsBot:commands.compliance.viewDashboard", "View Compliance Dashboard"),
				url: `${appUrl}/settings/compliance`,
			},
			...(summary.pendingExceptions.length > 0
				? [
						{
							type: "Action.OpenUrl",
							title: t("teamsBot:commands.compliance.reviewExceptions", "Review Exceptions"),
							url: `${appUrl}/approvals/inbox`,
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
	const t = input.t ?? ((_key, defaultValue) => defaultValue);

	const lines: string[] = [
		t("teamsBot:commands.compliance.textTitle", "**⚠️ Compliance Summary - Last {days} days**", { days: daysBack }),
		"",
		t("teamsBot:commands.compliance.textViolations", "**Violations:** {count}", { count: summary.recentViolationsCount }),
		t("teamsBot:commands.compliance.textCriticalAlerts", "**Critical Alerts:** {count}", { count: summary.criticalAlertsCount }),
		t("teamsBot:commands.compliance.textPendingExceptions", "**Pending Exceptions:** {count}", { count: summary.pendingExceptions.length }),
		"",
	];

	if (summary.alerts.length > 0) {
		lines.push(t("teamsBot:commands.compliance.textRecentViolations", "**Recent Violations:**"));
		for (const alert of summary.alerts.slice(0, 5)) {
			const icon = getSeverityIcon(alert.severity);
			lines.push(t("teamsBot:commands.compliance.textViolationItem", "{icon} {employeeName} - {details}", {
				icon,
				employeeName: alert.employeeName,
				details: alert.details,
			}));
		}
		if (summary.alerts.length > 5) {
			lines.push(t("teamsBot:commands.compliance.textMore", "  +{count} more", { count: summary.alerts.length - 5 }));
		}
		lines.push("");
	}

	if (summary.pendingExceptions.length > 0) {
		lines.push(t("teamsBot:commands.compliance.textPendingRequests", "**Pending Requests:**"));
		for (const exception of summary.pendingExceptions.slice(0, 5)) {
			lines.push(t("teamsBot:commands.compliance.textPendingRequestItem", "📝 {employeeName} - {type}", {
				employeeName: exception.employeeName,
				type: getExceptionTypeLabel(exception.exceptionType, t),
			}));
		}
		if (summary.pendingExceptions.length > 5) {
			lines.push(t("teamsBot:commands.compliance.textMore", "  +{count} more", { count: summary.pendingExceptions.length - 5 }));
		}
	}

	return lines.join("\n");
}
