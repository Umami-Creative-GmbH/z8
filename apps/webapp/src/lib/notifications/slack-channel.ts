/**
 * Slack Notification Channel
 *
 * Handles sending notifications via Slack.
 * Mirrors the Telegram notification channel pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "./types";

const logger = createLogger("SlackChannel");

interface SlackNotificationParams {
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
 * Check if Slack is available for an organization
 */
export async function isSlackAvailable(organizationId: string): Promise<boolean> {
	try {
		const { isSlackEnabledForOrganization } = await import("@/lib/slack");
		return await isSlackEnabledForOrganization(organizationId);
	} catch (error) {
		logger.debug({ error, organizationId }, "Slack availability check failed");
		return false;
	}
}

/**
 * Send a notification via Slack
 */
export async function sendSlackNotification(params: SlackNotificationParams): Promise<void> {
	try {
		const {
			getChannelIdForUser,
			postMessage,
			sendApprovalMessageToManager,
			getBotConfigByOrganization,
		} = await import("@/lib/slack");

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
						botConfig.botAccessToken,
					);
					return;
				}
			}
		}

		// For other notifications, send a simple message
		const channelId = await getChannelIdForUser(params.userId, params.organizationId);
		if (!channelId) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Slack channel found for user",
			);
			return;
		}

		let text = `*${params.title}*\n\n${params.message}`;
		if (params.actionUrl) {
			text += `\n\n<${params.actionUrl}|View in Z8>`;
		}

		await postMessage(botConfig.botAccessToken, {
			channel: channelId,
			text,
		});

		logger.debug({ userId: params.userId, type: params.type }, "Slack notification sent");
	} catch (error) {
		logger.error({ error, params }, "Failed to send Slack notification");
		throw error;
	}
}
