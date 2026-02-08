/**
 * Telegram Approval Handler
 *
 * Handles approve/reject actions from inline keyboard buttons.
 * Sends approval cards to managers via proactive messaging.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceEntry, approvalRequest, employee, telegramApprovalMessage } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { editMessageText, sendMessage } from "./api";
import { getChatIdForUser } from "./conversation-manager";
import { buildApprovalMessage, buildResolvedApprovalMessage, escapeMarkdownV2 } from "./formatters";
import type {
	ApprovalCallbackData,
	ApprovalCardData,
	ResolvedTelegramBot,
	TelegramCallbackQuery,
} from "./types";
import { resolveTelegramUser } from "./user-resolver";

const logger = createLogger("TelegramApprovalHandler");

/**
 * Handle approval callback from inline keyboard
 */
export async function handleApprovalCallback(
	query: TelegramCallbackQuery,
	data: ApprovalCallbackData,
	telegramUserId: string,
	bot: ResolvedTelegramBot,
): Promise<void> {
	const action = data.a === "ap" ? "approve" : "reject";
	const approvalId = data.id;

	// Resolve user
	const userResult = await resolveTelegramUser(telegramUserId, bot.organizationId);
	if (userResult.status !== "found") {
		logger.warn({ telegramUserId }, "Unlinked user tried to act on approval");
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
			if (query.message) {
				await editMessageText(bot.botToken, {
					chat_id: query.message.chat.id,
					message_id: query.message.message_id,
					text: escapeMarkdownV2("This approval has already been processed."),
					parse_mode: "MarkdownV2",
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

		const newStatus = action === "approve" ? "approved" : "rejected";

		// Update approval request
		await db
			.update(approvalRequest)
			.set({
				status: newStatus,
				approvedAt: new Date(),
				...(newStatus === "rejected" ? { rejectionReason: "Rejected via Telegram" } : {}),
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
			"Approval action processed via Telegram",
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
		if (query.message && cardData) {
			const resolvedText = buildResolvedApprovalMessage(cardData, {
				action: newStatus,
				approverName,
				resolvedAt: new Date(),
			});

			await editMessageText(bot.botToken, {
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				text: resolvedText,
				parse_mode: "MarkdownV2",
			});
		}

		// Update approval message record
		const msgRecord = await db.query.telegramApprovalMessage.findFirst({
			where: eq(telegramApprovalMessage.approvalRequestId, approvalId),
		});

		if (msgRecord) {
			await db
				.update(telegramApprovalMessage)
				.set({
					respondedAt: new Date(),
					status: newStatus,
				})
				.where(eq(telegramApprovalMessage.id, msgRecord.id));
		}
	} catch (error) {
		logger.error({ error, approvalId, action }, "Failed to process approval action");
	}
}

/**
 * Send an approval card to a manager via Telegram.
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

		// Get chat ID for the approver
		const chatId = await getChatIdForUser(approverEmployee.userId, organizationId);
		if (!chatId) {
			logger.debug({ approverId, organizationId }, "No Telegram chat for approver");
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

		// Build message with inline keyboard
		const { text, keyboard } = buildApprovalMessage(cardData);

		// Send message
		const sentMessage = await sendMessage(botToken, {
			chat_id: chatId,
			text,
			parse_mode: "MarkdownV2",
			reply_markup: keyboard,
		});

		// Store message record for updates
		if (sentMessage) {
			await db.insert(telegramApprovalMessage).values({
				approvalRequestId: approvalId,
				organizationId,
				recipientUserId: approverEmployee.userId,
				chatId,
				messageId: String(sentMessage.message_id),
				status: "sent",
			});

			logger.info(
				{ approvalId, approverId, messageId: sentMessage.message_id },
				"Sent approval message to manager via Telegram",
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
