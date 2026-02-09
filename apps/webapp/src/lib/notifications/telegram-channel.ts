/**
 * Telegram Notification Channel
 *
 * Handles sending notifications via Telegram.
 * Mirrors the Teams notification channel pattern.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { employee, approvalRequest } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "./types";

const logger = createLogger("TelegramChannel");

interface TelegramNotificationParams {
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
 * Check if Telegram is available for an organization
 */
export async function isTelegramAvailable(organizationId: string): Promise<boolean> {
	try {
		const { isTelegramEnabledForOrganization } = await import("@/lib/telegram");
		return await isTelegramEnabledForOrganization(organizationId);
	} catch (error) {
		logger.debug({ error, organizationId }, "Telegram availability check failed");
		return false;
	}
}

/**
 * Send a notification via Telegram
 */
export async function sendTelegramNotification(params: TelegramNotificationParams): Promise<void> {
	try {
		const {
			getChatIdForUser,
			sendMessage,
			sendApprovalMessageToManager,
			getBotConfigByOrganization,
		} = await import("@/lib/telegram");
		const { escapeMarkdownV2 } = await import("@/lib/telegram/formatters");

		const botConfig = await getBotConfigByOrganization(params.organizationId);
		if (!botConfig) return;

		// Handle approval-related notifications specially
		if (params.type === "approval_request_submitted" && params.entityType === "approval_request") {
			const approval = await db.query.approvalRequest.findFirst({
				where: eq(approvalRequest.id, params.entityId || ""),
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

		// For other notifications, send a simple message
		const chatId = await getChatIdForUser(params.userId, params.organizationId);
		if (!chatId) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Telegram chat found for user",
			);
			return;
		}

		let text = `*${escapeMarkdownV2(params.title)}*\n\n${escapeMarkdownV2(params.message)}`;
		if (params.actionUrl) {
			text += `\n\n[View in Z8](${escapeMarkdownV2(params.actionUrl)})`;
		}

		await sendMessage(botConfig.botToken, {
			chat_id: chatId,
			text,
			parse_mode: "MarkdownV2",
		});

		logger.debug(
			{ userId: params.userId, type: params.type },
			"Telegram notification sent",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to send Telegram notification");
		throw error;
	}
}
