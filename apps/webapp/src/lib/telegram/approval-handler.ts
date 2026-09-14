import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramApprovalMessage } from "@/db/schema";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import {
	approvalAttemptNotice,
	telegramApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import { editMessageText, sendMessage } from "./api";
import { getChatIdForUser } from "./conversation-manager";
import type {
	ApprovalCallbackData,
	ResolvedTelegramBot,
	TelegramCallbackQuery,
} from "./types";
import { resolveTelegramUser } from "./user-resolver";

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
		const notice = await approvalAttemptNotice(result, {
			userId: user.user.userId,
			organizationId: bot.organizationId,
		});
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
		});
		if (notice.status === "undisclosable") return;
		const chatId = await getChatIdForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!chatId) return;
		const sent = await sendMessage(botToken, {
			chat_id: chatId,
			...telegramApprovalNotice(notice),
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
