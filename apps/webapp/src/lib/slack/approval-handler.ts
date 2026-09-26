import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { slackApprovalMessage, slackUserMapping } from "@/db/schema";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import { approvalAttemptNotice } from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import { openConversation, postMessage, updateMessage } from "./api";
import { slackApprovalCard } from "./approval-card";
import { getChannelIdForUser } from "./conversation-manager";
import type { ResolvedSlackBot, SlackInteractionPayload } from "./types";
import { resolveSlackUser } from "./user-resolver";

const logger = createLogger("SlackApprovalHandler");

/**
 * A press on a legacy Slack approval card. Slack has no established
 * per-invocation identity (#261), so a fresh press never decides: no
 * `action_ts` composite, card value, payload hash or receive-time ID reaches
 * a decision. Only supported historical replay, verified against the
 * committed result, is reported; everything else gets authenticated review.
 * Cards sent by the delivery owner carry no decision controls at all.
 */
export async function handleApprovalAction(
	payload: SlackInteractionPayload,
	action: { action_id: string; value?: string },
	slackUserId: string,
	bot: ResolvedSlackBot,
): Promise<void> {
	if (
		!action.value ||
		!["approval_approve", "approval_reject"].includes(action.action_id)
	)
		return;
	const user = await resolveSlackUser(slackUserId, bot.slackTeamId);
	if (user.status !== "found") return;
	try {
		const { attemptBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		const result = await attemptBotApproval({
			approvalId: action.value,
			actorEmployeeId: user.user.employeeId,
			organizationId: bot.organizationId,
			action: action.action_id === "approval_approve" ? "approve" : "reject",
			platform: "slack",
		});
		if (result.status !== "review_required" && result.status !== "historical")
			return;
		if (!payload.channel || !payload.message) return;
		const tracked = await db.query.slackApprovalMessage.findFirst({
			where: and(
				eq(slackApprovalMessage.organizationId, bot.organizationId),
				eq(slackApprovalMessage.approvalRequestId, action.value),
				eq(slackApprovalMessage.recipientUserId, user.user.userId),
				eq(slackApprovalMessage.channelId, payload.channel.id),
				eq(slackApprovalMessage.messageTs, payload.message.ts),
			),
		});
		if (!tracked) return;
		const notice = await approvalAttemptNotice(
			result,
			{ userId: user.user.userId, organizationId: bot.organizationId },
			{ kind: "compatibility", approvalRequestId: tracked.approvalRequestId },
		);
		if (!notice) return;
		await updateMessage(bot.botAccessToken, {
			channel: tracked.channelId,
			ts: tracked.messageTs,
			...slackApprovalCard(notice),
		});
	} catch (error) {
		logger.error(
			{ error, approvalId: action.value },
			"Failed to review Slack approval card",
		);
	}
}

export async function sendApprovalMessageToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
	botAccessToken: string,
): Promise<void> {
	try {
		const notice = await prepareApprovalPresentation({
			approvalId,
			recipientEmployeeId: approverId,
			organizationId,
		});
		if (notice.status === "undisclosable") return;
		let channelId = await getChannelIdForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!channelId) {
			const mapping = await db.query.slackUserMapping.findFirst({
				where: and(
					eq(slackUserMapping.userId, notice.recipientUserId),
					eq(slackUserMapping.organizationId, organizationId),
					eq(slackUserMapping.isActive, true),
				),
			});
			if (mapping)
				channelId = await openConversation(botAccessToken, mapping.slackUserId);
		}
		if (!channelId) return;
		const sent = await postMessage(botAccessToken, {
			channel: channelId,
			...slackApprovalCard(notice),
		});
		if (sent)
			await db
				.insert(slackApprovalMessage)
				.values({
					approvalRequestId: approvalId,
					organizationId,
					recipientUserId: notice.recipientUserId,
					channelId,
					messageTs: sent.ts,
					status: "sent",
				});
	} catch (error) {
		logger.error({ error, approvalId }, "Failed to send Slack approval notice");
	}
}
