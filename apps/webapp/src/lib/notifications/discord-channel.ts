/**
 * Discord Notification Channel
 *
 * Handles sending notifications via Discord.
 * Mirrors the Telegram notification channel pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { isAbsenceCardDeliveredByOwner } from "@/lib/approvals/delivery/store";
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
export async function isDiscordAvailable(
	organizationId: string,
): Promise<boolean> {
	try {
		const { isDiscordEnabledForOrganization } = await import("@/lib/discord");
		return await isDiscordEnabledForOrganization(organizationId);
	} catch (error) {
		logger.debug(
			{ error, organizationId },
			"Discord availability check failed",
		);
		return false;
	}
}

/** Whether the approval delivery owner (#292) sends this absence's Discord card. */
function deliveredByApprovalOwner(
	organizationId: string,
	absenceId: string | undefined,
): Promise<boolean> {
	return isAbsenceCardDeliveredByOwner({ organizationId, absenceId, provider: "discord" });
}

/**
 * Send a notification via Discord
 */
export async function sendDiscordNotification(
	params: DiscordNotificationParams,
): Promise<void> {
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

		// One owner per delivery effect: where the approval delivery owner has
		// the absence card, this path sends neither the card nor a plain
		// message about the same request.
		if (
			params.type === "approval_request_submitted" &&
			params.entityType === "absence_entry" &&
			(await deliveredByApprovalOwner(params.organizationId, params.entityId))
		) {
			return;
		}

		// Handle approval-related notifications specially
		if (
			params.type === "approval_request_submitted" &&
			params.entityType === "approval_request"
		) {
			const approval = await db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, params.entityId || ""),
					eq(approvalRequest.organizationId, params.organizationId),
				),
			});

			if (
				approval?.entityType === "absence_entry" &&
				(await deliveredByApprovalOwner(params.organizationId, approval.entityId))
			) {
				return;
			}

			if (approval) {
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, params.userId),
						eq(employee.organizationId, params.organizationId),
						eq(employee.isActive, true),
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
			// Missing approval/recipient evidence must not fall through to raw details.
			return;
		}

		// For other notifications, send a simple embed
		const channelId = await getChannelIdForUser(
			params.userId,
			params.organizationId,
		);
		if (!channelId) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Discord DM channel found for user",
			);
			return;
		}

		const embeds = buildNotificationEmbed(
			params.title,
			params.message,
			params.actionUrl,
		);

		await sendMessage(botConfig.botToken, channelId, { embeds });

		logger.debug(
			{ userId: params.userId, type: params.type },
			"Discord notification sent",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to send Discord notification");
		throw error;
	}
}
