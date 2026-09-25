import type {
	ApprovalDeliveryAdapter,
	ApprovalDeliveryFailure,
} from "@/lib/approvals/delivery/owner";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import { discordApprovalNotice } from "@/lib/bot-platform/approval-notice";
import { editMessageWithOutcome, sendMessageWithOutcome } from "./api";
import { discordActionableCard, fitsDiscordMessage } from "./approval-card";
import { getBotConfigByOrganization } from "./bot-config";
import { discordReceiverScope } from "./bound-approval";
import { resolveApprovalDMChannel } from "./conversation-manager";
import { classifyDiscordDeliveryFailure, type DiscordCallFailure } from "./delivery-outcome";

function failure(
	call: DiscordCallFailure,
	method: "send" | "edit",
): ApprovalDeliveryFailure | "gone" {
	const kind = classifyDiscordDeliveryFailure(call, method);
	if (kind === "gone") return kind;
	const reason =
		call.kind === "unknown"
			? call.reason
			: `discord_${call.status}${call.code ? `_${call.code}` : ""}`;
	return { kind: "failed", outcome: kind, reason };
}

/**
 * Discord mechanics for the approval delivery owner: bot resolution, the
 * recipient's DM with this application, card layout and the REST calls.
 * Cards come from the shared presentation; a card that does not fit is
 * review-only.
 */
export const discordApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "discord",

	async sendInitial(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		if (bot.setupStatus !== "active") {
			return { kind: "suppressed", reason: "integration_disabled" };
		}
		if (!bot.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
		const receiverScope = discordReceiverScope(bot.applicationId);
		if (!receiverScope) {
			return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
		}
		const channel = await resolveApprovalDMChannel(
			bot.botToken,
			input.recipientUserId,
			input.organizationId,
		);
		if (channel.kind === "missing") {
			return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
		}
		if (channel.kind !== "ok") {
			const failed = failure(channel, "send");
			return typeof failed === "string"
				? { kind: "failed", outcome: "permanent", reason: failed }
				: failed;
		}
		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			recipientEmployeeId: input.recipientEmployeeId,
			organizationId: input.organizationId,
			provider: "discord",
			fits: fitsDiscordMessage,
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		const sent = await sendMessageWithOutcome(
			bot.botToken,
			channel.result,
			card.status === "actionable" ? discordActionableCard(card) : discordApprovalNotice(card),
		);
		if (sent.kind !== "ok") {
			const failed = failure(sent, "send");
			return typeof failed === "string"
				? { kind: "failed", outcome: "permanent", reason: failed }
				: failed;
		}
		return {
			kind: "accepted",
			receiverScope,
			destinationId: sent.result.channel_id,
			remoteMessageId: sent.result.id,
			bindingId: card.status === "actionable" ? card.bindingId : null,
			controls: card.status === "actionable" ? "actionable" : "none",
		};
	},

	async refresh(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		// Only the application that sent a message can edit it.
		if (discordReceiverScope(bot.applicationId) !== input.message.receiverScope) {
			return { kind: "gone", reason: "bot_replaced" };
		}
		const edited = await editMessageWithOutcome(
			bot.botToken,
			input.message.destinationId,
			input.message.remoteMessageId,
			discordApprovalNotice(input.notice),
		);
		if (edited.kind === "ok") return { kind: "accepted" };
		const failed = failure(edited, "edit");
		if (failed === "gone") return { kind: "gone", reason: "message_not_editable" };
		return failed;
	},
};
