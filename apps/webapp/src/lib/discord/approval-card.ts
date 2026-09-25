import type { ApprovalActionableCard, ApprovalCardDraft } from "@/lib/approvals/presentation";
import { escapeDiscordMarkdown } from "@/lib/bot-platform/approval-notice";
import { encodeBoundApprovalCustomId } from "./bound-approval";
import { ButtonStyle, type DiscordMessagePayload } from "./types";

const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_BUTTON_LABEL_LIMIT = 80;
const DISCORD_LINK_URL_LIMIT = 512;

function discordCardContent(card: ApprovalCardDraft): string {
	return escapeDiscordMarkdown(
		[
			card.title,
			"",
			...card.facts.map((fact) => `${fact.label}: ${fact.value}`),
			"",
			card.text,
		].join("\n"),
	);
}

/**
 * Essential facts and controls must fit one Discord message; a truncated
 * proposal never keeps its controls, so an oversized card is prepared as
 * review-only.
 */
export function fitsDiscordMessage(card: ApprovalCardDraft): boolean {
	return (
		discordCardContent(card).length <= DISCORD_CONTENT_LIMIT &&
		[card.approveLabel, card.rejectLabel, card.reviewLabel].every(
			(label) => label.length > 0 && label.length <= DISCORD_BUTTON_LABEL_LIMIT,
		) &&
		card.reviewUrl.length <= DISCORD_LINK_URL_LIMIT
	);
}

/**
 * Bound card layout: approve/reject carry only the binding handle; the review
 * link never sends an interaction, and no mention can notify anyone.
 */
export function discordActionableCard(card: ApprovalActionableCard): DiscordMessagePayload {
	return {
		content: discordCardContent(card),
		embeds: [],
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: ButtonStyle.SUCCESS,
						label: card.approveLabel,
						custom_id: encodeBoundApprovalCustomId("approve", card.bindingId),
					},
					{
						type: 2,
						style: ButtonStyle.DANGER,
						label: card.rejectLabel,
						custom_id: encodeBoundApprovalCustomId("reject", card.bindingId),
					},
					{ type: 2, style: ButtonStyle.LINK, label: card.reviewLabel, url: card.reviewUrl },
				],
			},
		],
		allowed_mentions: { parse: [] },
	};
}
