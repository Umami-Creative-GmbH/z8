import { describe, expect, it } from "vitest";
import { buildEscalationAttentionAlert } from "./attention-alert";

describe("buildEscalationAttentionAlert", () => {
	it("translates the alert for each reason", () => {
		const alert = buildEscalationAttentionAlert({
			organizationId: "org-1",
			userId: "admin-1",
			attentionId: "attention-1",
			reason: "no_eligible_backup",
		});

		expect(alert).toMatchObject({
			userId: "admin-1",
			organizationId: "org-1",
			type: "approval_escalation_attention",
			title: "Approval escalation needs attention",
			message:
				"An overdue approval has no eligible backup approver. The current approver keeps the assignment.",
			entityType: "approval_escalation_attention",
			entityId: "attention-1",
			idempotencyKey: "approval-escalation-attention:attention-1:admin-1",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.approvalEscalationAttention.title",
					titleDefault: "Approval escalation needs attention",
					messageKey: "common:notifications.content.approvalEscalationAttention.noEligibleBackup",
					messageDefault:
						"An overdue approval has no eligible backup approver. The current approver keeps the assignment.",
				},
			},
		});
	});

	it.each([
		["replacement_overdue", "replacementOverdue"],
		["unsupported_route", "unsupportedRoute"],
		["ambiguous_history", "ambiguousHistory"],
		["delivery_exhausted", "deliveryExhausted"],
		["delivery_unavailable", "deliveryUnavailable"],
	] as const)("uses its own message key for %s", (reason, key) => {
		const alert = buildEscalationAttentionAlert({
			organizationId: "org-1",
			userId: "admin-1",
			attentionId: "attention-1",
			reason,
		});

		expect(alert.metadata?.i18n).toMatchObject({
			messageKey: `common:notifications.content.approvalEscalationAttention.${key}`,
			messageDefault: alert.message,
		});
	});
});
