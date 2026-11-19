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

/** A messaging channel's setup status as recorded at migration time. */
export function channelSetupStatusLabel(
	setupStatus: string,
	t: EscalationTranslate,
): string {
	switch (setupStatus) {
		case "active":
			return t("settings.notifications.status.active", "Active");
		case "pending":
			return t("settings.notifications.status.pending", "Pending");
		case "configured":
			return t("settings.notifications.status.configured", "Configured");
		case "error":
			return t("settings.notifications.status.error", "Error");
		case "disconnected":
			return t("settings.notifications.status.disconnected", "Disconnected");
		case "disabled":
			return t("settings.notifications.status.disabled", "Disabled");
		default:
			return t("settings.notifications.status.unknown", "Unknown status");
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

/** The approval kind of an attention item; unknown kinds stay as recorded. */
export function attentionApprovalTypeLabel(
	approvalType: string,
	t: EscalationTranslate,
): string {
	switch (approvalType) {
		case "absence":
			return t("settings.approvalEscalation.approvalType.absence", "Absence");
		case "absence_change":
			return t(
				"settings.approvalEscalation.approvalType.absenceChange",
				"Absence change",
			);
		case "time_correction":
			return t(
				"settings.approvalEscalation.approvalType.timeCorrection",
				"Time correction",
			);
		case "manual_time_submission":
			return t(
				"settings.approvalEscalation.approvalType.manualTimeSubmission",
				"Manual time submission",
			);
		case "policy_clock_out":
			return t(
				"settings.approvalEscalation.approvalType.policyClockOut",
				"Policy clock-out",
			);
		case "travel_expense":
			return t(
				"settings.approvalEscalation.approvalType.travelExpense",
				"Travel expense",
			);
		case "shift_request":
			return t(
				"settings.approvalEscalation.approvalType.shiftRequest",
				"Shift request",
			);
		case "compliance_exception":
			return t(
				"settings.approvalEscalation.approvalType.complianceException",
				"Compliance exception",
			);
		case "period_submission":
			return t(
				"settings.approvalEscalation.approvalType.periodSubmission",
				"Period submission",
			);
		default:
			return approvalType;
	}
}

/** What a recorded attempt tried to do; unknown kinds stay as recorded. */
export function attemptKindLabel(kind: string, t: EscalationTranslate): string {
	switch (kind) {
		case "transfer":
			return t("settings.approvalEscalation.attempt.kind.transfer", "Transfer");
		case "delivery":
			return t("settings.approvalEscalation.attempt.kind.delivery", "Delivery");
		case "retirement":
			return t(
				"settings.approvalEscalation.attempt.kind.retirement",
				"Message update",
			);
		default:
			return kind;
	}
}

function attemptOutcomeBaseLabel(
	outcome: string,
	t: EscalationTranslate,
): string | null {
	switch (outcome) {
		case "delivered":
			return t(
				"settings.approvalEscalation.attempt.outcome.delivered",
				"Delivered",
			);
		case "delivered_after_purge":
			return t(
				"settings.approvalEscalation.attempt.outcome.deliveredAfterPurge",
				"Delivered after cleanup",
			);
		case "retryable":
			return t(
				"settings.approvalEscalation.attempt.outcome.retryable",
				"Temporary failure",
			);
		case "ambiguous":
			return t(
				"settings.approvalEscalation.attempt.outcome.ambiguous",
				"Result unknown",
			);
		case "destination_invalid":
			return t(
				"settings.approvalEscalation.attempt.outcome.destinationInvalid",
				"Destination invalid",
			);
		case "unavailable":
			return t(
				"settings.approvalEscalation.attempt.outcome.unavailable",
				"Channel unavailable",
			);
		case "permanent":
			return t(
				"settings.approvalEscalation.attempt.outcome.permanent",
				"Permanent failure",
			);
		case "gone":
			return t(
				"settings.approvalEscalation.attempt.outcome.gone",
				"Message no longer available",
			);
		case "not_covering":
			return t(
				"settings.approvalEscalation.attempt.outcome.notCovering",
				"Message no longer current",
			);
		default:
			return null;
	}
}

/**
 * A recorded attempt outcome. Delivery outcomes are `<outcome>:<reason>`; the
 * outcome is labelled and the provider's reason code is kept as evidence.
 */
export function attemptOutcomeLabel(
	outcome: string,
	t: EscalationTranslate,
): string {
	const separator = outcome.indexOf(":");
	if (separator === -1) return attemptOutcomeBaseLabel(outcome, t) ?? outcome;
	const label = attemptOutcomeBaseLabel(outcome.slice(0, separator), t);
	if (label === null) return outcome;
	const reason = outcome.slice(separator + 1);
	return reason ? `${label} (${reason})` : label;
}

/** An evidence field name; unknown fields stay as recorded. */
export function evidenceKeyLabel(key: string, t: EscalationTranslate): string {
	switch (key) {
		case "workId":
			return t(
				"settings.approvalEscalation.evidence.workId",
				"Delivery job",
			);
		case "effect":
			return t("settings.approvalEscalation.evidence.effect", "Message action");
		case "attemptCount":
			return t(
				"settings.approvalEscalation.evidence.attemptCount",
				"Attempts made",
			);
		case "outcome":
			return t("settings.approvalEscalation.evidence.outcome", "Outcome");
		case "reason":
			return t("settings.approvalEscalation.evidence.reason", "Reason code");
		case "recovered":
			return t("settings.approvalEscalation.evidence.recovered", "Recovered by");
		case "cause":
			return t("settings.approvalEscalation.evidence.cause", "Cause");
		case "actionableAt":
			return t(
				"settings.approvalEscalation.evidence.actionableAt",
				"Actionable since",
			);
		case "actionableEvidence":
			return t(
				"settings.approvalEscalation.evidence.actionableEvidence",
				"Actionable since (source)",
			);
		case "deadline":
			return t("settings.approvalEscalation.evidence.deadline", "Deadline");
		case "policyRevision":
			return t(
				"settings.approvalEscalation.evidence.policyRevision",
				"Policy revision",
			);
		case "route":
			return t("settings.approvalEscalation.evidence.route", "Decision path");
		case "error":
			return t("settings.approvalEscalation.evidence.error", "Error");
		case "code":
			return t("settings.approvalEscalation.evidence.code", "Error code");
		default:
			return key;
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
