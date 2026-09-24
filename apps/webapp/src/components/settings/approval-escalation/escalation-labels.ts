import type { useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
import type {
	ApprovalEscalationAttentionEventType,
	ApprovalEscalationAttentionReason,
	ApprovalEscalationChannel,
	ApprovalEscalationPolicyConflictCode,
} from "@/db/schema";
import {
	type DisplayContext,
	formatInstant,
} from "@/lib/datetime/temporal-format";

export type EscalationTranslate = ReturnType<typeof useTranslate>["t"];

export function formatEscalationInstant(
	iso: string,
	context: DisplayContext,
): string {
	return formatInstant(Temporal.Instant.from(iso), context, "dateTimeMedium");
}

export function channelLabel(channel: ApprovalEscalationChannel): string {
	switch (channel) {
		case "slack":
			return "Slack";
		case "telegram":
			return "Telegram";
		case "discord":
			return "Discord";
		case "teams":
			return "Microsoft Teams";
	}
}

export function attentionReasonLabel(
	reason: ApprovalEscalationAttentionReason,
	t: EscalationTranslate,
): string {
	switch (reason) {
		case "no_eligible_backup":
			return t(
				"settings.approvalEscalation.reason.noEligibleBackup",
				"No eligible backup approver",
			);
		case "replacement_overdue":
			return t(
				"settings.approvalEscalation.reason.replacementOverdue",
				"Replacement approver is overdue",
			);
		case "unsupported_route":
			return t(
				"settings.approvalEscalation.reason.unsupportedRoute",
				"Unsupported decision path",
			);
		case "ambiguous_history":
			return t(
				"settings.approvalEscalation.reason.ambiguousHistory",
				"Ambiguous escalation history",
			);
		case "delivery_exhausted":
			return t(
				"settings.approvalEscalation.reason.deliveryExhausted",
				"Delivery retries exhausted",
			);
		case "delivery_unavailable":
			return t(
				"settings.approvalEscalation.reason.deliveryUnavailable",
				"No delivery destination available",
			);
	}
}

export function conflictLabel(
	code: ApprovalEscalationPolicyConflictCode,
	t: EscalationTranslate,
): string {
	switch (code) {
		case "differing_timeouts":
			return t(
				"settings.approvalEscalation.conflict.differingTimeouts",
				"Channels used different timeouts; the shortest one became the response window.",
			);
		case "invalid_timeout":
			return t(
				"settings.approvalEscalation.conflict.invalidTimeout",
				"A channel had an invalid timeout and was not used for the response window.",
			);
		case "disabled_active_source":
			return t(
				"settings.approvalEscalation.conflict.disabledActiveSource",
				"Some active channels had escalations turned off. They still do not deliver escalation messages.",
			);
		case "inactive_source_enabled":
			return t(
				"settings.approvalEscalation.conflict.inactiveSourceEnabled",
				"Some inactive channels had escalations turned on. They did not count toward the policy.",
			);
	}
}

export function attentionEventLabel(
	eventType: ApprovalEscalationAttentionEventType,
	t: EscalationTranslate,
): string {
	switch (eventType) {
		case "raised":
			return t("settings.approvalEscalation.event.raised", "Raised");
		case "alerted":
			return t("settings.approvalEscalation.event.alerted", "Admins alerted");
		case "resolved":
			return t("settings.approvalEscalation.event.resolved", "Resolved");
		case "disposed":
			return t("settings.approvalEscalation.event.disposed", "Disposed");
	}
}
