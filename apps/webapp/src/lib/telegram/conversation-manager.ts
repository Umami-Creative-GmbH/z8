/**
 * Telegram Conversation Manager
 *
 * Stores and retrieves chat IDs for proactive messaging.
 * Simpler than Teams - just stores the Telegram chat_id.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramConversation, telegramUserMapping } from "@/db/schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TelegramConversationManager");

/**
 * Save or update a conversation reference.
 * Called on every incoming message to keep chat_id current.
 */
export async function saveConversation(
	chatId: string,
	chatType: string,
	userId: string,
	organizationId: string,
): Promise<void> {
	try {
		const existing = await db.query.telegramConversation.findFirst({
			where: and(
				eq(telegramConversation.userId, userId),
				eq(telegramConversation.organizationId, organizationId),
				eq(telegramConversation.chatType, chatType),
			),
		});

		if (existing) {
			await db
				.update(telegramConversation)
				.set({
					chatId,
					isActive: true,
					lastUsedAt: new Date(),
				})
				.where(eq(telegramConversation.id, existing.id));
		} else {
			await db.insert(telegramConversation).values({
				organizationId,
				userId,
				chatId,
				chatType,
				isActive: true,
			});
		}
	} catch (error) {
		logger.error({ error, userId, chatId }, "Failed to save conversation");
	}
}

/**
 * Get the chat ID for a user (for proactive messaging)
 */
export async function getChatIdForUser(
	userId: string,
	organizationId: string,
): Promise<string | null> {
	const conversation = await db.query.telegramConversation.findFirst({
		where: and(
			eq(telegramConversation.userId, userId),
			eq(telegramConversation.organizationId, organizationId),
			eq(telegramConversation.chatType, "private"),
			eq(telegramConversation.isActive, true),
		),
		columns: { chatId: true },
	});

	return conversation?.chatId ?? null;
}

/**
 * Get all active private conversations for an organization.
 * Used by daily digest and broadcast messages.
 */
export async function getOrganizationPrivateConversations(
	organizationId: string,
): Promise<Array<{ userId: string; chatId: string }>> {
	const conversations = await db.query.telegramConversation.findMany({
		where: and(
			eq(telegramConversation.organizationId, organizationId),
			eq(telegramConversation.chatType, "private"),
			eq(telegramConversation.isActive, true),
		),
		columns: { userId: true, chatId: true },
	});

	// Filter to only conversations with a userId
	return conversations.filter((c): c is { userId: string; chatId: string } => c.userId !== null);
}

/**
 * Deactivate a conversation (when bot is blocked/removed)
 */
export async function deactivateConversation(
	chatId: string,
	organizationId: string,
): Promise<void> {
	await db
		.update(telegramConversation)
		.set({ isActive: false })
		.where(
			and(
				eq(telegramConversation.chatId, chatId),
				eq(telegramConversation.organizationId, organizationId),
			),
		);
}
