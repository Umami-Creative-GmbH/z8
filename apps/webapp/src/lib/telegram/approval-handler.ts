import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramApprovalMessage } from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	type ApprovalDeliveryMessageRecord,
	findApprovalDeliveryMessageByRemoteIdentity,
	markApprovalDeliveryMessageWithoutControls,
} from "@/lib/approvals/delivery/store";
import {
	type ApprovalActionableCard,
	type ApprovalCardDraft,
	prepareApprovalPresentation,
} from "@/lib/approvals/presentation";
import type { BoundBotApprovalResult } from "@/lib/bot-platform/approval-decision";
import {
	approvalAttemptNotice,
	boundDecisionNotice,
	telegramApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import { editMessageText, sendMessage } from "./api";
import {
	encodeBoundApprovalCallback,
	telegramInvocationEnvelope,
	telegramReceiverScope,
} from "./bound-approval";
import { getChatIdForUser } from "./conversation-manager";
import type {
	ApprovalCallbackData,
	ResolvedTelegramBot,
	TelegramCallbackQuery,
	TelegramSendMessageParams,
} from "./types";
import { resolveTelegramUser } from "./user-resolver";

const TELEGRAM_TEXT_LIMIT = 4096;

const logger = createLogger("TelegramApprovalHandler");

export async function handleApprovalCallback(
	query: TelegramCallbackQuery,
	data: ApprovalCallbackData,
	telegramUserId: string,
	bot: ResolvedTelegramBot,
): Promise<void> {
	const user = await resolveTelegramUser(telegramUserId, bot.organizationId);
	if (user.status !== "found") return;
	try {
		const { attemptBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		const result = await attemptBotApproval({
			approvalId: data.id,
			actorEmployeeId: user.user.employeeId,
			organizationId: bot.organizationId,
			action: data.a === "ap" ? "approve" : "reject",
			platform: "telegram",
		});
		if (result.status !== "review_required" && result.status !== "historical")
			return;
		if (!query.message) return;
		const tracked = await db.query.telegramApprovalMessage.findFirst({
			where: and(
				eq(telegramApprovalMessage.organizationId, bot.organizationId),
				eq(telegramApprovalMessage.approvalRequestId, data.id),
				eq(telegramApprovalMessage.recipientUserId, user.user.userId),
				eq(telegramApprovalMessage.chatId, String(query.message.chat.id)),
				eq(telegramApprovalMessage.messageId, String(query.message.message_id)),
			),
		});
		if (!tracked) return;
		const notice = await approvalAttemptNotice(
			result,
			{ userId: user.user.userId, organizationId: bot.organizationId },
			{ kind: "compatibility", approvalRequestId: tracked.approvalRequestId },
		);
		if (!notice) return;
		await editMessageText(bot.botToken, {
			chat_id: tracked.chatId,
			message_id: Number(tracked.messageId),
			...telegramApprovalNotice(notice),
		});
	} catch (error) {
		logger.error(
			{ error, approvalId: data.id },
			"Failed to review Telegram approval card",
		);
	}
}

function telegramCardText(card: ApprovalCardDraft): string {
	return [
		card.title,
		"",
		...card.facts.map((fact) => `${fact.label}: ${fact.value}`),
		"",
		card.text,
	].join("\n");
}

/**
 * Essential facts must fit one Telegram message; a truncated proposal never
 * keeps its controls, so an oversized card is prepared as review-only.
 */
export function fitsTelegramMessage(card: ApprovalCardDraft): boolean {
	return telegramCardText(card).length <= TELEGRAM_TEXT_LIMIT;
}

/** Bound card layout: approve/reject carry only the binding handle. */
export function telegramActionableCard(
	card: ApprovalActionableCard,
): Omit<TelegramSendMessageParams, "chat_id"> {
	return {
		text: telegramCardText(card),
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: card.approveLabel,
						callback_data: encodeBoundApprovalCallback("approve", card.bindingId),
					},
					{
						text: card.rejectLabel,
						callback_data: encodeBoundApprovalCallback("reject", card.bindingId),
					},
				],
				[{ text: card.reviewLabel, url: card.reviewUrl }],
			],
		},
	};
}

/**
 * A bound card action (#290). The callback-query identity and the card's
 * binding go through the shared attempt into the authoritative decision.
 * Returns the acknowledgment text; the acknowledgment itself is sent by the
 * caller and is never evidence of commitment. Message updates are best effort
 * and cannot change a committed decision.
 */
export async function handleBoundApprovalCallback(
	query: TelegramCallbackQuery,
	callback: { action: "approve" | "reject"; bindingId: string },
	updateId: number | undefined,
	bot: ResolvedTelegramBot,
): Promise<string | undefined> {
	const user = await resolveTelegramUser(String(query.from.id), bot.organizationId);
	if (user.status !== "found") return undefined;
	let result: BoundBotApprovalResult;
	try {
		const { attemptBoundBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		result = await attemptBoundBotApproval({
			organizationId: bot.organizationId,
			actorEmployeeId: user.user.employeeId,
			actorUserId: user.user.userId,
			bindingId: callback.bindingId,
			action: callback.action,
			platform: "telegram",
			invocation: telegramInvocationEnvelope(bot.botToken, query, updateId),
		});
	} catch (error) {
		// Outcome unknown: claim nothing. A redelivery of this query replays
		// the committed result if the decision did commit.
		logger.error(
			{ error, bindingId: callback.bindingId },
			"Failed to decide bound Telegram approval",
		);
		return undefined;
	}
	try {
		if (!query.message) return undefined;
		const receiverScope = telegramReceiverScope(bot.botToken);
		const delivered = receiverScope
			? await findApprovalDeliveryMessageByRemoteIdentity({
					organizationId: bot.organizationId,
					provider: "telegram",
					receiverScope,
					destinationId: String(query.message.chat.id),
					remoteMessageId: String(query.message.message_id),
				})
			: null;
		if (delivered && delivered.recipientUserId === user.user.userId) {
			return await updateDeliveredBoundCard(result, delivered, bot, user.user.userId);
		}
		const tracked = await db.query.telegramApprovalMessage.findFirst({
			where: and(
				eq(telegramApprovalMessage.organizationId, bot.organizationId),
				eq(telegramApprovalMessage.recipientUserId, user.user.userId),
				eq(telegramApprovalMessage.chatId, String(query.message.chat.id)),
				eq(telegramApprovalMessage.messageId, String(query.message.message_id)),
			),
		});
		if (!tracked) return undefined;
		const notice = await boundDecisionNotice(
			result,
			{ userId: user.user.userId, organizationId: bot.organizationId },
			{ kind: "compatibility", approvalRequestId: tracked.approvalRequestId },
		);
		if (!notice) return undefined;
		await editMessageText(bot.botToken, {
			chat_id: tracked.chatId,
			message_id: Number(tracked.messageId),
			...telegramApprovalNotice(notice),
		});
		return notice.title;
	} catch (error) {
		logger.error(
			{ error, bindingId: callback.bindingId, status: result.status },
			"Failed to update bound Telegram approval card",
		);
		return undefined;
	}
}

/**
 * The clicked card was sent by the approval delivery owner (#291): show the
 * attempt's outcome and drop its controls. The recorded status version is
 * left alone, so the owner's refresh still brings the message to the
 * request's current status; the lifecycle's other messages are refreshed
 * from the decision's committed intent.
 */
async function updateDeliveredBoundCard(
	result: BoundBotApprovalResult,
	message: ApprovalDeliveryMessageRecord,
	bot: ResolvedTelegramBot,
	recipientUserId: string,
): Promise<string | undefined> {
	const notice = await boundDecisionNotice(
		result,
		{ userId: recipientUserId, organizationId: bot.organizationId },
		message.approvalRequestId
			? { kind: "compatibility", approvalRequestId: message.approvalRequestId }
			: { kind: "canonical", assignmentId: message.assignmentId },
	);
	try {
		if (!notice) return undefined;
		const edited = await editMessageText(bot.botToken, {
			chat_id: message.destinationId,
			message_id: Number(message.remoteMessageId),
			...telegramApprovalNotice(notice),
		});
		if (edited) {
			await markApprovalDeliveryMessageWithoutControls({
				organizationId: bot.organizationId,
				messageId: message.id,
			});
		}
		return notice.title;
	} finally {
		// After this edit, so the owner's refresh is the last word on the card.
		kickApprovalDelivery({
			organizationId: bot.organizationId,
			workflowId: message.workflowId,
		});
	}
}

export async function sendApprovalMessageToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
	botToken: string,
): Promise<void> {
	try {
		const notice = await prepareApprovalPresentation({
			approvalId,
			recipientEmployeeId: approverId,
			organizationId,
			provider: "telegram",
			fits: fitsTelegramMessage,
		});
		if (notice.status === "undisclosable") return;
		const chatId = await getChatIdForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!chatId) return;
		const sent = await sendMessage(botToken, {
			chat_id: chatId,
			...(notice.status === "actionable"
				? telegramActionableCard(notice)
				: telegramApprovalNotice(notice)),
		});
		if (sent)
			await db
				.insert(telegramApprovalMessage)
				.values({
					approvalRequestId: approvalId,
					organizationId,
					recipientUserId: notice.recipientUserId,
					chatId,
					messageId: String(sent.message_id),
					status: "sent",
				});
	} catch (error) {
		logger.error(
			{ error, approvalId },
			"Failed to send Telegram approval notice",
		);
	}
}
