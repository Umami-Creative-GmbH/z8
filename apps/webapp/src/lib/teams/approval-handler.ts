import type { TurnContext } from "botbuilder";
import { db } from "@/db";
import { teamsApprovalCard } from "@/db/schema";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import {
	approvalAttemptNotice,
	teamsApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import type { ResolvedTeamsUser, ResolvedTenant } from "./types";
import { TeamsError } from "./types";

const logger = createLogger("TeamsApprovalHandler");

export async function handleApprovalAction(
	context: TurnContext,
	approvalId: string,
	action: "approve" | "reject",
	user: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<void> {
	try {
		const { attemptBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		const result = await attemptBotApproval({
			approvalId,
			actorEmployeeId: user.employeeId,
			organizationId: tenant.organizationId,
			action,
			platform: "teams",
		});
		// Send only the outcome of this authenticated invocation. Do not select
		// another recipient's activity via an approval-only tracking lookup.
		if (result.status !== "review_required" && result.status !== "historical") {
			await context.sendActivity(
				"This approval is unavailable. Open Z8 to review your inbox.",
			);
			return;
		}
		const notice = await approvalAttemptNotice(
			result,
			{ userId: user.userId, organizationId: tenant.organizationId },
			{ kind: "compatibility", approvalRequestId: approvalId },
		);
		if (!notice) return;
		await context.sendActivity({
			type: "message",
			text: notice.title,
			attachments: [
				{
					contentType: "application/vnd.microsoft.card.adaptive",
					content: teamsApprovalNotice(notice),
				},
			],
		});
	} catch (error) {
		logger.error({ error, approvalId }, "Failed to review Teams approval card");
		throw new TeamsError("Failed to review approval", "BOT_ERROR");
	}
}

export async function sendApprovalCardToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		const notice = await prepareApprovalPresentation({
			approvalId,
			recipientEmployeeId: approverId,
			organizationId,
		});
		if (notice.status === "undisclosable") return;
		const { sendAdaptiveCard } = await import("./bot-adapter");
		const { getConversationReferenceForUser } = await import(
			"./conversation-manager"
		);
		const conversation = await getConversationReferenceForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!conversation?.conversation?.id) return;
		const activityId = await sendAdaptiveCard(
			conversation,
			teamsApprovalNotice(notice),
			notice.title,
		);
		if (activityId)
			await db
				.insert(teamsApprovalCard)
				.values({
					approvalRequestId: approvalId,
					organizationId,
					recipientUserId: notice.recipientUserId,
					teamsConversationId: conversation.conversation.id,
					teamsActivityId: activityId,
					teamsMessageId: activityId,
					status: "sent",
				});
	} catch (error) {
		logger.error({ error, approvalId }, "Failed to send Teams approval notice");
	}
}
