import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramApprovalMessage, telegramBotConfig } from "@/db/schema";
import {
	type ChatInstallationOriginRecord,
	findActiveInstallationConversation,
	resolveAuthoritativeProviderApprovalSettings,
	resolveInstallationSecret,
} from "@/lib/approvals/delivery/installation-origin";
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

async function resolveTelegramTokenForInstallation(
	organizationId: string,
	installation: ChatInstallationOriginRecord,
): Promise<string | null> {
	const fromRevision = await resolveInstallationSecret({
		installation,
		candidateKeyNames: ["bot_token", "telegram/bot_token"],
	});
	if (fromRevision) return fromRevision;
	if (installation.legacyTable === "telegram_bot_config") {
		const legacyBot = await getBotConfigByOrganization(organizationId);
		return legacyBot?.botToken ?? null;
	}
	return null;
}

/**
 * Telegram mechanics for the approval delivery owner: bot resolution, the
 * recipient's private chat, card layout and the Bot API calls. Cards come
 * from the shared presentation; a card that does not fit is review-only.
 */
export const telegramApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "telegram",

	async acceptsEscalationDelivery(organizationId) {
		const authoritative = await resolveAuthoritativeProviderApprovalSettings(
			organizationId,
			"telegram",
		);
		if (authoritative !== null) return authoritative.enableEscalations;
		const [config] = await db
			.select({ enableEscalations: telegramBotConfig.enableEscalations })
			.from(telegramBotConfig)
			.where(eq(telegramBotConfig.organizationId, organizationId))
			.limit(1);
		return config?.enableEscalations === true;
	},

	async sendInitial(input) {
		let botToken: string;
		let receiverScope: string | null;
		let chatId: string | null;
		const target = input.targetInstallation ?? null;

		if (target) {
			const token = await resolveTelegramTokenForInstallation(input.organizationId, target);
			if (!token) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const authoritative = await resolveAuthoritativeProviderApprovalSettings(
				input.organizationId,
				"telegram",
			);
			if (authoritative) {
				if (!authoritative.enableApprovals) {
					return { kind: "suppressed", reason: "approvals_disabled" };
				}
				if (input.purpose === "replacement" && !authoritative.enableEscalations) {
					return { kind: "suppressed", reason: "escalations_disabled" };
				}
			} else if (target.legacyTable === "telegram_bot_config") {
				const legacy = await getBotConfigByOrganization(input.organizationId);
				if (!legacy) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
				if (legacy.setupStatus !== "active") {
					return { kind: "suppressed", reason: "integration_disabled" };
				}
				if (!legacy.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
				if (input.purpose === "replacement" && !legacy.enableEscalations) {
					return { kind: "suppressed", reason: "escalations_disabled" };
				}
			}
			botToken = token;
			receiverScope = target.receiverScope ?? telegramReceiverScope(botToken);
			if (!receiverScope) {
				return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
			}
			const installationConversation = await findActiveInstallationConversation({
				organizationId: input.organizationId,
				installationId: target.id,
				userId: input.recipientUserId,
				conversationTypes: ["private"],
			});
			chatId =
				installationConversation?.externalConversationId ??
				(target.legacyTable === "telegram_bot_config"
					? await getChatIdForUser(input.recipientUserId, input.organizationId)
					: null);
			if (!chatId) {
				return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
			}
		} else {
			const bot = await getBotConfigByOrganization(input.organizationId);
			if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			if (bot.setupStatus !== "active") {
				return { kind: "suppressed", reason: "integration_disabled" };
			}
			if (!bot.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
			if (input.purpose === "replacement" && !bot.enableEscalations) {
				return { kind: "suppressed", reason: "escalations_disabled" };
			}
			botToken = bot.botToken;
			receiverScope = telegramReceiverScope(botToken);
			if (!receiverScope) {
				return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
			}
			chatId = await getChatIdForUser(input.recipientUserId, input.organizationId);
			if (!chatId) {
				return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
			}
		}

		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			...(input.canonicalAssignment ? { canonicalAssignment: input.canonicalAssignment } : {}),
			recipientEmployeeId: input.recipientEmployeeId,
			actingForEmployeeId: input.actingForEmployeeId ?? null,
			organizationId: input.organizationId,
			provider: "telegram",
			fits: fitsTelegramMessage,
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		const sent = await sendMessageWithOutcome(botToken, {
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
			installationId: target?.id ?? null,
			credentialRevisionId: target?.activeCredentialRevisionId ?? null,
		};
	},

	async refresh(input) {
		const origin = input.originInstallation ?? null;
		let botToken: string;
		if (origin) {
			const token = await resolveTelegramTokenForInstallation(input.organizationId, origin);
			if (!token) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const tokenScope = telegramReceiverScope(token);
			if (
				tokenScope !== input.message.receiverScope &&
				origin.receiverScope !== input.message.receiverScope
			) {
				return { kind: "gone", reason: "bot_replaced" };
			}
			botToken = token;
		} else {
			const bot = await getBotConfigByOrganization(input.organizationId);
			if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			// Only the bot that sent a message can edit it.
			if (telegramReceiverScope(bot.botToken) !== input.message.receiverScope) {
				return { kind: "gone", reason: "bot_replaced" };
			}
			botToken = bot.botToken;
		}
		const messageId = Number(input.message.remoteMessageId);
		if (!Number.isSafeInteger(messageId)) return { kind: "gone", reason: "invalid_message_id" };
		const edited = await editMessageTextWithOutcome(botToken, {
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

	async listUntrackedLegacyCards(input) {
		const tracked = await db
			.select({
				chatId: telegramApprovalMessage.chatId,
				messageId: telegramApprovalMessage.messageId,
			})
			.from(telegramApprovalMessage)
			.where(
				and(
					eq(telegramApprovalMessage.organizationId, input.organizationId),
					eq(telegramApprovalMessage.approvalRequestId, input.approvalRequestId),
					eq(telegramApprovalMessage.recipientUserId, input.recipientUserId),
				),
			);
		if (tracked.length === 0) return [];
		// The old path records no bot identity; only the organization's current
		// bot can edit a card, and a card another bot sent reads as gone.
		const bot = await getBotConfigByOrganization(input.organizationId);
		const receiverScope = bot ? telegramReceiverScope(bot.botToken) : null;
		if (!receiverScope) return [];
		return tracked.map((card) => ({
			provider: "telegram" as const,
			recipientUserId: input.recipientUserId,
			receiverScope,
			destinationId: card.chatId,
			remoteMessageId: card.messageId,
		}));
	},
};
