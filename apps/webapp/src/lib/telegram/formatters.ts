/**
 * Telegram Message Formatters
 *
 * Converts shared bot data into Telegram MarkdownV2 formatted messages
 * and inline keyboard layouts.
 */

import { DateTime } from "luxon";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { fmtFullDate, fmtShortDate, fmtShortDateTime } from "@/lib/bot-platform/i18n";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
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
// HTML HELPERS (for command responses)
// ============================================

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert simple markdown (as used in shared bot command responses) to Telegram HTML.
 *
 * Handles:
 * - **bold** → <b>bold</b>
 * - _italic_ → <i>italic</i>
 *
 * All other text is HTML-escaped.
 */
export function markdownToHtml(text: string): string {
	// Split into segments: bold, italic, and plain text
	// Process bold first (**...**), then italic (_..._)
	let html = "";
	let remaining = text;

	while (remaining.length > 0) {
		// Find the next **bold** or _italic_ match
		const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
		const italicMatch = remaining.match(/(?<!\w)_(.+?)_(?!\w)/);

		// Determine which comes first
		const boldIndex = boldMatch?.index ?? Infinity;
		const italicIndex = italicMatch?.index ?? Infinity;

		if (boldIndex === Infinity && italicIndex === Infinity) {
			// No more markdown, escape and append the rest
			html += escapeHtml(remaining);
			break;
		}

		if (boldIndex <= italicIndex) {
			// Bold comes first
			html += escapeHtml(remaining.slice(0, boldIndex));
			html += `<b>${escapeHtml(boldMatch![1])}</b>`;
			remaining = remaining.slice(boldIndex + boldMatch![0].length);
		} else {
			// Italic comes first
			html += escapeHtml(remaining.slice(0, italicIndex));
			html += `<i>${escapeHtml(italicMatch![1])}</i>`;
			remaining = remaining.slice(italicIndex + italicMatch![0].length);
		}
	}

	return html;
}

// ============================================
// APPROVAL MESSAGES
// ============================================

/**
 * Build approval request message for Telegram.
 */
export function buildApprovalMessage(
	data: ApprovalCardData,
	t?: BotTranslateFn,
	locale: string = DEFAULT_LANGUAGE,
): {
	text: string;
	keyboard: TelegramInlineKeyboardMarkup;
} {
	const lines: string[] = [];

	lines.push(bold(t ? t("bot.approval.newRequest", "New Approval Request") : "New Approval Request"));
	lines.push("");
	lines.push(`${t ? t("bot.approval.from", "From") : "From"}: ${bold(data.requesterName)}`);

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || (t ? t("bot.approval.leave", "Leave") : "Leave");
		lines.push(`${t ? t("bot.approval.type", "Type") : "Type"}: ${escapeMarkdownV2(category)}`);
		if (data.startDate && data.endDate) {
			const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
			lines.push(`${t ? t("bot.approval.period", "Period") : "Period"}: ${escapeMarkdownV2(start)} \\- ${escapeMarkdownV2(end)}`);
		}
	} else if (data.entityType === "time_entry") {
		lines.push(`${t ? t("bot.approval.type", "Type") : "Type"}: ${escapeMarkdownV2(t ? t("bot.approval.timeCorrection", "Time entry correction") : "Time entry correction")}`);
	}

	if (data.reason) {
		lines.push(`${t ? t("bot.approval.reason", "Reason") : "Reason"}: ${escapeMarkdownV2(data.reason)}`);
	}

	const submitted = fmtShortDateTime(DateTime.fromJSDate(data.createdAt), locale);
	lines.push(`${t ? t("bot.approval.submitted", "Submitted") : "Submitted"}: ${escapeMarkdownV2(submitted)}`);

	// Build inline keyboard with approve/reject buttons
	// Callback data must be <= 64 bytes, so use compact format
	const approveData: ApprovalCallbackData = { a: "ap", id: data.approvalId };
	const rejectData: ApprovalCallbackData = { a: "rj", id: data.approvalId };

	const keyboard: TelegramInlineKeyboardMarkup = {
		inline_keyboard: [
			[
				{
					text: t ? t("bot.approval.approve", "Approve") : "Approve",
					callback_data: JSON.stringify(approveData),
				},
				{
					text: t ? t("bot.approval.reject", "Reject") : "Reject",
					callback_data: JSON.stringify(rejectData),
				},
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
	t?: BotTranslateFn,
	locale: string = DEFAULT_LANGUAGE,
): string {
	const lines: string[] = [];
	const icon = resolved.action === "approved" ? "\u2705" : "\u274C";
	const status =
		resolved.action === "approved"
			? (t ? t("bot.approval.approved", "Approved") : "Approved")
			: (t ? t("bot.approval.rejected", "Rejected") : "Rejected");

	lines.push(`${icon} ${bold(`${t ? t("bot.approval.approval", "Approval") : "Approval"} ${status}`)}`);
	lines.push("");
	lines.push(`${t ? t("bot.approval.from", "From") : "From"}: ${bold(data.requesterName)}`);

	if (data.entityType === "absence_entry") {
		const category = data.absenceCategory || (t ? t("bot.approval.leave", "Leave") : "Leave");
		lines.push(`${t ? t("bot.approval.type", "Type") : "Type"}: ${escapeMarkdownV2(category)}`);
		if (data.startDate && data.endDate) {
			const start = fmtShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtShortDate(DateTime.fromISO(data.endDate), locale);
			lines.push(`${t ? t("bot.approval.period", "Period") : "Period"}: ${escapeMarkdownV2(start)} \\- ${escapeMarkdownV2(end)}`);
		}
	}

	lines.push("");
	lines.push(`${bold(status)} ${t ? t("bot.approval.by", "by") : "by"} ${escapeMarkdownV2(resolved.approverName)}`);
	const resolvedAt = fmtShortDateTime(DateTime.fromJSDate(resolved.resolvedAt), locale);
	lines.push(`${t ? t("bot.approval.at", "at") : "at"} ${escapeMarkdownV2(resolvedAt)}`);

	return lines.join("\n");
}

// ============================================
// DAILY DIGEST
// ============================================

/**
 * Build daily digest message for Telegram.
 * Uses the shared DailyDigestData and formats for MarkdownV2.
 */
export function buildDailyDigestMessage(
	data: DailyDigestData,
	appUrl: string,
	t?: BotTranslateFn,
	locale: string = DEFAULT_LANGUAGE,
): string {
	const lines: string[] = [];
	const dateFormatted = fmtFullDate(
		DateTime.fromJSDate(data.date).setZone(data.timezone),
		locale,
	);

	lines.push(bold(t ? t("bot.digest.title", "Daily Digest - {date}", { date: dateFormatted }) : `Daily Digest - ${dateFormatted}`));
	lines.push("");

	// Pending approvals
	if (data.pendingApprovals === 0) {
		lines.push(`${bold(t ? t("bot.digest.pendingApprovals", "Pending Approvals:") : "Pending Approvals:")} ${t ? t("bot.digest.none", "None") : "None"}`);
	} else {
		lines.push(`${bold(t ? t("bot.digest.pendingApprovals", "Pending Approvals:") : "Pending Approvals:")} ${data.pendingApprovals}`);
	}
	lines.push("");

	// Who's out
	lines.push(bold(t ? t("bot.digest.whosOut", "Who's Out:") : "Who's Out:"));
	if (data.employeesOut.length === 0) {
		lines.push(escapeMarkdownV2(t ? t("bot.digest.everyoneAvailable", "Everyone is available") : "Everyone is available"));
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
	lines.push(bold(t ? t("bot.digest.clockedIn", "Currently Clocked In:") : "Currently Clocked In:"));
	if (data.employeesClockedIn.length === 0) {
		lines.push(escapeMarkdownV2(t ? t("bot.digest.noOneYet", "No one yet") : "No one yet"));
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
		lines.push(bold(t ? t("bot.digest.coverageGaps", "Coverage Gaps:") : "Coverage Gaps:"));
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
		lines.push(bold(t ? t("bot.digest.openShifts", "Open Shifts:") : "Open Shifts:"));
		lines.push(
			escapeMarkdownV2(
				`Today: ${data.openShiftsToday || 0} | Tomorrow: ${data.openShiftsTomorrow || 0}`,
			),
		);
		lines.push("");
	}

	// Compliance
	if (data.compliancePending && data.compliancePending > 0) {
		lines.push(bold(t ? t("bot.digest.compliance", "Compliance:") : "Compliance:"));
		lines.push(
			escapeMarkdownV2(
				`${data.compliancePending} pending exception request${data.compliancePending > 1 ? "s" : ""}`,
			),
		);
		lines.push("");
	}

	// Dashboard link
	const dashboardUrl = `${appUrl}/dashboard`;
	const linkText = t ? t("bot.digest.openDashboard", "Open Z8 Dashboard") : "Open Z8 Dashboard";
	lines.push(`[${linkText}](${escapeMarkdownV2(dashboardUrl)})`);

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
	t?: BotTranslateFn,
): string {
	const lines: string[] = [];

	lines.push(bold(t ? t("bot.escalation.title", "Escalated Approval Request") : "Escalated Approval Request"));
	lines.push("");
	lines.push(`${t ? t("bot.approval.from", "From") : "From"}: ${bold(requesterName)}`);
	lines.push(
		`${t ? t("bot.approval.type", "Type") : "Type"}: ${escapeMarkdownV2(
			entityType === "absence_entry"
				? (t ? t("bot.escalation.absenceRequest", "Absence request") : "Absence request")
				: (t ? t("bot.escalation.timeCorrection", "Time correction") : "Time correction"),
		)}`,
	);
	lines.push(`${t ? t("bot.escalation.waiting", "Waiting") : "Waiting"}: ${escapeMarkdownV2(`${Math.round(ageHours)}h`)}`);
	lines.push(`${t ? t("bot.escalation.originalApprover", "Original approver") : "Original approver"}: ${escapeMarkdownV2(originalApproverName)}`);
	lines.push("");
	lines.push(
		escapeMarkdownV2(
			t
				? t("bot.escalation.reason", "This request has been escalated to you because the original approver did not respond in time.")
				: "This request has been escalated to you because the original approver did not respond in time.",
		),
	);

	return lines.join("\n");
}
