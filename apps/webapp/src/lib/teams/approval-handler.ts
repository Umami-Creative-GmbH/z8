/**
 * Teams Approval Handler
 *
 * Handles approve/reject actions from Teams Adaptive Cards.
 */

import type { TurnContext } from "botbuilder";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
	approvalRequest,
	absenceEntry,
	timeEntry,
	teamsApprovalCard,
	employee,
} from "@/db/schema";
import { user } from "@/db/auth-schema";
import { createLogger } from "@/lib/logger";
import { updateMessage } from "./bot-adapter";
import { getStoredConversation } from "./conversation-manager";
import { buildResolvedApprovalCard } from "./cards";
import { TeamsError } from "./types";
import type { ResolvedTeamsUser, ResolvedTenant, ApprovalCardData } from "./types";

const logger = createLogger("TeamsApprovalHandler");

/**
 * Handle approval action from Teams card
 *
 * @param context - Bot turn context
 * @param approvalId - Approval request ID
 * @param action - Action type (approve/reject)
 * @param user - Resolved Teams user
 * @param tenant - Resolved tenant
 */
export async function handleApprovalAction(
	context: TurnContext,
	approvalId: string,
	action: "approve" | "reject",
	resolvedUser: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<void> {
	try {
		// Get approval request
		const approval = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, approvalId),
				eq(approvalRequest.organizationId, tenant.organizationId),
			),
		});

		if (!approval) {
			throw new TeamsError("Approval not found", "APPROVAL_NOT_FOUND");
		}

		if (approval.status !== "pending") {
			throw new TeamsError("Approval already resolved", "APPROVAL_ALREADY_RESOLVED");
		}

		// Verify user is the approver
		if (approval.approverId !== resolvedUser.employeeId) {
			throw new TeamsError("Not authorized to approve", "NOT_AUTHORIZED");
		}

		const newStatus = action === "approve" ? "approved" : "rejected";

		// Update approval request
		await db
			.update(approvalRequest)
			.set({
				status: newStatus,
				approvedAt: new Date(),
				...(newStatus === "rejected" ? { rejectionReason: "Rejected via Teams" } : {}),
			})
			.where(eq(approvalRequest.id, approvalId));

		// Update the underlying entity status
		if (approval.entityType === "absence_entry") {
			await db
				.update(absenceEntry)
				.set({ status: newStatus })
				.where(eq(absenceEntry.id, approval.entityId));
		}
		// Note: Time entries use the blockchain-style pattern and corrections are handled
		// via supersededBy/replacesEntryId. The approval status is tracked in the
		// approvalRequest table itself.

		logger.info(
			{
				approvalId,
				action,
				approverId: resolvedUser.employeeId,
				organizationId: tenant.organizationId,
			},
			"Approval action processed via Teams",
		);

		// Get approver name
		const approverEmployee = await db.query.employee.findFirst({
			where: eq(employee.id, resolvedUser.employeeId),
			with: {
				user: {
					columns: { name: true },
				},
			},
		});
		const approverName = approverEmployee?.user?.name || "Unknown";

		// Get Teams card record to update it
		const cardRecord = await db.query.teamsApprovalCard.findFirst({
			where: eq(teamsApprovalCard.approvalRequestId, approvalId),
		});

		if (cardRecord && cardRecord.teamsActivityId) {
			// Get conversation reference
			const conversation = await getStoredConversation(
				resolvedUser.userId,
				tenant.organizationId,
			);

			if (conversation) {
				// Build original card data for resolved card
				const originalCardData = await buildApprovalCardData(approval);

				if (originalCardData) {
					// Build resolved card
					const resolvedCard = buildResolvedApprovalCard(originalCardData, {
						action: action === "approve" ? "approved" : "rejected",
						approverName,
						resolvedAt: new Date(),
					});

					// Update the card in Teams
					try {
						await updateMessage(
							conversation.conversationReference,
							cardRecord.teamsActivityId,
							{
								type: "message",
								text: `Approval ${action}d`,
								attachments: [
									{
										contentType: "application/vnd.microsoft.card.adaptive",
										content: resolvedCard,
									},
								],
							},
						);
					} catch (updateError) {
						// Log but don't fail - the action already succeeded
						logger.warn({ error: updateError, approvalId }, "Failed to update Teams card");
					}
				}
			}

			// Update card record
			await db
				.update(teamsApprovalCard)
				.set({
					respondedAt: new Date(),
					status: action === "approve" ? "approved" : "rejected",
				})
				.where(eq(teamsApprovalCard.id, cardRecord.id));
		}

		// Send confirmation message
		await context.sendActivity(
			`Request ${action === "approve" ? "approved" : "rejected"} successfully.`,
		);
	} catch (error) {
		logger.error({ error, approvalId, action }, "Failed to process approval action");

		if (error instanceof TeamsError) {
			throw error;
		}

		throw new TeamsError("Failed to process approval", "BOT_ERROR", {
			originalError: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Build ApprovalCardData from approval request
 */
async function buildApprovalCardData(
	approval: typeof approvalRequest.$inferSelect,
): Promise<ApprovalCardData | null> {
	// Get requester info
	const requester = await db.query.employee.findFirst({
		where: eq(employee.id, approval.requestedBy),
		with: {
			user: {
				columns: { name: true, email: true },
			},
		},
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
		const absence = await db.query.absenceEntry.findFirst({
			where: eq(absenceEntry.id, approval.entityId),
			with: {
				category: {
					columns: { name: true },
				},
			},
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
	} else if (approval.entityType === "time_entry") {
		const entry = await db.query.timeEntry.findFirst({
			where: eq(timeEntry.id, approval.entityId),
		});

		if (entry) {
			return {
				...baseData,
				originalTime: entry.timestamp?.toISOString(),
				correctedTime: entry.notes || undefined,
			};
		}
	}

	return baseData;
}

/**
 * Send approval card to a manager
 *
 * Called when a new approval request is created.
 *
 * @param approvalId - Approval request ID
 * @param approverId - Employee ID of the approver
 * @param organizationId - Organization ID
 */
export async function sendApprovalCardToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	const { sendAdaptiveCard } = await import("./bot-adapter");
	const { getConversationReferenceForUser } = await import("./conversation-manager");
	const { buildApprovalCardWithInvoke } = await import("./cards");

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

		// Get conversation reference
		const conversationRef = await getConversationReferenceForUser(
			approverEmployee.userId,
			organizationId,
		);

		if (!conversationRef) {
			logger.debug({ approverId, organizationId }, "No Teams conversation for approver");
			return;
		}

		// Get approval details
		const approval = await db.query.approvalRequest.findFirst({
			where: eq(approvalRequest.id, approvalId),
		});

		if (!approval) {
			logger.warn({ approvalId }, "Approval not found when sending card");
			return;
		}

		// Build card data
		const cardData = await buildApprovalCardData(approval);
		if (!cardData) {
			logger.warn({ approvalId }, "Could not build card data");
			return;
		}

		// Build and send card
		const card = buildApprovalCardWithInvoke(cardData);
		const activityId = await sendAdaptiveCard(
			conversationRef,
			card,
			`New approval request from ${cardData.requesterName}`,
		);

		// Store card record
		if (activityId) {
			await db.insert(teamsApprovalCard).values({
				approvalRequestId: approvalId,
				organizationId,
				recipientUserId: approverEmployee.userId,
				teamsConversationId: conversationRef.conversation?.id || "",
				teamsActivityId: activityId,
				teamsMessageId: activityId, // In Bot Framework, activity ID serves as message ID
				status: "sent",
			});

			logger.info(
				{ approvalId, approverId, activityId },
				"Sent approval card to manager via Teams",
			);
		}
	} catch (error) {
		logger.error({ error, approvalId, approverId }, "Failed to send approval card to manager");
	}
}
