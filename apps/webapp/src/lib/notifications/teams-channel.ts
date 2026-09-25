/**
 * Teams Notification Channel
 *
 * Handles sending notifications via Microsoft Teams.
 * Integrates with the Teams bot module for proactive messaging.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { isAbsenceCardDeliveredByOwner } from "@/lib/approvals/delivery/store";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "./types";

const logger = createLogger("TeamsChannel");

interface TeamsNotificationParams {
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
 * Check if Teams is available for an organization
 */
export async function isTeamsAvailable(
	organizationId: string,
): Promise<boolean> {
	try {
		// Dynamically import to avoid circular dependencies
		const { isTeamsEnabledForOrganization, isBotConfigured } = await import(
			"@/lib/teams"
		);

		// Bot must be configured at the system level
		if (!isBotConfigured()) {
			return false;
		}

		// Organization must have Teams enabled
		return await isTeamsEnabledForOrganization(organizationId);
	} catch (error) {
		logger.debug({ error, organizationId }, "Teams availability check failed");
		return false;
	}
}

/**
 * Send a notification via Teams
 *
 * For approval-related notifications, this sends an interactive Adaptive Card.
 * For other notifications, this sends a simple text message.
 */
export async function sendTeamsNotification(
	params: TeamsNotificationParams,
): Promise<void> {
	try {
		// Dynamically import Teams module to avoid circular dependencies
		const {
			getConversationReferenceForUser,
			sendProactiveMessage,
			sendApprovalCardToManager,
		} = await import("@/lib/teams");

		// One owner per delivery effect (#293): where the approval delivery owner
		// has the absence card, this path sends neither the card nor a plain
		// message about the same request.
		if (
			params.type === "approval_request_submitted" &&
			params.entityType === "absence_entry" &&
			(await isAbsenceCardDeliveredByOwner({
				organizationId: params.organizationId,
				absenceId: params.entityId,
				provider: "teams",
			}))
		) {
			return;
		}

		// Handle approval-related notifications specially
		if (
			params.type === "approval_request_submitted" &&
			params.entityType === "approval_request"
		) {
			// Get the approval request details
			const approval = await db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, params.entityId || ""),
					eq(approvalRequest.organizationId, params.organizationId),
				),
			});

			if (
				approval?.entityType === "absence_entry" &&
				(await isAbsenceCardDeliveredByOwner({
					organizationId: params.organizationId,
					absenceId: approval.entityId,
					provider: "teams",
				}))
			) {
				return;
			}

			if (approval) {
				// Get employee ID from user ID
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, params.userId),
						eq(employee.organizationId, params.organizationId),
						eq(employee.isActive, true),
					),
				});

				if (emp) {
					// Send approval card
					await sendApprovalCardToManager(
						approval.id,
						emp.id,
						params.organizationId,
					);
					return;
				}
			}
			// Missing approval/recipient evidence must not fall through to raw details.
			return;
		}

		// For other notifications, send a simple message
		const conversationRef = await getConversationReferenceForUser(
			params.userId,
			params.organizationId,
		);

		if (!conversationRef) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Teams conversation found for user",
			);
			return;
		}

		// Build message text
		let text = `**${params.title}**\n\n${params.message}`;
		if (params.actionUrl) {
			text += `\n\n[View in Z8](${params.actionUrl})`;
		}

		await sendProactiveMessage(conversationRef, {
			type: "message",
			text,
		});

		logger.debug(
			{ userId: params.userId, type: params.type },
			"Teams notification sent",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to send Teams notification");
		throw error;
	}
}
