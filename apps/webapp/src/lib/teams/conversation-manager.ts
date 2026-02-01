/**
 * Teams Conversation Manager
 *
 * Manages Bot Framework conversation references for proactive messaging.
 * Stores conversation references so we can send messages to users without
 * them initiating a conversation first.
 */

import { and, eq } from "drizzle-orm";
import { TurnContext, type ConversationReference } from "botbuilder";
import { db } from "@/db";
import { teamsConversation } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { StoredConversation } from "./types";

const logger = createLogger("TeamsConversationManager");

/**
 * Save a conversation reference from a bot turn context
 *
 * @param context - Bot Framework turn context
 * @param userId - Z8 user ID (if known)
 * @param organizationId - Z8 organization ID
 */
export async function saveConversationReference(
	context: TurnContext,
	userId: string | null,
	organizationId: string,
): Promise<void> {
	try {
		const reference = TurnContext.getConversationReference(context.activity);
		const conversationId = reference.conversation?.id;
		const serviceUrl = reference.serviceUrl;
		const tenantId = context.activity.conversation?.tenantId;

		if (!conversationId || !serviceUrl || !tenantId) {
			logger.warn(
				{ conversationId, serviceUrl, tenantId },
				"Missing required fields for conversation reference",
			);
			return;
		}

		// Determine conversation type
		let conversationType: "personal" | "channel" | "groupChat" = "personal";
		if (context.activity.conversation?.conversationType === "channel") {
			conversationType = "channel";
		} else if (context.activity.conversation?.conversationType === "groupChat") {
			conversationType = "groupChat";
		}

		// Check for existing conversation
		const existing = await db.query.teamsConversation.findFirst({
			where: and(
				eq(teamsConversation.teamsConversationId, conversationId),
				eq(teamsConversation.organizationId, organizationId),
			),
		});

		const referenceJson = JSON.stringify(reference);

		if (existing) {
			// Update existing
			await db
				.update(teamsConversation)
				.set({
					conversationReference: referenceJson,
					teamsServiceUrl: serviceUrl,
					lastUsedAt: new Date(),
					isActive: true,
					// Update userId if we now know it
					...(userId && !existing.userId ? { userId } : {}),
				})
				.where(eq(teamsConversation.id, existing.id));

			logger.debug({ conversationId, organizationId }, "Updated conversation reference");
		} else {
			// Create new
			await db.insert(teamsConversation).values({
				userId,
				organizationId,
				conversationReference: referenceJson,
				teamsConversationId: conversationId,
				teamsServiceUrl: serviceUrl,
				teamsTenantId: tenantId,
				conversationType,
				lastUsedAt: new Date(),
			});

			logger.debug({ conversationId, organizationId, userId }, "Saved new conversation reference");
		}
	} catch (error) {
		logger.error({ error }, "Failed to save conversation reference");
	}
}

/**
 * Get conversation reference for a user (for proactive messaging)
 *
 * @param userId - Z8 user ID
 * @param organizationId - Z8 organization ID
 * @returns Conversation reference or null
 */
export async function getConversationReferenceForUser(
	userId: string,
	organizationId: string,
): Promise<ConversationReference | null> {
	try {
		const conv = await db.query.teamsConversation.findFirst({
			where: and(
				eq(teamsConversation.userId, userId),
				eq(teamsConversation.organizationId, organizationId),
				eq(teamsConversation.isActive, true),
				eq(teamsConversation.conversationType, "personal"),
			),
			orderBy: (t, { desc }) => [desc(t.lastUsedAt)],
		});

		if (!conv) {
			logger.debug({ userId, organizationId }, "No conversation reference found for user");
			return null;
		}

		return JSON.parse(conv.conversationReference) as ConversationReference;
	} catch (error) {
		logger.error({ error, userId, organizationId }, "Failed to get conversation reference");
		return null;
	}
}

/**
 * Get stored conversation details
 *
 * @param userId - Z8 user ID
 * @param organizationId - Z8 organization ID
 * @returns Stored conversation details or null
 */
export async function getStoredConversation(
	userId: string,
	organizationId: string,
): Promise<StoredConversation | null> {
	try {
		const conv = await db.query.teamsConversation.findFirst({
			where: and(
				eq(teamsConversation.userId, userId),
				eq(teamsConversation.organizationId, organizationId),
				eq(teamsConversation.isActive, true),
			),
			orderBy: (t, { desc }) => [desc(t.lastUsedAt)],
		});

		if (!conv) {
			return null;
		}

		return {
			id: conv.id,
			userId: conv.userId,
			organizationId: conv.organizationId,
			conversationReference: JSON.parse(conv.conversationReference) as ConversationReference,
			teamsConversationId: conv.teamsConversationId,
			teamsServiceUrl: conv.teamsServiceUrl,
			teamsTenantId: conv.teamsTenantId,
			conversationType: conv.conversationType as "personal" | "channel" | "groupChat",
			isActive: conv.isActive,
			lastUsedAt: conv.lastUsedAt,
		};
	} catch (error) {
		logger.error({ error, userId, organizationId }, "Failed to get stored conversation");
		return null;
	}
}

/**
 * Deactivate a conversation (e.g., when bot is removed)
 *
 * @param conversationId - Teams conversation ID
 * @param organizationId - Z8 organization ID
 */
export async function deactivateConversation(
	conversationId: string,
	organizationId: string,
): Promise<void> {
	try {
		await db
			.update(teamsConversation)
			.set({ isActive: false })
			.where(
				and(
					eq(teamsConversation.teamsConversationId, conversationId),
					eq(teamsConversation.organizationId, organizationId),
				),
			);

		logger.info({ conversationId, organizationId }, "Deactivated conversation");
	} catch (error) {
		logger.error({ error, conversationId, organizationId }, "Failed to deactivate conversation");
	}
}

/**
 * Get all active personal conversations for an organization
 * Used for broadcast messages (e.g., daily digest)
 *
 * @param organizationId - Z8 organization ID
 * @returns Array of conversation references with user IDs
 */
export async function getOrganizationPersonalConversations(
	organizationId: string,
): Promise<Array<{ userId: string; conversationReference: ConversationReference }>> {
	try {
		const conversations = await db.query.teamsConversation.findMany({
			where: and(
				eq(teamsConversation.organizationId, organizationId),
				eq(teamsConversation.isActive, true),
				eq(teamsConversation.conversationType, "personal"),
			),
		});

		return conversations
			.filter((c) => c.userId !== null)
			.map((c) => ({
				userId: c.userId as string,
				conversationReference: JSON.parse(c.conversationReference) as ConversationReference,
			}));
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to get organization conversations");
		return [];
	}
}
