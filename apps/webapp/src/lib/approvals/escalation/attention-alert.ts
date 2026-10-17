import type { ApprovalEscalationAttentionReason } from "@/db/schema";
import type { CreateNotificationParams } from "@/lib/notifications/types";

export const ESCALATION_MANAGEMENT_PATH = "/settings/approval-policies";

const ALERT_TITLE = {
	titleKey: "common:notifications.content.approvalEscalationAttention.title",
	titleDefault: "Approval escalation needs attention",
} as const;

/** One message per reason, translated per recipient (#812). */
const ATTENTION_ALERT_MESSAGES: Record<
	ApprovalEscalationAttentionReason,
	{ messageKey: string; messageDefault: string }
> = {
	no_eligible_backup: {
		messageKey: "common:notifications.content.approvalEscalationAttention.noEligibleBackup",
		messageDefault:
			"An overdue approval has no eligible backup approver. The current approver keeps the assignment.",
	},
	replacement_overdue: {
		messageKey: "common:notifications.content.approvalEscalationAttention.replacementOverdue",
		messageDefault:
			"An approval is still undecided after its automatic escalation. No further automatic transfer will happen.",
	},
	unsupported_route: {
		messageKey: "common:notifications.content.approvalEscalationAttention.unsupportedRoute",
		messageDefault: "An approval cannot be escalated because its decision path is not supported.",
	},
	ambiguous_history: {
		messageKey: "common:notifications.content.approvalEscalationAttention.ambiguousHistory",
		messageDefault:
			"An approval's escalation history is ambiguous and needs review before any automatic transfer.",
	},
	delivery_exhausted: {
		messageKey: "common:notifications.content.approvalEscalationAttention.deliveryExhausted",
		messageDefault: "Escalation notifications for an approval failed after all retries.",
	},
	delivery_unavailable: {
		messageKey: "common:notifications.content.approvalEscalationAttention.deliveryUnavailable",
		messageDefault: "No escalation notification destination is available for an approval.",
	},
};

/** The attention alert for one organization admin or owner, at most once per incident. */
export function buildEscalationAttentionAlert(input: {
	organizationId: string;
	userId: string;
	attentionId: string;
	reason: ApprovalEscalationAttentionReason;
}): CreateNotificationParams {
	const copy = ATTENTION_ALERT_MESSAGES[input.reason];
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		type: "approval_escalation_attention",
		title: ALERT_TITLE.titleDefault,
		message: copy.messageDefault,
		entityType: "approval_escalation_attention",
		entityId: input.attentionId,
		actionUrl: `${ESCALATION_MANAGEMENT_PATH}?tab=attention`,
		idempotencyKey: `approval-escalation-attention:${input.attentionId}:${input.userId}`,
		metadata: { i18n: { ...ALERT_TITLE, ...copy } },
	};
}
