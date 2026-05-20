/**
 * Approval Adaptive Card Builder
 *
 * Builds interactive Adaptive Cards for approval requests in Teams.
 * Cards have approve/reject buttons that call back to Z8.
 */

import { DateTime } from "luxon";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import {
	type BotTranslateFn,
	fmtWeekdayShortDate,
	fmtWeekdayShortDateTime,
	fmtWeekdayShortDateYear,
} from "@/lib/bot-platform/i18n";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import type { ApprovalCardData, ApprovalCardResolvedData } from "../types";

/**
 * Build an approval request Adaptive Card
 *
 * @param data - Approval card data
 * @param callbackUrl - URL for action callbacks
 * @returns Adaptive Card JSON
 */
export function buildApprovalCard(
	data: ApprovalCardData,
	callbackUrl: string,
	locale: string = DEFAULT_LANGUAGE,
	t: BotTranslateFn = (_key, defaultValue) => defaultValue,
): Record<string, unknown> {
	const isAbsence = data.entityType === "absence_entry";
	const title = isAbsence
		? t("teamsBot:approval.absenceRequest", "Absence Request")
		: t("teamsBot:approval.timeCorrectionRequest", "Time Correction Request");
	const accentColor = isAbsence ? "accent" : "warning";

	// Build facts section based on entity type
	const facts: Array<{ title: string; value: string }> = [
		{ title: t("teamsBot:approval.facts.from", "From"), value: data.requesterName },
	];

	if (data.requesterEmail) {
		facts.push({ title: t("teamsBot:approval.facts.email", "Email"), value: data.requesterEmail });
	}

	if (isAbsence) {
		if (data.absenceCategory) {
			facts.push({ title: t("teamsBot:approval.facts.type", "Type"), value: data.absenceCategory });
		}
		if (data.startDate && data.endDate) {
			const start = fmtWeekdayShortDateYear(DateTime.fromISO(data.startDate), locale);
			const end = fmtWeekdayShortDateYear(DateTime.fromISO(data.endDate), locale);
			facts.push({ title: t("teamsBot:approval.facts.dates", "Dates"), value: `${start} - ${end}` });
		}
		if (data.days !== undefined) {
			facts.push({
				title: t("teamsBot:approval.facts.duration", "Duration"),
				value: t("teamsBot:approval.durationDays", "{count, plural, one {# day} other {# days}}", { count: data.days }),
			});
		}
	} else {
		// Time correction
		if (data.originalTime) {
			facts.push({ title: t("teamsBot:approval.facts.original", "Original"), value: data.originalTime });
		}
		if (data.correctedTime) {
			facts.push({ title: t("teamsBot:approval.facts.corrected", "Corrected"), value: data.correctedTime });
		}
	}

	if (data.reason) {
		facts.push({ title: t("teamsBot:approval.facts.reason", "Reason"), value: data.reason });
	}

	facts.push({
		title: t("teamsBot:approval.facts.submitted", "Submitted"),
		value: fmtWeekdayShortDateTime(DateTime.fromJSDate(data.createdAt), locale),
	});

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{
				type: "Container",
				style: accentColor,
				items: [
					{
						type: "TextBlock",
						text: title,
						weight: "bolder",
						size: "medium",
						color: "light",
					},
				],
				bleed: true,
				padding: "default",
			},
			{
				type: "FactSet",
				facts: facts,
				spacing: "medium",
			},
		],
		actions: [
			{
				type: "Action.Http",
				title: t("teamsBot:approval.actions.approve", "Approve"),
				method: "POST",
				url: callbackUrl,
				body: JSON.stringify({
					action: "approve",
					approvalId: data.approvalId,
				}),
				style: "positive",
			},
			{
				type: "Action.Http",
				title: t("teamsBot:approval.actions.reject", "Reject"),
				method: "POST",
				url: callbackUrl,
				body: JSON.stringify({
					action: "reject",
					approvalId: data.approvalId,
				}),
				style: "destructive",
			},
			{
				type: "Action.OpenUrl",
				title: t("teamsBot:approval.actions.viewInZ8", "View in Z8"),
				url: `${getDefaultAppBaseUrl()}/approvals/inbox`,
			},
		],
	};
}

/**
 * Build an approval card with Action.Submit buttons (for Bot Framework)
 * This version uses invoke actions that the bot can handle directly
 */
export function buildApprovalCardWithInvoke(
	data: ApprovalCardData,
	locale: string = DEFAULT_LANGUAGE,
	t: BotTranslateFn = (_key, defaultValue) => defaultValue,
): Record<string, unknown> {
	const isAbsence = data.entityType === "absence_entry";
	const title = isAbsence
		? t("teamsBot:approval.absenceRequest", "Absence Request")
		: t("teamsBot:approval.timeCorrectionRequest", "Time Correction Request");
	const accentColor = isAbsence ? "accent" : "warning";

	// Build facts section
	const facts: Array<{ title: string; value: string }> = [
		{ title: t("teamsBot:approval.facts.from", "From"), value: data.requesterName },
	];

	if (isAbsence) {
		if (data.absenceCategory) {
			facts.push({ title: t("teamsBot:approval.facts.type", "Type"), value: data.absenceCategory });
		}
		if (data.startDate && data.endDate) {
			const start = fmtWeekdayShortDate(DateTime.fromISO(data.startDate), locale);
			const end = fmtWeekdayShortDate(DateTime.fromISO(data.endDate), locale);
			facts.push({ title: t("teamsBot:approval.facts.dates", "Dates"), value: `${start} - ${end}` });
		}
		if (data.days !== undefined) {
			facts.push({
				title: t("teamsBot:approval.facts.duration", "Duration"),
				value: t("teamsBot:approval.durationDays", "{count, plural, one {# day} other {# days}}", { count: data.days }),
			});
		}
	} else {
		if (data.originalTime) {
			facts.push({ title: t("teamsBot:approval.facts.original", "Original"), value: data.originalTime });
		}
		if (data.correctedTime) {
			facts.push({ title: t("teamsBot:approval.facts.corrected", "Corrected"), value: data.correctedTime });
		}
	}

	if (data.reason) {
		facts.push({ title: t("teamsBot:approval.facts.reason", "Reason"), value: data.reason });
	}

	facts.push({
		title: t("teamsBot:approval.facts.submitted", "Submitted"),
		value: fmtWeekdayShortDateTime(DateTime.fromJSDate(data.createdAt), locale),
	});

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{
				type: "Container",
				style: accentColor,
				items: [
					{
						type: "TextBlock",
						text: title,
						weight: "bolder",
						size: "medium",
						color: "light",
					},
				],
				bleed: true,
				padding: "default",
			},
			{
				type: "FactSet",
				facts: facts,
				spacing: "medium",
			},
		],
		actions: [
			{
				type: "Action.Submit",
				title: t("teamsBot:approval.actions.approve", "Approve"),
				style: "positive",
				data: {
					msteams: {
						type: "messageBack",
						displayText: t("teamsBot:approval.actions.approving", "Approving..."),
						text: "approve",
						value: {
							action: "approve",
							approvalId: data.approvalId,
						},
					},
				},
			},
			{
				type: "Action.Submit",
				title: t("teamsBot:approval.actions.reject", "Reject"),
				style: "destructive",
				data: {
					msteams: {
						type: "messageBack",
						displayText: t("teamsBot:approval.actions.rejecting", "Rejecting..."),
						text: "reject",
						value: {
							action: "reject",
							approvalId: data.approvalId,
						},
					},
				},
			},
		],
	};
}

/**
 * Build a resolved approval card (shown after approve/reject)
 */
export function buildResolvedApprovalCard(
	originalData: ApprovalCardData,
	resolvedData: ApprovalCardResolvedData,
	locale: string = DEFAULT_LANGUAGE,
	t: BotTranslateFn = (_key, defaultValue) => defaultValue,
): Record<string, unknown> {
	const isAbsence = originalData.entityType === "absence_entry";
	const title = isAbsence
		? t("teamsBot:approval.absenceRequest", "Absence Request")
		: t("teamsBot:approval.timeCorrectionRequest", "Time Correction Request");
	const statusColor = resolvedData.action === "approved" ? "good" : "attention";
	const statusText = resolvedData.action === "approved"
		? t("teamsBot:approval.status.approved", "APPROVED")
		: t("teamsBot:approval.status.rejected", "REJECTED");

	const facts: Array<{ title: string; value: string }> = [
		{ title: t("teamsBot:approval.facts.from", "From"), value: originalData.requesterName },
	];

	if (isAbsence) {
		if (originalData.absenceCategory) {
			facts.push({ title: t("teamsBot:approval.facts.type", "Type"), value: originalData.absenceCategory });
		}
		if (originalData.startDate && originalData.endDate) {
			const start = fmtWeekdayShortDate(DateTime.fromISO(originalData.startDate), locale);
			const end = fmtWeekdayShortDate(DateTime.fromISO(originalData.endDate), locale);
			facts.push({ title: t("teamsBot:approval.facts.dates", "Dates"), value: `${start} - ${end}` });
		}
	}

	facts.push({
		title: t("teamsBot:approval.facts.status", "Status"),
		value: statusText,
	});

	facts.push({
		title: resolvedData.action === "approved"
			? t("teamsBot:approval.facts.approvedBy", "Approved by")
			: t("teamsBot:approval.facts.rejectedBy", "Rejected by"),
		value: resolvedData.approverName,
	});

	facts.push({
		title: t("teamsBot:approval.facts.resolved", "Resolved"),
		value: fmtWeekdayShortDateTime(DateTime.fromJSDate(resolvedData.resolvedAt), locale),
	});

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{
				type: "Container",
				style: statusColor,
				items: [
					{
						type: "TextBlock",
						text: `${title} - ${statusText}`,
						weight: "bolder",
						size: "medium",
						color: "light",
					},
				],
				bleed: true,
				padding: "default",
			},
			{
				type: "FactSet",
				facts: facts,
				spacing: "medium",
			},
		],
	};
}
