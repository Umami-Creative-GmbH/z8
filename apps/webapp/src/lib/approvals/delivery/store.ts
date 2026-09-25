import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	type ApprovalDeliveryEffect,
	type ApprovalDeliveryLifecycle,
	type ApprovalDeliveryProvider,
	type ApprovalDeliveryStatus,
	absenceEntry,
	approvalDeliveryControl,
	approvalDeliveryMessage,
	approvalDeliveryWork,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	workPeriod,
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

function nullableText(value: unknown): string | null {
	return typeof value === "string" ? value : null;
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
 * Whether the delivery owner sends the card an existing-path approval
 * notification is about, so that path sends neither the card nor a plain
 * message about the same request. The owner must be active for the provider
 * and kind, and the absence or work period must have a canonical workflow,
 * whose committed intents the owner delivers; a legacy request (e.g. a policy
 * fallback) keeps the path.
 */
export async function isApprovalNotificationDeliveredByOwner(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	entityType?: string;
	entityId?: string;
}): Promise<boolean> {
	if (!input.entityId) return false;
	let absenceId: string | null = null;
	// Time kinds (#325): the canonical workflow of exactly this cycle names the
	// kind; a legacy request (no mirroring stage) keeps the existing path.
	let timeWorkflowType: ApprovalWorkflowType | null = null;
	if (input.entityType === "absence_entry") {
		absenceId = input.entityId;
	} else if (input.entityType === "work_period") {
		// The notification names only the period: its linked workflow counts only
		// while that cycle is still pending (the one being notified about).
		const [linked] = await db
			.select({ workflowType: approvalWorkflow.workflowType })
			.from(workPeriod)
			.innerJoin(
				approvalWorkflow,
				and(
					eq(approvalWorkflow.id, workPeriod.approvalWorkflowId),
					eq(approvalWorkflow.organizationId, workPeriod.organizationId),
					eq(approvalWorkflow.sourceType, "time_entry"),
					eq(approvalWorkflow.sourceId, workPeriod.id),
					eq(approvalWorkflow.status, "pending"),
				),
			)
			.where(
				and(eq(workPeriod.id, input.entityId), eq(workPeriod.organizationId, input.organizationId)),
			)
			.limit(1);
		timeWorkflowType = linked?.workflowType ?? null;
	} else if (input.entityType === "approval_request") {
		const request = await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, input.entityId),
				eq(approvalRequest.organizationId, input.organizationId),
			),
			columns: { id: true, entityType: true, entityId: true },
		});
		if (request?.entityType === "absence_entry") absenceId = request.entityId;
		if (request?.entityType === "time_entry") {
			const [mirrored] = await db
				.select({ workflowType: approvalWorkflow.workflowType })
				.from(approvalWorkflowStage)
				.innerJoin(
					approvalWorkflow,
					and(
						eq(approvalWorkflow.id, approvalWorkflowStage.workflowId),
						eq(approvalWorkflow.organizationId, approvalWorkflowStage.organizationId),
					),
				)
				.where(
					and(
						eq(approvalWorkflowStage.organizationId, input.organizationId),
						eq(approvalWorkflowStage.legacyApprovalRequestId, request.id),
					),
				)
				.limit(1);
			timeWorkflowType = mirrored?.workflowType ?? null;
		}
	}
	if (timeWorkflowType) {
		return await isApprovalDeliveryOwner({
			organizationId: input.organizationId,
			workflowType: timeWorkflowType,
			provider: input.provider,
		});
	}
	if (!absenceId) return false;
	const owner = await isApprovalDeliveryOwner({
		organizationId: input.organizationId,
		workflowType: "absence",
		provider: input.provider,
	});
	if (!owner) return false;
	const absence = await db.query.absenceEntry.findFirst({
		where: and(eq(absenceEntry.id, absenceId), eq(absenceEntry.organizationId, input.organizationId)),
		columns: { approvalWorkflowId: true },
	});
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

function legacyInitialDedupeKey(approvalRequestId: string, provider: string): string {
	return `approval-delivery:v1:legacy-initial:${approvalRequestId}:${provider}`;
}

function refreshDedupeKey(messageId: string, workflowVersion: number): string {
	return `approval-delivery:v1:refresh:${messageId}:${workflowVersion}`;
}

/**
 * A legacy-authoritative lifecycle (#296): one source (e.g. an expense claim)
 * and its legacy requests, which are the assignment equivalents. A claim leaves
 * draft once, so its requests form exactly one lifecycle.
 */
export interface LegacyDeliveryLifecycle {
	workflowType: ApprovalWorkflowType;
	sourceType: string;
	sourceId: string;
}

/**
 * The lifecycle's status version: one plus the number of its decided legacy
 * requests. Decisions only move forward, so it only increases, like a
 * workflow's version; a message reflecting it is current.
 */
function legacyLifecycleVersionSql(organizationId: string, lifecycle: LegacyDeliveryLifecycle) {
	return sql`(
		select 1 + count(*) filter (where r.status <> 'pending')
		from approval_request r
		where r.organization_id = ${organizationId}
			and r.entity_type = ${lifecycle.sourceType}
			and r.entity_id = ${lifecycle.sourceId}::uuid
	)`;
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
	created += await planApprovalMessageRefreshes(transaction, input);
	return { created, cancelled: cancelled.length };
}

/**
 * Legacy counterpart of the workflow plan (#296): an initial card per pending
 * legacy request of the lifecycle and owned provider, the cancellation of
 * initial work whose request is no longer pending, and a refresh of every
 * known message whose card no longer matches.
 */
async function planLegacyLifecycleEffects(
	transaction: DatabaseTransaction,
	input: {
		organizationId: string;
		lifecycle: LegacyDeliveryLifecycle;
		providers: readonly ApprovalDeliveryProvider[];
	},
): Promise<{ created: number; cancelled: number }> {
	const { lifecycle } = input;
	const pending = rows(
		await transaction.execute(sql`
			select r.id, r.approver_id
			from approval_request r
			where r.organization_id = ${input.organizationId}
				and r.entity_type = ${lifecycle.sourceType}
				and r.entity_id = ${lifecycle.sourceId}::uuid
				and r.status = 'pending'
		`),
	);
	const legacy = {
		lifecycle: "legacy" as const,
		workflowType: lifecycle.workflowType,
		legacySourceType: lifecycle.sourceType,
		legacySourceId: lifecycle.sourceId,
	};
	let created = 0;
	for (const request of pending) {
		const approvalRequestId = text(request.id, "legacy request");
		for (const provider of input.providers) {
			const inserted = await transaction
				.insert(approvalDeliveryWork)
				.values({
					organizationId: input.organizationId,
					...legacy,
					effect: "initial",
					provider,
					legacyApprovalRequestId: approvalRequestId,
					recipientEmployeeId: text(request.approver_id, "approver"),
					dedupeKey: legacyInitialDedupeKey(approvalRequestId, provider),
				})
				.onConflictDoNothing({
					target: [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey],
				})
				.returning({ id: approvalDeliveryWork.id });
			created += inserted.length;
		}
	}
	const stillPending = pending.map((request) => text(request.id, "legacy request"));
	const cancelled = await transaction
		.update(approvalDeliveryWork)
		.set({ status: "cancelled", lastOutcome: "obsolete", processedAt: new Date() })
		.where(
			and(
				eq(approvalDeliveryWork.organizationId, input.organizationId),
				eq(approvalDeliveryWork.lifecycle, "legacy"),
				eq(approvalDeliveryWork.legacySourceType, lifecycle.sourceType),
				eq(approvalDeliveryWork.legacySourceId, lifecycle.sourceId),
				eq(approvalDeliveryWork.effect, "initial"),
				inArray(approvalDeliveryWork.status, ["pending", "awaiting_repair", "exhausted", "failed"]),
				stillPending.length > 0
					? sql`${approvalDeliveryWork.legacyApprovalRequestId} <> all(${sql.param(stillPending)}::uuid[])`
					: sql`true`,
			),
		)
		.returning({ id: approvalDeliveryWork.id });
	created += await planLegacyMessageRefreshes(transaction, input);
	return { created, cancelled: cancelled.length };
}

/**
 * A refresh for every known message whose card no longer matches the
 * workflow: its assignment or the request is no longer pending and the
 * message does not yet reflect the current workflow version. The dedupe
 * identity is shared by both owners, so a refresh planned by escalation
 * (with its transfer, optionally for one assignment's messages) and by the
 * delivery owner is one effect with one executor. Escalation's planning
 * wins while the effect is still unclaimed.
 */
export async function planApprovalMessageRefreshes(
	executor: ApprovalDeliveryExecutor,
	input: {
		organizationId: string;
		workflowId: string;
		outboxId: string | null;
		assignmentId?: string;
		escalationTransferId?: string;
	},
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
				${input.assignmentId ? sql`and m.assignment_id = ${input.assignmentId}::uuid` : sql``}
		`),
	);
	let created = 0;
	for (const message of stale) {
		const messageId = text(message.id, "message");
		const version = Number(message.version);
		const planned = executor.insert(approvalDeliveryWork).values({
			organizationId: input.organizationId,
			outboxId: input.outboxId,
			workflowId: input.workflowId,
			effect: "refresh",
			provider: text(message.provider, "provider") as ApprovalDeliveryProvider,
			assignmentId: text(message.assignment_id, "assignment"),
			recipientEmployeeId: text(message.recipient_employee_id, "recipient"),
			messageId,
			escalationTransferId: input.escalationTransferId ?? null,
			dedupeKey: refreshDedupeKey(messageId, version),
		});
		const target = [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey];
		const inserted = await (input.escalationTransferId
			? // Escalation owns the retirement of its transfer's cards: it adopts
				// the same refresh when the delivery owner planned it first and no
				// worker has claimed it yet (a claim moves it out of `pending`).
				planned.onConflictDoUpdate({
					target,
					set: { escalationTransferId: input.escalationTransferId },
					setWhere: sql`${approvalDeliveryWork.escalationTransferId} is null
						and ${approvalDeliveryWork.status} = 'pending'`,
				})
			: planned.onConflictDoNothing({ target })
		).returning({ id: approvalDeliveryWork.id });
		created += inserted.length;
	}
	return created;
}

/**
 * A refresh for every known message of a legacy lifecycle whose request is no
 * longer pending and which does not yet reflect the lifecycle's version. A
 * still-pending request's card keeps its controls.
 */
async function planLegacyMessageRefreshes(
	executor: ApprovalDeliveryExecutor,
	input: { organizationId: string; lifecycle: LegacyDeliveryLifecycle },
): Promise<number> {
	const { lifecycle } = input;
	const stale = rows(
		await executor.execute(sql`
			select m.id, m.provider, m.legacy_approval_request_id, m.recipient_employee_id,
				${legacyLifecycleVersionSql(input.organizationId, lifecycle)} as version
			from approval_delivery_message m
			join approval_request r
				on r.id = m.legacy_approval_request_id and r.organization_id = m.organization_id
			where m.organization_id = ${input.organizationId}
				and m.lifecycle = 'legacy'
				and m.legacy_source_type = ${lifecycle.sourceType}
				and m.legacy_source_id = ${lifecycle.sourceId}::uuid
				and m.state <> 'gone'
				and r.status <> 'pending'
				and m.status_version < ${legacyLifecycleVersionSql(input.organizationId, lifecycle)}
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
				lifecycle: "legacy",
				workflowType: lifecycle.workflowType,
				legacySourceType: lifecycle.sourceType,
				legacySourceId: lifecycle.sourceId,
				effect: "refresh",
				provider: text(message.provider, "provider") as ApprovalDeliveryProvider,
				legacyApprovalRequestId: text(message.legacy_approval_request_id, "legacy request"),
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

/**
 * Plans refreshes for one lifecycle's messages outside intent expansion.
 * Escalation scopes a canonical plan to one assignment's messages and links
 * the refreshes to its transfer (#300).
 */
export async function scheduleApprovalMessageRefreshes(
	input:
		| {
				organizationId: string;
				workflowId: string;
				assignmentId?: string;
				escalationTransferId?: string;
		  }
		| { organizationId: string; legacy: LegacyDeliveryLifecycle },
): Promise<number> {
	return "legacy" in input
		? planLegacyMessageRefreshes(db, {
				organizationId: input.organizationId,
				lifecycle: input.legacy,
			})
		: planApprovalMessageRefreshes(db, { ...input, outboxId: null });
}

function replacementDedupeKey(transferId: string, provider: string): string {
	return `approval-delivery:v1:replacement:${transferId}:${provider}`;
}

/**
 * The replacement card of one committed escalation transfer, once per
 * intended provider. The providers are the channels frozen at the transfer
 * event's first successful expansion; the work rows are that frozen intent.
 */
export async function planReplacementDeliveryWork(
	executor: ApprovalDeliveryExecutor,
	input: {
		organizationId: string;
		workflowId: string;
		escalationTransferId: string;
		replacementAssignmentId: string;
		recipientEmployeeId: string;
		providers: readonly ApprovalDeliveryProvider[];
	},
): Promise<number> {
	if (input.providers.length === 0) return 0;
	const inserted = await executor
		.insert(approvalDeliveryWork)
		.values(
			input.providers.map((provider) => ({
				organizationId: input.organizationId,
				workflowId: input.workflowId,
				effect: "replacement" as const,
				provider,
				assignmentId: input.replacementAssignmentId,
				recipientEmployeeId: input.recipientEmployeeId,
				escalationTransferId: input.escalationTransferId,
				dedupeKey: replacementDedupeKey(input.escalationTransferId, provider),
			})),
		)
		.onConflictDoNothing({
			target: [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey],
		})
		.returning({ id: approvalDeliveryWork.id });
	return inserted.length;
}

/**
 * Cancels replacement work that became obsolete before it was sent: its
 * assignment is no longer pending (decided, or transferred again) or the
 * request settled. Work in flight is rechecked by its own worker.
 */
export async function cancelObsoleteReplacementDeliveryWork(input: {
	organizationId: string;
	workflowId?: string;
}): Promise<number> {
	const cancelled = rows(
		await db.execute(sql`
			update approval_delivery_work d
			set status = 'cancelled', last_outcome = 'obsolete', processed_at = now()
			from approval_stage_assignment a, approval_workflow w
			where d.organization_id = ${input.organizationId}
				${input.workflowId ? sql`and d.workflow_id = ${input.workflowId}::uuid` : sql``}
				and d.effect = 'replacement'
				and d.status in ('pending', 'awaiting_repair', 'exhausted', 'failed')
				and a.id = d.assignment_id and a.organization_id = d.organization_id
				and w.id = d.workflow_id and w.organization_id = d.organization_id
				and (a.status <> 'pending' or w.status <> 'pending')
			returning d.id
		`),
	);
	return cancelled.length;
}

export interface ApprovalDeliveryExpansionSummary {
	expanded: number;
	created: number;
	cancelled: number;
}

/**
 * Expands pending lifecycle intents into delivery work: the canonical
 * workflow's outbox rows (written atomically with each transition) for kinds
 * with canonical authority, and the legacy intents (#296) written with each
 * legacy submission/decision for kinds with legacy authority. Only kinds with a
 * delivery control are expanded, and only intents created at or after that
 * control's activation. Rows stay locked until the work they imply has
 * committed, so a crash re-expands them.
 */
export async function expandApprovalDeliveryIntents(input: {
	organizationId: string;
	limit: number;
	workflowId?: string;
}): Promise<ApprovalDeliveryExpansionSummary> {
	const canonical = await expandCanonicalIntents(input);
	const legacy = input.workflowId
		? { expanded: 0, created: 0, cancelled: 0 }
		: await expandLegacyIntents(input);
	return {
		expanded: canonical.expanded + legacy.expanded,
		created: canonical.created + legacy.created,
		cancelled: canonical.cancelled + legacy.cancelled,
	};
}

async function expandCanonicalIntents(input: {
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

async function expandLegacyIntents(input: {
	organizationId: string;
	limit: number;
}): Promise<ApprovalDeliveryExpansionSummary> {
	return db.transaction(async (transaction) => {
		const intents = rows(
			await transaction.execute(sql`
				select i.id, i.workflow_type, i.source_type, i.source_id,
					array(
						select c.provider from approval_delivery_control c
						where c.organization_id = i.organization_id
							and c.workflow_type = i.workflow_type
							and c.activated_at <= i.created_at
						order by c.provider
					) as providers
				from approval_delivery_intent i
				left join approval_workflow_rollout r
					on r.organization_id = i.organization_id
					and r.workflow_type = i.workflow_type
				where i.organization_id = ${input.organizationId}
					and i.expansion_status = 'pending'
					-- Legacy lifecycles are owned only while the kind has legacy authority.
					and (r.lifecycle_mode is null or r.lifecycle_mode not in ('canonical', 'complete'))
					and exists (
						select 1 from approval_delivery_control c
						where c.organization_id = i.organization_id
							and c.workflow_type = i.workflow_type
							and c.activated_at <= i.created_at
					)
				order by i.created_at, i.id
				limit ${input.limit}
				for update of i skip locked
			`),
		);
		if (intents.length === 0) return { expanded: 0, created: 0, cancelled: 0 };
		const lifecycles = new Map<
			string,
			{ lifecycle: LegacyDeliveryLifecycle; providers: ApprovalDeliveryProvider[] }
		>();
		for (const intent of intents) {
			const lifecycle: LegacyDeliveryLifecycle = {
				workflowType: text(intent.workflow_type, "workflow type") as ApprovalWorkflowType,
				sourceType: text(intent.source_type, "source type"),
				sourceId: text(intent.source_id, "source"),
			};
			const key = `${lifecycle.workflowType}:${lifecycle.sourceType}:${lifecycle.sourceId}`;
			const providers = Array.isArray(intent.providers)
				? (intent.providers as ApprovalDeliveryProvider[])
				: [];
			const known = lifecycles.get(key);
			lifecycles.set(key, {
				lifecycle,
				providers: [...new Set([...(known?.providers ?? []), ...providers])],
			});
		}
		let created = 0;
		let cancelled = 0;
		for (const plan of lifecycles.values()) {
			const result = await planLegacyLifecycleEffects(transaction, {
				organizationId: input.organizationId,
				lifecycle: plan.lifecycle,
				providers: plan.providers,
			});
			created += result.created;
			cancelled += result.cancelled;
		}
		const ids = intents.map((intent) => text(intent.id, "intent"));
		await transaction.execute(sql`
			update approval_delivery_intent set expansion_status = 'expanded', expanded_at = now()
			where organization_id = ${input.organizationId}
				and id = any(${sql.param(ids)}::uuid[])
		`);
		return { expanded: intents.length, created, cancelled };
	});
}

export interface ClaimedApprovalDeliveryWork {
	id: string;
	organizationId: string;
	lifecycle: ApprovalDeliveryLifecycle;
	/** Canonical lifecycles only. */
	workflowId: string | null;
	workflowType: ApprovalWorkflowType;
	effect: ApprovalDeliveryEffect;
	provider: ApprovalDeliveryProvider;
	/** Canonical lifecycles only. */
	assignmentId: string | null;
	/** Legacy lifecycles only: the source and the recipient's legacy request. */
	legacy: (LegacyDeliveryLifecycle & { approvalRequestId: string }) | null;
	recipientEmployeeId: string;
	messageId: string | null;
	/** Set when escalation's replacement delivery owns this work (#300). */
	escalationTransferId: string | null;
	claimToken: string;
	retryCount: number;
	attemptCount: number;
}

/** Which executor a work row belongs to: escalation owns transfer-linked work. */
export type ApprovalDeliveryWorkOwner = "delivery" | "escalation";

/**
 * Leases due work of one owner: pending rows whose time has come and
 * processing rows whose lease expired (a crashed or stalled worker). Claims
 * are serialized per organization across both owners, and at most one
 * refresh per message is in flight, so an older refresh can never overwrite
 * a newer one remotely.
 */
export async function claimApprovalDeliveryWork(input: {
	organizationId: string;
	owner: ApprovalDeliveryWorkOwner;
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
				left join approval_workflow w
					on w.id = d.workflow_id and w.organization_id = d.organization_id
				join approval_delivery_control c
					on c.organization_id = d.organization_id
					and c.workflow_type = coalesce(w.workflow_type, d.workflow_type)
					and c.provider = d.provider
				where d.organization_id = ${input.organizationId}
					and (d.lifecycle = 'legacy' or w.id is not null)
					and (
						(d.status = 'pending' and d.available_at <= ${now})
						or (d.status = 'processing' and d.lease_expires_at <= ${now})
					)
					and d.escalation_transfer_id is ${input.owner === "escalation" ? sql`not null` : sql`null`}
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
				where d.organization_id = ${input.organizationId}
					and d.id = any(${sql.param(ids)}::uuid[])
				returning d.id, d.organization_id, d.lifecycle, d.workflow_id,
					coalesce((
						select w.workflow_type from approval_workflow w
						where w.id = d.workflow_id and w.organization_id = d.organization_id
					), d.workflow_type) as workflow_type,
					d.effect, d.provider, d.assignment_id, d.legacy_source_type,
					d.legacy_source_id, d.legacy_approval_request_id, d.recipient_employee_id,
					d.message_id, d.escalation_transfer_id, d.retry_count, d.attempt_count
			`),
		);
		return claimed
			.map((row): ClaimedApprovalDeliveryWork => {
				const lifecycle = text(row.lifecycle, "lifecycle") as ApprovalDeliveryLifecycle;
				const workflowType = text(row.workflow_type, "workflow type") as ApprovalWorkflowType;
				return {
					id: text(row.id, "work"),
					organizationId: text(row.organization_id, "organization"),
					lifecycle,
					workflowId: nullableText(row.workflow_id),
					workflowType,
					effect: text(row.effect, "effect") as ApprovalDeliveryEffect,
					provider: text(row.provider, "provider") as ApprovalDeliveryProvider,
					assignmentId: nullableText(row.assignment_id),
					legacy:
						lifecycle === "legacy"
							? {
									workflowType,
									sourceType: text(row.legacy_source_type, "legacy source type"),
									sourceId: text(row.legacy_source_id, "legacy source"),
									approvalRequestId: text(row.legacy_approval_request_id, "legacy request"),
								}
							: null,
					recipientEmployeeId: text(row.recipient_employee_id, "recipient"),
					messageId: typeof row.message_id === "string" ? row.message_id : null,
					escalationTransferId: nullableText(row.escalation_transfer_id),
					claimToken,
					retryCount: Number(row.retry_count),
					attemptCount: Number(row.attempt_count),
				};
			})
			.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
	});
}

/**
 * Current state of a legacy lifecycle's request (#296), shaped like a
 * workflow assignment: the lifecycle's status and version, and the request's
 * own status and current approver. Only kinds whose source status is known
 * here are supported; anything else is null.
 */
export async function loadLegacyDeliveryState(input: {
	organizationId: string;
	lifecycle: LegacyDeliveryLifecycle;
	approvalRequestId: string;
}): Promise<{
	lifecycleStatus: "pending" | "approved" | "rejected" | "unknown";
	version: number;
	requestStatus: string;
	approverEmployeeId: string;
} | null> {
	if (
		input.lifecycle.workflowType !== "travel_expense" ||
		input.lifecycle.sourceType !== "travel_expense_claim"
	) {
		return null;
	}
	const [state] = rows(
		await db.execute(sql`
			select r.status as request_status, r.approver_id,
				c.status as source_status,
				${legacyLifecycleVersionSql(input.organizationId, input.lifecycle)} as version
			from approval_request r
			join travel_expense_claim c
				on c.id = r.entity_id and c.organization_id = r.organization_id
			where r.organization_id = ${input.organizationId}
				and r.id = ${input.approvalRequestId}::uuid
				and r.entity_type = ${input.lifecycle.sourceType}
				and r.entity_id = ${input.lifecycle.sourceId}::uuid
		`),
	);
	if (!state) return null;
	const sourceStatus = text(state.source_status, "source status");
	return {
		lifecycleStatus:
			sourceStatus === "submitted"
				? "pending"
				: sourceStatus === "approved" || sourceStatus === "rejected"
					? sourceStatus
					: "unknown",
		version: Number(state.version),
		requestStatus: text(state.request_status, "request status"),
		approverEmployeeId: text(state.approver_id, "approver"),
	};
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

interface DeliveredMessageRemote {
	organizationId: string;
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

/** One actual remote message of a canonical workflow or a legacy lifecycle. */
export type DeliveredApprovalMessageInput = DeliveredMessageRemote &
	(
		| { workflowId: string; stageId: string; assignmentId: string; legacy?: never }
		| {
				legacy: LegacyDeliveryLifecycle & { approvalRequestId: string };
				workflowId?: never;
				stageId?: never;
				assignmentId?: never;
		  }
	);

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
	const { legacy, workflowId, stageId, assignmentId, ...remote } = input;
	const values = legacy
		? {
				...remote,
				lifecycle: "legacy" as const,
				// The review link and the lifecycle link name the same legacy request.
				approvalRequestId: legacy.approvalRequestId,
				workflowType: legacy.workflowType,
				legacySourceType: legacy.sourceType,
				legacySourceId: legacy.sourceId,
				legacyApprovalRequestId: legacy.approvalRequestId,
			}
		: { ...remote, workflowId, stageId, assignmentId };
	try {
		const [inserted] = await db
			.insert(approvalDeliveryMessage)
			.values(values)
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
	if (message.approvalRequestId) {
		return { kind: "compatibility", approvalRequestId: message.approvalRequestId };
	}
	if (!message.assignmentId) {
		throw new Error("Approval delivery message has no review reference");
	}
	return { kind: "canonical", assignmentId: message.assignmentId };
}

/** The legacy lifecycle a delivered message belongs to, if it is one. */
export function approvalDeliveryMessageLegacyLifecycle(
	message: Pick<
		ApprovalDeliveryMessageRecord,
		"lifecycle" | "workflowType" | "legacySourceType" | "legacySourceId"
	>,
): LegacyDeliveryLifecycle | null {
	return message.lifecycle === "legacy" &&
		message.workflowType &&
		message.legacySourceType &&
		message.legacySourceId
		? {
				workflowType: message.workflowType,
				sourceType: message.legacySourceType,
				sourceId: message.legacySourceId,
			}
		: null;
}

/**
 * Whether a delivered card's assignment and request are still pending. When
 * they are not, the owner refreshes the card from the committed intent, so no
 * other writer should edit it.
 */
export async function isApprovalDeliveryMessagePending(
	message: Pick<
		ApprovalDeliveryMessageRecord,
		"organizationId" | "lifecycle" | "workflowId" | "assignmentId" | "legacyApprovalRequestId"
	>,
): Promise<boolean> {
	if (message.lifecycle === "legacy") {
		if (!message.legacyApprovalRequestId) return false;
		const [request] = await db
			.select({ status: approvalRequest.status })
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, message.organizationId),
					eq(approvalRequest.id, message.legacyApprovalRequestId),
				),
			)
			.limit(1);
		return request?.status === "pending";
	}
	if (!message.workflowId || !message.assignmentId) return false;
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
 * Whether a delivered card's assignment was replaced by another approver's
 * (escalation or reassignment): its cards then say it was reassigned. Legacy
 * lifecycle cards (#296) have no canonical assignment to replace.
 */
export async function isApprovalDeliveryAssignmentReplaced(
	message: Pick<ApprovalDeliveryMessageRecord, "organizationId" | "workflowId" | "assignmentId">,
): Promise<boolean> {
	if (!message.workflowId || !message.assignmentId) return false;
	const [successor] = await db
		.select({ id: approvalStageAssignment.id })
		.from(approvalStageAssignment)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, message.organizationId),
				eq(approvalStageAssignment.workflowId, message.workflowId),
				eq(approvalStageAssignment.reassignedFromAssignmentId, message.assignmentId),
			),
		)
		.limit(1);
	return successor !== undefined;
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
	/** Only this provider's work (a repaired destination belongs to one provider). */
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
