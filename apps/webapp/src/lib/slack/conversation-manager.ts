/**
 * Slack Conversation Manager
 *
 * Stores and retrieves DM channel IDs for proactive messaging.
 * Mirrors telegram/conversation-manager.ts pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { slackConversation } from "@/db/schema";
import {
	type ChatDispatchTargetHint,
	listInstallationActiveConversations,
	resolveInstallationConversationForUser,
	resolveSwitchedActiveChatInstallation,
} from "@/lib/chat-installations/runtime-target";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SlackConversationManager");

/**
 * Save or update a conversation reference.
 * Called on every incoming interaction to keep channel_id current.
 */
export async function saveConversation(
	channelId: string,
	channelType: string,
	userId: string,
	organizationId: string,
): Promise<void> {
	try {
		const existing = await db.query.slackConversation.findFirst({
			where: and(
				eq(slackConversation.userId, userId),
				eq(slackConversation.organizationId, organizationId),
				eq(slackConversation.channelType, channelType),
			),
		});

		if (existing) {
			await db
				.update(slackConversation)
				.set({
					channelId,
					isActive: true,
					lastUsedAt: new Date(),
				})
				.where(eq(slackConversation.id, existing.id));
		} else {
			await db.insert(slackConversation).values({
				organizationId,
				userId,
				channelId,
				channelType,
				isActive: true,
			});
		}
		if (channelType === "im") {
			// Approval cards waiting for a usable DM can be delivered now.
			const { rearmApprovalDeliveryForRepairedDestination } =
				await import("@/lib/approvals/delivery/recovery");
			await rearmApprovalDeliveryForRepairedDestination({
				organizationId,
				userId,
				provider: "slack",
			});
		}
	} catch (error) {
		logger.error({ error, userId, channelId }, "Failed to save conversation");
	}
}

/**
 * Get the DM channel ID for a user (for proactive messaging)
 */
export async function getChannelIdForUser(
	userId: string,
	organizationId: string,
	options?: ChatDispatchTargetHint,
): Promise<string | null> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "slack", options);
	if (resolution.kind === "organization_owned_active") {
		const conv = await resolveInstallationConversationForUser({
			organizationId,
			installationId: resolution.target.installationId,
			userId,
			conversationTypes: ["im", "private"],
		});
		return conv?.externalConversationId ?? null;
	}

	const conversation = await db.query.slackConversation.findFirst({
		where: and(
			eq(slackConversation.userId, userId),
			eq(slackConversation.organizationId, organizationId),
			eq(slackConversation.channelType, "im"),
			eq(slackConversation.isActive, true),
		),
		columns: { channelId: true },
	});

	return conversation?.channelId ?? null;
}

/**
 * Get all active DM conversations for an organization.
 * Used by daily digest and broadcast messages.
 */
export async function getOrganizationPrivateConversations(
	organizationId: string,
	options?: ChatDispatchTargetHint,
): Promise<Array<{ userId: string; channelId: string }>> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "slack", options);
	if (resolution.kind === "organization_owned_active") {
		const conversations = await listInstallationActiveConversations({
			organizationId,
			installationId: resolution.target.installationId,
			conversationTypes: ["im", "private"],
		});
		return conversations.map((conv) => ({
			userId: conv.userId,
			channelId: conv.externalConversationId,
		}));
	}

	const conversations = await db.query.slackConversation.findMany({
		where: and(
			eq(slackConversation.organizationId, organizationId),
			eq(slackConversation.channelType, "im"),
			eq(slackConversation.isActive, true),
		),
		columns: { userId: true, channelId: true },
	});

	// Filter to only conversations with a userId
	return conversations.filter((c): c is { userId: string; channelId: string } => c.userId !== null);
}

/**
 * Deactivate a conversation
 */
export async function deactivateConversation(
	channelId: string,
	organizationId: string,
): Promise<void> {
	await db
		.update(slackConversation)
		.set({ isActive: false })
		.where(
			and(
				eq(slackConversation.channelId, channelId),
				eq(slackConversation.organizationId, organizationId),
			),
		);
}
