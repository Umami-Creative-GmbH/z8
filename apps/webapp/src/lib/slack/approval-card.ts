import type { ApprovalCardFact } from "@/lib/approvals/presentation";
import type { ApprovalNotice } from "@/lib/bot-platform/approval-notice";

/** A Slack approval message: a status notice, or submitted facts to review. */
export type SlackApprovalCardContent = ApprovalNotice & { facts?: readonly ApprovalCardFact[] };

// Block Kit limits beyond which Slack truncates or rejects the message.
const HEADER_LIMIT = 150;
const SECTION_TEXT_LIMIT = 3000;
const BUTTON_TEXT_LIMIT = 75;
const URL_LIMIT = 3000;

function factLines(facts: readonly ApprovalCardFact[]): string {
	return facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n");
}

/** Slack control characters in `mrkdwn` text (the notification fallback). */
function escapeSlackText(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Slack's rendering of a review-only approval card. Slack has no established
 * per-invocation identity (#261), so the only control opens the exact item in
 * Z8. Every user-supplied value is plain text: names cannot mention or link.
 */
export function slackApprovalCard(card: SlackApprovalCardContent) {
	const facts = card.facts?.length ? factLines(card.facts) : null;
	return {
		text: escapeSlackText([card.title, facts, card.text].filter(Boolean).join("\n\n")),
		blocks: [
			{ type: "header", text: { type: "plain_text", text: card.title } },
			...(facts ? [{ type: "section", text: { type: "plain_text", text: facts } }] : []),
			{ type: "section", text: { type: "plain_text", text: card.text } },
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: card.reviewLabel },
						url: card.reviewUrl,
						action_id: "approval_review",
					},
				],
			},
		],
	};
}

/**
 * Essential content must reach the recipient whole; a card Slack would
 * truncate is sent as a review notice without its facts instead.
 */
export function fitsSlackApprovalCard(card: SlackApprovalCardContent): boolean {
	return (
		card.title.length <= HEADER_LIMIT &&
		(card.facts ? factLines(card.facts).length <= SECTION_TEXT_LIMIT : true) &&
		card.text.length <= SECTION_TEXT_LIMIT &&
		card.reviewLabel.length <= BUTTON_TEXT_LIMIT &&
		card.reviewUrl.length <= URL_LIMIT
	);
}
