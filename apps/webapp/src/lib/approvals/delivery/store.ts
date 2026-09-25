import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	type ApprovalDeliveryEffect,
	type ApprovalDeliveryProvider,
	type ApprovalDeliveryStatus,
	absenceEntry,
	approvalDeliveryControl,
	approvalDeliveryMessage,
	approvalDeliveryWork,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
} from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { ApprovalReviewReference } from "../presentation/review-navigation";
import type { ApprovalWorkflowType } from "../workflow/ports";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ApprovalDeliveryExecutor = typeof db | DatabaseTransaction;

/** Long enough for one provider call (30 s timeout) plus its bookkeeping. */
export const APPROVAL_DELIVERY_LEASE_MS = 120_000;

function rows(result: unknown): Record<string, unknown>[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	const value = (result as { rows?: unknown }).rows;
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function text(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw new Error(`Approval delivery row has no ${field}`);
	}
	return value;
}

/**
 * The delivery owner is active for an organization, kind and provider only
 * while a control row exists and the kind has canonical authority there;
 * otherwise the existing notification path keeps the effect.
 */
export async function isApprovalDeliveryOwner(input: {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	provider: ApprovalDeliveryProvider;
}): Promise<boolean> {
	const [row] = await db
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalDeliveryControl)
		.innerJoin(
			approvalWorkflowRollout,
			and(
				eq(approvalWorkflowRollout.organizationId, approvalDeliveryControl.organizationId),
				eq(approvalWorkflowRollout.workflowType, approvalDeliveryControl.workflowType),
			),
		)
		.where(
			and(
				eq(approvalDeliveryControl.organizationId, input.organizationId),
				eq(approvalDeliveryControl.workflowType, input.workflowType),
				eq(approvalDeliveryControl.provider, input.provider),
			),
		)
		.limit(1);
	return row?.mode === "canonical" || row?.mode === "complete";
}

/**
 * Whether the delivery owner sends this absence's card on a provider: the
 * owner is active there and the absence has a canonical workflow, whose
 * committed intents the owner delivers. A legacy request (e.g. a policy
 * fallback) keeps the existing notification path.
 */
export async function isAbsenceCardDeliveredByOwner(input: {
	organizationId: string;
	absenceId: string | undefined;
	provider: ApprovalDeliveryProvider;
}): Promise<boolean> {
	if (!input.absenceId) return false;
	const owner = await isApprovalDeliveryOwner({
		organizationId: input.organizationId,
		workflowType: "absence",
		provider: input.provider,
	});
	if (!owner) return false;
	const [absence] = await db
		.select({ approvalWorkflowId: absenceEntry.approvalWorkflowId })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
		)
		.limit(1);
	return Boolean(absence?.approvalWorkflowId);
}

/** Organizations with at least one delivery control, in stable order. */
export async function listApprovalDeliveryOrganizations(): Promise<string[]> {
	const found = await db
		.selectDistinct({ organizationId: approvalDeliveryControl.organizationId })
		.from(approvalDeliveryControl)
		.orderBy(approvalDeliveryControl.organizationId);
	return found.map((row) => row.organizationId);
}

export async function hasApprovalDeliveryControl(organizationId: string): Promise<boolean> {
	const [row] = await db
		.select({ organizationId: approvalDeliveryControl.organizationId })
		.from(approvalDeliveryControl)
		.where(eq(approvalDeliveryControl.organizationId, organizationId))
		.limit(1);
	return Boolean(row);
}

function initialDedupeKey(assignmentId: string, provider: string): string {
	return `approval-delivery:v1:initial:${assignmentId}:${provider}`;
}

function refreshDedupeKey(messageId: string, workflowVersion: number): string {
	return `approval-delivery:v1:refresh:${messageId}:${workflowVersion}`;
}

/**
 * Plans every effect the workflow's current state requires: an initial card
 * per still-pending assignment and owned provider (each at most once), the
 * cancellation of initial work that became obsolete, and a refresh of every
 * known message whose card no longer matches. Planning from current state
 * makes repeated or reordered intents converge on the same work rows.
 */
async function planWorkflowEffects(
	transaction: DatabaseTransaction,
	input: {
		organizationId: string;
		workflowId: string;
		outboxId: string | null;
		providers: readonly ApprovalDeliveryProvider[];
	},
): Promise<{ created: number; cancelled: number }> {
	const pending = rows(
		await transaction.execute(sql`
			select a.id, a.approver_employee_id
			from approval_stage_assignment a
			join approval_workflow_stage s
				on s.id = a.stage_id and s.organization_id = a.organization_id
			join approval_workflow w
				on w.id = a.workflow_id and w.organization_id = a.organization_id
			where a.organization_id = ${input.organizationId}
				and a.workflow_id = ${input.workflowId}::uuid
				and a.status = 'pending' and s.status = 'pending' and w.status = 'pending'
				and w.current_stage_order = s.stage_order
				-- Replacement assignments belong to escalation's replacement delivery.
				and a.reassigned_from_assignment_id is null
		`),
	);
	let created = 0;
	for (const assignment of pending) {
		const assignmentId = text(assignment.id, "assignment");
		for (const provider of input.providers) {
			const inserted = await transaction
				.insert(approvalDeliveryWork)
				.values({
					organizationId: input.organizationId,
					outboxId: input.outboxId,
					workflowId: input.workflowId,
					effect: "initial",
					provider,
					assignmentId,
					recipientEmployeeId: text(assignment.approver_employee_id, "approver"),
					dedupeKey: initialDedupeKey(assignmentId, provider),
				})
				.onConflictDoNothing({
					target: [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey],
				})
				.returning({ id: approvalDeliveryWork.id });
			created += inserted.length;
		}
	}
	const stillPending = pending.map((assignment) => text(assignment.id, "assignment"));
	const cancelled = await transaction
		.update(approvalDeliveryWork)
		.set({
			status: "cancelled",
			lastOutcome: "obsolete",
			processedAt: new Date(),
		})
		.where(
			and(
				eq(approvalDeliveryWork.organizationId, input.organizationId),
				eq(approvalDeliveryWork.workflowId, input.workflowId),
				eq(approvalDeliveryWork.effect, "initial"),
				inArray(approvalDeliveryWork.status, ["pending", "awaiting_repair", "exhausted", "failed"]),
				stillPending.length > 0
					? sql`${approvalDeliveryWork.assignmentId} <> all(${sql.param(stillPending)}::uuid[])`
					: sql`true`,
			),
		)
		.returning({ id: approvalDeliveryWork.id });
	created += await planMessageRefreshes(transaction, input);
	return { created, cancelled: cancelled.length };
}

/**
 * A refresh for every known message whose card no longer matches the
 * workflow: its assignment or the request is no longer pending and the
 * message does not yet reflect the current workflow version.
 */
async function planMessageRefreshes(
	executor: ApprovalDeliveryExecutor,
	input: { organizationId: string; workflowId: string; outboxId: string | null },
): Promise<number> {
	const stale = rows(
		await executor.execute(sql`
			select m.id, m.provider, m.assignment_id, m.recipient_employee_id,
				w.version
			from approval_delivery_message m
			join approval_workflow w
				on w.id = m.workflow_id and w.organization_id = m.organization_id
			join approval_stage_assignment a
				on a.id = m.assignment_id and a.organization_id = m.organization_id
			where m.organization_id = ${input.organizationId}
				and m.workflow_id = ${input.workflowId}::uuid
				and m.state <> 'gone'
				and m.status_version < w.version
				and (a.status <> 'pending' or w.status <> 'pending')
		`),
	);
	let created = 0;
	for (const message of stale) {
		const messageId = text(message.id, "message");
		const version = Number(message.version);
		const inserted = await executor
			.insert(approvalDeliveryWork)
			.values({
				organizationId: input.organizationId,
				outboxId: input.outboxId,
				workflowId: input.workflowId,
				effect: "refresh",
				provider: text(message.provider, "provider") as ApprovalDeliveryProvider,
				assignmentId: text(message.assignment_id, "assignment"),
				recipientEmployeeId: text(message.recipient_employee_id, "recipient"),
				messageId,
				dedupeKey: refreshDedupeKey(messageId, version),
			})
			.onConflictDoNothing({
				target: [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey],
			})
			.returning({ id: approvalDeliveryWork.id });
		created += inserted.length;
	}
	return created;
}

/** Plans refreshes for one workflow's messages outside intent expansion. */
export async function scheduleApprovalMessageRefreshes(input: {
	organizationId: string;
	workflowId: string;
}): Promise<number> {
	return planMessageRefreshes(db, { ...input, outboxId: null });
}

export interface ApprovalDeliveryExpansionSummary {
	expanded: number;
	created: number;
	cancelled: number;
}

/**
 * Expands pending lifecycle intents (the canonical workflow's outbox rows,
 * written atomically with each transition) into delivery work. Only kinds
 * with a delivery control and canonical authority are expanded, and only
 * intents created at or after that control's activation. Rows stay locked
 * until the work they imply has committed, so a crash re-expands them.
 */
export async function expandApprovalDeliveryIntents(input: {
	organizationId: string;
	limit: number;
	workflowId?: string;
}): Promise<ApprovalDeliveryExpansionSummary> {
	return db.transaction(async (transaction) => {
		const intents = rows(
			await transaction.execute(sql`
				select o.id, o.workflow_id, w.workflow_type,
					array(
						select c.provider from approval_delivery_control c
						where c.organization_id = o.organization_id
							and c.workflow_type = w.workflow_type
							and c.activated_at <= o.created_at
						order by c.provider
					) as providers
				from approval_outbox o
				join approval_workflow w
					on w.id = o.workflow_id and w.organization_id = o.organization_id
				join approval_workflow_rollout r
					on r.organization_id = o.organization_id
					and r.workflow_type = w.workflow_type
					and r.lifecycle_mode in ('canonical', 'complete')
				where o.organization_id = ${input.organizationId}
					and o.expansion_status = 'pending'
					and o.event_type <> 'workflow.legacy_observed'
					${input.workflowId ? sql`and o.workflow_id = ${input.workflowId}::uuid` : sql``}
					and exists (
						select 1 from approval_delivery_control c
						where c.organization_id = o.organization_id
							and c.workflow_type = w.workflow_type
							and c.activated_at <= o.created_at
					)
				order by o.created_at, o.id
				limit ${input.limit}
				for update of o skip locked
			`),
		);
		if (intents.length === 0) return { expanded: 0, created: 0, cancelled: 0 };
		// One plan per workflow; the latest intent is recorded as its cause.
		const workflows = new Map<
			string,
			{ outboxId: string; providers: ApprovalDeliveryProvider[] }
		>();
		for (const intent of intents) {
			const providers = Array.isArray(intent.providers)
				? (intent.providers as ApprovalDeliveryProvider[])
				: [];
			const workflowId = text(intent.workflow_id, "workflow");
			const known = workflows.get(workflowId);
			workflows.set(workflowId, {
				outboxId: text(intent.id, "outbox"),
				providers: [...new Set([...(known?.providers ?? []), ...providers])],
			});
		}
		let created = 0;
		let cancelled = 0;
		for (const [workflowId, plan] of workflows) {
			const result = await planWorkflowEffects(transaction, {
				organizationId: input.organizationId,
				workflowId,
				outboxId: plan.outboxId,
				providers: plan.providers,
			});
			created += result.created;
			cancelled += result.cancelled;
		}
		const ids = intents.map((intent) => text(intent.id, "outbox"));
		await transaction.execute(sql`
			update approval_outbox set expansion_status = 'expanded', expanded_at = now()
			where organization_id = ${input.organizationId}
				and id = any(${sql.param(ids)}::uuid[])
		`);
		return { expanded: intents.length, created, cancelled };
	});
}

export interface ClaimedApprovalDeliveryWork {
	id: string;
	organizationId: string;
	workflowId: string;
	workflowType: ApprovalWorkflowType;
	effect: ApprovalDeliveryEffect;
	provider: ApprovalDeliveryProvider;
	assignmentId: string;
	recipientEmployeeId: string;
	messageId: string | null;
	claimToken: string;
	retryCount: number;
	attemptCount: number;
}

/**
 * Leases due work: pending rows whose time has come and processing rows whose
 * lease expired (a crashed or stalled worker). Claims are serialized per
 * organization, and at most one refresh per message is in flight, so an
 * older refresh can never overwrite a newer one remotely.
 */
export async function claimApprovalDeliveryWork(input: {
	organizationId: string;
	limit: number;
	now: Instant;
	workflowId?: string;
	leaseMs?: number;
}): Promise<ClaimedApprovalDeliveryWork[]> {
	const now = dateFromInstant(input.now);
	const leaseExpiresAt = dateFromInstant(
		input.now.add({ milliseconds: input.leaseMs ?? APPROVAL_DELIVERY_LEASE_MS }),
	);
	return db.transaction(async (transaction) => {
		await transaction.execute(sql`
			select pg_advisory_xact_lock(hashtextextended(
				'approval-delivery-claim:' || length(${input.organizationId}) || ':' || ${input.organizationId}, 0))
		`);
		const due = rows(
			await transaction.execute(sql`
				select d.id, d.message_id
				from approval_delivery_work d
				join approval_workflow w
					on w.id = d.workflow_id and w.organization_id = d.organization_id
				join approval_delivery_control c
					on c.organization_id = d.organization_id
					and c.workflow_type = w.workflow_type
					and c.provider = d.provider
				where d.organization_id = ${input.organizationId}
					and (
						(d.status = 'pending' and d.available_at <= ${now})
						or (d.status = 'processing' and d.lease_expires_at <= ${now})
					)
					${input.workflowId ? sql`and d.workflow_id = ${input.workflowId}::uuid` : sql``}
					and (d.message_id is null or not exists (
						select 1 from approval_delivery_work x
						where x.organization_id = d.organization_id
							and x.message_id = d.message_id and x.id <> d.id
							and x.status = 'processing' and x.lease_expires_at > ${now}
					))
				order by d.available_at, d.id
				limit ${input.limit}
				for update of d skip locked
			`),
		);
		const seenMessages = new Set<string>();
		const ids: string[] = [];
		for (const row of due) {
			const messageId = typeof row.message_id === "string" ? row.message_id : null;
			if (messageId) {
				if (seenMessages.has(messageId)) continue;
				seenMessages.add(messageId);
			}
			ids.push(text(row.id, "work"));
		}
		if (ids.length === 0) return [];
		const claimToken = randomUUID();
		const claimed = rows(
			await transaction.execute(sql`
				update approval_delivery_work d
				set status = 'processing', claim_token = ${claimToken}::uuid,
					claimed_at = ${now}, lease_expires_at = ${leaseExpiresAt},
					attempt_count = d.attempt_count + 1, last_attempt_at = ${now},
					updated_at = ${now}
				from approval_workflow w
				where d.organization_id = ${input.organizationId}
					and d.id = any(${sql.param(ids)}::uuid[])
					and w.id = d.workflow_id and w.organization_id = d.organization_id
				returning d.id, d.organization_id, d.workflow_id, w.workflow_type,
					d.effect, d.provider, d.assignment_id, d.recipient_employee_id,
					d.message_id, d.retry_count, d.attempt_count
			`),
		);
		return claimed
			.map((row) => ({
				id: text(row.id, "work"),
				organizationId: text(row.organization_id, "organization"),
				workflowId: text(row.workflow_id, "workflow"),
				workflowType: text(row.workflow_type, "workflow type") as ApprovalWorkflowType,
				effect: text(row.effect, "effect") as ApprovalDeliveryEffect,
				provider: text(row.provider, "provider") as ApprovalDeliveryProvider,
				assignmentId: text(row.assignment_id, "assignment"),
				recipientEmployeeId: text(row.recipient_employee_id, "recipient"),
				messageId: typeof row.message_id === "string" ? row.message_id : null,
				claimToken,
				retryCount: Number(row.retry_count),
				attemptCount: Number(row.attempt_count),
			}))
			.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
	});
}

/**
 * Re-checks and extends a claim right before a provider call. A worker whose
 * lease expired (for example behind slow calls earlier in its batch) must not
 * send: another worker may already own the work. Returns false then.
 */
export async function renewApprovalDeliveryLease(input: {
	work: Pick<ClaimedApprovalDeliveryWork, "id" | "organizationId" | "claimToken">;
	now: Instant;
	leaseMs?: number;
}): Promise<boolean> {
	const renewed = await db
		.update(approvalDeliveryWork)
		.set({
			leaseExpiresAt: dateFromInstant(
				input.now.add({ milliseconds: input.leaseMs ?? APPROVAL_DELIVERY_LEASE_MS }),
			),
		})
		.where(
			and(
				eq(approvalDeliveryWork.id, input.work.id),
				eq(approvalDeliveryWork.organizationId, input.work.organizationId),
				eq(approvalDeliveryWork.claimToken, input.work.claimToken),
				eq(approvalDeliveryWork.status, "processing"),
				gt(approvalDeliveryWork.leaseExpiresAt, dateFromInstant(input.now)),
			),
		)
		.returning({ id: approvalDeliveryWork.id });
	return renewed.length === 1;
}

/**
 * Completes a claim only while its lease token still holds. A worker whose
 * lease was taken over changes nothing (returns false); the remote message it
 * may have produced is still recorded separately.
 */
export async function finishApprovalDeliveryWork(
	executor: ApprovalDeliveryExecutor,
	input: {
		work: Pick<ClaimedApprovalDeliveryWork, "id" | "organizationId" | "claimToken">;
		status: Exclude<ApprovalDeliveryStatus, "processing">;
		outcome: string;
		availableAt?: Instant;
		retryCount?: number;
	},
): Promise<boolean> {
	const terminal = input.status !== "pending";
	const finished = await executor
		.update(approvalDeliveryWork)
		.set({
			status: input.status,
			lastOutcome: input.outcome,
			claimToken: null,
			leaseExpiresAt: null,
			processedAt: terminal ? new Date() : null,
			...(input.availableAt ? { availableAt: dateFromInstant(input.availableAt) } : {}),
			...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
		})
		.where(
			and(
				eq(approvalDeliveryWork.id, input.work.id),
				eq(approvalDeliveryWork.organizationId, input.work.organizationId),
				eq(approvalDeliveryWork.claimToken, input.work.claimToken),
				eq(approvalDeliveryWork.status, "processing"),
			),
		)
		.returning({ id: approvalDeliveryWork.id });
	return finished.length === 1;
}

export interface DeliveredApprovalMessageInput {
	organizationId: string;
	workflowId: string;
	stageId: string;
	assignmentId: string;
	approvalRequestId: string | null;
	recipientEmployeeId: string;
	recipientUserId: string;
	provider: ApprovalDeliveryProvider;
	receiverScope: string;
	destinationId: string;
	remoteMessageId: string;
	bindingId: string | null;
	originWorkId: string | null;
	controls: "actionable" | "none";
	statusVersion: number;
}

export type RecordDeliveredMessageResult =
	| { kind: "recorded"; messageId: string }
	| { kind: "known"; messageId: string }
	| { kind: "purged" };

function isForeignKeyViolation(error: unknown): boolean {
	for (let current = error; current && typeof current === "object"; ) {
		if ("code" in current && current.code === "23503") return true;
		current = "cause" in current ? current.cause : undefined;
	}
	return false;
}

/**
 * Records one actual remote message with its full identity, independently of
 * the claim's fence: a late or duplicate send is still tracked so it can be
 * refreshed. A lifecycle purged meanwhile cannot be recreated (its FKs fail).
 */
export async function recordDeliveredApprovalMessage(
	input: DeliveredApprovalMessageInput,
): Promise<RecordDeliveredMessageResult> {
	try {
		const [inserted] = await db
			.insert(approvalDeliveryMessage)
			.values(input)
			.onConflictDoNothing({
				target: [
					approvalDeliveryMessage.organizationId,
					approvalDeliveryMessage.provider,
					approvalDeliveryMessage.receiverScope,
					approvalDeliveryMessage.destinationId,
					approvalDeliveryMessage.remoteMessageId,
				],
			})
			.returning({ id: approvalDeliveryMessage.id });
		if (inserted) return { kind: "recorded", messageId: inserted.id };
	} catch (error) {
		if (isForeignKeyViolation(error)) return { kind: "purged" };
		throw error;
	}
	const known = await findApprovalDeliveryMessageByRemoteIdentity(input);
	return known ? { kind: "known", messageId: known.id } : { kind: "purged" };
}

export type ApprovalDeliveryMessageRecord = typeof approvalDeliveryMessage.$inferSelect;

export async function loadApprovalDeliveryMessage(input: {
	organizationId: string;
	messageId: string;
}): Promise<ApprovalDeliveryMessageRecord | null> {
	const [message] = await db
		.select()
		.from(approvalDeliveryMessage)
		.where(
			and(
				eq(approvalDeliveryMessage.organizationId, input.organizationId),
				eq(approvalDeliveryMessage.id, input.messageId),
			),
		)
		.limit(1);
	return message ?? null;
}

/** The tracked message a provider callback arrived on, if we sent it. */
export async function findApprovalDeliveryMessageByRemoteIdentity(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	receiverScope: string;
	destinationId: string;
	remoteMessageId: string;
}): Promise<ApprovalDeliveryMessageRecord | null> {
	const [message] = await db
		.select()
		.from(approvalDeliveryMessage)
		.where(
			and(
				eq(approvalDeliveryMessage.organizationId, input.organizationId),
				eq(approvalDeliveryMessage.provider, input.provider),
				eq(approvalDeliveryMessage.receiverScope, input.receiverScope),
				eq(approvalDeliveryMessage.destinationId, input.destinationId),
				eq(approvalDeliveryMessage.remoteMessageId, input.remoteMessageId),
			),
		)
		.limit(1);
	return message ?? null;
}

/** The exact item a delivered message's review link opens. */
export function approvalDeliveryMessageReviewReference(
	message: Pick<ApprovalDeliveryMessageRecord, "approvalRequestId" | "assignmentId">,
): ApprovalReviewReference {
	return message.approvalRequestId
		? { kind: "compatibility", approvalRequestId: message.approvalRequestId }
		: { kind: "canonical", assignmentId: message.assignmentId };
}

/**
 * Whether a delivered card's assignment and request are still pending. When
 * they are not, the owner refreshes the card from the committed intent, so no
 * other writer should edit it.
 */
export async function isApprovalDeliveryMessagePending(
	message: Pick<ApprovalDeliveryMessageRecord, "organizationId" | "workflowId" | "assignmentId">,
): Promise<boolean> {
	const [row] = await db
		.select({
			workflowStatus: approvalWorkflow.status,
			assignmentStatus: approvalStageAssignment.status,
		})
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, message.organizationId),
				eq(approvalStageAssignment.workflowId, message.workflowId),
				eq(approvalStageAssignment.id, message.assignmentId),
			),
		)
		.limit(1);
	return row?.workflowStatus === "pending" && row.assignmentStatus === "pending";
}

/**
 * The remote message no longer shows controls and reflects `statusVersion`.
 * Versions only increase, so a stale completion cannot regress newer state.
 */
export async function retireApprovalDeliveryMessage(
	executor: ApprovalDeliveryExecutor,
	input: {
		organizationId: string;
		messageId: string;
		statusVersion: number;
		state?: "retired" | "gone";
	},
): Promise<boolean> {
	const updated = await executor
		.update(approvalDeliveryMessage)
		.set({
			state: input.state ?? "retired",
			controls: "none",
			statusVersion: input.statusVersion,
		})
		.where(
			and(
				eq(approvalDeliveryMessage.organizationId, input.organizationId),
				eq(approvalDeliveryMessage.id, input.messageId),
				lt(approvalDeliveryMessage.statusVersion, input.statusVersion),
				ne(approvalDeliveryMessage.state, "gone"),
			),
		)
		.returning({ id: approvalDeliveryMessage.id });
	return updated.length === 1;
}

/** Removes controls without claiming a newer status (e.g. a review notice). */
export async function markApprovalDeliveryMessageWithoutControls(input: {
	organizationId: string;
	messageId: string;
}): Promise<void> {
	await db
		.update(approvalDeliveryMessage)
		.set({ state: "retired", controls: "none" })
		.where(
			and(
				eq(approvalDeliveryMessage.organizationId, input.organizationId),
				eq(approvalDeliveryMessage.id, input.messageId),
				ne(approvalDeliveryMessage.state, "gone"),
			),
		);
}

export type RecoverApprovalDeliveryResult =
	| { kind: "rearmed"; workIds: string[] }
	| { kind: "not_recoverable" };

/**
 * Explicit recovery: re-arms exhausted, failed or repair-waiting work for an
 * immediate attempt with a fresh retry schedule. Delivered, suppressed or
 * cancelled work is never resent.
 */
export async function rearmApprovalDeliveryWork(input: {
	organizationId: string;
	workIds?: string[];
	assignmentId?: string;
	recipientEmployeeIds?: string[];
	provider?: ApprovalDeliveryProvider;
	/** Only work whose last outcome starts with this (e.g. `destination_invalid:`). */
	outcomePrefix?: string;
	now: Instant;
}): Promise<RecoverApprovalDeliveryResult> {
	const filters = [
		eq(approvalDeliveryWork.organizationId, input.organizationId),
		inArray(approvalDeliveryWork.status, ["awaiting_repair", "exhausted", "failed"]),
	];
	if (input.workIds) filters.push(inArray(approvalDeliveryWork.id, input.workIds));
	if (input.assignmentId) filters.push(eq(approvalDeliveryWork.assignmentId, input.assignmentId));
	if (input.recipientEmployeeIds)
		filters.push(inArray(approvalDeliveryWork.recipientEmployeeId, input.recipientEmployeeIds));
	if (input.provider) filters.push(eq(approvalDeliveryWork.provider, input.provider));
	if (input.outcomePrefix)
		filters.push(sql`starts_with(${approvalDeliveryWork.lastOutcome}, ${input.outcomePrefix})`);
	if (!input.workIds && !input.assignmentId && !input.recipientEmployeeIds) {
		throw new Error("Approval delivery recovery requires an explicit target");
	}
	const rearmed = await db
		.update(approvalDeliveryWork)
		.set({
			status: "pending",
			availableAt: dateFromInstant(input.now),
			retryCount: 0,
			processedAt: null,
		})
		.where(and(...filters))
		.returning({ id: approvalDeliveryWork.id });
	return rearmed.length > 0
		? { kind: "rearmed", workIds: rearmed.map((row) => row.id).sort() }
		: { kind: "not_recoverable" };
}
