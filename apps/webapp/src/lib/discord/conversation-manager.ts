/**
 * Discord Conversation Manager
 *
 * Stores and retrieves DM channel IDs for proactive messaging.
 * Discord requires creating a DM channel first, then sending to it.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordConversation } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { createDM } from "./api";

const logger = createLogger("DiscordConversationManager");

/**
 * Save or update a DM conversation reference.
 * Uses upsert to avoid race conditions on concurrent interactions.
 */
export async function saveConversation(
	channelId: string,
	userId: string,
	organizationId: string,
): Promise<void> {
	try {
		await db
			.insert(discordConversation)
			.values({
				organizationId,
				userId,
				channelId,
				isActive: true,
			})
			.onConflictDoUpdate({
				target: [discordConversation.userId, discordConversation.organizationId],
				set: {
					channelId,
					isActive: true,
					lastUsedAt: new Date(),
				},
			});
	} catch (error) {
		logger.error({ error, userId, channelId }, "Failed to save Discord conversation");
	}
}

/**
 * Get the DM channel ID for a user (for proactive messaging)
 */
export async function getChannelIdForUser(
	userId: string,
	organizationId: string,
): Promise<string | null> {
	const conversation = await db.query.discordConversation.findFirst({
		where: and(
			eq(discordConversation.userId, userId),
			eq(discordConversation.organizationId, organizationId),
			eq(discordConversation.isActive, true),
		),
		columns: { channelId: true },
	});

	return conversation?.channelId ?? null;
}

/**
 * Get or create a DM channel for a Discord user.
 * Creates the DM channel via Discord API if not stored.
 */
export async function getOrCreateDMChannel(
	botToken: string,
	discordUserId: string,
	userId: string,
	organizationId: string,
): Promise<string | null> {
	// Check for existing stored channel
	const existing = await getChannelIdForUser(userId, organizationId);
	if (existing) return existing;

	// Create DM channel via Discord API
	const channelId = await createDM(botToken, discordUserId);
	if (!channelId) {
		logger.warn({ discordUserId, organizationId }, "Failed to create Discord DM channel");
		return null;
	}

	// Store for future use
	await saveConversation(channelId, userId, organizationId);

	return channelId;
}

/**
 * Get all active DM conversations for an organization.
 * Used by daily digest and broadcast messages.
 */
export async function getOrganizationConversations(
	organizationId: string,
): Promise<Array<{ userId: string; channelId: string }>> {
	const conversations = await db.query.discordConversation.findMany({
		where: and(
			eq(discordConversation.organizationId, organizationId),
			eq(discordConversation.isActive, true),
		),
		columns: { userId: true, channelId: true },
	});

	// Filter to only conversations with a userId
	return conversations.filter((c): c is { userId: string; channelId: string } => c.userId !== null);
}

/**
 * Deactivate a conversation (when bot is blocked/removed)
 */
export async function deactivateConversation(
	channelId: string,
	organizationId: string,
): Promise<void> {
	await db
		.update(discordConversation)
		.set({ isActive: false })
		.where(
			and(
				eq(discordConversation.channelId, channelId),
				eq(discordConversation.organizationId, organizationId),
			),
		);
}
