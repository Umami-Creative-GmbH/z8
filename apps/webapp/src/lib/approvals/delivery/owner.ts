import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	type ApprovalDeliveryEffect,
	type ApprovalDeliveryProvider,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { type ApprovalNotice, approvalStatusNotice } from "@/lib/bot-platform/approval-notice";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { loadNotificationChannelPreferences } from "@/lib/notifications/notification-service";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { isCanonicalOnlyApprovalKind, readApprovalAuthoritySnapshot } from "../authority";
import { isCovering, loadEmployeeName } from "../deputy/deputy-reads";
import type { EscalationAttentionInput } from "../escalation/attention";
import {
	raiseEscalationAttention,
	resolveRecoveredEscalationAttentionCondition,
} from "../escalation/attention-store";
import { findLegacyDecisionEvidenceByRequest, listDecisionEvidence } from "../evidence/store";
import { nextApprovalDeliveryAttempt } from "./schedule";
import {
	type ActiveApprovalDeliveryInstallationResolution,
	buildRedactedReconciliationContext,
	type ChatInstallationOriginRecord,
	loadOrganizationInstallationById,
	resolveActiveApprovalDeliveryInstallation,
	resolveCardOriginInstallation,
	shouldQuarantineAcrossSwitch,
} from "./installation-origin";
import {
	type ApprovalDeliveryExecutor,
	type ApprovalDeliveryMessageRecord,
	type ClaimedApprovalDeliveryWork,
	approvalDeliveryMessageReviewReference,
	cardHolderEmployeeId,
	claimApprovalDeliveryWork,
	expandApprovalDeliveryIntents,
	finishApprovalDeliveryWork,
	isApprovalDeliveryAssignmentReplaced,
	loadApprovalDeliveryMessage,
	loadLegacyDeliveryState,
	planDeputyCardRetirements,
	quarantineApprovalDeliveryWorkAcrossSwitch,
	recordApprovalDeliveryDispatchIntent,
	recordDeliveredApprovalMessage,
	retireApprovalDeliveryMessage,
	retireDeputyCardMessage,
	scheduleApprovalMessageRefreshes,
	type UntrackedApprovalCard,
} from "./store";

const logger = createLogger("ApprovalDeliveryOwner");

export const DEFAULT_APPROVAL_DELIVERY_BATCH_LIMIT = 50;

/** A provider call that did not deliver, with its explicit transport outcome. */
export interface ApprovalDeliveryFailure {
	kind: "failed";
	outcome: "retryable" | "ambiguous" | "destination_invalid" | "unavailable" | "permanent";
	reason: string;
}

export type ApprovalInitialSendResult =
	| {
			kind: "accepted";
			receiverScope: string;
			destinationId: string;
			remoteMessageId: string;
			bindingId: string | null;
			controls: "actionable" | "none";
			/** Originating chat installation used for the send (#2043). */
			installationId?: string | null;
			/** Credential revision used for the send (#2043). */
			credentialRevisionId?: string | null;
	  }
	| { kind: "suppressed"; reason: string }
	| ApprovalDeliveryFailure;

export type ApprovalRefreshResult =
	| { kind: "accepted" }
	| { kind: "current" }
	| { kind: "gone"; reason: string }
	| ApprovalDeliveryFailure;

/**
 * Provider mechanics only: preparation of the shared presentation, layout,
 * destination and transport. Authority, scheduling and tracking stay here.
 */
export interface ApprovalDeliveryAdapter {
	provider: ApprovalDeliveryProvider;
	/**
	 * The channel's current escalation-delivery preference (#251 §4.3). It
	 * freezes a transfer's intended channels at expansion and is rechecked by
	 * `sendInitial` for every replacement card.
	 */
	acceptsEscalationDelivery(organizationId: string): Promise<boolean>;
	sendInitial(input: {
		organizationId: string;
		/** The compatibility request the card names; null for a canonical-only kind. */
		approvalRequestId: string | null;
		/**
		 * The exact assignment of a canonical-only kind (#1059), which has no legacy
		 * request: the card is prepared and bound for it instead.
		 */
		canonicalAssignment?: { workflowId: string; stageId: string; assignmentId: string };
		recipientEmployeeId: string;
		recipientUserId: string;
		/**
		 * A deputy card (#1017): the absent approver the recipient covers for, whose
		 * assignment or request the card is bound to. Never inferred.
		 */
		actingForEmployeeId?: string | null;
		/** `replacement`: the card of an escalation's replacement assignment (#300). */
		purpose: Exclude<ApprovalDeliveryEffect, "refresh">;
		/** Target active installation resolved by the delivery owner (#2043). */
		targetInstallation?: ChatInstallationOriginRecord | null;
	}): Promise<ApprovalInitialSendResult>;
	refresh(input: {
		organizationId: string;
		message: ApprovalDeliveryMessageRecord;
		notice: ApprovalNotice;
		/** Originating installation resolved for this card (#2043). */
		originInstallation?: ChatInstallationOriginRecord | null;
	}): Promise<ApprovalRefreshResult>;
	/**
	 * The cards the provider's old notification path sent for one legacy
	 * request to one recipient, which no delivery work produced (#408).
	 * Escalation adopts them to retire them after a legacy transfer, with the
	 * identity only this provider's current installation can edit. Providers
	 * without such a tracked path omit it.
	 */
	listUntrackedLegacyCards?(input: {
		organizationId: string;
		approvalRequestId: string;
		recipientUserId: string;
	}): Promise<UntrackedApprovalCard[]>;
}

export async function loadApprovalDeliveryAdapter(
	provider: ApprovalDeliveryProvider,
): Promise<ApprovalDeliveryAdapter> {
	switch (provider) {
		case "telegram":
			return (await import("@/lib/telegram/approval-delivery")).telegramApprovalDeliveryAdapter;
		case "teams":
			return (await import("@/lib/teams/approval-delivery")).teamsApprovalDeliveryAdapter;
		case "slack":
			return (await import("@/lib/slack/approval-delivery")).slackApprovalDeliveryAdapter;
		case "discord":
			return (await import("@/lib/discord/approval-delivery")).discordApprovalDeliveryAdapter;
	}
}

interface WorkState {
	workflowStatus: string;
	workflowVersion: number;
	assignmentStatus: string;
	stageId: string | null;
	approvalRequestId: string | null;
	/** Legacy lifecycles: the request's current approver (reassignment check). */
	approverEmployeeId: string | null;
}

async function loadWorkState(
	work: Pick<
		ClaimedApprovalDeliveryWork,
		"organizationId" | "workflowId" | "assignmentId" | "legacy"
	>,
): Promise<WorkState | null> {
	if (work.legacy) {
		// A legacy lifecycle (#296): its request stands in for the assignment
		// and the source's status for the workflow's.
		const legacy = await loadLegacyDeliveryState({
			organizationId: work.organizationId,
			lifecycle: work.legacy,
			approvalRequestId: work.legacy.approvalRequestId,
		});
		return legacy
			? {
					workflowStatus: legacy.lifecycleStatus,
					workflowVersion: legacy.version,
					assignmentStatus: legacy.requestStatus,
					stageId: null,
					approvalRequestId: work.legacy.approvalRequestId,
					approverEmployeeId: legacy.approverEmployeeId,
				}
			: null;
	}
	if (!work.workflowId || !work.assignmentId) return null;
	const [state] = await db
		.select({
			workflowStatus: approvalWorkflow.status,
			workflowVersion: approvalWorkflow.version,
			assignmentStatus: approvalStageAssignment.status,
			stageId: approvalStageAssignment.stageId,
			approvalRequestId: approvalWorkflowStage.legacyApprovalRequestId,
		})
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.innerJoin(
			approvalWorkflowStage,
			and(
				eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
				eq(approvalWorkflowStage.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, work.organizationId),
				eq(approvalStageAssignment.workflowId, work.workflowId),
				eq(approvalStageAssignment.id, work.assignmentId),
			),
		)
		.limit(1);
	return state ? { ...state, approverEmployeeId: null } : null;
}

function attentionCondition(
	work: ClaimedApprovalDeliveryWork,
	reason: "delivery_exhausted" | "delivery_unavailable" | "unsupported_route",
	evidence: Record<string, unknown>,
	approvalRequestId: string | null,
	now: Instant,
	outcome: string,
): EscalationAttentionInput {
	return {
		organizationId: work.organizationId,
		reason,
		// A legacy request has no assignment row; it and its approver stand in.
		subject: work.legacy
			? {
					kind: "legacy_assignment",
					approvalRequestId: work.legacy.approvalRequestId,
					approverEmployeeId: work.recipientEmployeeId,
				}
			: { kind: "assignment", assignmentId: work.assignmentId ?? "" },
		deliveryChannel: work.provider,
		approvalType: work.workflowType,
		...(approvalRequestId
			? { approvalRequestId }
			: work.legacy
				? { approvalRequestId: work.legacy.approvalRequestId }
				: {}),
		...(work.workflowId ? { workflowId: work.workflowId } : {}),
		currentApproverEmployeeId: work.recipientEmployeeId,
		evidence: {
			workId: work.id,
			effect: work.effect,
			attemptCount: work.attemptCount,
			...evidence,
		},
		attempts: [
			{
				kind: work.effect === "refresh" ? "retirement" : "delivery",
				channel: work.provider,
				reference: work.id,
				outcome,
				at: now.toString(),
			},
		],
	};
}

async function finishWithAttention(
	work: ClaimedApprovalDeliveryWork,
	input: {
		status: "awaiting_repair" | "exhausted" | "failed";
		outcome: string;
		dispatchAttemptState?:
			| "confirmed_unsent"
			| "intent_recorded"
			| "none"
			| "sent"
			| "uncertain_across_switch"
			| "closed_unknown";
		attention: EscalationAttentionInput;
	},
): Promise<boolean> {
	return db.transaction(async (transaction) => {
		const finished = await finishApprovalDeliveryWork(transaction, {
			work,
			status: input.status,
			outcome: input.outcome,
			...(input.dispatchAttemptState !== undefined
				? { dispatchAttemptState: input.dispatchAttemptState }
				: {}),
		});
		// Only the lease holder records the condition it observed.
		if (finished) await raiseEscalationAttention(transaction, input.attention);
		return finished;
	});
}

async function resolveDeliveryAttention(
	executor: ApprovalDeliveryExecutor,
	work: ClaimedApprovalDeliveryWork,
	now: Instant,
): Promise<void> {
	for (const reason of ["delivery_exhausted", "delivery_unavailable"] as const) {
		await resolveRecoveredEscalationAttentionCondition(
			executor,
			attentionCondition(work, reason, { recovered: "delivered" }, null, now, "delivered"),
		);
	}
}

export type ApprovalDeliveryOutcome =
	| "delivered"
	| "retry_scheduled"
	| "exhausted"
	| "awaiting_repair"
	| "failed"
	| "suppressed"
	| "cancelled"
	| "lease_lost"
	| "uncertain_across_switch";

function resolvedActiveInstallationId(
	resolution: ActiveApprovalDeliveryInstallationResolution,
): string | null {
	if (resolution.kind === "active" || resolution.kind === "legacy") {
		return resolution.installation.id;
	}
	return null;
}

async function maybeQuarantineWorkAcrossSwitch(input: {
	work: ClaimedApprovalDeliveryWork;
	activeResolution?: ActiveApprovalDeliveryInstallationResolution;
	now: Instant;
	reason: "lease_expired_across_switch" | "ambiguous_outcome_across_switch";
	failureReason?: string | null;
}): Promise<ApprovalDeliveryOutcome | null> {
	const { work, now } = input;
	if (work.effect === "refresh") return null;
	if (work.dispatchAttemptState !== "intent_recorded" || !work.installationId) {
		return null;
	}
	const activeResolution =
		input.activeResolution ??
		(await resolveActiveApprovalDeliveryInstallation(work.organizationId, work.provider));
	const activeInstallationId = resolvedActiveInstallationId(activeResolution);
	const attemptedInstallation = await loadOrganizationInstallationById(
		work.organizationId,
		work.installationId,
	);
	const shouldQuarantine = shouldQuarantineAcrossSwitch({
		dispatchAttemptState: work.dispatchAttemptState,
		attemptedInstallationId: work.installationId,
		attemptedInstallationStatus: attemptedInstallation?.status ?? null,
		activeInstallationId,
	});
	if (!shouldQuarantine) return null;

	const context = buildRedactedReconciliationContext({
		reason: input.reason,
		provider: work.provider,
		effect: work.effect,
		attemptedInstallationId: work.installationId,
		attemptedCredentialRevisionId: work.credentialRevisionId,
		activeInstallationId,
		dispatchIntentAt: work.dispatchIntentAt,
		detectedAt: now,
		failureReason: input.failureReason ?? null,
		attemptCount: work.attemptCount,
	});
	logger.error(
		{
			organizationId: work.organizationId,
			workId: work.id,
			...context,
		},
		"Approval delivery attempt outcome uncertain across installation switch; quarantined for operator reconciliation",
	);
	const quarantined = await quarantineApprovalDeliveryWorkAcrossSwitch(db, {
		work,
		context,
		now,
	});
	return quarantined ? "uncertain_across_switch" : "lease_lost";
}

async function handleFailure(
	work: ClaimedApprovalDeliveryWork,
	failure: ApprovalDeliveryFailure,
	approvalRequestId: string | null,
	now: Instant,
): Promise<ApprovalDeliveryOutcome> {
	if (failure.outcome === "ambiguous") {
		const quarantined = await maybeQuarantineWorkAcrossSwitch({
			work,
			now,
			reason: "ambiguous_outcome_across_switch",
			failureReason: failure.reason,
		});
		if (quarantined) return quarantined;
	}
	const outcome = `${failure.outcome}:${failure.reason}`;
	const evidence = { outcome: failure.outcome, reason: failure.reason };
	// Ambiguous failures may have been accepted by the provider; keep
	// `intent_recorded` so a subsequent switch quarantines instead of resending.
	// Explicit rejections or pre-send errors are confirmed unsent and may reroute.
	const dispatchAttemptState =
		failure.outcome === "ambiguous"
			? (work.dispatchAttemptState ?? "intent_recorded")
			: "confirmed_unsent";
	switch (failure.outcome) {
		case "retryable":
		case "ambiguous": {
			const next = nextApprovalDeliveryAttempt({
				retriesSoFar: work.retryCount,
				attemptedAt: now,
			});
			if (next.kind === "retry") {
				const finished = await finishApprovalDeliveryWork(db, {
					work,
					status: "pending",
					outcome,
					availableAt: next.availableAt,
					retryCount: next.retryCount,
					dispatchAttemptState,
				});
				return finished ? "retry_scheduled" : "lease_lost";
			}
			const finished = await finishWithAttention(work, {
				status: "exhausted",
				outcome,
				dispatchAttemptState,
				attention: attentionCondition(
					work,
					"delivery_exhausted",
					evidence,
					approvalRequestId,
					now,
					outcome,
				),
			});
			return finished ? "exhausted" : "lease_lost";
		}
		case "destination_invalid":
		case "unavailable": {
			const finished = await finishWithAttention(work, {
				status: "awaiting_repair",
				outcome,
				dispatchAttemptState,
				attention: attentionCondition(
					work,
					"delivery_unavailable",
					evidence,
					approvalRequestId,
					now,
					outcome,
				),
			});
			return finished ? "awaiting_repair" : "lease_lost";
		}
		case "permanent": {
			const finished = await finishWithAttention(work, {
				status: "failed",
				outcome,
				dispatchAttemptState,
				attention: attentionCondition(
					work,
					"delivery_exhausted",
					evidence,
					approvalRequestId,
					now,
					outcome,
				),
			});
			return finished ? "failed" : "lease_lost";
		}
	}
}

async function finishSimply(
	work: ClaimedApprovalDeliveryWork,
	status: "delivered" | "suppressed" | "cancelled",
	outcome: string,
	dispatchAttemptState?: "confirmed_unsent" | "sent",
): Promise<ApprovalDeliveryOutcome> {
	const finished = await finishApprovalDeliveryWork(db, {
		work,
		status,
		outcome,
		...(dispatchAttemptState ? { dispatchAttemptState } : {}),
	});
	return finished ? status : "lease_lost";
}

/**
 * Escalation's work acts only under the authority its transfer committed
 * under (#408): legacy replacement and retirement work while the kind has
 * legacy authority, canonical escalation work while it has canonical
 * authority. After a cutover between planning and send it acts under neither.
 */
async function escalationAuthorityHolds(work: ClaimedApprovalDeliveryWork): Promise<boolean> {
	if (!work.escalationTransferId) return true;
	const { authority } = await readApprovalAuthoritySnapshot(db, {
		organizationId: work.organizationId,
		workflowType: work.workflowType,
	});
	return authority === (work.lifecycle === "legacy" ? "legacy" : "canonical");
}

/**
 * Initial or replacement card for one assignment. Current state is rechecked
 * before any fresh details leave: a no-longer-pending assignment is obsolete
 * (for a replacement: authority moved on), and preferences,
 * membership/entitlement, integration and escalation-delivery enablement and
 * the destination are checked at send time.
 */
async function processInitial(
	work: ClaimedApprovalDeliveryWork,
	adapter: ApprovalDeliveryAdapter,
	clock: () => Instant,
): Promise<ApprovalDeliveryOutcome> {
	let now = clock();
	// If a prior worker recorded dispatch intent and crashed or left an
	// ambiguous outcome, and the active installation switched in the meantime,
	// quarantine immediately so neither installation receives a duplicate card.
	if (work.dispatchAttemptState === "intent_recorded" && work.installationId) {
		const quarantined = await maybeQuarantineWorkAcrossSwitch({
			work,
			now,
			reason: "lease_expired_across_switch",
		});
		if (quarantined) return quarantined;
	}
	if (!(await escalationAuthorityHolds(work))) {
		return finishSimply(work, "cancelled", "authority_changed");
	}
	const state = await loadWorkState(work);
	if (!state) return finishSimply(work, "cancelled", "purged");
	// A deputy card (#1017) belongs to the absent approver it acts for.
	const holder = cardHolderEmployeeId(work);
	if (
		state.workflowStatus !== "pending" ||
		state.assignmentStatus !== "pending" ||
		// A legacy request moved to another approver no longer needs this card.
		(state.approverEmployeeId !== null && state.approverEmployeeId !== holder)
	) {
		return finishSimply(work, "cancelled", "obsolete");
	}
	if (
		work.actingForEmployeeId &&
		!(await isCovering(db, {
			organizationId: work.organizationId,
			approverId: work.actingForEmployeeId,
			deputyId: work.recipientEmployeeId,
			at: now,
		}))
	) {
		return finishSimply(work, "cancelled", "not_covering");
	}
	const [recipient] = await db
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.id, work.recipientEmployeeId),
				eq(employee.organizationId, work.organizationId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!recipient) return finishSimply(work, "cancelled", "recipient_inactive");
	// A canonical-only kind (#1059) has no legacy request: its card names the assignment.
	const canonicalAssignment =
		!state.approvalRequestId &&
		isCanonicalOnlyApprovalKind(work.workflowType) &&
		work.workflowId &&
		work.assignmentId &&
		state.stageId
			? { workflowId: work.workflowId, stageId: state.stageId, assignmentId: work.assignmentId }
			: null;
	if (!state.approvalRequestId && !canonicalAssignment) {
		const finished = await finishWithAttention(work, {
			status: "failed",
			outcome: "permanent:unsupported_reference",
			attention: attentionCondition(
				work,
				"unsupported_route",
				{ reason: "no_compatibility_reference" },
				null,
				now,
				"unsupported_reference",
			),
		});
		return finished ? "failed" : "lease_lost";
	}
	const preferences = await loadNotificationChannelPreferences(
		recipient.userId,
		"approval_request_submitted",
	);
	if (!preferences[work.provider]) {
		return finishSimply(work, "suppressed", "preference_disabled", "confirmed_unsent");
	}
	const activeResolution = await resolveActiveApprovalDeliveryInstallation(
		work.organizationId,
		work.provider,
	);
	if (activeResolution.kind === "none") {
		return handleFailure(
			work,
			{ kind: "failed", outcome: "unavailable", reason: "installation_unavailable" },
			state.approvalRequestId,
			now,
		);
	}
	const targetInstallation =
		activeResolution.kind === "active" || activeResolution.kind === "legacy"
			? activeResolution.installation
			: null;
	// Attempt time, lease renewal, and durable pre-dispatch intent persistence
	// right before calling the provider adapter (#2043).
	now = clock();
	if (
		!(await recordApprovalDeliveryDispatchIntent({
			work,
			installationId: targetInstallation?.id ?? null,
			credentialRevisionId: targetInstallation?.activeCredentialRevisionId ?? null,
			now,
		}))
	) {
		return "lease_lost";
	}
	work.installationId = targetInstallation?.id ?? null;
	work.credentialRevisionId = targetInstallation?.activeCredentialRevisionId ?? null;
	work.dispatchIntentAt = now;
	work.dispatchAttemptState = "intent_recorded";
	const sent = await adapter.sendInitial({
		organizationId: work.organizationId,
		approvalRequestId: state.approvalRequestId,
		...(canonicalAssignment ? { canonicalAssignment } : {}),
		recipientEmployeeId: work.recipientEmployeeId,
		recipientUserId: recipient.userId,
		...(work.actingForEmployeeId ? { actingForEmployeeId: work.actingForEmployeeId } : {}),
		purpose: work.effect === "replacement" ? "replacement" : "initial",
		targetInstallation,
	});
	if (sent.kind === "suppressed") {
		return finishSimply(work, "suppressed", sent.reason, "confirmed_unsent");
	}
	if (sent.kind === "failed") {
		return handleFailure(work, sent, state.approvalRequestId, now);
	}
	const deliveredInstallationId = sent.installationId ?? targetInstallation?.id ?? null;
	const deliveredCredentialRevisionId =
		sent.credentialRevisionId ?? targetInstallation?.activeCredentialRevisionId ?? null;
	// Identity first: a late or duplicate send is tracked even if our lease
	// was taken over, so it can still be refreshed and retired.
	const remote = {
		organizationId: work.organizationId,
		approvalRequestId: state.approvalRequestId,
		recipientEmployeeId: work.recipientEmployeeId,
		recipientUserId: recipient.userId,
		actingForEmployeeId: work.actingForEmployeeId,
		provider: work.provider,
		receiverScope: sent.receiverScope,
		destinationId: sent.destinationId,
		remoteMessageId: sent.remoteMessageId,
		installationId: deliveredInstallationId,
		credentialRevisionId: deliveredCredentialRevisionId,
		bindingId: sent.bindingId,
		originWorkId: work.id,
		controls: sent.controls,
		statusVersion: state.workflowVersion,
	};
	const recorded = work.legacy
		? await recordDeliveredApprovalMessage({ ...remote, legacy: work.legacy })
		: await recordDeliveredApprovalMessage({
				...remote,
				workflowId: work.workflowId ?? "",
				stageId: state.stageId ?? "",
				assignmentId: work.assignmentId ?? "",
			});
	const finished = await db.transaction(async (transaction) => {
		const done = await finishApprovalDeliveryWork(transaction, {
			work,
			status: "delivered",
			outcome: recorded.kind === "purged" ? "delivered_after_purge" : "delivered",
			dispatchAttemptState: "sent",
		});
		if (done) await resolveDeliveryAttention(transaction, work, now);
		return done;
	});
	// The card was prepared from state read before sending. If the request
	// moved on meanwhile, this message is stale: schedule its retirement.
	// Escalation retires its own stale replacement card.
	if (recorded.kind !== "purged") {
		await scheduleApprovalMessageRefreshes(
			work.legacy
				? {
						organizationId: work.organizationId,
						legacy: work.legacy,
						...(work.escalationTransferId
							? {
									approvalRequestId: work.legacy.approvalRequestId,
									recipientEmployeeId: work.recipientEmployeeId,
									escalationTransferId: work.escalationTransferId,
								}
							: {}),
					}
				: {
						organizationId: work.organizationId,
						workflowId: work.workflowId ?? "",
						...(work.escalationTransferId && work.assignmentId
							? {
									assignmentId: work.assignmentId,
									escalationTransferId: work.escalationTransferId,
								}
							: {}),
					},
		);
	}
	return finished ? "delivered" : "lease_lost";
}

/**
 * Refreshes one delivered message to the request's current status. Only a
 * status notice is ever rendered (never controls), the content is computed
 * from current state, and the recorded version only increases.
 */
async function processRefresh(
	work: ClaimedApprovalDeliveryWork,
	adapter: ApprovalDeliveryAdapter,
	clock: () => Instant,
): Promise<ApprovalDeliveryOutcome> {
	const message = work.messageId
		? await loadApprovalDeliveryMessage({
				organizationId: work.organizationId,
				messageId: work.messageId,
			})
		: null;
	if (!message) return finishSimply(work, "cancelled", "purged");
	if (message.state === "gone") return finishSimply(work, "delivered", "gone");
	if (!(await escalationAuthorityHolds(work))) {
		return finishSimply(work, "cancelled", "authority_changed");
	}
	const state = await loadWorkState(work);
	if (!state) return finishSimply(work, "cancelled", "purged");
	// A replaced assignment (escalation or reassignment) says so on its cards.
	// A legacy transfer (#408) keeps the same request with its replacement, so
	// the former holder's card is replaced whatever the request's status: it
	// never shows the replacement's decision and never regains controls.
	const replaced = await isApprovalDeliveryAssignmentReplaced(message);
	const legacyReplaced = work.legacy !== null && replaced;
	if (
		message.actingForEmployeeId &&
		message.state === "current" &&
		state.workflowStatus === "pending" &&
		state.assignmentStatus === "pending" &&
		!legacyReplaced
	) {
		// Cover ended while the approval is still pending (#1017): no version
		// moved, so this is the deputy card's own retirement.
		return retireDeputyCard(work, adapter, clock, message, state);
	}
	if (message.statusVersion >= state.workflowVersion) {
		return finishSimply(work, "delivered", "current");
	}
	if (
		state.workflowStatus === "pending" &&
		state.assignmentStatus === "pending" &&
		!legacyReplaced
	) {
		return finishSimply(work, "delivered", "still_actionable");
	}
	// Fresh details only for a recipient who is still an active member;
	// otherwise the controls are removed with a generic notice.
	const display = await resolveRecipientDisplayContext({
		userId: message.recipientUserId,
		organizationId: work.organizationId,
	});
	const decided =
		!legacyReplaced &&
		(state.assignmentStatus === "approved" || state.assignmentStatus === "rejected");
	const reassigned = !decided && replaced;
	const evidence =
		!display || !decided
			? null
			: work.legacy
				? // The legacy decision evidence of exactly this request (#296).
					await findLegacyDecisionEvidenceByRequest(db, {
						organizationId: work.organizationId,
						approvalRequestId: work.legacy.approvalRequestId,
					})
				: ((
						await listDecisionEvidence(db, {
							organizationId: work.organizationId,
							workflowId: work.workflowId ?? "",
						})
					).find((record) => record.assignmentId === work.assignmentId) ?? null);
	const notice = await approvalStatusNotice(
		{ workflowStatus: state.workflowStatus, evidence, reassigned },
		display,
		{ userId: message.recipientUserId, organizationId: work.organizationId },
		approvalDeliveryMessageReviewReference(message),
	);
	// Attempt time, origin resolution, lease renewal, and pre-dispatch intent
	// right before editing: refreshes ALWAYS route to the card's originating
	// installation (even while retiring), never to a replacement installation (#2043).
	const now = clock();
	const origin = await resolveCardOriginInstallation({
		organizationId: work.organizationId,
		provider: message.provider,
		installationId: message.installationId,
		receiverScope: message.receiverScope,
		now,
	});
	if (
		origin.kind === "revoked" ||
		origin.kind === "retirement_expired" ||
		origin.kind === "ambiguous_inbox_fallback"
	) {
		const goneReason =
			origin.kind === "revoked"
				? "installation_revoked"
				: origin.kind === "retirement_expired"
					? "installation_retirement_expired"
					: "origin_ambiguous";
		const finished = await db.transaction(async (transaction) => {
			await retireApprovalDeliveryMessage(transaction, {
				organizationId: work.organizationId,
				messageId: message.id,
				statusVersion: state.workflowVersion,
				state: "gone",
			});
			const done = await finishApprovalDeliveryWork(transaction, {
				work,
				status: "delivered",
				outcome: `gone:${goneReason}`,
				dispatchAttemptState: "confirmed_unsent",
			});
			if (done) await resolveDeliveryAttention(transaction, work, now);
			return done;
		});
		return finished ? "delivered" : "lease_lost";
	}
	const originInstallation = origin.kind === "serviceable" ? origin.installation : null;
	if (
		!(await recordApprovalDeliveryDispatchIntent({
			work,
			installationId: originInstallation?.id ?? null,
			credentialRevisionId: originInstallation?.activeCredentialRevisionId ?? null,
			now,
		}))
	) {
		return "lease_lost";
	}
	work.installationId = originInstallation?.id ?? null;
	work.credentialRevisionId = originInstallation?.activeCredentialRevisionId ?? null;
	work.dispatchIntentAt = now;
	work.dispatchAttemptState = "intent_recorded";
	const refreshed = await adapter.refresh({
		organizationId: work.organizationId,
		message,
		notice,
		originInstallation,
	});
	if (refreshed.kind === "failed") {
		return handleFailure(work, refreshed, state.approvalRequestId, now);
	}
	const finished = await db.transaction(async (transaction) => {
		await retireApprovalDeliveryMessage(transaction, {
			organizationId: work.organizationId,
			messageId: message.id,
			statusVersion: state.workflowVersion,
			state: refreshed.kind === "gone" ? "gone" : "retired",
		});
		const done = await finishApprovalDeliveryWork(transaction, {
			work,
			status: "delivered",
			outcome: refreshed.kind === "gone" ? `gone:${refreshed.reason}` : refreshed.kind,
			dispatchAttemptState: "sent",
		});
		if (done) await resolveDeliveryAttention(transaction, work, now);
		return done;
	});
	return finished ? "delivered" : "lease_lost";
}

/**
 * A deputy card whose approval is still pending (#1017): retired with "No
 * longer covering for X" once its recipient no longer covers for X, and left
 * alone while they still do (a later pass may plan it again). It keeps the
 * version it reflects, so a later decision still refreshes it to the outcome.
 */
async function retireDeputyCard(
	work: ClaimedApprovalDeliveryWork,
	adapter: ApprovalDeliveryAdapter,
	clock: () => Instant,
	message: ApprovalDeliveryMessageRecord,
	state: WorkState,
): Promise<ApprovalDeliveryOutcome> {
	const actingFor = message.actingForEmployeeId;
	if (!actingFor) return finishSimply(work, "cancelled", "obsolete");
	if (
		await isCovering(db, {
			organizationId: work.organizationId,
			approverId: actingFor,
			deputyId: message.recipientEmployeeId,
			at: clock(),
		})
	) {
		return finishSimply(work, "cancelled", "still_covering");
	}
	const display = await resolveRecipientDisplayContext({
		userId: message.recipientUserId,
		organizationId: work.organizationId,
	});
	// Without the approver's name the card reads "No longer actionable" instead.
	const approverName = await loadEmployeeName(db, {
		organizationId: work.organizationId,
		employeeId: actingFor,
	});
	const notice = await approvalStatusNotice(
		{
			workflowStatus: state.workflowStatus,
			evidence: null,
			...(approverName ? { noLongerCoveringFor: approverName } : {}),
		},
		display,
		{ userId: message.recipientUserId, organizationId: work.organizationId },
		approvalDeliveryMessageReviewReference(message),
	);
	const now = clock();
	const origin = await resolveCardOriginInstallation({
		organizationId: work.organizationId,
		provider: message.provider,
		installationId: message.installationId,
		receiverScope: message.receiverScope,
		now,
	});
	if (
		origin.kind === "revoked" ||
		origin.kind === "retirement_expired" ||
		origin.kind === "ambiguous_inbox_fallback"
	) {
		const goneReason =
			origin.kind === "revoked"
				? "installation_revoked"
				: origin.kind === "retirement_expired"
					? "installation_retirement_expired"
					: "origin_ambiguous";
		const finished = await db.transaction(async (transaction) => {
			await retireDeputyCardMessage(transaction, {
				organizationId: work.organizationId,
				messageId: message.id,
				state: "gone",
			});
			const done = await finishApprovalDeliveryWork(transaction, {
				work,
				status: "delivered",
				outcome: `gone:${goneReason}`,
				dispatchAttemptState: "confirmed_unsent",
			});
			if (done) await resolveDeliveryAttention(transaction, work, now);
			return done;
		});
		return finished ? "delivered" : "lease_lost";
	}
	const originInstallation = origin.kind === "serviceable" ? origin.installation : null;
	if (
		!(await recordApprovalDeliveryDispatchIntent({
			work,
			installationId: originInstallation?.id ?? null,
			credentialRevisionId: originInstallation?.activeCredentialRevisionId ?? null,
			now,
		}))
	) {
		return "lease_lost";
	}
	work.installationId = originInstallation?.id ?? null;
	work.credentialRevisionId = originInstallation?.activeCredentialRevisionId ?? null;
	work.dispatchIntentAt = now;
	work.dispatchAttemptState = "intent_recorded";
	const refreshed = await adapter.refresh({
		organizationId: work.organizationId,
		message,
		notice,
		originInstallation,
	});
	if (refreshed.kind === "failed") {
		return handleFailure(work, refreshed, state.approvalRequestId, now);
	}
	const finished = await db.transaction(async (transaction) => {
		await retireDeputyCardMessage(transaction, {
			organizationId: work.organizationId,
			messageId: message.id,
			state: refreshed.kind === "gone" ? "gone" : "retired",
		});
		const done = await finishApprovalDeliveryWork(transaction, {
			work,
			status: "delivered",
			outcome: refreshed.kind === "gone" ? `gone:${refreshed.reason}` : "not_covering",
			dispatchAttemptState: "sent",
		});
		if (done) await resolveDeliveryAttention(transaction, work, now);
		return done;
	});
	return finished ? "delivered" : "lease_lost";
}

export interface ApprovalDeliveryRunSummary {
	organizationId: string;
	expanded: number;
	planned: number;
	cancelled: number;
	claimed: number;
	outcomes: Partial<Record<ApprovalDeliveryOutcome, number>>;
}

/**
 * Executes claimed work through the shared transport and tracking, whichever
 * owner claimed it. `now` pins the clock in tests; production reads it per
 * attempt so retry intervals are measured from the actual attempt.
 */
export async function executeApprovalDeliveryWork(
	claimed: readonly ClaimedApprovalDeliveryWork[],
	now?: Instant,
): Promise<Partial<Record<ApprovalDeliveryOutcome, number>>> {
	const clock = () => now ?? systemClock.nowInstant();
	const outcomes: Partial<Record<ApprovalDeliveryOutcome, number>> = {};
	for (const work of claimed) {
		let outcome: ApprovalDeliveryOutcome;
		try {
			const adapter = await loadApprovalDeliveryAdapter(work.provider);
			outcome =
				work.effect === "refresh"
					? await processRefresh(work, adapter, clock)
					: await processInitial(work, adapter, clock);
		} catch (error) {
			// Unexpected failure, possibly after the provider accepted the send:
			// retry on the schedule as ambiguous (it may duplicate) instead of
			// leaving the lease to expire repeatedly.
			logger.error(
				{ error, workId: work.id, organizationId: work.organizationId },
				"Approval delivery attempt failed",
			);
			outcome = await handleFailure(
				work,
				{ kind: "failed", outcome: "ambiguous", reason: "internal_error" },
				null,
				clock(),
			).catch(() => "lease_lost" as const);
		}
		outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
	}
	return outcomes;
}

/**
 * One bounded, organization-scoped delivery pass: expand new lifecycle
 * intents into work, lease due work (including expired leases of crashed
 * workers) and execute it. Callers supply scope and limits only. Work of
 * escalation's replacement delivery (#300) is left to escalation.
 */
export async function processApprovalDeliveries(input: {
	organizationId: string;
	limit?: number;
	workflowId?: string;
	now?: Instant;
}): Promise<ApprovalDeliveryRunSummary> {
	const limit = input.limit ?? DEFAULT_APPROVAL_DELIVERY_BATCH_LIMIT;
	// Production reads the clock per step: work planned just now is due at once.
	const clock = () => input.now ?? systemClock.nowInstant();
	const expansion = await expandApprovalDeliveryIntents({
		organizationId: input.organizationId,
		limit,
		now: clock(),
		...(input.workflowId ? { workflowId: input.workflowId } : {}),
	});
	// Deputy cards whose cover ended (#1017); an organization-wide pass only.
	const retirements = input.workflowId
		? 0
		: await planDeputyCardRetirements({ organizationId: input.organizationId, now: clock() });
	const claimed = await claimApprovalDeliveryWork({
		organizationId: input.organizationId,
		owner: "delivery",
		limit,
		now: clock(),
		...(input.workflowId ? { workflowId: input.workflowId } : {}),
	});
	const outcomes = await executeApprovalDeliveryWork(claimed, input.now);
	return {
		organizationId: input.organizationId,
		expanded: expansion.expanded,
		planned: expansion.created + retirements,
		cancelled: expansion.cancelled,
		claimed: claimed.length,
		outcomes,
	};
}
