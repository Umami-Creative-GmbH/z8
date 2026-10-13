/**
 * Discord Message Formatters
 *
 * Converts shared bot data into Discord embed objects and button components.
 */

import { DateTime } from "luxon";
import {
	type BotTranslateFn,
	fmtFullDate,
	fmtShortDate,
	fmtShortDateTime,
} from "@/lib/bot-platform/i18n";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import type {
	ApprovalButtonData,
	ApprovalCardData,
	ApprovalResolvedData,
	DailyDigestData,
	DiscordActionRow,
	DiscordEmbed,
} from "./types";
import { ButtonStyle, ComponentType } from "./types";

// ============================================
// EMBED COLORS
// ============================================

const Colors = {
	BLUE: 0x3498db,
	GREEN: 0x2ecc71,
	RED: 0xe74c3c,
	ORANGE: 0xf39c12,
	YELLOW: 0xf1c40f,
} as const;

// ============================================
// APPROVAL MESSAGES
// ============================================

/**
 * Build approval request embed with approve/reject buttons.
 */
export function buildApprovalEmbed(
	data: ApprovalCardData,
	locale: string = DEFAULT_LANGUAGE,
): {
	embeds: DiscordEmbed[];
	components: DiscordActionRow[];
} {
	const fields: DiscordEmbed["fields"] = [
		{ name: "From", value: data.requesterName, inline: true },
	];

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || "Leave";
		fields.push({ name: "Type", value: category, inline: true });
		if (data.startDate && data.endDate) {
			const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
			fields.push({ name: "Period", value: `${start} - ${end}`, inline: true });
		}
	} else if (data.entityType === "time_entry") {
		fields.push({ name: "Type", value: "Time entry correction", inline: true });
	}

	if (data.reason) {
		fields.push({ name: "Reason", value: data.reason, inline: false });
	}

	const submitted = fmtShortDateTime(DateTime.fromJSDate(data.createdAt), locale);
	fields.push({ name: "Submitted", value: submitted, inline: true });

	const approveData: ApprovalButtonData = { a: "ap", id: data.approvalId };
	const rejectData: ApprovalButtonData = { a: "rj", id: data.approvalId };

	return {
		embeds: [
			{
				title: "New Approval Request",
				color: Colors.ORANGE,
				fields,
				timestamp: data.createdAt.toISOString(),
			},
		],
		components: [
			{
				type: ComponentType.ACTION_ROW,
				components: [
					{
						type: ComponentType.BUTTON,
						style: ButtonStyle.SUCCESS,
						label: "Approve",
						custom_id: JSON.stringify(approveData),
					},
					{
						type: ComponentType.BUTTON,
						style: ButtonStyle.DANGER,
						label: "Reject",
						custom_id: JSON.stringify(rejectData),
					},
				],
			},
		],
	};
}

/**
 * Build resolved approval embed (replaces the original after action).
 */
export function buildResolvedApprovalEmbed(
	data: ApprovalCardData,
	resolved: ApprovalResolvedData,
	locale: string = DEFAULT_LANGUAGE,
): { embeds: DiscordEmbed[]; components: DiscordActionRow[] } {
	const isApproved = resolved.action === "approved";
	const icon = isApproved ? "\u2705" : "\u274C";
	const status = isApproved ? "Approved" : "Rejected";

	const fields: DiscordEmbed["fields"] = [
		{ name: "From", value: data.requesterName, inline: true },
	];

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || "Leave";
		fields.push({ name: "Type", value: category, inline: true });
		if (data.startDate && data.endDate) {
			const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
			fields.push({ name: "Period", value: `${start} - ${end}`, inline: true });
		}
	}

	const resolvedAt = fmtShortDateTime(DateTime.fromJSDate(resolved.resolvedAt), locale);
	fields.push({ name: `${status} by`, value: resolved.approverName, inline: true });
	fields.push({ name: "At", value: resolvedAt, inline: true });

	return {
		embeds: [
			{
				title: `${icon} Approval ${status}`,
				color: isApproved ? Colors.GREEN : Colors.RED,
				fields,
				timestamp: resolved.resolvedAt.toISOString(),
			},
		],
		// Disabled buttons to show the action was taken
		components: [
			{
				type: ComponentType.ACTION_ROW,
				components: [
					{
						type: ComponentType.BUTTON,
						style: isApproved ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
						label: "Approve",
						custom_id: "resolved_ap",
						disabled: true,
					},
					{
						type: ComponentType.BUTTON,
						style: !isApproved ? ButtonStyle.DANGER : ButtonStyle.SECONDARY,
						label: "Reject",
						custom_id: "resolved_rj",
						disabled: true,
					},
				],
			},
		],
	};
}

// ============================================
// DAILY DIGEST
// ============================================

/**
 * Build daily digest embed for Discord, in the recipient language.
 */
export function buildDailyDigestEmbed(
	data: DailyDigestData,
	appUrl: string,
	locale: string,
	t: BotTranslateFn,
): DiscordEmbed[] {
	const dateFormatted = fmtFullDate(DateTime.fromJSDate(data.date).setZone(data.timezone), locale);

	const fields: DiscordEmbed["fields"] = [];

	// Pending approvals
	fields.push({
		name: t("teamsBot:digest.pendingApprovals", "Pending Approvals"),
		value:
			data.pendingApprovals === 0 ? t("bot.digest.none", "None") : String(data.pendingApprovals),
		inline: true,
	});

	// Who's out
	const whosOut = t("teamsBot:digest.whosOutToday", "Who's Out Today");
	if (data.employeesOut.length === 0) {
		fields.push({
			name: whosOut,
			value: t("bot.digest.everyoneAvailable", "Everyone is available"),
			inline: true,
		});
	} else {
		const outList = data.employeesOut
			.slice(0, 5)
			.map(
				(emp) =>
					t("teamsBot:digest.textEmployeeOut", "• {name} - {category} (returns {returnDate})", {
						name: emp.name,
						category: emp.category,
						returnDate: emp.returnDate,
					}) +
					(emp.deputyName
						? ` · ${t("teamsBot:digest.deputy", "Deputy: {name}", { name: emp.deputyName })}`
						: ""),
			)
			.join("\n");
		const suffix =
			data.employeesOut.length > 5
				? `\n${t("teamsBot:common.moreBullet", "• +{count} more", { count: data.employeesOut.length - 5 })}`
				: "";
		fields.push({ name: whosOut, value: outList + suffix, inline: false });
	}

	// Clocked in
	const clockedIn = t("teamsBot:digest.currentlyClockedIn", "Currently Clocked In");
	if (data.employeesClockedIn.length === 0) {
		fields.push({ name: clockedIn, value: t("bot.digest.noOneYet", "No one yet"), inline: true });
	} else {
		const clockedList = data.employeesClockedIn
			.slice(0, 5)
			.map((emp) =>
				t("teamsBot:digest.textClockedInEmployee", "• {name} - since {clockedInAt} ({duration})", {
					name: emp.name,
					clockedInAt: emp.clockedInAt,
					duration: emp.durationSoFar,
				}),
			)
			.join("\n");
		const suffix =
			data.employeesClockedIn.length > 5
				? `\n${t("teamsBot:common.moreBullet", "• +{count} more", { count: data.employeesClockedIn.length - 5 })}`
				: "";
		fields.push({ name: clockedIn, value: clockedList + suffix, inline: false });
	}

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		const gapList = data.coverageGaps
			.map(
				(gap) =>
					`${gap.locationName} - ${gap.subareaName}: ${gap.actual}/${gap.scheduled} (-${gap.shortage})`,
			)
			.join("\n");
		fields.push({
			name: t("bot.digest.coverageGapsTitle", "Coverage Gaps"),
			value: gapList,
			inline: false,
		});
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		fields.push({
			name: t("teamsBot:digest.openShifts", "Open Shifts"),
			value: t("teamsBot:digest.todayTomorrow", "Today: {today} | Tomorrow: {tomorrow}", {
				today: data.openShiftsToday || 0,
				tomorrow: data.openShiftsTomorrow || 0,
			}),
			inline: true,
		});
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		fields.push({
			name: t("bot.digest.complianceTitle", "Compliance"),
			value: t(
				"teamsBot:digest.pendingExceptionRequests",
				"{count, plural, one {# pending exception request awaiting review} other {# pending exception requests awaiting review}}",
				{ count: data.compliancePending },
			),
			inline: true,
		});
	}

	const dashboardUrl = `${appUrl}/dashboard`;

	return [
		{
			title: t("bot.digest.title", "Daily Digest - {date}", { date: dateFormatted }),
			color: Colors.BLUE,
			fields,
			footer: {
				text: t("bot.digest.viewDashboardAt", "View full dashboard at {url}", {
					url: dashboardUrl,
				}),
			},
			timestamp: data.date.toISOString(),
		},
	];
}

// ============================================
// ESCALATION
// ============================================

/**
 * Build escalation embed for Discord.
 */
export function buildEscalationEmbed(
	requesterName: string,
	entityType: string,
	ageHours: number,
	originalApproverName: string,
): DiscordEmbed[] {
	return [
		{
			title: "Escalated Approval Request",
			color: Colors.YELLOW,
			description:
				"This request has been escalated to you because the original approver did not respond in time.",
			fields: [
				{ name: "From", value: requesterName, inline: true },
				{
					name: "Type",
					value: entityType === "absence_entry" ? "Absence request" : "Time correction",
					inline: true,
				},
				{ name: "Waiting", value: `${Math.round(ageHours)}h`, inline: true },
				{ name: "Original approver", value: originalApproverName, inline: true },
			],
		},
	];
}

/**
 * Build a simple notification embed. The caller passes the link text already
 * in the recipient language.
 */
export function buildNotificationEmbed(
	title: string,
	message: string,
	action?: { url: string; label: string },
): DiscordEmbed[] {
	return [
		{
			title,
			description: message + (action ? `\n\n[${action.label}](${action.url})` : ""),
			color: Colors.BLUE,
			timestamp: new Date().toISOString(),
		},
	];
}
