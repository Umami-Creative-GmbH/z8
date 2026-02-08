/**
 * Discord Approval Handler
 *
 * Handles approve/reject actions from button interactions.
 * Sends approval cards to managers via proactive DMs.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest, discordApprovalMessage, employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { createInteractionResponse, sendMessage } from "./api";
import { getChannelIdForUser } from "./conversation-manager";
import { buildApprovalEmbed, buildResolvedApprovalEmbed } from "./formatters";
import type {
	ApprovalButtonData,
	ApprovalCardData,
	DiscordInteraction,
	ResolvedDiscordBot,
} from "./types";
import { InteractionResponseType } from "./types";
import { resolveDiscordUser } from "./user-resolver";

const logger = createLogger("DiscordApprovalHandler");

/**
 * Handle approval button click from Discord interaction
 */
export async function handleApprovalButtonClick(
	interaction: DiscordInteraction,
	data: ApprovalButtonData,
	discordUserId: string,
	bot: ResolvedDiscordBot,
): Promise<void> {
	const action = data.a === "ap" ? "approve" : "reject";
	const approvalId = data.id;

	// Resolve user
	const userResult = await resolveDiscordUser(discordUserId, bot.organizationId);
	if (userResult.status !== "found") {
		logger.warn({ discordUserId }, "Unlinked user tried to act on approval");
		await createInteractionResponse(
			interaction.id,
			interaction.token,
			InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			{ content: "Your Discord account is not linked to Z8.", flags: 64 },
		);
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
			await createInteractionResponse(
				interaction.id,
				interaction.token,
				InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				{ content: "This approval request was not found.", flags: 64 },
			);
			return;
		}

		if (approval.status !== "pending") {
			// Update the message to show it's already resolved
			await createInteractionResponse(
				interaction.id,
				interaction.token,
				InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				{ content: "This approval has already been processed.", flags: 64 },
			);
			return;
		}

		// Verify user is the approver
		if (approval.approverId !== userResult.user.employeeId) {
			logger.warn(
				{ approvalId, employeeId: userResult.user.employeeId },
				"Unauthorized approval attempt",
			);
			await createInteractionResponse(
				interaction.id,
				interaction.token,
				InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				{ content: "You are not authorized to act on this approval.", flags: 64 },
			);
			return;
		}

		const newStatus = action === "approve" ? "approved" : "rejected";

		// Update approval request
		await db
			.update(approvalRequest)
			.set({
				status: newStatus,
				approvedAt: new Date(),
				...(newStatus === "rejected" ? { rejectionReason: "Rejected via Discord" } : {}),
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
				action,
				approverId: userResult.user.employeeId,
				organizationId: bot.organizationId,
			},
			"Approval action processed via Discord",
		);

		// Get approver name
		const approverEmployee = await db.query.employee.findFirst({
			where: eq(employee.id, userResult.user.employeeId),
			with: { user: { columns: { name: true } } },
		});
		const approverName = approverEmployee?.user?.name || "Unknown";

		// Build original card data for resolved message
		const cardData = await buildApprovalCardData(approval);

		// Update the message to show resolved status
		if (interaction.message && cardData) {
			const { embeds, components } = buildResolvedApprovalEmbed(cardData, {
				action: newStatus,
				approverName,
				resolvedAt: new Date(),
			});

			// Respond to interaction by updating the message
			await createInteractionResponse(
				interaction.id,
				interaction.token,
				InteractionResponseType.UPDATE_MESSAGE,
				{ embeds, components },
			);
		} else {
			// Fallback: acknowledge with ephemeral message
			const statusText = newStatus === "approved" ? "approved" : "rejected";
			await createInteractionResponse(
				interaction.id,
				interaction.token,
				InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				{ content: `Approval ${statusText} successfully.`, flags: 64 },
			);
		}

		// Update approval message record
		const msgRecord = await db.query.discordApprovalMessage.findFirst({
			where: eq(discordApprovalMessage.approvalRequestId, approvalId),
		});

		if (msgRecord) {
			await db
				.update(discordApprovalMessage)
				.set({
					respondedAt: new Date(),
					status: newStatus,
				})
				.where(eq(discordApprovalMessage.id, msgRecord.id));
		}
	} catch (error) {
		logger.error({ error, approvalId, action }, "Failed to process approval action");
	}
}

/**
 * Send an approval card to a manager via Discord DM.
 * Called when a new approval request is created.
 */
export async function sendApprovalMessageToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
	botToken: string,
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

		// Get DM channel for the approver
		const channelId = await getChannelIdForUser(approverEmployee.userId, organizationId);
		if (!channelId) {
			logger.debug({ approverId, organizationId }, "No Discord DM channel for approver");
			return;
		}

		// Get approval details
		const approval = await db.query.approvalRequest.findFirst({
			where: eq(approvalRequest.id, approvalId),
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

		// Build embed with buttons
		const { embeds, components } = buildApprovalEmbed(cardData);

		// Send message
		const sentMessage = await sendMessage(botToken, channelId, {
			embeds,
			components,
		});

		// Store message record for updates
		if (sentMessage) {
			await db.insert(discordApprovalMessage).values({
				approvalRequestId: approvalId,
				organizationId,
				recipientUserId: approverEmployee.userId,
				channelId,
				messageId: sentMessage.id,
				status: "sent",
			});

			logger.info(
				{ approvalId, approverId, messageId: sentMessage.id },
				"Sent approval message to manager via Discord",
			);
		}
	} catch (error) {
		logger.error({ error, approvalId, approverId }, "Failed to send Discord approval message");
	}
}

/**
 * Build ApprovalCardData from approval request (shared logic)
 */
async function buildApprovalCardData(
	approval: typeof approvalRequest.$inferSelect,
): Promise<ApprovalCardData | null> {
	const requester = await db.query.employee.findFirst({
		where: eq(employee.id, approval.requestedBy),
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
