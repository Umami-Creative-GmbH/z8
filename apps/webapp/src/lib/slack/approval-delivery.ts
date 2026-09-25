import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { slackUserMapping } from "@/db/schema";
import type {
	ApprovalDeliveryAdapter,
	ApprovalDeliveryFailure,
} from "@/lib/approvals/delivery/owner";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import {
	openConversationWithOutcome,
	postMessageWithOutcome,
	updateMessageWithOutcome,
} from "./api";
import { fitsSlackApprovalCard, slackApprovalCard } from "./approval-card";
import { getBotConfigByOrganization } from "./bot-config";
import { getChannelIdForUser } from "./conversation-manager";
import { classifySlackDeliveryFailure, type SlackCallFailure } from "./delivery-outcome";
import type { ResolvedSlackBot } from "./types";

/** The installation that sent a message; only it can update the message. */
export function slackReceiverScope(bot: Pick<ResolvedSlackBot, "slackTeamId">): string {
	return `slack-team:${bot.slackTeamId}`;
}

function failureReason(call: SlackCallFailure): string {
	switch (call.kind) {
		case "platform":
			return `slack_${call.error}`;
		case "http":
			return `slack_http_${call.status}`;
		case "rate_limited":
			return "slack_rate_limited";
		case "unknown":
			return call.reason;
	}
}

function sendFailure(call: SlackCallFailure, method: "send" | "open"): ApprovalDeliveryFailure {
	const kind = classifySlackDeliveryFailure(call, method);
	// Only an update can find its message gone.
	return {
		kind: "failed",
		outcome: kind === "gone" ? "permanent" : kind,
		reason: failureReason(call),
	};
}

/**
 * The recipient's DM with the bot: the conversation they used, or one opened
 * for their linked account in this workspace.
 */
async function resolveDirectMessage(
	bot: ResolvedSlackBot,
	input: { organizationId: string; recipientUserId: string },
): Promise<{ kind: "ok"; channelId: string } | ApprovalDeliveryFailure> {
	const known = await getChannelIdForUser(input.recipientUserId, input.organizationId);
	if (known) return { kind: "ok", channelId: known };
	const mapping = await db.query.slackUserMapping.findFirst({
		where: and(
			eq(slackUserMapping.userId, input.recipientUserId),
			eq(slackUserMapping.organizationId, input.organizationId),
			eq(slackUserMapping.slackTeamId, bot.slackTeamId),
			eq(slackUserMapping.isActive, true),
		),
		columns: { slackUserId: true },
	});
	if (!mapping) {
		return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
	}
	const opened = await openConversationWithOutcome(bot.botAccessToken, mapping.slackUserId);
	return opened.kind === "ok"
		? { kind: "ok", channelId: opened.result }
		: sendFailure(opened, "open");
}

/**
 * Slack mechanics for the approval delivery owner (#294): installation, the
 * recipient's DM, card layout and the Web API calls. Slack has no established
 * per-invocation identity (#261), so every card is review-only: the submitted
 * facts when they fit Slack's limits, otherwise a review notice.
 */
export const slackApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "slack",

	async sendInitial(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		if (bot.setupStatus !== "active") {
			return { kind: "suppressed", reason: "integration_disabled" };
		}
		if (!bot.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
		const destination = await resolveDirectMessage(bot, input);
		if (destination.kind !== "ok") return destination;
		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			recipientEmployeeId: input.recipientEmployeeId,
			organizationId: input.organizationId,
			provider: "slack",
			summary: { fits: fitsSlackApprovalCard },
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		// Never controls: an actionable card cannot be prepared for Slack, and
		// the renderer has no approve or reject control either way.
		const sent = await postMessageWithOutcome(bot.botAccessToken, {
			channel: destination.channelId,
			...slackApprovalCard(card),
		});
		if (sent.kind !== "ok") return sendFailure(sent, "send");
		return {
			kind: "accepted",
			receiverScope: slackReceiverScope(bot),
			destinationId: sent.result.channel,
			remoteMessageId: sent.result.ts,
			bindingId: null,
			controls: "none",
		};
	},

	async refresh(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		// Only the installation that sent a message can update it.
		if (slackReceiverScope(bot) !== input.message.receiverScope) {
			return { kind: "gone", reason: "workspace_replaced" };
		}
		const updated = await updateMessageWithOutcome(bot.botAccessToken, {
			channel: input.message.destinationId,
			ts: input.message.remoteMessageId,
			...slackApprovalCard(input.notice),
		});
		if (updated.kind === "ok") return { kind: "accepted" };
		const kind = classifySlackDeliveryFailure(updated, "edit");
		return kind === "gone"
			? { kind: "gone", reason: "message_not_editable" }
			: { kind: "failed", outcome: kind, reason: failureReason(updated) };
	},
};
