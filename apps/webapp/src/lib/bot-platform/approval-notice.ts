import { getDefaultAppBaseUrl } from "@/lib/app-url";
import type { ApprovalReviewNotice } from "@/lib/approvals/presentation";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { getBotTranslate } from "./i18n";

export type ApprovalNotice = Pick<
	ApprovalReviewNotice,
	"title" | "text" | "reviewUrl" | "reviewLabel"
>;

/** No source facts or render-time decision timestamps belong in legacy replies. */
export async function approvalAttemptNotice(
	result:
		| { status: "historical"; action: "approve" | "reject" }
		| { status: "review_required" },
	recipient: { userId: string; organizationId: string },
): Promise<ApprovalNotice | null> {
	const display = await resolveRecipientDisplayContext(recipient);
	if (!display) return null;
	const t = await getBotTranslate(display.locale);
	return {
		title:
			result.status === "historical"
				? t("bot.approval.historicalTitle", "Historical decision")
				: t("bot.approval.reviewRequiredTitle", "Review required"),
		text:
			result.status === "historical"
				? result.action === "approve"
					? t(
							"bot.approval.historicalApproval",
							"Your previously recorded approval was verified. This is a historical result; no new decision was made. Review the request in Z8 for further details.",
						)
					: t(
							"bot.approval.historicalRejection",
							"Your previously recorded rejection was verified. This is a historical result; no new decision was made. Review the request in Z8 for further details.",
						)
				: t(
						"bot.approval.unboundCallback",
						"This card cannot establish the facts originally reviewed. No decision was made. Review the request in Z8.",
					),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: `${getDefaultAppBaseUrl()}/approvals/inbox`,
	};
}

export function slackApprovalNotice(notice: ApprovalNotice) {
	return {
		text: `${notice.title}: ${notice.text} ${notice.reviewUrl}`,
		blocks: [
			{
				type: "section",
				text: { type: "plain_text", text: `${notice.title}\n${notice.text}` },
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: notice.reviewLabel },
						url: notice.reviewUrl,
						action_id: "approval_review",
					},
				],
			},
		],
	};
}

export function telegramApprovalNotice(notice: ApprovalNotice) {
	return {
		text: `${notice.title}\n\n${notice.text}`,
		reply_markup: {
			inline_keyboard: [[{ text: notice.reviewLabel, url: notice.reviewUrl }]],
		},
	};
}

export function discordApprovalNotice(notice: ApprovalNotice) {
	return {
		content: `${notice.title}\n\n${notice.text}\n${notice.reviewUrl}`,
		embeds: [],
		components: [],
	};
}

export function teamsApprovalNotice(
	notice: ApprovalNotice,
): Record<string, unknown> {
	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{ type: "TextBlock", text: notice.title, weight: "bolder", wrap: true },
			{ type: "TextBlock", text: notice.text, wrap: true },
		],
		actions: [
			{
				type: "Action.OpenUrl",
				title: notice.reviewLabel,
				url: notice.reviewUrl,
			},
		],
	};
}
