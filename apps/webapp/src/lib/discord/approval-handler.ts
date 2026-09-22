import { db } from "@/db";
import { discordApprovalMessage } from "@/db/schema";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import {
	approvalAttemptNotice,
	discordApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { createLogger } from "@/lib/logger";
import { createInteractionResponse, sendMessage } from "./api";
import { getChannelIdForUser } from "./conversation-manager";
import type {
	ApprovalButtonData,
	DiscordInteraction,
	ResolvedDiscordBot,
} from "./types";
import { InteractionResponseType } from "./types";
import { resolveDiscordUser } from "./user-resolver";

const logger = createLogger("DiscordApprovalHandler");

export async function handleApprovalButtonClick(
	interaction: DiscordInteraction,
	data: ApprovalButtonData,
	discordUserId: string,
	bot: ResolvedDiscordBot,
): Promise<void> {
	const user = await resolveDiscordUser(discordUserId, bot.organizationId);
	if (user.status !== "found") {
		await createInteractionResponse(
			interaction.id,
			interaction.token,
			InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			{ content: "Your Discord account is not linked to Z8.", flags: 64 },
		);
		return;
	}
	try {
		const { attemptBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		const result = await attemptBotApproval({
			approvalId: data.id,
			actorEmployeeId: user.user.employeeId,
			organizationId: bot.organizationId,
			action: data.a === "ap" ? "approve" : "reject",
			platform: "discord",
		});
		// Ephemeral replies target the authenticated invocation, never a first
		// approval-only tracking row or another recipient's message.
		const notice =
			result.status === "review_required" || result.status === "historical"
				? await approvalAttemptNotice(result, {
						userId: user.user.userId,
						organizationId: bot.organizationId,
					})
				: null;
		const content = notice
			? discordApprovalNotice(notice)
			: {
					content:
						"This approval is unavailable. Open Z8 to review your inbox.",
				};
		await createInteractionResponse(
			interaction.id,
			interaction.token,
			InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			{ ...content, flags: 64 },
		);
	} catch (error) {
		logger.error(
			{ error, approvalId: data.id },
			"Failed to review Discord approval card",
		);
	}
}

export async function sendApprovalMessageToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
	botToken: string,
): Promise<void> {
	try {
		const notice = await prepareApprovalPresentation({
			approvalId,
			recipientEmployeeId: approverId,
			organizationId,
		});
		if (notice.status === "undisclosable") return;
		const channelId = await getChannelIdForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!channelId) return;
		const sent = await sendMessage(
			botToken,
			channelId,
			discordApprovalNotice(notice),
		);
		if (sent)
			await db
				.insert(discordApprovalMessage)
				.values({
					approvalRequestId: approvalId,
					organizationId,
					recipientUserId: notice.recipientUserId,
					channelId,
					messageId: sent.id,
					status: "sent",
				});
	} catch (error) {
		logger.error(
			{ error, approvalId },
			"Failed to send Discord approval notice",
		);
	}
}
