import type {
	ApprovalDeliveryAdapter,
	ApprovalDeliveryFailure,
} from "@/lib/approvals/delivery/owner";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import { telegramApprovalNotice } from "@/lib/bot-platform/approval-notice";
import { editMessageTextWithOutcome, sendMessageWithOutcome } from "./api";
import { fitsTelegramMessage, telegramActionableCard } from "./approval-handler";
import { getBotConfigByOrganization } from "./bot-config";
import { telegramReceiverScope } from "./bound-approval";
import { getChatIdForUser } from "./conversation-manager";
import { classifyTelegramDeliveryFailure, type TelegramCallFailure } from "./delivery-outcome";

function failure(
	call: TelegramCallFailure,
	method: "send" | "edit",
): ApprovalDeliveryFailure | "current" | "gone" {
	const kind = classifyTelegramDeliveryFailure(call, method);
	if (kind === "current" || kind === "gone") return kind;
	const reason = call.kind === "unknown" ? call.reason : `telegram_${call.errorCode ?? "error"}`;
	return { kind: "failed", outcome: kind, reason };
}

/**
 * Telegram mechanics for the approval delivery owner: bot resolution, the
 * recipient's private chat, card layout and the Bot API calls. Cards come
 * from the shared presentation; a card that does not fit is review-only.
 */
export const telegramApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "telegram",

	async sendInitial(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		if (bot.setupStatus !== "active") {
			return { kind: "suppressed", reason: "integration_disabled" };
		}
		if (!bot.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
		const receiverScope = telegramReceiverScope(bot.botToken);
		if (!receiverScope) {
			return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
		}
		const chatId = await getChatIdForUser(input.recipientUserId, input.organizationId);
		if (!chatId) {
			return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
		}
		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			recipientEmployeeId: input.recipientEmployeeId,
			organizationId: input.organizationId,
			provider: "telegram",
			fits: fitsTelegramMessage,
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		const sent = await sendMessageWithOutcome(bot.botToken, {
			chat_id: chatId,
			...(card.status === "actionable"
				? telegramActionableCard(card)
				: telegramApprovalNotice(card)),
		});
		if (sent.kind !== "ok") {
			const failed = failure(sent, "send");
			return typeof failed === "string"
				? { kind: "failed", outcome: "permanent", reason: failed }
				: failed;
		}
		return {
			kind: "accepted",
			receiverScope,
			destinationId: String(sent.result.chat.id),
			remoteMessageId: String(sent.result.message_id),
			bindingId: card.status === "actionable" ? card.bindingId : null,
			controls: card.status === "actionable" ? "actionable" : "none",
		};
	},

	async refresh(input) {
		const bot = await getBotConfigByOrganization(input.organizationId);
		if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		// Only the bot that sent a message can edit it.
		if (telegramReceiverScope(bot.botToken) !== input.message.receiverScope) {
			return { kind: "gone", reason: "bot_replaced" };
		}
		const messageId = Number(input.message.remoteMessageId);
		if (!Number.isSafeInteger(messageId)) return { kind: "gone", reason: "invalid_message_id" };
		const edited = await editMessageTextWithOutcome(bot.botToken, {
			chat_id: input.message.destinationId,
			message_id: messageId,
			...telegramApprovalNotice(input.notice),
		});
		if (edited.kind === "ok") return { kind: "accepted" };
		const failed = failure(edited, "edit");
		if (failed === "current") return { kind: "current" };
		if (failed === "gone") return { kind: "gone", reason: "message_not_editable" };
		return failed;
	},
};
