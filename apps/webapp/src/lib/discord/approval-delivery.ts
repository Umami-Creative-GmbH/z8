import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatInstallationMemberLink, discordBotConfig } from "@/db/schema";
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
import { discordApprovalNotice } from "@/lib/bot-platform/approval-notice";
import { editMessageWithOutcome, openDMChannelWithOutcome, sendMessageWithOutcome } from "./api";
import { discordActionableCard, fitsDiscordMessage } from "./approval-card";
import { getBotConfigByOrganization } from "./bot-config";
import { discordReceiverScope } from "./bound-approval";
import { resolveApprovalDMChannel } from "./conversation-manager";
import { classifyDiscordDeliveryFailure, type DiscordCallFailure } from "./delivery-outcome";

function failure(
	call: DiscordCallFailure,
	method: "send" | "edit",
): ApprovalDeliveryFailure | "gone" {
	const kind = classifyDiscordDeliveryFailure(call, method);
	if (kind === "gone") return kind;
	const reason =
		call.kind === "unknown"
			? call.reason
			: `discord_${call.status}${call.code ? `_${call.code}` : ""}`;
	return { kind: "failed", outcome: kind, reason };
}

async function resolveDiscordTokenForInstallation(
	organizationId: string,
	installation: ChatInstallationOriginRecord,
): Promise<{ botToken: string; applicationId: string | null } | null> {
	const fromRevision = await resolveInstallationSecret({
		installation,
		candidateKeyNames: ["bot_token", "discord/bot_token"],
	});
	if (fromRevision) {
		return { botToken: fromRevision, applicationId: installation.externalAppId };
	}
	if (installation.legacyTable === "discord_bot_config") {
		const legacyBot = await getBotConfigByOrganization(organizationId, {
			installationId: installation.id,
		});
		if (legacyBot) {
			return {
				botToken: legacyBot.botToken,
				applicationId: installation.externalAppId ?? legacyBot.applicationId,
			};
		}
	}
	return null;
}

/**
 * Discord mechanics for the approval delivery owner: bot resolution, the
 * recipient's DM with this application, card layout and the REST calls.
 * Cards come from the shared presentation; a card that does not fit is
 * review-only.
 */
export const discordApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "discord",

	async acceptsEscalationDelivery(organizationId) {
		const authoritative = await resolveAuthoritativeProviderApprovalSettings(
			organizationId,
			"discord",
		);
		if (authoritative !== null) return authoritative.enableEscalations;
		const [config] = await db
			.select({ enableEscalations: discordBotConfig.enableEscalations })
			.from(discordBotConfig)
			.where(eq(discordBotConfig.organizationId, organizationId))
			.limit(1);
		return config?.enableEscalations === true;
	},

	async sendInitial(input) {
		const target = input.targetInstallation ?? null;
		let botToken: string;
		let receiverScope: string | null;
		let dmChannelId: string;

		if (target) {
			const creds = await resolveDiscordTokenForInstallation(input.organizationId, target);
			if (!creds) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const authoritative = await resolveAuthoritativeProviderApprovalSettings(
				input.organizationId,
				"discord",
			);
			if (authoritative) {
				if (!authoritative.enableApprovals) {
					return { kind: "suppressed", reason: "approvals_disabled" };
				}
				if (input.purpose === "replacement" && !authoritative.enableEscalations) {
					return { kind: "suppressed", reason: "escalations_disabled" };
				}
			} else if (target.legacyTable === "discord_bot_config") {
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
			botToken = creds.botToken;
			receiverScope =
				target.receiverScope ??
				(creds.applicationId ? discordReceiverScope(creds.applicationId) : null);
			if (!receiverScope) {
				return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
			}
			const installationConversation = await findActiveInstallationConversation({
				organizationId: input.organizationId,
				installationId: target.id,
				userId: input.recipientUserId,
				conversationTypes: ["private", "dm"],
			});
			if (
				installationConversation?.externalConversationId &&
				installationConversation.reachabilityStatus === "reachable" &&
				/^\d+$/.test(installationConversation.externalConversationId)
			) {
				dmChannelId = installationConversation.externalConversationId;
			} else if (target.legacyTable === "discord_bot_config") {
				const channel = await resolveApprovalDMChannel(
					botToken,
					input.recipientUserId,
					input.organizationId,
				);
				if (channel.kind === "missing") {
					return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
				}
				if (channel.kind !== "ok") {
					const failed = failure(channel, "send");
					return typeof failed === "string"
						? { kind: "failed", outcome: "permanent", reason: failed }
						: failed;
				}
				dmChannelId = channel.result;
			} else {
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
				if (!memberLink) {
					return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
				}
				const opened = await openDMChannelWithOutcome(botToken, memberLink.externalUserId);
				if (opened.kind !== "ok") {
					const failed = failure(opened, "send");
					return typeof failed === "string"
						? { kind: "failed", outcome: "permanent", reason: failed }
						: failed;
				}
				dmChannelId = opened.result;
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
			botToken = bot.botToken;
			receiverScope = discordReceiverScope(bot.applicationId);
			if (!receiverScope) {
				return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
			}
			const channel = await resolveApprovalDMChannel(
				bot.botToken,
				input.recipientUserId,
				input.organizationId,
			);
			if (channel.kind === "missing") {
				return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
			}
			if (channel.kind !== "ok") {
				const failed = failure(channel, "send");
				return typeof failed === "string"
					? { kind: "failed", outcome: "permanent", reason: failed }
					: failed;
			}
			dmChannelId = channel.result;
		}

		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			...(input.canonicalAssignment ? { canonicalAssignment: input.canonicalAssignment } : {}),
			recipientEmployeeId: input.recipientEmployeeId,
			actingForEmployeeId: input.actingForEmployeeId ?? null,
			organizationId: input.organizationId,
			provider: "discord",
			fits: fitsDiscordMessage,
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		const sent = await sendMessageWithOutcome(
			botToken,
			dmChannelId,
			card.status === "actionable" ? discordActionableCard(card) : discordApprovalNotice(card),
		);
		if (sent.kind !== "ok") {
			const failed = failure(sent, "send");
			return typeof failed === "string"
				? { kind: "failed", outcome: "permanent", reason: failed }
				: failed;
		}
		return {
			kind: "accepted",
			receiverScope,
			destinationId: sent.result.channel_id,
			remoteMessageId: sent.result.id,
			bindingId: card.status === "actionable" ? card.bindingId : null,
			controls: card.status === "actionable" ? "actionable" : "none",
			installationId: target?.id ?? null,
			credentialRevisionId: target?.activeCredentialRevisionId ?? null,
		};
	},

	async refresh(input) {
		const origin = input.originInstallation ?? null;
		let botToken: string;
		if (origin) {
			const creds = await resolveDiscordTokenForInstallation(input.organizationId, origin);
			if (!creds) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			const expectedScope =
				origin.receiverScope ??
				(creds.applicationId ? discordReceiverScope(creds.applicationId) : null);
			if (expectedScope && expectedScope !== input.message.receiverScope) {
				return { kind: "gone", reason: "bot_replaced" };
			}
			botToken = creds.botToken;
		} else {
			const bot = await getBotConfigByOrganization(input.organizationId);
			if (!bot) return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
			// Only the application that sent a message can edit it.
			if (discordReceiverScope(bot.applicationId) !== input.message.receiverScope) {
				return { kind: "gone", reason: "bot_replaced" };
			}
			botToken = bot.botToken;
		}
		const edited = await editMessageWithOutcome(
			botToken,
			input.message.destinationId,
			input.message.remoteMessageId,
			discordApprovalNotice(input.notice),
		);
		if (edited.kind === "ok") return { kind: "accepted" };
		const failed = failure(edited, "edit");
		if (failed === "gone") return { kind: "gone", reason: "message_not_editable" };
		return failed;
	},
};
