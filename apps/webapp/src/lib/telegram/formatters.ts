/**
 * Telegram Message Formatters
 *
 * Converts shared bot data into Telegram MarkdownV2 formatted messages
 * and inline keyboard layouts.
 */

import { DateTime } from "luxon";
import type {
	ApprovalCallbackData,
	ApprovalCardData,
	ApprovalResolvedData,
	DailyDigestData,
	TelegramInlineKeyboardMarkup,
} from "./types";

// ============================================
// MARKDOWNV2 HELPERS
// ============================================

/**
 * Escape special characters for Telegram MarkdownV2.
 * Must escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text: string): string {
	return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Bold text in MarkdownV2
 */
function bold(text: string): string {
	return `*${escapeMarkdownV2(text)}*`;
}

// ============================================
// APPROVAL MESSAGES
// ============================================

/**
 * Build approval request message for Telegram.
 */
export function buildApprovalMessage(data: ApprovalCardData): {
	text: string;
	keyboard: TelegramInlineKeyboardMarkup;
} {
	const lines: string[] = [];

	lines.push(bold("New Approval Request"));
	lines.push("");
	lines.push(`From: ${bold(data.requesterName)}`);

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || "Leave";
		lines.push(`Type: ${escapeMarkdownV2(category)}`);
		if (data.startDate && data.endDate) {
			const start = DateTime.fromISO(data.startDate).toFormat("MMM d");
			const end = DateTime.fromISO(data.endDate).toFormat("MMM d");
			lines.push(`Period: ${escapeMarkdownV2(start)} \\- ${escapeMarkdownV2(end)}`);
		}
	} else if (data.entityType === "time_entry") {
		lines.push(`Type: ${escapeMarkdownV2("Time entry correction")}`);
	}

	if (data.reason) {
		lines.push(`Reason: ${escapeMarkdownV2(data.reason)}`);
	}

	const submitted = DateTime.fromJSDate(data.createdAt).toFormat("MMM d, HH:mm");
	lines.push(`Submitted: ${escapeMarkdownV2(submitted)}`);

	// Build inline keyboard with approve/reject buttons
	// Callback data must be <= 64 bytes, so use compact format
	const approveData: ApprovalCallbackData = { a: "ap", id: data.approvalId };
	const rejectData: ApprovalCallbackData = { a: "rj", id: data.approvalId };

	const keyboard: TelegramInlineKeyboardMarkup = {
		inline_keyboard: [
			[
				{ text: "Approve", callback_data: JSON.stringify(approveData) },
				{ text: "Reject", callback_data: JSON.stringify(rejectData) },
			],
		],
	};

	return {
		text: lines.join("\n"),
		keyboard,
	};
}

/**
 * Build resolved approval message (replaces the original after action).
 */
export function buildResolvedApprovalMessage(
	data: ApprovalCardData,
	resolved: ApprovalResolvedData,
): string {
	const lines: string[] = [];
	const icon = resolved.action === "approved" ? "\u2705" : "\u274C";
	const status = resolved.action === "approved" ? "Approved" : "Rejected";

	lines.push(`${icon} ${bold(`Approval ${status}`)}`);
	lines.push("");
	lines.push(`From: ${bold(data.requesterName)}`);

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || "Leave";
		lines.push(`Type: ${escapeMarkdownV2(category)}`);
		if (data.startDate && data.endDate) {
			const start = DateTime.fromISO(data.startDate).toFormat("MMM d");
			const end = DateTime.fromISO(data.endDate).toFormat("MMM d");
			lines.push(`Period: ${escapeMarkdownV2(start)} \\- ${escapeMarkdownV2(end)}`);
		}
	}

	lines.push("");
	lines.push(`${bold(status)} by ${escapeMarkdownV2(resolved.approverName)}`);
	const resolvedAt = DateTime.fromJSDate(resolved.resolvedAt).toFormat("MMM d, HH:mm");
	lines.push(`at ${escapeMarkdownV2(resolvedAt)}`);

	return lines.join("\n");
}

// ============================================
// DAILY DIGEST
// ============================================

/**
 * Build daily digest message for Telegram.
 * Uses the shared DailyDigestData and formats for MarkdownV2.
 */
export function buildDailyDigestMessage(data: DailyDigestData, appUrl: string): string {
	const lines: string[] = [];
	const dateFormatted = DateTime.fromJSDate(data.date)
		.setZone(data.timezone)
		.toFormat("EEEE, MMMM d, yyyy");

	lines.push(bold(`Daily Digest - ${dateFormatted}`));
	lines.push("");

	// Pending approvals
	if (data.pendingApprovals === 0) {
		lines.push(`${bold("Pending Approvals:")} None`);
	} else {
		lines.push(`${bold("Pending Approvals:")} ${data.pendingApprovals}`);
	}
	lines.push("");

	// Who's out
	lines.push(bold("Who's Out:"));
	if (data.employeesOut.length === 0) {
		lines.push(escapeMarkdownV2("Everyone is available"));
	} else {
		for (const emp of data.employeesOut.slice(0, 5)) {
			lines.push(escapeMarkdownV2(`  ${emp.name} - ${emp.category} (returns ${emp.returnDate})`));
		}
		if (data.employeesOut.length > 5) {
			lines.push(escapeMarkdownV2(`  +${data.employeesOut.length - 5} more`));
		}
	}
	lines.push("");

	// Clocked in
	lines.push(bold("Currently Clocked In:"));
	if (data.employeesClockedIn.length === 0) {
		lines.push(escapeMarkdownV2("No one yet"));
	} else {
		for (const emp of data.employeesClockedIn.slice(0, 5)) {
			lines.push(
				escapeMarkdownV2(`  ${emp.name} - since ${emp.clockedInAt} (${emp.durationSoFar})`),
			);
		}
		if (data.employeesClockedIn.length > 5) {
			lines.push(escapeMarkdownV2(`  +${data.employeesClockedIn.length - 5} more`));
		}
	}
	lines.push("");

	// Coverage gaps
	if (data.coverageGaps && data.coverageGaps.length > 0) {
		lines.push(bold("Coverage Gaps:"));
		for (const gap of data.coverageGaps) {
			lines.push(
				escapeMarkdownV2(
					`  ${gap.locationName} - ${gap.subareaName}: ${gap.actual}/${gap.scheduled} (-${gap.shortage})`,
				),
			);
		}
		lines.push("");
	}

	// Open shifts
	if (data.openShiftsToday || data.openShiftsTomorrow) {
		lines.push(bold("Open Shifts:"));
		lines.push(
			escapeMarkdownV2(
				`Today: ${data.openShiftsToday || 0} | Tomorrow: ${data.openShiftsTomorrow || 0}`,
			),
		);
		lines.push("");
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		lines.push(bold("Compliance:"));
		lines.push(
			escapeMarkdownV2(
				`${data.compliancePending} pending exception request${data.compliancePending > 1 ? "s" : ""}`,
			),
		);
		lines.push("");
	}

	// Dashboard link
	const dashboardUrl = `${appUrl}/dashboard`;
	lines.push(`[Open Z8 Dashboard](${escapeMarkdownV2(dashboardUrl)})`);

	return lines.join("\n");
}

// ============================================
// ESCALATION
// ============================================

/**
 * Build escalation message for Telegram.
 */
export function buildEscalationMessage(
	requesterName: string,
	entityType: string,
	ageHours: number,
	originalApproverName: string,
): string {
	const lines: string[] = [];

	lines.push(bold("Escalated Approval Request"));
	lines.push("");
	lines.push(`From: ${bold(requesterName)}`);
	lines.push(
		`Type: ${escapeMarkdownV2(entityType === "absence_entry" ? "Absence request" : "Time correction")}`,
	);
	lines.push(`Waiting: ${escapeMarkdownV2(`${Math.round(ageHours)}h`)}`);
	lines.push(`Original approver: ${escapeMarkdownV2(originalApproverName)}`);
	lines.push("");
	lines.push(
		escapeMarkdownV2(
			"This request has been escalated to you because the original approver did not respond in time.",
		),
	);

	return lines.join("\n");
}
