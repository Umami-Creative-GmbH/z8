/**
 * Telegram Approval Handler
 *
 * Handles approve/reject actions from inline keyboard buttons.
 * Sends approval cards to managers via proactive messaging.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee, telegramApprovalMessage } from "@/db/schema";
import { decideBotApproval } from "@/lib/bot-platform/approval-decision";
import { getBotTranslate, getUserLocale } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
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
				const locale = await getUserLocale(userResult.user.userId);
				const t = await getBotTranslate(locale);
				await editMessageText(bot.botToken, {
					chat_id: query.message.chat.id,
					message_id: query.message.message_id,
					text: escapeMarkdownV2(
						t("bot.approval.alreadyProcessed", "This approval has already been processed."),
					),
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

		await decideBotApproval({
			approvalId,
			actorEmployeeId: userResult.user.employeeId,
			organizationId: bot.organizationId,
			action,
			platform: "telegram",
		});

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
			where: and(
				eq(employee.id, userResult.user.employeeId),
				eq(employee.organizationId, bot.organizationId),
			),
			with: { user: { columns: { name: true } } },
		});
		if (!approverEmployee) return;
		const approverName = approverEmployee?.user?.name || "Unknown";

		// Build original card data for resolved message
		const cardData = await buildApprovalCardData(approval, bot.organizationId);

		// Update the message to show resolved status
		if (query.message && cardData) {
			const display = await resolveRecipientDisplayContext({
				userId: userResult.user.userId,
				organizationId: bot.organizationId,
			});
			if (display) {
				const t = await getBotTranslate(display.locale);
				const resolvedText = buildResolvedApprovalMessage(
					cardData,
					{
						action: newStatus,
						approverName,
						resolvedAt: new Date(),
					},
					t,
					display,
				);

				await editMessageText(bot.botToken, {
					chat_id: query.message.chat.id,
					message_id: query.message.message_id,
					text: resolvedText,
					parse_mode: "MarkdownV2",
				});
			}
		}

		// Update approval message record
		const msgRecord = await db.query.telegramApprovalMessage.findFirst({
			where: and(
				eq(telegramApprovalMessage.approvalRequestId, approvalId),
				eq(telegramApprovalMessage.organizationId, bot.organizationId),
			),
		});

		if (msgRecord) {
			await db
				.update(telegramApprovalMessage)
				.set({
					respondedAt: new Date(),
					status: newStatus,
				})
				.where(
					and(
						eq(telegramApprovalMessage.id, msgRecord.id),
						eq(telegramApprovalMessage.organizationId, bot.organizationId),
					),
				);
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

		// Resolve the recipient only after proving this approval belongs to the organization.
		const chatId = await getChatIdForUser(approverEmployee.userId, organizationId);
		if (!chatId) {
			logger.debug({ approverId, organizationId }, "No Telegram chat for approver");
			return;
		}

		// Build card data
		const cardData = await buildApprovalCardData(approval, organizationId);
		if (!cardData) {
			logger.warn({ approvalId }, "Could not build card data");
			return;
		}

		// Build message with inline keyboard (use recipient's locale)
		const display = await resolveRecipientDisplayContext({
			userId: approverEmployee.userId,
			organizationId,
		});
		if (!display) return;
		const t = await getBotTranslate(display.locale);
		const { text, keyboard } = buildApprovalMessage(cardData, t, display);

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
	organizationId: string,
): Promise<ApprovalCardData | null> {
	const requester = await db.query.employee.findFirst({
		where: and(eq(employee.id, approval.requestedBy), eq(employee.organizationId, organizationId)),
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
			where: and(
				eq(absenceEntry.id, approval.entityId),
				eq(absenceEntry.organizationId, organizationId),
			),
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
