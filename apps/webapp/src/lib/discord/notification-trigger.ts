/**
 * Discord Notification Trigger
 *
 * Trigger functions to send Discord notifications when events occur in Z8.
 * Mirrors the Telegram notification trigger pattern.
 */

import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "./approval-handler";
import { getBotConfigByOrganization, isDiscordEnabledForOrganization } from "./bot-config";

const logger = createLogger("DiscordNotificationTrigger");

/**
 * Trigger Discord notification for a new approval request
 */
export async function triggerDiscordApprovalNotification(
	approvalRequestId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		const enabled = await isDiscordEnabledForOrganization(organizationId);
		if (!enabled) return;

		const config = await getBotConfigByOrganization(organizationId);
		if (!config?.enableApprovals) return;

		await sendApprovalMessageToManager(
			approvalRequestId,
			approverId,
			organizationId,
			config.botToken,
		);
	} catch (error) {
		logger.error(
			{ error, approvalRequestId, approverId, organizationId },
			"Failed to trigger Discord approval notification",
		);
	}
}

/**
 * Trigger Discord notification for approval resolution
 */
export async function triggerDiscordApprovalResolutionNotification(
	approvalRequestId: string,
	action: "approved" | "rejected",
	requesterId: string,
	organizationId: string,
): Promise<void> {
	try {
		const enabled = await isDiscordEnabledForOrganization(organizationId);
		if (!enabled) return;

		// TODO: Implement requester notification
		logger.debug(
			{ approvalRequestId, action, requesterId },
			"Approval resolved, Discord notification could be sent to requester",
		);
	} catch (error) {
		logger.error(
			{ error, approvalRequestId, action, organizationId },
			"Failed to trigger Discord resolution notification",
		);
	}
}
