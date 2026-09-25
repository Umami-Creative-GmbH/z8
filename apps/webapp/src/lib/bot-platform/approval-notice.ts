import type { ApprovalReviewNotice } from "@/lib/approvals/presentation";
import {
	type ApprovalReviewReference,
	approvalReviewUrl,
} from "@/lib/approvals/presentation/review-navigation";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import type { BoundBotApprovalResult } from "./approval-decision";
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
	reference: ApprovalReviewReference,
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
		// Exact item; arrival rechecks membership and entitlement.
		reviewUrl: await approvalReviewUrl({
			organizationId: recipient.organizationId,
			reference,
		}),
	};
}

/**
 * Result of a bound card action. A decided result reports the committed
 * evidence: the persisted actor and decision time, and the assignment outcome
 * separately from the request outcome (an intermediate approval is not final).
 * A replay presents the original evidence, never the retry's actor or time.
 */
export async function boundDecisionNotice(
	result: BoundBotApprovalResult,
	recipient: { userId: string; organizationId: string },
	reference: ApprovalReviewReference,
): Promise<ApprovalNotice | null> {
	const display = await resolveRecipientDisplayContext(recipient);
	if (!display) return null;
	const t = await getBotTranslate(display.locale);
	const reviewLabel = t("bot.approval.reviewInZ8", "Review in Z8");
	const reviewUrl = await approvalReviewUrl({
		organizationId: recipient.organizationId,
		reference,
	});
	if (result.status !== "decided") {
		return {
			title: t("bot.approval.reviewRequiredTitle", "Review required"),
			text:
				result.status === "conflict"
					? t(
							"bot.approval.invocationConflict",
							"This button press was already recorded with a different action. No decision was made. Review the request in Z8.",
						)
					: t(
							"bot.approval.boundReviewRequired",
							"This card no longer matches the current request or assignment, or the action could not be verified. No decision was made. Review the request in Z8.",
						),
			reviewLabel,
			reviewUrl,
		};
	}
	const { evidence } = result;
	const params = {
		actor:
			evidence.labels.actorName ??
			t("bot.approval.card.unavailable", "Unavailable"),
		time: `${formatInstant(evidence.decidedAt, display, "dateTimeMedium")} (${display.timezone})`,
	};
	const title =
		evidence.requestOutcome === "approved"
			? t("bot.approval.outcome.requestApprovedTitle", "Request approved")
			: evidence.requestOutcome === "rejected"
				? t("bot.approval.outcome.requestRejectedTitle", "Request rejected")
				: t("bot.approval.outcome.stepApprovedTitle", "Approval recorded");
	const outcome =
		evidence.requestOutcome === "approved"
			? t(
					"bot.approval.outcome.requestApproved",
					"Approved by {actor} on {time}. The request is approved.",
					params,
				)
			: evidence.requestOutcome === "rejected"
				? t(
						"bot.approval.outcome.requestRejected",
						"Rejected by {actor} on {time}. The request is rejected.",
						params,
					)
				: t(
						"bot.approval.outcome.stepApproved",
						"Approved by {actor} on {time}. The request still awaits further approval.",
						params,
					);
	return {
		title,
		text: result.replayed
			? `${outcome}\n\n${t(
					"bot.approval.outcome.replayed",
					"This button press was already recorded; this is its original result and nothing new was decided.",
				)}`
			: outcome,
		reviewLabel,
		reviewUrl,
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
