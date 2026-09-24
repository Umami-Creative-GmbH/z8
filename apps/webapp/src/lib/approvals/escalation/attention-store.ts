import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import type { ApprovalEscalationAttentionReason } from "@/db/schema";
import {
	approvalEscalationAttention,
	approvalEscalationAttentionEvent,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	auditLog,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import {
	classifyEscalationAttentionRecheck,
	type EscalationAttentionInput,
	type EscalationAttentionRecheckResult,
	escalationAttentionApprovalRequestId,
	escalationAttentionAssignmentId,
	escalationAttentionCurrentApproverId,
	escalationAttentionDedupeKey,
} from "./attention";

const logger = createLogger("ApprovalEscalationAttention");

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type EscalationAttentionExecutor = typeof db | DatabaseTransaction;

export const ESCALATION_MANAGEMENT_PATH = "/settings/approval-escalation";
export const MAX_ATTENTION_DISPOSITION_NOTE_LENGTH = 2000;

export interface RaiseEscalationAttentionOutcome {
	kind: "raised" | "observed";
	attentionId: string;
	dedupeKey: string;
}

/**
 * Record an unresolved condition as a committed outcome of the caller's
 * transaction. It never throws to signal the hold, so the attention record
 * commits together with whatever the caller decided (#255 §6). Repeated
 * observations of the same open condition update that incident instead of
 * opening another one.
 */
export async function raiseEscalationAttention(
	executor: EscalationAttentionExecutor,
	input: EscalationAttentionInput,
): Promise<RaiseEscalationAttentionOutcome> {
	if (!input.organizationId) {
		throw new Error("Escalation attention requires organization scope");
	}
	const dedupeKey = escalationAttentionDedupeKey(input);
	const observedAt = new Date();
	const currentApproverEmployeeId = escalationAttentionCurrentApproverId(input);

	const [row] = await executor
		.insert(approvalEscalationAttention)
		.values({
			organizationId: input.organizationId,
			dedupeKey,
			reason: input.reason,
			approvalType: input.approvalType ?? null,
			approvalRequestId: escalationAttentionApprovalRequestId(input),
			workflowId: input.workflowId ?? null,
			assignmentId: escalationAttentionAssignmentId(input),
			lineageRootAssignmentId: input.lineageRootAssignmentId ?? null,
			currentApproverEmployeeId,
			deliveryChannel: input.deliveryChannel ?? null,
			evidence: input.evidence,
			attempts: input.attempts ?? [],
			policyRevision: input.policyRevision ?? null,
			firstRaisedAt: observedAt,
			lastObservedAt: observedAt,
		})
		.onConflictDoUpdate({
			target: [
				approvalEscalationAttention.organizationId,
				approvalEscalationAttention.dedupeKey,
			],
			targetWhere: sql`status = 'open'`,
			set: {
				lastObservedAt: observedAt,
				observationCount: sql`${approvalEscalationAttention.observationCount} + 1`,
				evidence: input.evidence,
				currentApproverEmployeeId,
				...(input.attempts ? { attempts: input.attempts } : {}),
				...(input.policyRevision !== undefined
					? { policyRevision: input.policyRevision }
					: {}),
			},
		})
		.returning({
			id: approvalEscalationAttention.id,
			inserted: sql<boolean>`(xmax = 0)`,
		});

	if (!row) throw new Error("Escalation attention write returned no row");

	if (row.inserted) {
		await executor.insert(approvalEscalationAttentionEvent).values({
			attentionId: row.id,
			organizationId: input.organizationId,
			eventType: "raised",
			actorKind: "system",
			detail: { reason: input.reason, evidence: input.evidence },
		});
	}

	return {
		kind: row.inserted ? "raised" : "observed",
		attentionId: row.id,
		dedupeKey,
	};
}

export type CloseEscalationAttentionOutcome =
	| { kind: "resolved" }
	| { kind: "not_open" };

/**
 * Close an incident because its condition is demonstrably resolved. Callers
 * pass the evidence of recovery; notification delivery is never such evidence.
 */
export async function resolveRecoveredEscalationAttention(
	executor: EscalationAttentionExecutor,
	input: {
		organizationId: string;
		attentionId: string;
		evidence: Record<string, unknown>;
	},
): Promise<CloseEscalationAttentionOutcome> {
	const closedAt = new Date();
	const [row] = await executor
		.update(approvalEscalationAttention)
		.set({ status: "resolved", closedAt, closureNote: null })
		.where(
			and(
				eq(approvalEscalationAttention.id, input.attentionId),
				eq(approvalEscalationAttention.organizationId, input.organizationId),
				eq(approvalEscalationAttention.status, "open"),
			),
		)
		.returning({ id: approvalEscalationAttention.id });

	if (!row) return { kind: "not_open" };

	await executor.insert(approvalEscalationAttentionEvent).values({
		attentionId: row.id,
		organizationId: input.organizationId,
		eventType: "resolved",
		actorKind: "system",
		detail: input.evidence,
	});
	return { kind: "resolved" };
}

/** Resolve the open incident for a condition identified the same way it was raised. */
export async function resolveRecoveredEscalationAttentionCondition(
	executor: EscalationAttentionExecutor,
	condition: EscalationAttentionInput,
): Promise<CloseEscalationAttentionOutcome> {
	const [open] = await executor
		.select({ id: approvalEscalationAttention.id })
		.from(approvalEscalationAttention)
		.where(
			and(
				eq(
					approvalEscalationAttention.organizationId,
					condition.organizationId,
				),
				eq(
					approvalEscalationAttention.dedupeKey,
					escalationAttentionDedupeKey(condition),
				),
				eq(approvalEscalationAttention.status, "open"),
			),
		)
		.limit(1);
	if (!open) return { kind: "not_open" };
	return resolveRecoveredEscalationAttention(executor, {
		organizationId: condition.organizationId,
		attentionId: open.id,
		evidence: condition.evidence,
	});
}

export type DisposeEscalationAttentionOutcome =
	| { kind: "disposed" }
	| { kind: "not_open" }
	| { kind: "not_found" }
	| { kind: "invalid_note" };

/**
 * Explicit human disposition by an approval manager. Callers must have
 * already authorized the actor for this organization. Disposition closes the
 * incident and is audited; it does not change assignment authority or restore
 * an automatic-transfer allowance.
 */
export async function disposeEscalationAttention(input: {
	organizationId: string;
	attentionId: string;
	actorUserId: string;
	note: string;
}): Promise<DisposeEscalationAttentionOutcome> {
	const note = input.note.trim();
	if (!note || note.length > MAX_ATTENTION_DISPOSITION_NOTE_LENGTH) {
		return { kind: "invalid_note" };
	}

	return db.transaction(
		async (tx): Promise<DisposeEscalationAttentionOutcome> => {
			const closedAt = new Date();
			const [row] = await tx
				.update(approvalEscalationAttention)
				.set({
					status: "disposed",
					closedAt,
					closureNote: note,
					disposedByUserId: input.actorUserId,
				})
				.where(
					and(
						eq(approvalEscalationAttention.id, input.attentionId),
						eq(
							approvalEscalationAttention.organizationId,
							input.organizationId,
						),
						eq(approvalEscalationAttention.status, "open"),
					),
				)
				.returning({
					id: approvalEscalationAttention.id,
					reason: approvalEscalationAttention.reason,
					dedupeKey: approvalEscalationAttention.dedupeKey,
				});

			if (!row) {
				const [existing] = await tx
					.select({ id: approvalEscalationAttention.id })
					.from(approvalEscalationAttention)
					.where(
						and(
							eq(approvalEscalationAttention.id, input.attentionId),
							eq(
								approvalEscalationAttention.organizationId,
								input.organizationId,
							),
						),
					)
					.limit(1);
				return { kind: existing ? "not_open" : "not_found" };
			}

			await tx.insert(approvalEscalationAttentionEvent).values({
				attentionId: row.id,
				organizationId: input.organizationId,
				eventType: "disposed",
				actorKind: "user",
				actorUserId: input.actorUserId,
				detail: { note },
			});
			await tx.insert(auditLog).values({
				organizationId: input.organizationId,
				entityType: "approval_escalation_attention",
				entityId: row.id,
				action: AuditAction.APPROVAL_ESCALATION_ATTENTION_DISPOSED,
				performedBy: input.actorUserId,
				changes: JSON.stringify({ status: { from: "open", to: "disposed" } }),
				metadata: JSON.stringify({
					reason: row.reason,
					dedupeKey: row.dedupeKey,
					note,
				}),
			});
			return { kind: "disposed" };
		},
	);
}

export interface EscalationAttentionRecheckSummary {
	checked: number;
	resolved: number;
	persisting: number;
}

/**
 * Bounded, organization-scoped recheck of open incidents against current
 * authoritative approval/assignment state. Incidents whose subject has settled
 * are closed as recovered; everything else stays open.
 */
export async function recheckEscalationAttention(input: {
	organizationId: string;
	limit?: number;
}): Promise<EscalationAttentionRecheckSummary> {
	if (!input.organizationId)
		throw new Error("Escalation attention recheck requires organization scope");
	const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

	const incidents = await db
		.select({
			id: approvalEscalationAttention.id,
			reason: approvalEscalationAttention.reason,
			approvalRequestId: approvalEscalationAttention.approvalRequestId,
			workflowId: approvalEscalationAttention.workflowId,
			assignmentId: approvalEscalationAttention.assignmentId,
			currentApproverEmployeeId:
				approvalEscalationAttention.currentApproverEmployeeId,
		})
		.from(approvalEscalationAttention)
		.where(
			and(
				eq(approvalEscalationAttention.organizationId, input.organizationId),
				eq(approvalEscalationAttention.status, "open"),
			),
		)
		.orderBy(
			sql`${approvalEscalationAttention.lastRecheckedAt} asc nulls first`,
			asc(approvalEscalationAttention.firstRaisedAt),
		)
		.limit(limit);

	if (incidents.length === 0) return { checked: 0, resolved: 0, persisting: 0 };

	const ids = <T extends string | null>(values: T[]) => [
		...new Set(
			values.filter((value): value is NonNullable<T> => value !== null),
		),
	];
	const workflowIds = ids(incidents.map((incident) => incident.workflowId));
	const requestIds = ids(
		incidents.map((incident) => incident.approvalRequestId),
	);
	const assignmentIds = ids(incidents.map((incident) => incident.assignmentId));

	const [workflows, requests, assignments] = await Promise.all([
		workflowIds.length
			? db
					.select({ id: approvalWorkflow.id, status: approvalWorkflow.status })
					.from(approvalWorkflow)
					.where(
						and(
							eq(approvalWorkflow.organizationId, input.organizationId),
							inArray(approvalWorkflow.id, workflowIds),
						),
					)
			: [],
		requestIds.length
			? db
					.select({
						id: approvalRequest.id,
						status: approvalRequest.status,
						approverId: approvalRequest.approverId,
					})
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.organizationId, input.organizationId),
							inArray(approvalRequest.id, requestIds),
						),
					)
			: [],
		assignmentIds.length
			? db
					.select({
						id: approvalStageAssignment.id,
						status: approvalStageAssignment.status,
					})
					.from(approvalStageAssignment)
					.where(
						and(
							eq(approvalStageAssignment.organizationId, input.organizationId),
							inArray(approvalStageAssignment.id, assignmentIds),
						),
					)
			: [],
	]);
	const workflowById = new Map(workflows.map((row) => [row.id, row]));
	const requestById = new Map(requests.map((row) => [row.id, row]));
	const assignmentById = new Map(assignments.map((row) => [row.id, row]));

	let resolved = 0;
	const persistingIds: string[] = [];
	for (const incident of incidents) {
		const request = incident.approvalRequestId
			? requestById.get(incident.approvalRequestId)
			: undefined;
		const result: EscalationAttentionRecheckResult =
			classifyEscalationAttentionRecheck(incident, {
				workflowStatus: incident.workflowId
					? (workflowById.get(incident.workflowId)?.status ?? null)
					: undefined,
				approvalStatus: incident.approvalRequestId
					? (request?.status ?? null)
					: undefined,
				approvalApproverEmployeeId: incident.approvalRequestId
					? (request?.approverId ?? null)
					: undefined,
				assignmentStatus: incident.assignmentId
					? (assignmentById.get(incident.assignmentId)?.status ?? null)
					: undefined,
			});

		if (result.kind === "recovered") {
			const outcome = await resolveRecoveredEscalationAttention(db, {
				organizationId: input.organizationId,
				attentionId: incident.id,
				evidence: { cause: result.cause, observedBy: "recheck" },
			});
			if (outcome.kind === "resolved") resolved += 1;
		} else {
			persistingIds.push(incident.id);
		}
	}

	if (persistingIds.length > 0) {
		await db
			.update(approvalEscalationAttention)
			.set({ lastRecheckedAt: new Date() })
			.where(
				and(
					eq(approvalEscalationAttention.organizationId, input.organizationId),
					eq(approvalEscalationAttention.status, "open"),
					inArray(approvalEscalationAttention.id, persistingIds),
				),
			);
	}

	return {
		checked: incidents.length,
		resolved,
		persisting: persistingIds.length,
	};
}

const ATTENTION_ALERT_MESSAGES: Record<
	ApprovalEscalationAttentionReason,
	string
> = {
	no_eligible_backup:
		"An overdue approval has no eligible backup approver. The current approver keeps the assignment.",
	replacement_overdue:
		"An approval is still undecided after its automatic escalation. No further automatic transfer will happen.",
	unsupported_route:
		"An approval cannot be escalated because its decision path is not supported.",
	ambiguous_history:
		"An approval's escalation history is ambiguous and needs review before any automatic transfer.",
	delivery_exhausted:
		"Escalation notifications for an approval failed after all retries.",
	delivery_unavailable:
		"No escalation notification destination is available for an approval.",
};

export interface EscalationAttentionAlertSummary {
	incidents: number;
	alerted: number;
	failedRecipients: number;
}

/**
 * Preference-aware alerts for approved organization admins/owners, sent at
 * most once per recipient per incident via notification idempotency keys.
 * Alert state is bookkeeping only; it never resolves or changes the incident.
 */
export async function dispatchEscalationAttentionAlerts(input: {
	organizationId: string;
	limit?: number;
}): Promise<EscalationAttentionAlertSummary> {
	if (!input.organizationId)
		throw new Error("Escalation attention alerts require organization scope");
	const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

	const incidents = await db
		.select({
			id: approvalEscalationAttention.id,
			reason: approvalEscalationAttention.reason,
		})
		.from(approvalEscalationAttention)
		.where(
			and(
				eq(approvalEscalationAttention.organizationId, input.organizationId),
				eq(approvalEscalationAttention.status, "open"),
				isNull(approvalEscalationAttention.adminAlertedAt),
			),
		)
		.orderBy(asc(approvalEscalationAttention.firstRaisedAt))
		.limit(limit);
	if (incidents.length === 0)
		return { incidents: 0, alerted: 0, failedRecipients: 0 };

	const recipients = await db
		.select({ userId: member.userId })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				inArray(member.role, ["owner", "admin"]),
				eq(member.status, "approved"),
			),
		);
	if (recipients.length === 0) {
		return { incidents: incidents.length, alerted: 0, failedRecipients: 0 };
	}

	let alerted = 0;
	let failedRecipients = 0;
	for (const incident of incidents) {
		let failed = 0;
		for (const recipient of recipients) {
			try {
				await createNotification(
					{
						userId: recipient.userId,
						organizationId: input.organizationId,
						type: "approval_escalation_attention",
						title: "Approval escalation needs attention",
						message: ATTENTION_ALERT_MESSAGES[incident.reason],
						entityType: "approval_escalation_attention",
						entityId: incident.id,
						actionUrl: ESCALATION_MANAGEMENT_PATH,
						idempotencyKey: `approval-escalation-attention:${incident.id}:${recipient.userId}`,
					},
					{ throwOnError: true },
				);
			} catch (error) {
				failed += 1;
				logger.warn(
					{
						error,
						organizationId: input.organizationId,
						attentionId: incident.id,
					},
					"Escalation attention alert failed",
				);
			}
		}
		failedRecipients += failed;
		// Leave the incident un-alerted when any recipient failed so a later run
		// retries; idempotency keys suppress duplicates for recipients already notified.
		if (failed > 0) continue;

		const [marked] = await db
			.update(approvalEscalationAttention)
			.set({ adminAlertedAt: new Date() })
			.where(
				and(
					eq(approvalEscalationAttention.id, incident.id),
					eq(approvalEscalationAttention.organizationId, input.organizationId),
					isNull(approvalEscalationAttention.adminAlertedAt),
				),
			)
			.returning({ id: approvalEscalationAttention.id });
		if (!marked) continue;
		await db.insert(approvalEscalationAttentionEvent).values({
			attentionId: incident.id,
			organizationId: input.organizationId,
			eventType: "alerted",
			actorKind: "system",
			detail: { recipientCount: recipients.length },
		});
		alerted += 1;
	}

	return { incidents: incidents.length, alerted, failedRecipients };
}
