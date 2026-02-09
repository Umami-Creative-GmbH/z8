/**
 * Discord Notification Channel
 *
 * Handles sending notifications via Discord.
 * Mirrors the Telegram notification channel pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "./types";

const logger = createLogger("DiscordChannel");

interface DiscordNotificationParams {
	userId: string;
	organizationId: string;
	type: NotificationType;
	title: string;
	message: string;
	entityType?: string;
	entityId?: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Check if Discord is available for an organization
 */
export async function isDiscordAvailable(organizationId: string): Promise<boolean> {
	try {
		const { isDiscordEnabledForOrganization } = await import("@/lib/discord");
		return await isDiscordEnabledForOrganization(organizationId);
	} catch (error) {
		logger.debug({ error, organizationId }, "Discord availability check failed");
		return false;
	}
}

/**
 * Send a notification via Discord
 */
export async function sendDiscordNotification(params: DiscordNotificationParams): Promise<void> {
	try {
		const {
			getChannelIdForUser,
			sendMessage,
			sendApprovalMessageToManager,
			getBotConfigByOrganization,
		} = await import("@/lib/discord");
		const { buildNotificationEmbed } = await import("@/lib/discord/formatters");

		const botConfig = await getBotConfigByOrganization(params.organizationId);
		if (!botConfig) return;

		// Handle approval-related notifications specially
		if (params.type === "approval_request_submitted" && params.entityType === "approval_request") {
			const approval = await db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, params.entityId || ""),
					eq(approvalRequest.organizationId, params.organizationId),
				),
			});

			if (approval) {
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, params.userId),
						eq(employee.organizationId, params.organizationId),
					),
				});

				if (emp) {
					await sendApprovalMessageToManager(
						approval.id,
						emp.id,
						params.organizationId,
						botConfig.botToken,
					);
					return;
				}
			}
		}

		// For other notifications, send a simple embed
		const channelId = await getChannelIdForUser(params.userId, params.organizationId);
		if (!channelId) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Discord DM channel found for user",
			);
			return;
		}

		const embeds = buildNotificationEmbed(params.title, params.message, params.actionUrl);

		await sendMessage(botConfig.botToken, channelId, { embeds });

		logger.debug({ userId: params.userId, type: params.type }, "Discord notification sent");
	} catch (error) {
		logger.error({ error, params }, "Failed to send Discord notification");
		throw error;
	}
}
