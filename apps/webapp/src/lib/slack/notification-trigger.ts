/**
 * Slack Notification Trigger
 *
 * Trigger functions to send Slack notifications when events occur in Z8.
 * Mirrors the Telegram notification trigger pattern.
 */

import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "./approval-handler";
import { getBotConfigByOrganization, isSlackEnabledForOrganization } from "./bot-config";

const logger = createLogger("SlackNotificationTrigger");

/**
 * Trigger Slack notification for a new approval request
 */
export async function triggerSlackApprovalNotification(
	approvalRequestId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		const enabled = await isSlackEnabledForOrganization(organizationId);
		if (!enabled) return;

		const config = await getBotConfigByOrganization(organizationId);
		if (!config?.enableApprovals) return;

		await sendApprovalMessageToManager(
			approvalRequestId,
			approverId,
			organizationId,
			config.botAccessToken,
		);
	} catch (error) {
		logger.error(
			{ error, approvalRequestId, approverId, organizationId },
			"Failed to trigger Slack approval notification",
		);
	}
}

/**
 * Trigger Slack notification for approval resolution
 */
export async function triggerSlackApprovalResolutionNotification(
	approvalRequestId: string,
	action: "approved" | "rejected",
	requesterId: string,
	organizationId: string,
): Promise<void> {
	try {
		const enabled = await isSlackEnabledForOrganization(organizationId);
		if (!enabled) return;

		// TODO: Implement requester notification
		logger.debug(
			{ approvalRequestId, action, requesterId },
			"Approval resolved, Slack notification could be sent to requester",
		);
	} catch (error) {
		logger.error(
			{ error, approvalRequestId, action, organizationId },
			"Failed to trigger Slack resolution notification",
		);
	}
}
