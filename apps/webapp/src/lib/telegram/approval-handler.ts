import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramApprovalMessage } from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	type ApprovalDeliveryMessageRecord,
	approvalDeliveryMessageReviewReference,
	findApprovalDeliveryMessageByRemoteIdentity,
	isApprovalDeliveryAssignmentReplaced,
	isApprovalDeliveryMessagePending,
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
	approvalStatusNotice,
	boundDecisionNotice,
	telegramApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
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

/**
 * Returns the acknowledgment text when the press landed on a card whose
 * holder escalation replaced (#408); the owner, which adopted the card, is
 * its only writer then.
 */
export async function handleApprovalCallback(
	query: TelegramCallbackQuery,
	data: ApprovalCallbackData,
	telegramUserId: string,
	bot: ResolvedTelegramBot,
): Promise<string | undefined> {
	const user = await resolveTelegramUser(telegramUserId, bot.organizationId);
	if (user.status !== "found") return undefined;
	try {
		// The attempt below records its outcome whether or not a card is edited afterwards.
		// react-doctor-disable-next-line react-doctor/async-defer-await
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
		if (!query.message) return undefined;
		// This attempt never decides. A card the owner adopted from this path
		// (#408) is edited by the owner only.
		const receiverScope = telegramReceiverScope(bot.botToken);
		const adopted = receiverScope
			? await findApprovalDeliveryMessageByRemoteIdentity({
					organizationId: bot.organizationId,
					provider: "telegram",
					receiverScope,
					destinationId: String(query.message.chat.id),
					remoteMessageId: String(query.message.message_id),
				})
			: null;
		if (adopted && adopted.recipientUserId === user.user.userId) {
			return (await reassignedAcknowledgment(adopted, bot, user.user.userId)) ?? undefined;
		}
		if (result.status !== "review_required" && result.status !== "historical")
			return undefined;
		const tracked = await db.query.telegramApprovalMessage.findFirst({
			where: and(
				eq(telegramApprovalMessage.organizationId, bot.organizationId),
				eq(telegramApprovalMessage.approvalRequestId, data.id),
				eq(telegramApprovalMessage.recipientUserId, user.user.userId),
				eq(telegramApprovalMessage.chatId, String(query.message.chat.id)),
				eq(telegramApprovalMessage.messageId, String(query.message.message_id)),
			),
		});
		if (!tracked) return undefined;
		const notice = await approvalAttemptNotice(
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
	} catch (error) {
		logger.error(
			{ error, approvalId: data.id },
			"Failed to review Telegram approval card",
		);
	}
	return undefined;
}

/**
 * The acknowledgment of a press on a card whose assignment or legacy holder
 * was replaced (escalation or reassignment): "Reassigned", with the review
 * link on the card left to the owner. Null otherwise.
 */
async function reassignedAcknowledgment(
	message: ApprovalDeliveryMessageRecord,
	bot: ResolvedTelegramBot,
	recipientUserId: string,
): Promise<string | null> {
	if (!(await isApprovalDeliveryAssignmentReplaced(message))) return null;
	const display = await resolveRecipientDisplayContext({
		userId: recipientUserId,
		organizationId: bot.organizationId,
	});
	if (!display) return null;
	const reassigned = await approvalStatusNotice(
		{ workflowStatus: "pending", evidence: null, reassigned: true },
		display,
		bot.organizationId,
		approvalDeliveryMessageReviewReference(message),
	);
	return reassigned.title;
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
 * The clicked card was sent by the approval delivery owner (#291). The
 * acknowledgment carries the attempt's outcome. A card whose assignment or
 * request is no longer pending (for example the one just decided) is left to
 * the owner, which refreshes every message of the lifecycle from the
 * committed intent, so it has one writer. A still-pending card whose action
 * could not be decided here becomes a review notice without controls; the
 * owner does not refresh pending cards. A press on the card of a replaced
 * (reassigned) assignment is acknowledged as reassigned; the owner edits the
 * card itself, with the review link.
 */
async function updateDeliveredBoundCard(
	result: BoundBotApprovalResult,
	message: ApprovalDeliveryMessageRecord,
	bot: ResolvedTelegramBot,
	recipientUserId: string,
): Promise<string | undefined> {
	try {
		const notice = await boundDecisionNotice(
			result,
			{ userId: recipientUserId, organizationId: bot.organizationId },
			approvalDeliveryMessageReviewReference(message),
		);
		if (!notice) return undefined;
		if (result.status === "review_required") {
			const reassigned = await reassignedAcknowledgment(message, bot, recipientUserId);
			if (reassigned) return reassigned;
		}
		const remoteMessageId = Number(message.remoteMessageId);
		if (
			result.status !== "decided" &&
			Number.isSafeInteger(remoteMessageId) &&
			(await isApprovalDeliveryMessagePending(message))
		) {
			const edited = await editMessageText(bot.botToken, {
				chat_id: message.destinationId,
				message_id: remoteMessageId,
				...telegramApprovalNotice(notice),
			});
			if (edited) {
				await markApprovalDeliveryMessageWithoutControls({
					organizationId: bot.organizationId,
					messageId: message.id,
				});
			}
		}
		return notice.title;
	} finally {
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
