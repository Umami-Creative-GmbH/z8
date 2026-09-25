import type { ApprovalReviewNotice } from "@/lib/approvals/presentation";
import {
	type ApprovalReviewReference,
	approvalReviewUrl,
} from "@/lib/approvals/presentation/review-navigation";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import type { DecisionEvidenceRecord } from "@/lib/approvals/evidence/store";
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
	const outcome = BOUND_OUTCOME_TEXT[boundOutcome(evidence)];
	const text = t(outcome.text.key, outcome.text.fallback, params);
	return {
		title: t(outcome.title.key, outcome.title.fallback),
		text: result.replayed
			? `${text}\n\n${t(
					"bot.approval.outcome.replayed",
					"This button press was already recorded; this is its original result and nothing new was decided.",
				)}`
			: text,
		reviewLabel,
		reviewUrl,
	};
}

type BoundOutcome =
	| "request_approved"
	| "request_rejected"
	| "step_approved"
	| "step_rejected"
	| "recorded";

/**
 * The request outcome as of the committed operation wins; otherwise the step's
 * own outcome is reported without claiming finality. Anything else (e.g. a
 * cancelled request) only states that a decision was recorded.
 */
function boundOutcome(
	evidence: Pick<
		DecisionEvidenceRecord,
		"assignmentOutcome" | "requestOutcome"
	>,
): BoundOutcome {
	if (evidence.requestOutcome === "approved") return "request_approved";
	if (evidence.requestOutcome === "rejected") return "request_rejected";
	if (evidence.requestOutcome === "pending") {
		if (evidence.assignmentOutcome === "approved") return "step_approved";
		if (evidence.assignmentOutcome === "rejected") return "step_rejected";
	}
	return "recorded";
}

const BOUND_OUTCOME_TEXT: Readonly<
	Record<
		BoundOutcome,
		{
			title: { key: string; fallback: string };
			text: { key: string; fallback: string };
		}
	>
> = {
	request_approved: {
		title: {
			key: "bot.approval.outcome.requestApprovedTitle",
			fallback: "Request approved",
		},
		text: {
			key: "bot.approval.outcome.requestApproved",
			fallback: "Approved by {actor} on {time}. The request is approved.",
		},
	},
	request_rejected: {
		title: {
			key: "bot.approval.outcome.requestRejectedTitle",
			fallback: "Request rejected",
		},
		text: {
			key: "bot.approval.outcome.requestRejected",
			fallback: "Rejected by {actor} on {time}. The request is rejected.",
		},
	},
	step_approved: {
		title: {
			key: "bot.approval.outcome.stepApprovedTitle",
			fallback: "Approval recorded",
		},
		text: {
			key: "bot.approval.outcome.stepApproved",
			fallback:
				"Approved by {actor} on {time}. The request still awaits further approval.",
		},
	},
	step_rejected: {
		title: {
			key: "bot.approval.outcome.stepRejectedTitle",
			fallback: "Rejection recorded",
		},
		text: {
			key: "bot.approval.outcome.stepRejected",
			fallback:
				"Rejected by {actor} on {time}. The request is not final yet; review its current status in Z8.",
		},
	},
	recorded: {
		title: {
			key: "bot.approval.outcome.recordedTitle",
			fallback: "Decision recorded",
		},
		text: {
			key: "bot.approval.outcome.recorded",
			fallback:
				"Recorded by {actor} on {time}. Review the request's current status in Z8.",
		},
	},
};

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
