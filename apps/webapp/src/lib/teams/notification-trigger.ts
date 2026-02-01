/**
 * Teams Notification Trigger
 *
 * Trigger functions to send Teams notifications when events occur in Z8.
 * These functions check if Teams is enabled and send appropriate notifications.
 */

import { createLogger } from "@/lib/logger";
import { isTeamsEnabledForOrganization, getTenantConfigByOrganization } from "./tenant-resolver";
import { sendApprovalCardToManager } from "./approval-handler";

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
			logger.debug(
				{ organizationId },
				"Teams not enabled, skipping approval notification",
			);
			return;
		}

		// Check if approvals are enabled
		const config = await getTenantConfigByOrganization(organizationId);
		if (!config?.enableApprovals) {
			logger.debug(
				{ organizationId },
				"Teams approvals disabled, skipping notification",
			);
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

/**
 * Trigger Teams notification for approval resolution
 *
 * Call this after an approval is approved/rejected to notify the requester.
 *
 * @param approvalRequestId - The ID of the approval request
 * @param action - The action taken (approved/rejected)
 * @param requesterId - Employee ID of the original requester
 * @param organizationId - Organization ID
 */
export async function triggerApprovalResolutionNotification(
	approvalRequestId: string,
	action: "approved" | "rejected",
	requesterId: string,
	organizationId: string,
): Promise<void> {
	try {
		// Check if Teams is enabled for this org
		const teamsEnabled = await isTeamsEnabledForOrganization(organizationId);
		if (!teamsEnabled) {
			return;
		}

		const config = await getTenantConfigByOrganization(organizationId);
		if (!config?.enableApprovals) {
			return;
		}

		// For now, just log - we can extend this to send a notification to the requester
		// when their request is resolved
		logger.debug(
			{ approvalRequestId, action, requesterId },
			"Approval resolved, Teams notification could be sent to requester",
		);

		// TODO: Implement requester notification if desired
		// This would involve:
		// 1. Get requester's user ID from employee record
		// 2. Get their conversation reference
		// 3. Send a notification message
	} catch (error) {
		logger.error(
			{ error, approvalRequestId, action, organizationId },
			"Failed to trigger Teams resolution notification",
		);
	}
}
