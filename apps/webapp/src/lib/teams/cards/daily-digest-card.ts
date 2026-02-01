/**
 * Daily Digest Adaptive Card Builder
 *
 * Builds the daily summary card sent to managers each morning.
 */

import { DateTime } from "luxon";
import type { DailyDigestData } from "../types";

/**
 * Build a daily digest Adaptive Card
 *
 * @param data - Digest data
 * @param appUrl - Base URL of the Z8 app
 * @returns Adaptive Card JSON
 */
export function buildDailyDigestCard(
	data: DailyDigestData,
	appUrl: string,
): Record<string, unknown> {
	const dateFormatted = DateTime.fromJSDate(data.date)
		.setZone(data.timezone)
		.toFormat("EEEE, MMMM d, yyyy");

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: "accent",
			items: [
				{
					type: "TextBlock",
					text: "Daily Digest",
					weight: "bolder",
					size: "large",
					color: "light",
				},
				{
					type: "TextBlock",
					text: dateFormatted,
					color: "light",
					spacing: "none",
				},
			],
			bleed: true,
			padding: "default",
		},
	];

	// Pending Approvals Section
	body.push({
		type: "Container",
		spacing: "medium",
		items: [
			{
				type: "TextBlock",
				text: "Pending Approvals",
				weight: "bolder",
				size: "medium",
			},
			{
				type: "TextBlock",
				text:
					data.pendingApprovals === 0
						? "No pending approvals"
						: `You have **${data.pendingApprovals}** pending approval${data.pendingApprovals !== 1 ? "s" : ""}`,
				wrap: true,
			},
		],
	});

	// Who's Out Section
	body.push({
		type: "Container",
		spacing: "medium",
		separator: true,
		items: [
			{
				type: "TextBlock",
				text: "Who's Out Today",
				weight: "bolder",
				size: "medium",
			},
			...(data.employeesOut.length === 0
				? [
						{
							type: "TextBlock",
							text: "Everyone is available today",
							wrap: true,
						},
					]
				: data.employeesOut.slice(0, 5).map((emp) => ({
						type: "ColumnSet",
						columns: [
							{
								type: "Column",
								width: "stretch",
								items: [
									{
										type: "TextBlock",
										text: `**${emp.name}**`,
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
										text: emp.category,
										isSubtle: true,
									},
								],
							},
							{
								type: "Column",
								width: "auto",
								items: [
									{
										type: "TextBlock",
										text: `Returns ${emp.returnDate}`,
										isSubtle: true,
									},
								],
							},
						],
					}))),
			...(data.employeesOut.length > 5
				? [
						{
							type: "TextBlock",
							text: `_+${data.employeesOut.length - 5} more_`,
							isSubtle: true,
						},
					]
				: []),
		],
	});

	// Currently Clocked In Section
	body.push({
		type: "Container",
		spacing: "medium",
		separator: true,
		items: [
			{
				type: "TextBlock",
				text: "Currently Clocked In",
				weight: "bolder",
				size: "medium",
			},
			...(data.employeesClockedIn.length === 0
				? [
						{
							type: "TextBlock",
							text: "No one is clocked in yet",
							wrap: true,
						},
					]
				: data.employeesClockedIn.slice(0, 5).map((emp) => ({
						type: "ColumnSet",
						columns: [
							{
								type: "Column",
								width: "stretch",
								items: [
									{
										type: "TextBlock",
										text: `**${emp.name}**`,
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
										text: `Since ${emp.clockedInAt}`,
										isSubtle: true,
									},
								],
							},
							{
								type: "Column",
								width: "auto",
								items: [
									{
										type: "TextBlock",
										text: emp.durationSoFar,
										isSubtle: true,
									},
								],
							},
						],
					}))),
			...(data.employeesClockedIn.length > 5
				? [
						{
							type: "TextBlock",
							text: `_+${data.employeesClockedIn.length - 5} more_`,
							isSubtle: true,
						},
					]
				: []),
		],
	});

	// =========================================
	// Operations Console Sections
	// =========================================

	// Coverage Gaps Section (if any)
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		body.push({
			type: "Container",
			spacing: "medium",
			separator: true,
			items: [
				{
					type: "TextBlock",
					text: "🔴 Coverage Gaps",
					weight: "bolder",
					size: "medium",
					color: "attention",
				},
				...data.coverageGaps.map((gap) => ({
					type: "ColumnSet",
					columns: [
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: `**${gap.locationName}** - ${gap.subareaName}`,
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
									text: gap.timeSlot,
									isSubtle: true,
								},
							],
						},
						{
							type: "Column",
							width: "auto",
							items: [
								{
									type: "TextBlock",
									text: `${gap.actual}/${gap.scheduled} (-${gap.shortage})`,
									color: "attention",
								},
							],
						},
					],
				})),
			],
		});
	}

	// Open Shifts Section (if any)
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		body.push({
			type: "Container",
			spacing: "medium",
			separator: true,
			items: [
				{
					type: "TextBlock",
					text: "📋 Open Shifts",
					weight: "bolder",
					size: "medium",
				},
				{
					type: "TextBlock",
					text: `Today: **${data.openShiftsToday || 0}** | Tomorrow: **${data.openShiftsTomorrow || 0}**`,
					wrap: true,
				},
			],
		});
	}

	// Compliance Alerts Section (if any)
	if (data.compliancePending && data.compliancePending > 0) {
		body.push({
			type: "Container",
			spacing: "medium",
			separator: true,
			items: [
				{
					type: "TextBlock",
					text: "⚠️ Compliance Alerts",
					weight: "bolder",
					size: "medium",
					color: "warning",
				},
				{
					type: "TextBlock",
					text: `**${data.compliancePending}** pending exception request${data.compliancePending > 1 ? "s" : ""} awaiting review`,
					wrap: true,
				},
			],
		});
	}

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: body,
		actions: [
			{
				type: "Action.OpenUrl",
				title: "Open Z8 Dashboard",
				url: `${appUrl}/dashboard`,
			},
			...(data.pendingApprovals > 0
				? [
						{
							type: "Action.OpenUrl",
							title: "View Approvals",
							url: `${appUrl}/approvals`,
						},
					]
				: []),
		],
	};
}

/**
 * Build a simplified digest summary for text-only clients
 */
export function buildDailyDigestText(data: DailyDigestData): string {
	const lines: string[] = [];
	const dateFormatted = DateTime.fromJSDate(data.date)
		.setZone(data.timezone)
		.toFormat("EEEE, MMMM d, yyyy");

	lines.push(`**Daily Digest - ${dateFormatted}**`);
	lines.push("");

	// Pending approvals
	if (data.pendingApprovals === 0) {
		lines.push("**Pending Approvals:** None");
	} else {
		lines.push(`**Pending Approvals:** ${data.pendingApprovals}`);
	}
	lines.push("");

	// Who's out
	lines.push("**Who's Out:**");
	if (data.employeesOut.length === 0) {
		lines.push("Everyone is available");
	} else {
		for (const emp of data.employeesOut.slice(0, 5)) {
			lines.push(`• ${emp.name} - ${emp.category} (returns ${emp.returnDate})`);
		}
		if (data.employeesOut.length > 5) {
			lines.push(`• +${data.employeesOut.length - 5} more`);
		}
	}
	lines.push("");

	// Clocked in
	lines.push("**Currently Clocked In:**");
	if (data.employeesClockedIn.length === 0) {
		lines.push("No one yet");
	} else {
		for (const emp of data.employeesClockedIn.slice(0, 5)) {
			lines.push(`• ${emp.name} - since ${emp.clockedInAt} (${emp.durationSoFar})`);
		}
		if (data.employeesClockedIn.length > 5) {
			lines.push(`• +${data.employeesClockedIn.length - 5} more`);
		}
	}
	lines.push("");

	// Operations Console Additions

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		lines.push("**🔴 Coverage Gaps:**");
		for (const gap of data.coverageGaps) {
			lines.push(`• ${gap.locationName} - ${gap.subareaName}: ${gap.actual}/${gap.scheduled} (-${gap.shortage})`);
		}
		lines.push("");
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		lines.push("**📋 Open Shifts:**");
		lines.push(`Today: ${data.openShiftsToday || 0} | Tomorrow: ${data.openShiftsTomorrow || 0}`);
		lines.push("");
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		lines.push("**⚠️ Compliance:**");
		lines.push(`${data.compliancePending} pending exception request${data.compliancePending > 1 ? "s" : ""}`);
		lines.push("");
	}

	return lines.join("\n");
}
