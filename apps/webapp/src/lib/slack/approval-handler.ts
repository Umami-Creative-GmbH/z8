/**
 * Slack Approval Handler
 *
 * Handles approve/reject actions from Block Kit buttons.
 * Sends approval cards to managers via proactive messaging.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest, employee, slackApprovalMessage } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { openConversation, postMessage, updateMessage } from "./api";
import { getChannelIdForUser } from "./conversation-manager";
import { buildApprovalBlocks, buildResolvedApprovalBlocks } from "./formatters";
import type { ApprovalCardData, ResolvedSlackBot, SlackInteractionPayload } from "./types";
import { resolveSlackUser } from "./user-resolver";

const logger = createLogger("SlackApprovalHandler");

/**
 * Handle approval action from Block Kit button
 */
export async function handleApprovalAction(
	payload: SlackInteractionPayload,
	action: { action_id: string; value?: string },
	slackUserId: string,
	bot: ResolvedSlackBot,
): Promise<void> {
	const approvalAction = action.action_id === "approval_approve" ? "approve" : "reject";
	const approvalId = action.value;

	if (!approvalId) return;

	// Resolve user
	const userResult = await resolveSlackUser(slackUserId, bot.slackTeamId);
	if (userResult.status !== "found") {
		logger.warn({ slackUserId }, "Unlinked user tried to act on approval");
		return;
	}

	try {
		// Get approval request
		const approval = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, approvalId),
				eq(approvalRequest.organizationId, bot.organizationId),
			),
		});

		if (!approval) {
			logger.warn({ approvalId }, "Approval not found");
			return;
		}

		if (approval.status !== "pending") {
			// Update the message to show it's already resolved
			if (payload.channel && payload.message) {
				await updateMessage(bot.botAccessToken, {
					channel: payload.channel.id,
					ts: payload.message.ts,
					text: "This approval has already been processed.",
				});
			}
			return;
		}

		// Verify user is the approver
		if (approval.approverId !== userResult.user.employeeId) {
			logger.warn(
				{ approvalId, employeeId: userResult.user.employeeId },
				"Unauthorized approval attempt",
			);
			return;
		}

		const newStatus = approvalAction === "approve" ? "approved" : "rejected";

		// Update approval request
		await db
			.update(approvalRequest)
			.set({
				status: newStatus,
				approvedAt: new Date(),
				...(newStatus === "rejected" ? { rejectionReason: "Rejected via Slack" } : {}),
			})
			.where(eq(approvalRequest.id, approvalId));

		// Update the underlying entity status
		if (approval.entityType === "absence_entry") {
			await db
				.update(absenceEntry)
				.set({ status: newStatus })
				.where(eq(absenceEntry.id, approval.entityId));
		}

		logger.info(
			{
				approvalId,
				action: approvalAction,
				approverId: userResult.user.employeeId,
				organizationId: bot.organizationId,
			},
			"Approval action processed via Slack",
		);

		// Get approver name
		const approverEmployee = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, userResult.user.employeeId),
				eq(employee.organizationId, bot.organizationId),
			),
			with: { user: { columns: { name: true } } },
		});
		const approverName = approverEmployee?.user?.name || "Unknown";

		// Build original card data for resolved message
		const cardData = await buildApprovalCardData(approval);

		// Update the message to show resolved status
		if (payload.channel && payload.message && cardData) {
			const { blocks, text } = buildResolvedApprovalBlocks(cardData, {
				action: newStatus,
				approverName,
				resolvedAt: new Date(),
			});

			await updateMessage(bot.botAccessToken, {
				channel: payload.channel.id,
				ts: payload.message.ts,
				text,
				blocks,
			});
		}

		// Update approval message record
		const msgRecord = await db.query.slackApprovalMessage.findFirst({
			where: eq(slackApprovalMessage.approvalRequestId, approvalId),
		});

		if (msgRecord) {
			await db
				.update(slackApprovalMessage)
				.set({
					respondedAt: new Date(),
					status: newStatus,
				})
				.where(eq(slackApprovalMessage.id, msgRecord.id));
		}
	} catch (error) {
		logger.error(
			{ error, approvalId, action: approvalAction },
			"Failed to process approval action",
		);
	}
}

/**
 * Send an approval card to a manager via Slack.
 * Called when a new approval request is created.
 */
export async function sendApprovalMessageToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
	botAccessToken: string,
): Promise<void> {
	try {
		// Get approver's user ID
		const approverEmployee = await db.query.employee.findFirst({
			where: and(eq(employee.id, approverId), eq(employee.organizationId, organizationId)),
			columns: { userId: true },
		});

		if (!approverEmployee?.userId) {
			logger.debug({ approverId }, "Approver has no user ID");
			return;
		}

		// Get channel ID for the approver (try stored conversation first, then open DM)
		let channelId = await getChannelIdForUser(approverEmployee.userId, organizationId);

		if (!channelId) {
			// Try to look up their Slack user ID and open a DM
			const { slackUserMapping } = await import("@/db/schema");
			const mapping = await db.query.slackUserMapping.findFirst({
				where: and(
					eq(slackUserMapping.userId, approverEmployee.userId),
					eq(slackUserMapping.organizationId, organizationId),
					eq(slackUserMapping.isActive, true),
				),
			});

			if (mapping) {
				channelId = await openConversation(botAccessToken, mapping.slackUserId);
			}
		}

		if (!channelId) {
			logger.debug({ approverId, organizationId }, "No Slack channel for approver");
			return;
		}

		// Get approval details
		const approval = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, approvalId),
				eq(approvalRequest.organizationId, organizationId),
			),
		});

		if (!approval) {
			logger.warn({ approvalId }, "Approval not found when sending message");
			return;
		}

		// Build card data
		const cardData = await buildApprovalCardData(approval);
		if (!cardData) {
			logger.warn({ approvalId }, "Could not build card data");
			return;
		}

		// Build Block Kit message
		const { blocks, text } = buildApprovalBlocks(cardData);

		// Send message
		const sentMessage = await postMessage(botAccessToken, {
			channel: channelId,
			text,
			blocks,
		});

		// Store message record for updates
		if (sentMessage) {
			await db.insert(slackApprovalMessage).values({
				approvalRequestId: approvalId,
				organizationId,
				recipientUserId: approverEmployee.userId,
				channelId,
				messageTs: sentMessage.ts,
				status: "sent",
			});

			logger.info(
				{ approvalId, approverId, messageTs: sentMessage.ts },
				"Sent approval message to manager via Slack",
			);
		}
	} catch (error) {
		logger.error({ error, approvalId, approverId }, "Failed to send approval message");
	}
}

/**
 * Build ApprovalCardData from approval request (shared logic)
 */
async function buildApprovalCardData(
	approval: typeof approvalRequest.$inferSelect,
): Promise<ApprovalCardData | null> {
	const requester = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, approval.requestedBy),
			eq(employee.organizationId, approval.organizationId),
		),
		with: { user: { columns: { name: true, email: true } } },
	});

	if (!requester) return null;

	const baseData: ApprovalCardData = {
		approvalId: approval.id,
		entityType: approval.entityType as "absence_entry" | "time_entry",
		requesterName: requester.user?.name || "Unknown",
		requesterEmail: requester.user?.email,
		createdAt: approval.createdAt,
	};

	if (approval.entityType === "absence_entry") {
		const { absenceEntry } = await import("@/db/schema");
		const absence = await db.query.absenceEntry.findFirst({
			where: eq(absenceEntry.id, approval.entityId),
			with: { category: { columns: { name: true } } },
		});

		if (absence) {
			return {
				...baseData,
				absenceCategory: absence.category?.name,
				startDate: absence.startDate,
				endDate: absence.endDate,
				reason: absence.notes || undefined,
			};
		}
	}

	return baseData;
}
