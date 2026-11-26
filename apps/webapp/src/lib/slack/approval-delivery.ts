import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatInstallationMemberLink, slackUserMapping, slackWorkspaceConfig } from "@/db/schema";
import {
	type ChatInstallationOriginRecord,
	findActiveInstallationConversation,
	resolveAuthoritativeProviderApprovalSettings,
	resolveInstallationSecret,
} from "@/lib/approvals/delivery/installation-origin";
import type {
	ApprovalDeliveryAdapter,
	ApprovalDeliveryFailure,
} from "@/lib/approvals/delivery/owner";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import { upsertInstallationConversation } from "@/lib/chat-installations/inventory";
import {
	openConversationWithOutcome,
	postMessageWithOutcome,
	updateMessageWithOutcome,
} from "./api";
import { fitsSlackApprovalCard, slackApprovalCard } from "./approval-card";
import { getBotConfigByOrganization } from "./bot-config";
import { getChannelIdForUser } from "./conversation-manager";
import { classifySlackDeliveryFailure, type SlackCallFailure } from "./delivery-outcome";
import type { ResolvedSlackBot } from "./types";

/** The installation that sent a message; only it can update the message. */
export function slackReceiverScope(bot: Pick<ResolvedSlackBot, "slackTeamId">): string {
	return `slack-team:${bot.slackTeamId}`;
}

function failureReason(call: SlackCallFailure): string {
	switch (call.kind) {
		case "platform":
			return `slack_${call.error}`;
		case "http":
			return `slack_http_${call.status}`;
		case "rate_limited":
			return "slack_rate_limited";
		case "unknown":
			return call.reason;
	}
}

/** A failed post or DM open; only an update can find its message gone. */
function deliveryFailure(call: SlackCallFailure, method: "send" | "open"): ApprovalDeliveryFailure {
	const kind = classifySlackDeliveryFailure(call, method);
	return {
		kind: "failed",
		outcome: kind === "gone" ? "permanent" : kind,
		reason: failureReason(call),
	};
}

/**
 * The recipient's DM with the bot: the conversation they used, or one opened
 * for their linked account in this workspace.
 */
async function resolveDirectMessage(
	bot: ResolvedSlackBot,
	input: { organizationId: string; recipientUserId: string },
): Promise<{ kind: "ok"; channelId: string } | ApprovalDeliveryFailure> {
	const known = await getChannelIdForUser(input.recipientUserId, input.organizationId);
	if (known) return { kind: "ok", channelId: known };
	const mapping = await db.query.slackUserMapping.findFirst({
		where: and(
			eq(slackUserMapping.userId, input.recipientUserId),
			eq(slackUserMapping.organizationId, input.organizationId),
			eq(slackUserMapping.slackTeamId, bot.slackTeamId),
			eq(slackUserMapping.isActive, true),
		),
		columns: { slackUserId: true },
	});
	if (!mapping) {
		return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
	}
	const opened = await openConversationWithOutcome(bot.botAccessToken, mapping.slackUserId);
	return opened.kind === "ok"
		? { kind: "ok", channelId: opened.result }
		: deliveryFailure(opened, "open");
}

async function resolveSlackTokenForInstallation(
	organizationId: string,
	installation: ChatInstallationOriginRecord,
): Promise<{ botAccessToken: string; slackTeamId: string | null } | null> {
	const fromRevision = await resolveInstallationSecret({
		installation,
		candidateKeyNames: ["bot_access_token", "botToken", "slack/bot_access_token"],
	});
	if (fromRevision) {
		return { botAccessToken: fromRevision, slackTeamId: installation.externalSpaceId };
	}
	if (installation.legacyTable === "slack_workspace_config") {
		const legacyBot = await getBotConfigByOrganization(organizationId, {
			installationId: installation.id,
		});
		if (legacyBot) {
			return {
				botAccessToken: legacyBot.botAccessToken,
				slackTeamId: installation.externalSpaceId ?? legacyBot.slackTeamId,
			};
		}
	}
	return null;
}

/**
 * Slack mechanics for the approval delivery owner (#294): installation, the
 * recipient's DM, card layout and the Web API calls. Slack has no established
 * per-invocation identity (#261), so every card is review-only: the submitted
 * facts when they fit Slack's limits, otherwise a review notice.
 */
export const slackApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "slack",

	async acceptsEscalationDelivery(organizationId) {
		const authoritative = await resolveAuthoritativeProviderApprovalSettings(
			organizationId,
			"slack",
		);
		if (authoritative !== null) return authoritative.enableEscalations;
		const [config] = await db
			.select({ enableEscalations: slackWorkspaceConfig.enableEscalations })
			.from(slackWorkspaceConfig)
			.where(eq(slackWorkspaceConfig.organizationId, organizationId))
			.limit(1);
		return config?.enableEscalations === true;
	},

	async sendInitial(input) {
		const target = input.targetInstallation ?? null;
		let botAccessToken: string;
		let slackTeamId: string;
		let receiverScope: string;

		if (target) {
			const creds = await resolveSlackTokenForInstallation(input.organizationId, target);
			if (!creds) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const authoritative = await resolveAuthoritativeProviderApprovalSettings(
				input.organizationId,
				"slack",
			);
			if (authoritative) {
				if (!authoritative.enableApprovals) {
					return { kind: "suppressed", reason: "approvals_disabled" };
				}
				if (input.purpose === "replacement" && !authoritative.enableEscalations) {
					return { kind: "suppressed", reason: "escalations_disabled" };
				}
			} else if (target.legacyTable === "slack_workspace_config") {
				const legacy = await getBotConfigByOrganization(input.organizationId, {
					installationId: target.id,
				});
				if (!legacy) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
				if (legacy.setupStatus !== "active") {
					return { kind: "suppressed", reason: "integration_disabled" };
				}
				if (!legacy.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
				if (input.purpose === "replacement" && !legacy.enableEscalations) {
					return { kind: "suppressed", reason: "escalations_disabled" };
				}
			}
			botAccessToken = creds.botAccessToken;
			slackTeamId = creds.slackTeamId ?? "";
			receiverScope = target.receiverScope ?? (slackTeamId ? `slack-team:${slackTeamId}` : "");
			if (!receiverScope) {
				return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
			}
		} else {
			const bot = await getBotConfigByOrganization(input.organizationId);
			if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			if (bot.setupStatus !== "active") {
				return { kind: "suppressed", reason: "integration_disabled" };
			}
			if (!bot.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
			if (input.purpose === "replacement" && !bot.enableEscalations) {
				return { kind: "suppressed", reason: "escalations_disabled" };
			}
			botAccessToken = bot.botAccessToken;
			slackTeamId = bot.slackTeamId;
			receiverScope = slackReceiverScope(bot);
		}

		// Entitlement first: no DM is opened for a recipient who may not see
		// the request.
		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			...(input.canonicalAssignment ? { canonicalAssignment: input.canonicalAssignment } : {}),
			recipientEmployeeId: input.recipientEmployeeId,
			actingForEmployeeId: input.actingForEmployeeId ?? null,
			organizationId: input.organizationId,
			provider: "slack",
			summary: { fits: fitsSlackApprovalCard },
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };

		let destination: { kind: "ok"; channelId: string } | ApprovalDeliveryFailure;
		if (target) {
			const installationConversation = await findActiveInstallationConversation({
				organizationId: input.organizationId,
				installationId: target.id,
				userId: input.recipientUserId,
				conversationTypes: ["im", "private"],
			});
			if (installationConversation?.externalConversationId) {
				destination = { kind: "ok", channelId: installationConversation.externalConversationId };
			} else if (target.legacyTable === "slack_workspace_config") {
				destination = await resolveDirectMessage(
					{ botAccessToken, slackTeamId } as ResolvedSlackBot,
					input,
				);
			} else if (slackTeamId) {
				const [memberLink] = await db
					.select({ externalUserId: chatInstallationMemberLink.externalUserId })
					.from(chatInstallationMemberLink)
					.where(
						and(
							eq(chatInstallationMemberLink.organizationId, input.organizationId),
							eq(chatInstallationMemberLink.installationId, target.id),
							eq(chatInstallationMemberLink.userId, input.recipientUserId),
							eq(chatInstallationMemberLink.isCandidateEnrollment, false),
							eq(chatInstallationMemberLink.isActive, true),
						),
					)
					.limit(1);

				let targetSlackUserId: string | null = memberLink?.externalUserId ?? null;
				if (!targetSlackUserId) {
					const mapping = await db.query.slackUserMapping.findFirst({
						where: and(
							eq(slackUserMapping.userId, input.recipientUserId),
							eq(slackUserMapping.organizationId, input.organizationId),
							eq(slackUserMapping.slackTeamId, slackTeamId),
							eq(slackUserMapping.isActive, true),
						),
						columns: { slackUserId: true },
					});
					targetSlackUserId = mapping?.slackUserId ?? null;
				}

				if (!targetSlackUserId) {
					destination = {
						kind: "failed",
						outcome: "destination_invalid",
						reason: "destination_missing",
					};
				} else {
					const opened = await openConversationWithOutcome(botAccessToken, targetSlackUserId);
					if (opened.kind === "ok") {
						await upsertInstallationConversation(
							{
								organizationId: input.organizationId,
								installationId: target.id,
								userId: input.recipientUserId,
								externalUserId: targetSlackUserId,
								externalConversationId: opened.result,
								conversationType: "private",
								reachabilityStatus: "reachable",
								verifiedAt: new Date(),
							},
							{ db },
						);
						destination = { kind: "ok", channelId: opened.result };
					} else {
						destination = deliveryFailure(opened, "open");
					}
				}
			} else {
				destination = {
					kind: "failed",
					outcome: "destination_invalid",
					reason: "destination_missing",
				};
			}
		} else {
			destination = await resolveDirectMessage(
				{ botAccessToken, slackTeamId } as ResolvedSlackBot,
				input,
			);
		}

		if (destination.kind !== "ok") return destination;
		// Never controls: an actionable card cannot be prepared for Slack, and
		// the renderer has no approve or reject control either way.
		const sent = await postMessageWithOutcome(botAccessToken, {
			channel: destination.channelId,
			...slackApprovalCard(card),
		});
		if (sent.kind !== "ok") return deliveryFailure(sent, "send");
		return {
			kind: "accepted",
			receiverScope,
			destinationId: sent.result.channel,
			remoteMessageId: sent.result.ts,
			bindingId: null,
			controls: "none",
			installationId: target?.id ?? null,
			credentialRevisionId: target?.activeCredentialRevisionId ?? null,
		};
	},

	async refresh(input) {
		const origin = input.originInstallation ?? null;
		let botAccessToken: string;
		if (origin) {
			const creds = await resolveSlackTokenForInstallation(input.organizationId, origin);
			if (!creds) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const expectedScope =
				origin.receiverScope ?? (creds.slackTeamId ? `slack-team:${creds.slackTeamId}` : null);
			if (expectedScope && expectedScope !== input.message.receiverScope) {
				return { kind: "gone", reason: "workspace_replaced" };
			}
			botAccessToken = creds.botAccessToken;
		} else {
			const bot = await getBotConfigByOrganization(input.organizationId);
			if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			// Only the installation that sent a message can update it.
			if (slackReceiverScope(bot) !== input.message.receiverScope) {
				return { kind: "gone", reason: "workspace_replaced" };
			}
			botAccessToken = bot.botAccessToken;
		}
		const updated = await updateMessageWithOutcome(botAccessToken, {
			channel: input.message.destinationId,
			ts: input.message.remoteMessageId,
			...slackApprovalCard(input.notice),
		});
		if (updated.kind === "ok") return { kind: "accepted" };
		const kind = classifySlackDeliveryFailure(updated, "edit");
		return kind === "gone"
			? { kind: "gone", reason: "message_not_editable" }
			: { kind: "failed", outcome: kind, reason: failureReason(updated) };
	},
};
