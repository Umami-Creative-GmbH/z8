/**
 * Discord Message Formatters
 *
 * Converts shared bot data into Discord embed objects and button components.
 */

import { DateTime } from "luxon";
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
export function buildApprovalEmbed(data: ApprovalCardData): {
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
			const start = DateTime.fromISO(data.startDate).toFormat("MMM d");
			const end = DateTime.fromISO(data.endDate).toFormat("MMM d");
			fields.push({ name: "Period", value: `${start} - ${end}`, inline: true });
		}
	} else if (data.entityType === "time_entry") {
		fields.push({ name: "Type", value: "Time entry correction", inline: true });
	}

	if (data.reason) {
		fields.push({ name: "Reason", value: data.reason, inline: false });
	}

	const submitted = DateTime.fromJSDate(data.createdAt).toFormat("MMM d, HH:mm");
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
			const start = DateTime.fromISO(data.startDate).toFormat("MMM d");
			const end = DateTime.fromISO(data.endDate).toFormat("MMM d");
			fields.push({ name: "Period", value: `${start} - ${end}`, inline: true });
		}
	}

	const resolvedAt = DateTime.fromJSDate(resolved.resolvedAt).toFormat("MMM d, HH:mm");
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
 * Build daily digest embed for Discord.
 */
export function buildDailyDigestEmbed(data: DailyDigestData, appUrl: string): DiscordEmbed[] {
	const dateFormatted = DateTime.fromJSDate(data.date)
		.setZone(data.timezone)
		.toFormat("EEEE, MMMM d, yyyy");

	const fields: DiscordEmbed["fields"] = [];

	// Pending approvals
	fields.push({
		name: "Pending Approvals",
		value: data.pendingApprovals === 0 ? "None" : String(data.pendingApprovals),
		inline: true,
	});

	// Who's out
	if (data.employeesOut.length === 0) {
		fields.push({ name: "Who's Out", value: "Everyone is available", inline: true });
	} else {
		const outList = data.employeesOut
			.slice(0, 5)
			.map((emp) => `${emp.name} - ${emp.category} (returns ${emp.returnDate})`)
			.join("\n");
		const suffix = data.employeesOut.length > 5 ? `\n+${data.employeesOut.length - 5} more` : "";
		fields.push({ name: "Who's Out", value: outList + suffix, inline: false });
	}

	// Clocked in
	if (data.employeesClockedIn.length === 0) {
		fields.push({ name: "Currently Clocked In", value: "No one yet", inline: true });
	} else {
		const clockedList = data.employeesClockedIn
			.slice(0, 5)
			.map((emp) => `${emp.name} - since ${emp.clockedInAt} (${emp.durationSoFar})`)
			.join("\n");
		const suffix =
			data.employeesClockedIn.length > 5 ? `\n+${data.employeesClockedIn.length - 5} more` : "";
		fields.push({ name: "Currently Clocked In", value: clockedList + suffix, inline: false });
	}

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		const gapList = data.coverageGaps
			.map(
				(gap) =>
					`${gap.locationName} - ${gap.subareaName}: ${gap.actual}/${gap.scheduled} (-${gap.shortage})`,
			)
			.join("\n");
		fields.push({ name: "Coverage Gaps", value: gapList, inline: false });
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		fields.push({
			name: "Open Shifts",
			value: `Today: ${data.openShiftsToday || 0} | Tomorrow: ${data.openShiftsTomorrow || 0}`,
			inline: true,
		});
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		fields.push({
			name: "Compliance",
			value: `${data.compliancePending} pending exception request${data.compliancePending > 1 ? "s" : ""}`,
			inline: true,
		});
	}

	const dashboardUrl = `${appUrl}/dashboard`;

	return [
		{
			title: `Daily Digest - ${dateFormatted}`,
			color: Colors.BLUE,
			fields,
			footer: { text: `View full dashboard at ${dashboardUrl}` },
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
 * Build a simple notification embed.
 */
export function buildNotificationEmbed(
	title: string,
	message: string,
	actionUrl?: string,
): DiscordEmbed[] {
	return [
		{
			title,
			description: message + (actionUrl ? `\n\n[View in Z8](${actionUrl})` : ""),
			color: Colors.BLUE,
			timestamp: new Date().toISOString(),
		},
	];
}
