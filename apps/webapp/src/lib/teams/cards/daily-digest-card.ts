/**
 * Daily Digest Adaptive Card Builder
 *
 * Builds the daily summary card sent to managers each morning.
 */

import { DateTime } from "luxon";
import { type BotTranslateFn, fmtFullDate } from "@/lib/bot-platform/i18n";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import type { DailyDigestData } from "../types";

const fallbackT: BotTranslateFn = (_key, defaultValue, params) =>
	Object.entries(params ?? {}).reduce(
		(message, [name, value]) => message.replace(`{${name}}`, String(value)),
		defaultValue,
	);

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
	locale: string = DEFAULT_LANGUAGE,
	t: BotTranslateFn = fallbackT,
): Record<string, unknown> {
	const dateFormatted = fmtFullDate(DateTime.fromJSDate(data.date).setZone(data.timezone), locale);

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: "accent",
			items: [
				{
					type: "TextBlock",
					text: t("teamsBot:digest.title", "Daily Digest"),
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
				text: t("teamsBot:digest.pendingApprovals", "Pending Approvals"),
				weight: "bolder",
				size: "medium",
			},
			{
				type: "TextBlock",
				text:
					data.pendingApprovals === 0
						? t("teamsBot:digest.noPendingApprovals", "No pending approvals")
						: t(
								data.pendingApprovals === 1
									? "teamsBot:digest.pendingApprovalsCount"
									: "teamsBot:digest.pendingApprovalsCountPlural",
								data.pendingApprovals === 1
									? "You have {count} pending approval"
									: "You have {count} pending approvals",
								{ count: data.pendingApprovals },
							),
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
				text: t("teamsBot:digest.whosOutToday", "Who's Out Today"),
				weight: "bolder",
				size: "medium",
			},
			...(data.employeesOut.length === 0
				? [
						{
							type: "TextBlock",
							text: t("teamsBot:digest.everyoneAvailable", "Everyone is available today"),
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
										text: t("teamsBot:digest.returns", "Returns {date}", {
											date: emp.returnDate,
										}),
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
							text: `_${t("teamsBot:common.more", "+{count} more", {
								count: data.employeesOut.length - 5,
							})}_`,
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
				text: t("teamsBot:digest.currentlyClockedIn", "Currently Clocked In"),
				weight: "bolder",
				size: "medium",
			},
			...(data.employeesClockedIn.length === 0
				? [
						{
							type: "TextBlock",
							text: t("teamsBot:digest.noOneClockedIn", "No one is clocked in yet"),
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
										text: t("teamsBot:digest.since", "Since {time}", {
											time: emp.clockedInAt,
										}),
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
							text: `_${t("teamsBot:common.more", "+{count} more", {
								count: data.employeesClockedIn.length - 5,
							})}_`,
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
					text: `📋 ${t("teamsBot:digest.openShifts", "Open Shifts")}`,
					weight: "bolder",
					size: "medium",
				},
				{
					type: "TextBlock",
					text: t("teamsBot:digest.todayTomorrow", "Today: {today} | Tomorrow: {tomorrow}", {
						today: `**${data.openShiftsToday || 0}**`,
						tomorrow: `**${data.openShiftsTomorrow || 0}**`,
					}),
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
				title: t("teamsBot:digest.openDashboard", "Open Z8 Dashboard"),
				url: `${appUrl}/dashboard`,
			},
			...(data.pendingApprovals > 0
				? [
						{
							type: "Action.OpenUrl",
							title: t("teamsBot:digest.viewApprovals", "View Approvals"),
							url: `${appUrl}/approvals/inbox`,
						},
					]
				: []),
		],
	};
}

/**
 * Build a simplified digest summary for text-only clients
 */
export function buildDailyDigestText(
	data: DailyDigestData,
	locale: string = DEFAULT_LANGUAGE,
	t: BotTranslateFn = fallbackT,
): string {
	const lines: string[] = [];
	const dateFormatted = fmtFullDate(DateTime.fromJSDate(data.date).setZone(data.timezone), locale);

	lines.push(t("teamsBot:digest.textTitle", "**Daily Digest - {date}**", { date: dateFormatted }));
	lines.push("");

	// Pending approvals
	if (data.pendingApprovals === 0) {
		lines.push(t("teamsBot:digest.textPendingApprovalsNone", "**Pending Approvals:** None"));
	} else {
		lines.push(
			t("teamsBot:digest.textPendingApprovalsCount", "**Pending Approvals:** {count}", {
				count: data.pendingApprovals,
			}),
		);
	}
	lines.push("");

	// Who's out
	lines.push(t("teamsBot:digest.textWhosOut", "**Who's Out:**"));
	if (data.employeesOut.length === 0) {
		lines.push(t("teamsBot:digest.everyoneAvailable", "Everyone is available today"));
	} else {
		for (const emp of data.employeesOut.slice(0, 5)) {
			lines.push(
				t("teamsBot:digest.textEmployeeOut", "• {name} - {category} (returns {returnDate})", {
					name: emp.name,
					category: emp.category,
					returnDate: emp.returnDate,
				}),
			);
		}
		if (data.employeesOut.length > 5) {
			lines.push(
				t("teamsBot:common.moreBullet", "• +{count} more", { count: data.employeesOut.length - 5 }),
			);
		}
	}
	lines.push("");

	// Clocked in
	lines.push(t("teamsBot:digest.textCurrentlyClockedIn", "**Currently Clocked In:**"));
	if (data.employeesClockedIn.length === 0) {
		lines.push(t("teamsBot:digest.noOneClockedIn", "No one is clocked in yet"));
	} else {
		for (const emp of data.employeesClockedIn.slice(0, 5)) {
			lines.push(
				t("teamsBot:digest.textClockedInEmployee", "• {name} - since {clockedInAt} ({duration})", {
					name: emp.name,
					clockedInAt: emp.clockedInAt,
					duration: emp.durationSoFar,
				}),
			);
		}
		if (data.employeesClockedIn.length > 5) {
			lines.push(
				t("teamsBot:common.moreBullet", "• +{count} more", {
					count: data.employeesClockedIn.length - 5,
				}),
			);
		}
	}
	lines.push("");

	// Operations Console Additions

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		lines.push(t("teamsBot:digest.textCoverageGaps", "**🔴 Coverage Gaps:**"));
		for (const gap of data.coverageGaps) {
			lines.push(
				`• ${gap.locationName} - ${gap.subareaName}: ${gap.actual}/${gap.scheduled} (-${gap.shortage})`,
			);
		}
		lines.push("");
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		lines.push(t("teamsBot:digest.textOpenShifts", "**📋 Open Shifts:**"));
		lines.push(
			t("teamsBot:digest.todayTomorrow", "Today: {today} | Tomorrow: {tomorrow}", {
				today: data.openShiftsToday || 0,
				tomorrow: data.openShiftsTomorrow || 0,
			}),
		);
		lines.push("");
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		lines.push(t("teamsBot:digest.textCompliance", "**⚠️ Compliance:**"));
		lines.push(
			t(
				"teamsBot:digest.pendingExceptionRequests",
				"{count, plural, one {# pending exception request awaiting review} other {# pending exception requests awaiting review}}",
				{
					count: data.compliancePending,
				},
			),
		);
		lines.push("");
	}

	return lines.join("\n");
}
