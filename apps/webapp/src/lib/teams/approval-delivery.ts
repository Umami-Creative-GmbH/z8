import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsTenantConfig } from "@/db/schema";
import { env } from "@/env";
import type {
	ApprovalDeliveryAdapter,
	ApprovalDeliveryFailure,
} from "@/lib/approvals/delivery/owner";
import { prepareApprovalPresentation } from "@/lib/approvals/presentation";
import { fitsTeamsCard, teamsActionableActivity, teamsNoticeActivity } from "./approval-handler";
import { isBotConfigured, sendActivityWithOutcome, updateActivityWithOutcome } from "./bot-adapter";
import { teamsReceiverScope } from "./bound-approval";
import { findConversationReference, findPersonalConversation } from "./conversation-manager";
import { classifyTeamsDeliveryFailure, type TeamsCallFailure } from "./delivery-outcome";

function failure(
	call: TeamsCallFailure,
	method: "send" | "update",
): ApprovalDeliveryFailure | "gone" {
	const kind = classifyTeamsDeliveryFailure(call, method);
	if (kind === "gone") return kind;
	const reason =
		call.kind === "unknown"
			? call.reason
			: `teams_${call.status}${call.code ? `_${call.code}` : ""}`;
	return { kind: "failed", outcome: kind, reason };
}

/**
 * Every Teams tenant configured for the organization (an organization may
 * connect more than one); read failures propagate.
 */
function loadTenants(organizationId: string) {
	return db
		.select({
			tenantId: teamsTenantConfig.tenantId,
			setupStatus: teamsTenantConfig.setupStatus,
			enableApprovals: teamsTenantConfig.enableApprovals,
			enableEscalations: teamsTenantConfig.enableEscalations,
		})
		.from(teamsTenantConfig)
		.where(eq(teamsTenantConfig.organizationId, organizationId));
}

/**
 * Teams mechanics for the approval delivery owner (#293): the multi-tenant
 * bot, the organization's tenant, the recipient's personal conversation, card
 * layout and the connector calls. Cards come from the shared presentation; a
 * card that does not fit is review-only.
 */
export const teamsApprovalDeliveryAdapter: ApprovalDeliveryAdapter = {
	provider: "teams",

	/** Intended while any of the organization's tenants delivers escalations. */
	async acceptsEscalationDelivery(organizationId) {
		const tenants = await loadTenants(organizationId);
		return tenants.some((tenant) => tenant.enableEscalations);
	},

	async sendInitial(input) {
		if (!isBotConfigured()) {
			return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		}
		const tenants = await loadTenants(input.organizationId);
		if (tenants.length === 0) {
			return { kind: "failed", outcome: "unavailable", reason: "tenant_unavailable" };
		}
		const conversation = await findPersonalConversation(
			input.recipientUserId,
			input.organizationId,
		);
		if (!conversation) {
			return { kind: "failed", outcome: "destination_invalid", reason: "destination_missing" };
		}
		// The recipient's conversation decides the tenant; it must be one of ours.
		const tenant = tenants.find((config) => config.tenantId === conversation.teamsTenantId);
		if (!tenant) {
			return {
				kind: "failed",
				outcome: "destination_invalid",
				reason: "destination_tenant_mismatch",
			};
		}
		if (tenant.setupStatus !== "active") {
			return { kind: "suppressed", reason: "integration_disabled" };
		}
		if (!tenant.enableApprovals) return { kind: "suppressed", reason: "approvals_disabled" };
		// The recipient's own tenant decides escalation delivery.
		if (input.purpose === "replacement" && !tenant.enableEscalations) {
			return { kind: "suppressed", reason: "escalations_disabled" };
		}
		const receiverScope = teamsReceiverScope(env.MICROSOFT_APP_ID, tenant.tenantId);
		if (!receiverScope) {
			return { kind: "failed", outcome: "unavailable", reason: "bot_identity_unknown" };
		}
		const card = await prepareApprovalPresentation({
			approvalId: input.approvalRequestId,
			recipientEmployeeId: input.recipientEmployeeId,
			organizationId: input.organizationId,
			provider: "teams",
			fits: fitsTeamsCard,
		});
		if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
		const sent = await sendActivityWithOutcome(
			conversation.reference,
			card.status === "actionable" ? teamsActionableActivity(card) : teamsNoticeActivity(card),
		);
		if (sent.kind !== "ok") {
			const failed = failure(sent, "send");
			// A send has no message to lose; classification never yields "gone" here.
			return failed === "gone"
				? { kind: "failed", outcome: "permanent", reason: "unexpected_gone" }
				: failed;
		}
		if (!sent.activityId) {
			// Posted, but its identity is unknown: it cannot be tracked or retired.
			return { kind: "failed", outcome: "ambiguous", reason: "no_message_identity" };
		}
		return {
			kind: "accepted",
			receiverScope,
			destinationId: conversation.teamsConversationId,
			remoteMessageId: sent.activityId,
			bindingId: card.status === "actionable" ? card.bindingId : null,
			controls: card.status === "actionable" ? "actionable" : "none",
		};
	},

	async refresh(input) {
		if (!isBotConfigured()) {
			return { kind: "failed", outcome: "unavailable", reason: "bot_unavailable" };
		}
		// Only the bot and tenant that sent a message can update it.
		const tenants = await loadTenants(input.organizationId);
		const sender = tenants.some(
			(config) =>
				teamsReceiverScope(env.MICROSOFT_APP_ID, config.tenantId) === input.message.receiverScope,
		);
		if (!sender) return { kind: "gone", reason: "bot_replaced" };
		const reference = await findConversationReference(
			input.message.destinationId,
			input.organizationId,
		);
		if (!reference) return { kind: "gone", reason: "conversation_unknown" };
		const updated = await updateActivityWithOutcome(
			reference,
			input.message.remoteMessageId,
			teamsNoticeActivity(input.notice),
		);
		if (updated.kind === "ok") return { kind: "accepted" };
		const failed = failure(updated, "update");
		if (failed === "gone") return { kind: "gone", reason: "message_not_updatable" };
		return failed;
	},
};
