/**
 * Slack Block Kit Formatters
 *
 * Converts shared bot data into Slack Block Kit JSON.
 */

import { DateTime } from "luxon";
import { fmtFullDate, fmtShortDate, fmtShortDateTime } from "@/lib/bot-platform/i18n";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import type {
	ApprovalCardData,
	ApprovalResolvedData,
	DailyDigestData,
} from "@/lib/bot-platform/types";

// ============================================
// APPROVAL MESSAGES
// ============================================

/**
 * Build Block Kit blocks for an approval request message.
 */
export function buildApprovalBlocks(
	data: ApprovalCardData,
	locale: string = DEFAULT_LANGUAGE,
): {
	blocks: unknown[];
	text: string;
} {
	const text = `New approval request from ${data.requesterName}`;

	const blocks: unknown[] = [
		{
			type: "header",
			text: { type: "plain_text", text: "New Approval Request", emoji: true },
		},
	];

	// Fields section
	const fields: unknown[] = [{ type: "mrkdwn", text: `*From:*\n${data.requesterName}` }];

	if (data.entityType === "absence_entry") {
		fields.push({
			type: "mrkdwn",
			text: `*Type:*\n${data.absenceCategory || "Leave"}`,
		});

		if (data.startDate && data.endDate) {
			const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
			fields.push({
				type: "mrkdwn",
				text: `*Period:*\n${start} - ${end}`,
			});
		}
	} else if (data.entityType === "time_entry") {
		fields.push({
			type: "mrkdwn",
			text: "*Type:*\nTime entry correction",
		});
	}

	blocks.push({ type: "section", fields });

	if (data.reason) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Reason:*\n${data.reason}` },
		});
	}

	const submitted = fmtShortDateTime(DateTime.fromJSDate(data.createdAt), locale);
	blocks.push({
		type: "context",
		elements: [{ type: "mrkdwn", text: `Submitted ${submitted}` }],
	});

	// Action buttons
	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				text: { type: "plain_text", text: "Approve", emoji: true },
				style: "primary",
				action_id: "approval_approve",
				value: data.approvalId,
			},
			{
				type: "button",
				text: { type: "plain_text", text: "Reject", emoji: true },
				style: "danger",
				action_id: "approval_reject",
				value: data.approvalId,
			},
		],
	});

	return { blocks, text };
}

/**
 * Build Block Kit blocks for a resolved approval (replaces original after action).
 */
export function buildResolvedApprovalBlocks(
	data: ApprovalCardData,
	resolved: ApprovalResolvedData,
	locale: string = DEFAULT_LANGUAGE,
): { blocks: unknown[]; text: string } {
	const icon = resolved.action === "approved" ? ":white_check_mark:" : ":x:";
	const status = resolved.action === "approved" ? "Approved" : "Rejected";
	const text = `${status} by ${resolved.approverName}`;

	const blocks: unknown[] = [
		{
			type: "header",
			text: { type: "plain_text", text: `${icon} ${status}`, emoji: true },
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*From:*\n${data.requesterName}` },
				{
					type: "mrkdwn",
					text: `*Type:*\n${data.entityType === "absence_entry" ? data.absenceCategory || "Leave" : "Time Correction"}`,
				},
			],
		},
	];

	if (data.startDate && data.endDate) {
		const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
		const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
		blocks.push({
			type: "context",
			elements: [{ type: "mrkdwn", text: `${start} - ${end}` }],
		});
	}

	const resolvedAt = fmtShortDateTime(DateTime.fromJSDate(resolved.resolvedAt), locale);
	blocks.push({
		type: "context",
		elements: [{ type: "mrkdwn", text: `${status} by ${resolved.approverName} at ${resolvedAt}` }],
	});

	return { blocks, text };
}

// ============================================
// DAILY DIGEST
// ============================================

/**
 * Build Block Kit blocks for a daily digest message.
 */
export function buildDailyDigestBlocks(
	data: DailyDigestData,
	appUrl: string,
	locale: string = DEFAULT_LANGUAGE,
): {
	blocks: unknown[];
	text: string;
} {
	const text = "Daily Digest";
	const dateFormatted = fmtFullDate(
		DateTime.fromJSDate(data.date).setZone(data.timezone),
		locale,
	);

	const blocks: unknown[] = [
		{
			type: "header",
			text: { type: "plain_text", text: `Daily Digest - ${dateFormatted}`, emoji: true },
		},
	];

	// Pending approvals
	if (data.pendingApprovals === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "*Pending Approvals:* None" },
		});
	} else {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Pending Approvals:* ${data.pendingApprovals}` },
		});
	}

	// Who's out
	if (data.employeesOut.length > 0) {
		const outList = data.employeesOut
			.slice(0, 5)
			.map((e) => `  ${e.name} - ${e.category} (returns ${e.returnDate})`)
			.join("\n");
		let outText = `*Who's Out:*\n${outList}`;
		if (data.employeesOut.length > 5) {
			outText += `\n  +${data.employeesOut.length - 5} more`;
		}
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: outText },
		});
	}

	// Clocked in
	if (data.employeesClockedIn.length > 0) {
		const clockedList = data.employeesClockedIn
			.slice(0, 5)
			.map((e) => `  ${e.name} - since ${e.clockedInAt} (${e.durationSoFar})`)
			.join("\n");
		let clockedText = `*Currently Clocked In:*\n${clockedList}`;
		if (data.employeesClockedIn.length > 5) {
			clockedText += `\n  +${data.employeesClockedIn.length - 5} more`;
		}
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: clockedText },
		});
	}

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		const gapList = data.coverageGaps
			.map(
				(g) =>
					`  ${g.locationName} - ${g.subareaName}: ${g.actual}/${g.scheduled} (-${g.shortage})`,
			)
			.join("\n");
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*Coverage Gaps:*\n${gapList}` },
		});
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*Open Shifts:* Today: ${data.openShiftsToday || 0} | Tomorrow: ${data.openShiftsTomorrow || 0}`,
			},
		});
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*Compliance:* ${data.compliancePending} pending exception request${data.compliancePending > 1 ? "s" : ""}`,
			},
		});
	}

	// Dashboard link
	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				text: { type: "plain_text", text: "Open Z8 Dashboard", emoji: true },
				url: `${appUrl}/dashboard`,
			},
		],
	});

	return { blocks, text };
}

// ============================================
// ESCALATION
// ============================================

/**
 * Build Block Kit blocks for an escalation message.
 */
export function buildEscalationBlocks(
	requesterName: string,
	entityType: string,
	ageHours: number,
	originalApproverName: string,
): { blocks: unknown[]; text: string } {
	const text = `Escalated approval request from ${requesterName}`;
	const typeLabel = entityType === "absence_entry" ? "Absence request" : "Time correction";

	const blocks: unknown[] = [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: ":rotating_light: Escalated Approval Request",
				emoji: true,
			},
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*From:*\n${requesterName}` },
				{ type: "mrkdwn", text: `*Type:*\n${typeLabel}` },
			],
		},
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Waiting:*\n${Math.round(ageHours)}h` },
				{ type: "mrkdwn", text: `*Original approver:*\n${originalApproverName}` },
			],
		},
		{
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: "This request has been escalated to you because the original approver did not respond in time.",
				},
			],
		},
	];

	return { blocks, text };
}
