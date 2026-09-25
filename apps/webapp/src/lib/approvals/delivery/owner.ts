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
import type { EscalationAttentionInput } from "../escalation/attention";
import {
	raiseEscalationAttention,
	resolveRecoveredEscalationAttentionCondition,
} from "../escalation/attention-store";
import { findLegacyDecisionEvidenceByRequest, listDecisionEvidence } from "../evidence/store";
import { nextApprovalDeliveryAttempt } from "./schedule";
import {
	type ApprovalDeliveryExecutor,
	type ApprovalDeliveryMessageRecord,
	type ClaimedApprovalDeliveryWork,
	approvalDeliveryMessageReviewReference,
	claimApprovalDeliveryWork,
	expandApprovalDeliveryIntents,
	finishApprovalDeliveryWork,
	isApprovalDeliveryAssignmentReplaced,
	loadApprovalDeliveryMessage,
	loadLegacyDeliveryState,
	recordDeliveredApprovalMessage,
	renewApprovalDeliveryLease,
	retireApprovalDeliveryMessage,
	scheduleApprovalMessageRefreshes,
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
		approvalRequestId: string;
		recipientEmployeeId: string;
		recipientUserId: string;
		/** `replacement`: the card of an escalation's replacement assignment (#300). */
		purpose: Exclude<ApprovalDeliveryEffect, "refresh">;
	}): Promise<ApprovalInitialSendResult>;
	refresh(input: {
		organizationId: string;
		message: ApprovalDeliveryMessageRecord;
		notice: ApprovalNotice;
	}): Promise<ApprovalRefreshResult>;
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
		attention: EscalationAttentionInput;
	},
): Promise<boolean> {
	return db.transaction(async (transaction) => {
		const finished = await finishApprovalDeliveryWork(transaction, {
			work,
			status: input.status,
			outcome: input.outcome,
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
	| "lease_lost";

async function handleFailure(
	work: ClaimedApprovalDeliveryWork,
	failure: ApprovalDeliveryFailure,
	approvalRequestId: string | null,
	now: Instant,
): Promise<ApprovalDeliveryOutcome> {
	const outcome = `${failure.outcome}:${failure.reason}`;
	const evidence = { outcome: failure.outcome, reason: failure.reason };
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
				});
				return finished ? "retry_scheduled" : "lease_lost";
			}
			const finished = await finishWithAttention(work, {
				status: "exhausted",
				outcome,
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
): Promise<ApprovalDeliveryOutcome> {
	const finished = await finishApprovalDeliveryWork(db, { work, status, outcome });
	return finished ? status : "lease_lost";
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
	const state = await loadWorkState(work);
	if (!state) return finishSimply(work, "cancelled", "purged");
	if (
		state.workflowStatus !== "pending" ||
		state.assignmentStatus !== "pending" ||
		// A legacy request moved to another approver no longer needs this card.
		(state.approverEmployeeId !== null && state.approverEmployeeId !== work.recipientEmployeeId)
	) {
		return finishSimply(work, "cancelled", "obsolete");
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
	if (!state.approvalRequestId) {
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
		return finishSimply(work, "suppressed", "preference_disabled");
	}
	// Attempt time, and proof the lease still holds right before sending.
	now = clock();
	if (!(await renewApprovalDeliveryLease({ work, now }))) return "lease_lost";
	const sent = await adapter.sendInitial({
		organizationId: work.organizationId,
		approvalRequestId: state.approvalRequestId,
		recipientEmployeeId: work.recipientEmployeeId,
		recipientUserId: recipient.userId,
		purpose: work.effect === "replacement" ? "replacement" : "initial",
	});
	if (sent.kind === "suppressed") return finishSimply(work, "suppressed", sent.reason);
	if (sent.kind === "failed") {
		return handleFailure(work, sent, state.approvalRequestId, now);
	}
	// Identity first: a late or duplicate send is tracked even if our lease
	// was taken over, so it can still be refreshed and retired.
	const remote = {
		organizationId: work.organizationId,
		approvalRequestId: state.approvalRequestId,
		recipientEmployeeId: work.recipientEmployeeId,
		recipientUserId: recipient.userId,
		provider: work.provider,
		receiverScope: sent.receiverScope,
		destinationId: sent.destinationId,
		remoteMessageId: sent.remoteMessageId,
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
				? { organizationId: work.organizationId, legacy: work.legacy }
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
	const state = await loadWorkState(work);
	if (!state) return finishSimply(work, "cancelled", "purged");
	if (message.statusVersion >= state.workflowVersion) {
		return finishSimply(work, "delivered", "current");
	}
	if (state.workflowStatus === "pending" && state.assignmentStatus === "pending") {
		return finishSimply(work, "delivered", "still_actionable");
	}
	// Fresh details only for a recipient who is still an active member;
	// otherwise the controls are removed with a generic notice.
	const display = await resolveRecipientDisplayContext({
		userId: message.recipientUserId,
		organizationId: work.organizationId,
	});
	const decided = state.assignmentStatus === "approved" || state.assignmentStatus === "rejected";
	// A replaced assignment (escalation or reassignment) says so on its cards.
	const reassigned = !decided && (await isApprovalDeliveryAssignmentReplaced(message));
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
		work.organizationId,
		approvalDeliveryMessageReviewReference(message),
	);
	// Attempt time, and proof the lease still holds right before editing: at
	// most one refresh of a message reaches the provider at a time.
	const now = clock();
	if (!(await renewApprovalDeliveryLease({ work, now }))) return "lease_lost";
	const refreshed = await adapter.refresh({
		organizationId: work.organizationId,
		message,
		notice,
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
	const expansion = await expandApprovalDeliveryIntents({
		organizationId: input.organizationId,
		limit,
		...(input.workflowId ? { workflowId: input.workflowId } : {}),
	});
	const claimed = await claimApprovalDeliveryWork({
		organizationId: input.organizationId,
		owner: "delivery",
		limit,
		now: input.now ?? systemClock.nowInstant(),
		...(input.workflowId ? { workflowId: input.workflowId } : {}),
	});
	const outcomes = await executeApprovalDeliveryWork(claimed, input.now);
	return {
		organizationId: input.organizationId,
		expanded: expansion.expanded,
		planned: expansion.created,
		cancelled: expansion.cancelled,
		claimed: claimed.length,
		outcomes,
	};
}
