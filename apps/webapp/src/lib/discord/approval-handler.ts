import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordApprovalMessage } from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	type ApprovalDeliveryMessageRecord,
	approvalDeliveryMessageReviewReference,
	findApprovalDeliveryMessageByRemoteIdentity,
	isApprovalDeliveryMessagePending,
	markApprovalDeliveryMessageWithoutControls,
} from "@/lib/approvals/delivery/store";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import type { ApprovalReviewReference } from "@/lib/approvals/presentation/review-navigation";
import type { BoundBotApprovalResult } from "@/lib/bot-platform/approval-decision";
import {
	type ApprovalNotice,
	approvalAttemptNotice,
	boundDecisionNotice,
	discordApprovalNotice,
	escapeDiscordMarkdown,
} from "@/lib/bot-platform/approval-notice";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import {
	createFollowupMessage,
	createInteractionResponse,
	editMessage,
	sendMessage,
} from "./api";
import { discordActionableCard, fitsDiscordMessage } from "./approval-card";
import { discordInvocationEnvelope, discordReceiverScope } from "./bound-approval";
import { resolveApprovalDMChannel } from "./conversation-manager";
import type {
	ApprovalButtonData,
	DiscordInteraction,
	DiscordMessagePayload,
	ResolvedDiscordBot,
} from "./types";
import { InteractionResponseType } from "./types";
import { resolveDiscordUser } from "./user-resolver";

const EPHEMERAL = 64;

const logger = createLogger("DiscordApprovalHandler");

/** Legacy unbound card: historical-only matching, never a fresh decision. */
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
			{ content: "Your Discord account is not linked to Z8.", flags: EPHEMERAL },
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
				? await approvalAttemptNotice(
						result,
						{ userId: user.user.userId, organizationId: bot.organizationId },
						{ kind: "compatibility", approvalRequestId: data.id },
					)
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
			{ ...content, flags: EPHEMERAL },
		);
	} catch (error) {
		logger.error(
			{ error, approvalId: data.id },
			"Failed to review Discord approval card",
		);
	}
}

/**
 * A bound card action (#292). The individual interaction ID, scoped to the
 * authenticated application, and the card's binding go through the shared
 * attempt into the authoritative decision. The deferred acknowledgment is
 * protocol handling within Discord's three seconds and proves nothing; the
 * ephemeral follow-up reports only a committed or verified outcome. Nothing is
 * decided when the acknowledgment failed: Discord then shows the press as
 * failed, and a decision the recipient never hears of must not commit. Message
 * updates are best effort and cannot change a committed decision.
 */
export async function handleBoundApprovalInteraction(
	interaction: DiscordInteraction,
	callback: { action: "approve" | "reject"; bindingId: string },
	bot: ResolvedDiscordBot,
): Promise<void> {
	const acknowledged = await createInteractionResponse(
		interaction.id,
		interaction.token,
		InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		{ flags: EPHEMERAL },
	);
	if (!acknowledged) return;
	const reply = await decideBoundInteraction(interaction, callback, bot);
	try {
		await createFollowupMessage(bot.botToken, bot.applicationId, interaction.token, {
			...reply,
			flags: EPHEMERAL,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: bot.organizationId },
			"Failed to report bound Discord approval outcome",
		);
	}
}

async function decideBoundInteraction(
	interaction: DiscordInteraction,
	callback: { action: "approve" | "reject"; bindingId: string },
	bot: ResolvedDiscordBot,
): Promise<DiscordMessagePayload> {
	const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
	const user = discordUserId
		? await resolveDiscordUser(discordUserId, bot.organizationId)
		: null;
	if (user?.status !== "found") {
		return { content: "Your Discord account is not linked to Z8." };
	}
	const recipient = { userId: user.user.userId, organizationId: bot.organizationId };
	let result: BoundBotApprovalResult;
	try {
		const { attemptBoundBotApproval } = await import(
			"@/lib/bot-platform/approval-decision"
		);
		result = await attemptBoundBotApproval({
			organizationId: bot.organizationId,
			actorEmployeeId: user.user.employeeId,
			actorUserId: user.user.userId,
			bindingId: callback.bindingId,
			action: callback.action,
			platform: "discord",
			invocation: discordInvocationEnvelope(bot.applicationId, interaction),
		});
	} catch (error) {
		// Outcome unknown: claim nothing. The same interaction replays the
		// committed result if the decision did commit.
		logger.error(
			{ error, bindingId: callback.bindingId },
			"Failed to decide bound Discord approval",
		);
		return outcomeUnknownReply(recipient);
	}
	let notice: ApprovalNotice | null;
	try {
		notice = await updateClickedCard(interaction, result, bot, recipient);
	} catch (error) {
		// The outcome is known; only the card could not be looked up or updated.
		logger.error(
			{ error, bindingId: callback.bindingId, status: result.status },
			"Failed to update bound Discord approval card",
		);
		notice =
			result.status === "decided" && result.evidence.assignmentId
				? await boundDecisionNotice(result, recipient, {
						kind: "canonical",
						assignmentId: result.evidence.assignmentId,
					}).catch(() => null)
				: null;
	}
	return notice
		? discordApprovalNotice(notice)
		: { content: "This approval is unavailable. Open Z8 to review your inbox." };
}

async function outcomeUnknownReply(recipient: {
	userId: string;
	organizationId: string;
}): Promise<DiscordMessagePayload> {
	const display = await resolveRecipientDisplayContext(recipient).catch(() => null);
	const t = await getBotTranslate(display?.locale ?? "en");
	return {
		content: escapeDiscordMarkdown(
			t(
				"bot.approval.outcomeUnknown",
				"The outcome of this action could not be confirmed. Review the request in Z8 before trying again.",
			),
		),
		allowed_mentions: { parse: [] },
	};
}

/**
 * The notice for the clicked card, and its update. A card sent by the delivery
 * owner (#291) whose assignment or request is no longer pending is left to
 * the owner, which refreshes every message of the lifecycle from the committed
 * intent; a still-pending card whose action decided nothing becomes a review
 * notice. A legacy-tracked card is edited here as before.
 */
async function updateClickedCard(
	interaction: DiscordInteraction,
	result: BoundBotApprovalResult,
	bot: ResolvedDiscordBot,
	recipient: { userId: string; organizationId: string },
): Promise<ApprovalNotice | null> {
	const messageId = interaction.message?.id;
	const channelId = interaction.message?.channel_id ?? interaction.channel_id;
	const receiverScope = discordReceiverScope(bot.applicationId);
	const delivered =
		messageId && channelId && receiverScope
			? await findApprovalDeliveryMessageByRemoteIdentity({
					organizationId: bot.organizationId,
					provider: "discord",
					receiverScope,
					destinationId: channelId,
					remoteMessageId: messageId,
				})
			: null;
	if (delivered && delivered.recipientUserId === recipient.userId) {
		return updateDeliveredBoundCard(result, delivered, bot, recipient);
	}
	const tracked =
		messageId && channelId
			? await db.query.discordApprovalMessage.findFirst({
					where: and(
						eq(discordApprovalMessage.organizationId, bot.organizationId),
						eq(discordApprovalMessage.recipientUserId, recipient.userId),
						eq(discordApprovalMessage.channelId, channelId),
						eq(discordApprovalMessage.messageId, messageId),
					),
				})
			: undefined;
	const reference: ApprovalReviewReference | null = tracked
		? { kind: "compatibility", approvalRequestId: tracked.approvalRequestId }
		: result.status === "decided" && result.evidence.assignmentId
			? { kind: "canonical", assignmentId: result.evidence.assignmentId }
			: null;
	if (!reference) return null;
	const notice = await boundDecisionNotice(result, recipient, reference);
	if (notice && tracked) {
		await editMessage(
			bot.botToken,
			tracked.channelId,
			tracked.messageId,
			discordApprovalNotice(notice),
		).catch((error: unknown) => {
			logger.error({ error }, "Failed to edit tracked Discord approval card");
		});
	}
	return notice;
}

async function updateDeliveredBoundCard(
	result: BoundBotApprovalResult,
	message: ApprovalDeliveryMessageRecord,
	bot: ResolvedDiscordBot,
	recipient: { userId: string; organizationId: string },
): Promise<ApprovalNotice | null> {
	try {
		const notice = await boundDecisionNotice(
			result,
			recipient,
			approvalDeliveryMessageReviewReference(message),
		);
		if (!notice) return null;
		try {
			if (result.status !== "decided" && (await isApprovalDeliveryMessagePending(message))) {
				const edited = await editMessage(
					bot.botToken,
					message.destinationId,
					message.remoteMessageId,
					discordApprovalNotice(notice),
				);
				if (edited) {
					await markApprovalDeliveryMessageWithoutControls({
						organizationId: bot.organizationId,
						messageId: message.id,
					});
				}
			}
		} catch (error) {
			// The outcome stands; the card keeps its controls, which decide
			// only while the assignment is pending.
			logger.error({ error, messageId: message.id }, "Failed to mark Discord card for review");
		}
		return notice;
	} finally {
		kickApprovalDelivery({
			organizationId: bot.organizationId,
			workflowId: message.workflowId,
		});
	}
}

/**
 * The existing notification path. It sends the shared presentation to the
 * recipient's DM; with an admitted provider that can be a bound card.
 */
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
			provider: "discord",
			fits: fitsDiscordMessage,
		});
		if (notice.status === "undisclosable") return;
		const channel = await resolveApprovalDMChannel(
			botToken,
			notice.recipientUserId,
			organizationId,
		);
		if (channel.kind !== "ok") return;
		const channelId = channel.result;
		const sent = await sendMessage(
			botToken,
			channelId,
			notice.status === "actionable"
				? discordActionableCard(notice)
				: discordApprovalNotice(notice),
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
