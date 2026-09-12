/**
 * Telegram Notification Trigger
 *
 * Trigger functions to send Telegram notifications when events occur in Z8.
 * Mirrors the Teams notification trigger pattern.
 */

import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "./approval-handler";
import { getBotConfigByOrganization, isTelegramEnabledForOrganization } from "./bot-config";

const logger = createLogger("TelegramNotificationTrigger");

/**
 * Trigger Telegram notification for a new approval request
 */
export async function triggerTelegramApprovalNotification(
	approvalRequestId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		const enabled = await isTelegramEnabledForOrganization(organizationId);
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
			"Failed to trigger Telegram approval notification",
		);
	}
}
