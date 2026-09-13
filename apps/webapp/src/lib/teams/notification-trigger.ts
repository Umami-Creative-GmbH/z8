/**
 * Teams Notification Trigger
 *
 * Trigger functions to send Teams notifications when events occur in Z8.
 * These functions check if Teams is enabled and send appropriate notifications.
 */

import { createLogger } from "@/lib/logger";
import { sendApprovalCardToManager } from "./approval-handler";
import { getTenantConfigByOrganization, isTeamsEnabledForOrganization } from "./tenant-resolver";

const logger = createLogger("TeamsNotificationTrigger");

/**
 * Trigger Teams notification for a new approval request
 *
 * Call this after creating an approval request to send a Teams card to the approver.
 *
 * @param approvalRequestId - The ID of the approval request
 * @param approverId - Employee ID of the approver
 * @param organizationId - Organization ID
 */
export async function triggerApprovalNotification(
	approvalRequestId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		// Check if Teams is enabled for this org
		const teamsEnabled = await isTeamsEnabledForOrganization(organizationId);
		if (!teamsEnabled) {
			logger.debug({ organizationId }, "Teams not enabled, skipping approval notification");
			return;
		}

		// Check if approvals are enabled
		const config = await getTenantConfigByOrganization(organizationId);
		if (!config?.enableApprovals) {
			logger.debug({ organizationId }, "Teams approvals disabled, skipping notification");
			return;
		}

		// Send the approval card
		await sendApprovalCardToManager(approvalRequestId, approverId, organizationId);
	} catch (error) {
		// Log but don't fail - Teams notification is supplementary
		logger.error(
			{ error, approvalRequestId, approverId, organizationId },
			"Failed to trigger Teams approval notification",
		);
	}
}
