/**
 * Slack Notification Channel
 *
 * Handles sending notifications via Slack.
 * Mirrors the Telegram notification channel pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest, employee } from "@/db/schema";
import { isApprovalNotificationDeliveredByOwner } from "@/lib/approvals/delivery/store";
import {
	DurableDispatchConfirmedUnsentError,
	DurableDispatchUncertainError,
	extractRedactedErrorDiagnostics,
	isConfirmedUnsentError,
	isUncertainDispatchError,
} from "@/lib/chat-installations/durable-dispatch";
import type { ChatDispatchTargetHint } from "@/lib/chat-installations/runtime-target";
import { createLogger } from "@/lib/logger";
import { localizeOutboundNotification } from "./outbound-localization";
import type { NotificationType } from "./types";

const logger = createLogger("SlackChannel");

interface SlackNotificationParams {
	userId: string;
	organizationId: string;
	type: NotificationType;
	title: string;
	message: string;
	entityType?: string;
	entityId?: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Check if Slack is available for an organization
 */
export async function isSlackAvailable(
	organizationId: string,
	options: { throwOnError?: boolean } = {},
): Promise<boolean> {
	try {
		const { isSlackEnabledForOrganization } = await import("@/lib/slack");
		return await isSlackEnabledForOrganization(organizationId);
	} catch (error) {
		if (options.throwOnError) throw error;
		logger.debug({ error, organizationId }, "Slack availability check failed");
		return false;
	}
}

/**
 * Send a notification via Slack
 */
export async function sendSlackNotification(
	params: SlackNotificationParams,
	options: { durable?: boolean; dispatchTarget?: ChatDispatchTargetHint } = {},
): Promise<undefined | "unavailable"> {
	let providerCallStarted = false;
	try {
		const {
			getChannelIdForUser,
			postMessage,
			sendApprovalMessageToManager,
			getBotConfigByOrganization,
		} = await import("@/lib/slack");

		const hasTarget = Boolean(
			options.dispatchTarget?.installationId || options.dispatchTarget?.credentialRevisionId,
		);
		const botConfig = hasTarget
			? await getBotConfigByOrganization(params.organizationId, options.dispatchTarget)
			: await getBotConfigByOrganization(params.organizationId);
		if (!botConfig) return options.durable ? "unavailable" : undefined;

		// One owner per delivery effect (#294): where the approval delivery owner
		// has the absence card, this path sends neither the card nor a plain
		// message about the same request.
		if (
			params.type === "approval_request_submitted" &&
			(await isApprovalNotificationDeliveredByOwner({ ...params, provider: "slack" }))
		) {
			return options.durable ? "unavailable" : undefined;
		}

		// Handle approval-related notifications specially
		if (params.type === "approval_request_submitted" && params.entityType === "approval_request") {
			const approval = await db.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, params.entityId || ""),
					eq(approvalRequest.organizationId, params.organizationId),
				),
			});

			if (approval) {
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, params.userId),
						eq(employee.organizationId, params.organizationId),
						eq(employee.isActive, true),
					),
				});

				if (emp) {
					providerCallStarted = true;
					await sendApprovalMessageToManager(
						approval.id,
						emp.id,
						params.organizationId,
						botConfig.botAccessToken,
					);
					return options.durable ? "unavailable" : undefined;
				}
			}
			// Missing approval/recipient evidence must not fall through to raw details.
			return options.durable ? "unavailable" : undefined;
		}

		// For other notifications, send a simple message
		const channelId = hasTarget
			? await getChannelIdForUser(params.userId, params.organizationId, options.dispatchTarget)
			: await getChannelIdForUser(params.userId, params.organizationId);
		if (!channelId) {
			logger.debug(
				{ userId: params.userId, organizationId: params.organizationId },
				"No Slack channel found for user",
			);
			return options.durable ? "unavailable" : undefined;
		}

		const localized = await localizeOutboundNotification({
			userId: params.userId,
			organizationId: params.organizationId,
			title: params.title,
			message: params.message,
			metadata: params.metadata,
			withActionLabel: true,
		});
		let text = `*${localized.title}*\n\n${localized.message}`;
		if (params.actionUrl) {
			text += `\n\n<${params.actionUrl}|${localized.actionLabel}>`;
		}

		providerCallStarted = true;
		const acknowledgement = await postMessage(botConfig.botAccessToken, {
			channel: channelId,
			text,
		});
		if (options.durable && !acknowledgement) {
			throw new DurableDispatchUncertainError("slack_delivery_unacknowledged", {
				reason: "provider_unacknowledged",
			});
		}

		logger.debug({ userId: params.userId, type: params.type }, "Slack notification sent");
	} catch (error) {
		if (options.durable) {
			if (isConfirmedUnsentError(error) || isUncertainDispatchError(error)) {
				throw error;
			}
			const message = error instanceof Error ? error.message : "slack_delivery_failed";
			if (!providerCallStarted) {
				throw new DurableDispatchConfirmedUnsentError(
					message,
					extractRedactedErrorDiagnostics(error, "slack_preflight_failed"),
					error,
				);
			}
			throw new DurableDispatchUncertainError(
				message,
				extractRedactedErrorDiagnostics(error, "slack_provider_call_uncertain"),
				{ classification: "provider_error", causeError: error },
			);
		}
		logger.error({ error, params }, "Failed to send Slack notification");
		throw error;
	}
}
