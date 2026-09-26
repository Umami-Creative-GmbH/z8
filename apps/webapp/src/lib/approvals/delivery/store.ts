import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, ne, type SQL, sql } from "drizzle-orm";
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
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
import type { ApprovalWorkflowType } from "../workflow/ports";
import { recordLegacyTransferIntent } from "./intents";

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
 * fallback) keeps the path. Under legacy absence (#384) or time (#432)
 * authority the owner delivers the cycles whose lifecycle intents it owns.
 */
export async function isApprovalNotificationDeliveredByOwner(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	entityType?: string;
	entityId?: string;
}): Promise<boolean> {
	if (!input.entityId) return false;
	let absenceId: string | null = null;
	// The exact legacy request, when the notification names one: its cycle.
	let absenceRequestId: string | null = null;
	// Time kinds (#325): the canonical workflow of exactly this cycle names the
	// kind; a legacy request (no mirroring stage) keeps the existing path.
	let timeWorkflowType: ApprovalWorkflowType | null = null;
	// Legacy time cycles (#432): the work period and the exact request, when the
	// notification names one. A notification naming only the period counts the
	// cycles of all its pending requests (a period has one pending cycle).
	let legacyTimeCandidates: { workPeriodId: string; requestIds: string[] } | null = null;
	if (input.entityType === "absence_entry") {
		absenceId = input.entityId;
	} else if (input.entityType === "work_period") {
		const pending = await db
			.select({ id: approvalRequest.id })
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, input.entityId),
					eq(approvalRequest.status, "pending"),
				),
			);
		legacyTimeCandidates = {
			workPeriodId: input.entityId,
			requestIds: pending.map((row) => row.id),
		};
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
		if (request?.entityType === "absence_entry") {
			absenceId = request.entityId;
			absenceRequestId = request.id;
		}
		if (request?.entityType === "time_entry") {
			legacyTimeCandidates = { workPeriodId: request.entityId, requestIds: [request.id] };
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
	if (
		legacyTimeCandidates &&
		legacyTimeCandidates.requestIds.length > 0 &&
		(await isLegacyTimeCycleDeliveredByOwner({
			organizationId: input.organizationId,
			provider: input.provider,
			...legacyTimeCandidates,
		}))
	) {
		return true;
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
	if (!owner) {
		// Legacy absence authority (#384): the owner delivers a cycle whose
		// lifecycle intent it owns (written while the provider's control was
		// active), so the existing path stays silent for it. A notification naming
		// an exact request counts only that request's cycle; one naming only the
		// absence counts any of its cycles.
		const [delivered] = rows(
			await db.execute(sql`
				select 1 as delivered
				from approval_delivery_intent i
				join approval_delivery_control c
					on c.organization_id = i.organization_id
					and c.workflow_type = i.workflow_type
					and c.provider = ${input.provider}
					and c.activated_at <= i.created_at
				left join approval_workflow_rollout r
					on r.organization_id = i.organization_id and r.workflow_type = i.workflow_type
				where i.organization_id = ${input.organizationId}
					and i.workflow_type = 'absence'
					and i.source_type = 'absence_entry'
					and i.source_id = ${absenceId}::uuid
					${
						absenceRequestId
							? sql`and i.legacy_cycle_id = coalesce((
								select s.chain_instance_id from approval_chain_stage_instance s
								where s.organization_id = i.organization_id
									and s.approval_request_id = ${absenceRequestId}::uuid
								limit 1
							), ${absenceRequestId}::uuid)`
							: sql``
					}
					and (r.lifecycle_mode is null or r.lifecycle_mode not in ('canonical', 'complete'))
				limit 1
			`),
		);
		return delivered !== undefined;
	}
	const absence = await db.query.absenceEntry.findFirst({
		where: and(eq(absenceEntry.id, absenceId), eq(absenceEntry.organizationId, input.organizationId)),
		columns: { approvalWorkflowId: true },
	});
	return Boolean(absence?.approvalWorkflowId);
}

/**
 * Legacy time authority (#432): the owner delivers a cycle whose lifecycle
 * intent it owns (written while the provider's control was active) while the
 * kind still has legacy authority, as for legacy absences (#384), so the
 * existing path stays silent for it. Only the cycles of the given requests
 * count.
 */
async function isLegacyTimeCycleDeliveredByOwner(input: {
	organizationId: string;
	provider: ApprovalDeliveryProvider;
	workPeriodId: string;
	requestIds: string[];
}): Promise<boolean> {
	const [delivered] = rows(
		await db.execute(sql`
			select 1 as delivered
			from approval_delivery_intent i
			join approval_delivery_control c
				on c.organization_id = i.organization_id
				and c.workflow_type = i.workflow_type
				and c.provider = ${input.provider}
				and c.activated_at <= i.created_at
			left join approval_workflow_rollout r
				on r.organization_id = i.organization_id and r.workflow_type = i.workflow_type
			where i.organization_id = ${input.organizationId}
				and i.workflow_type in ('manual_time_submission', 'policy_clock_out', 'time_correction')
				and i.source_type = 'time_entry'
				and i.source_id = ${input.workPeriodId}::uuid
				and i.legacy_cycle_id in (
					select coalesce((
						select s.chain_instance_id from approval_chain_stage_instance s
						where s.organization_id = ${input.organizationId}
							and s.approval_request_id = request.id
						limit 1
					), request.id)
					from unnest(${sql.param(input.requestIds)}::uuid[]) as request(id)
				)
				and (r.lifecycle_mode is null or r.lifecycle_mode not in ('canonical', 'complete'))
			limit 1
		`),
	);
	return delivered !== undefined;
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
 * A legacy-authoritative lifecycle (#296): a source and its legacy requests,
 * which are the assignment equivalents. With a `cycleId` (#384) it is one
 * submission cycle of the source: the legacy chain instance, or the single
 * legacy request, that one submission created, so several cycles of a source
 * deliver, version and refresh independently. Without one the whole source is
 * one lifecycle (an expense claim leaves draft once).
 */
export interface LegacyDeliveryLifecycle {
	workflowType: ApprovalWorkflowType;
	sourceType: string;
	sourceId: string;
	cycleId: string | null;
}

/**
 * The lifecycle's status version; it only increases, like a workflow's
 * version, and a message reflecting it is current. A cycle counts its own
 * lifecycle intents (submission, each decision, withdrawal, each escalation
 * transfer), which are written with every change and never deleted but by the
 * purge; this survives ordinary cancellation, which deletes pending requests.
 * A source-scoped lifecycle is one plus the number of its decided legacy
 * requests (#296) and of its recorded escalation transfers (#408).
 */
function legacyLifecycleVersionSql(organizationId: string, lifecycle: LegacyDeliveryLifecycle) {
	if (lifecycle.cycleId) {
		return sql`(
			select count(*)
			from approval_delivery_intent i
			where i.organization_id = ${organizationId}
				and i.legacy_cycle_id = ${lifecycle.cycleId}::uuid
		)`;
	}
	return sql`((
		select 1 + count(*) filter (where r.status <> 'pending')
		from approval_request r
		where r.organization_id = ${organizationId}
			and r.entity_type = ${lifecycle.sourceType}
			and r.entity_id = ${lifecycle.sourceId}::uuid
	) + (
		select count(*)
		from approval_delivery_intent i
		where i.organization_id = ${organizationId}
			and i.source_type = ${lifecycle.sourceType}
			and i.source_id = ${lifecycle.sourceId}::uuid
			and i.legacy_cycle_id is null
			and i.event = 'transferred'
	))`;
}

/**
 * Whether escalation replaced a legacy request's recipient (#408): a committed
 * legacy transfer moved the request away from them, and no later transfer
 * moved it back. The same request stays with its replacement, so this, not
 * the request's status, tells a former holder's card from the holder's own.
 * Transfers keep the request by value, so the answer survives cancellation.
 */
function legacyRecipientReplacedSql(input: {
	organizationId: SQL;
	approvalRequestId: SQL;
	recipientEmployeeId: SQL;
}) {
	return sql`exists (
		select 1 from approval_escalation_transfer t
		where t.organization_id = ${input.organizationId}
			and t.authority_mode = 'legacy'
			and t.legacy_approval_request_id = ${input.approvalRequestId}
			and t.source_approver_employee_id = ${input.recipientEmployeeId}
			and not exists (
				select 1 from approval_escalation_transfer back
				where back.organization_id = t.organization_id
					and back.authority_mode = 'legacy'
					and back.legacy_approval_request_id = t.legacy_approval_request_id
					and back.replacement_approver_employee_id = t.source_approver_employee_id
					and back.legacy_source_sequence > t.legacy_source_sequence
			)
	)`;
}

const legacyMessageReplacedSql = legacyRecipientReplacedSql({
	organizationId: sql`m.organization_id`,
	approvalRequestId: sql`m.legacy_approval_request_id`,
	recipientEmployeeId: sql`m.recipient_employee_id`,
});

/**
 * The live legacy requests (`r`) of a lifecycle: the source's requests, and for
 * a cycle only the cycle's own request or its chain's stage requests.
 */
function legacyLifecycleRequestsSql(organizationId: string, lifecycle: LegacyDeliveryLifecycle) {
	return sql`r.organization_id = ${organizationId}
		and r.entity_type = ${lifecycle.sourceType}
		and r.entity_id = ${lifecycle.sourceId}::uuid
		${
			lifecycle.cycleId
				? sql`and (r.id = ${lifecycle.cycleId}::uuid or exists (
					select 1 from approval_chain_stage_instance s
					where s.organization_id = r.organization_id
						and s.chain_instance_id = ${lifecycle.cycleId}::uuid
						and s.approval_request_id = r.id
				))`
				: sql``
		}`;
}

/** Delivery rows (`m`/`d` columns) of exactly one legacy lifecycle. */
function legacyLifecycleRowsSql(
	alias: "m" | "d",
	organizationId: string,
	lifecycle: LegacyDeliveryLifecycle,
) {
	const row = sql.raw(alias);
	return sql`${row}.organization_id = ${organizationId}
		and ${row}.lifecycle = 'legacy'
		and ${row}.legacy_source_type = ${lifecycle.sourceType}
		and ${row}.legacy_source_id = ${lifecycle.sourceId}::uuid
		and ${
			lifecycle.cycleId
				? sql`${row}.legacy_cycle_id = ${lifecycle.cycleId}::uuid`
				: sql`${row}.legacy_cycle_id is null`
		}`;
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
			where ${legacyLifecycleRequestsSql(input.organizationId, lifecycle)}
				and r.status = 'pending'
				-- A request escalation transferred belongs to escalation's
				-- replacement delivery (#408), like a replacement assignment.
				and not exists (
					select 1 from approval_escalation_transfer t
					where t.organization_id = r.organization_id
						and t.authority_mode = 'legacy'
						and t.legacy_approval_request_id = r.id
				)
		`),
	);
	const legacy = {
		lifecycle: "legacy" as const,
		workflowType: lifecycle.workflowType,
		legacySourceType: lifecycle.sourceType,
		legacySourceId: lifecycle.sourceId,
		legacyCycleId: lifecycle.cycleId,
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
	const cancelled = rows(
		await transaction.execute(sql`
			update approval_delivery_work d
			set status = 'cancelled', last_outcome = 'obsolete', processed_at = now(),
				updated_at = now()
			where ${legacyLifecycleRowsSql("d", input.organizationId, lifecycle)}
				and d.effect = 'initial'
				and d.status in ('pending', 'awaiting_repair', 'exhausted', 'failed')
				${
					stillPending.length > 0
						? sql`and d.legacy_approval_request_id <> all(${sql.param(stillPending)}::uuid[])`
						: sql``
				}
			returning d.id
		`),
	);
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
 * A refresh for every known message of a legacy lifecycle whose card no longer
 * matches and which does not yet reflect the lifecycle's version: its request
 * is no longer pending (decided, or deleted by ordinary cancellation), or
 * escalation replaced its recipient (#408). The holder's card of a still-pending
 * request keeps its controls. Escalation scopes the plan to the former
 * holder's messages of one request and links the refreshes to its transfer,
 * adopting a still-unclaimed one the delivery owner planned first, like the
 * canonical plan.
 */
async function planLegacyMessageRefreshes(
	executor: ApprovalDeliveryExecutor,
	input: {
		organizationId: string;
		lifecycle: LegacyDeliveryLifecycle;
		approvalRequestId?: string;
		recipientEmployeeId?: string;
		escalationTransferId?: string;
	},
): Promise<number> {
	const { lifecycle } = input;
	const stale = rows(
		await executor.execute(sql`
			select m.id, m.provider, m.legacy_approval_request_id, m.recipient_employee_id,
				${legacyLifecycleVersionSql(input.organizationId, lifecycle)} as version
			from approval_delivery_message m
			left join approval_request r
				on r.id = m.legacy_approval_request_id and r.organization_id = m.organization_id
			where ${legacyLifecycleRowsSql("m", input.organizationId, lifecycle)}
				and m.state <> 'gone'
				and (r.id is null or r.status <> 'pending' or ${legacyMessageReplacedSql})
				and m.status_version < ${legacyLifecycleVersionSql(input.organizationId, lifecycle)}
				${
					input.approvalRequestId
						? sql`and m.legacy_approval_request_id = ${input.approvalRequestId}::uuid`
						: sql``
				}
				${
					input.recipientEmployeeId
						? sql`and m.recipient_employee_id = ${input.recipientEmployeeId}::uuid`
						: sql``
				}
		`),
	);
	let created = 0;
	for (const message of stale) {
		const messageId = text(message.id, "message");
		const version = Number(message.version);
		const planned = executor.insert(approvalDeliveryWork).values({
			organizationId: input.organizationId,
			lifecycle: "legacy",
			workflowType: lifecycle.workflowType,
			legacySourceType: lifecycle.sourceType,
			legacySourceId: lifecycle.sourceId,
			legacyCycleId: lifecycle.cycleId,
			effect: "refresh",
			provider: text(message.provider, "provider") as ApprovalDeliveryProvider,
			legacyApprovalRequestId: text(message.legacy_approval_request_id, "legacy request"),
			recipientEmployeeId: text(message.recipient_employee_id, "recipient"),
			messageId,
			escalationTransferId: input.escalationTransferId ?? null,
			dedupeKey: refreshDedupeKey(messageId, version),
		});
		const target = [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey];
		const inserted = await (input.escalationTransferId
			? planned.onConflictDoUpdate({
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
		| {
				organizationId: string;
				legacy: LegacyDeliveryLifecycle;
				/** Escalation (#408): one request's messages to one recipient, linked to its transfer. */
				approvalRequestId?: string;
				recipientEmployeeId?: string;
				escalationTransferId?: string;
		  },
): Promise<number> {
	if ("legacy" in input) {
		const { legacy, ...scope } = input;
		return planLegacyMessageRefreshes(db, { ...scope, lifecycle: legacy });
	}
	return planApprovalMessageRefreshes(db, { ...input, outboxId: null });
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

/** A card the provider's old notification path sent, which no work produced. */
export interface UntrackedApprovalCard {
	provider: ApprovalDeliveryProvider;
	recipientUserId: string;
	receiverScope: string;
	destinationId: string;
	remoteMessageId: string;
}

/**
 * The delivery effects of one committed legacy escalation transfer (#408), in
 * the expansion's transaction. The legacy request stays the same, so the
 * transfer is recorded as a lifecycle intent of its own (once per transfer,
 * already expanded: escalation is its only dispatcher), which moves the
 * lifecycle's version on. Then the replacement card per intended provider
 * (keyed by the transfer, so it never collides with the former holder's
 * initial card and a second transfer gets its own), the adoption of the former
 * holder's old-path cards, and the retirement of every tracked card of the
 * former holder for the request, linked to the transfer. Work and messages
 * name the legacy lifecycle, never a workflow, stage or assignment.
 */
export async function planLegacyEscalationTransferDelivery(
	transaction: DatabaseTransaction,
	input: {
		organizationId: string;
		escalationTransferId: string;
		lifecycle: LegacyDeliveryLifecycle;
		approvalRequestId: string;
		formerApproverEmployeeId: string;
		replacementApproverEmployeeId: string;
		providers: readonly ApprovalDeliveryProvider[];
		untrackedFormerCards: readonly UntrackedApprovalCard[];
	},
): Promise<number> {
	const { lifecycle } = input;
	await recordLegacyTransferIntent(transaction, {
		organizationId: input.organizationId,
		workflowType: lifecycle.workflowType,
		sourceType: lifecycle.sourceType,
		sourceId: lifecycle.sourceId,
		approvalRequestId: input.approvalRequestId,
		cycleId: lifecycle.cycleId,
		escalationTransferId: input.escalationTransferId,
	});
	const legacy = {
		lifecycle: "legacy" as const,
		workflowType: lifecycle.workflowType,
		legacySourceType: lifecycle.sourceType,
		legacySourceId: lifecycle.sourceId,
		legacyCycleId: lifecycle.cycleId,
		legacyApprovalRequestId: input.approvalRequestId,
	};
	let planned = 0;
	if (input.providers.length > 0) {
		const inserted = await transaction
			.insert(approvalDeliveryWork)
			.values(
				input.providers.map((provider) => ({
					organizationId: input.organizationId,
					...legacy,
					effect: "replacement" as const,
					provider,
					recipientEmployeeId: input.replacementApproverEmployeeId,
					escalationTransferId: input.escalationTransferId,
					dedupeKey: replacementDedupeKey(input.escalationTransferId, provider),
				})),
			)
			.onConflictDoNothing({
				target: [approvalDeliveryWork.organizationId, approvalDeliveryWork.dedupeKey],
			})
			.returning({ id: approvalDeliveryWork.id });
		planned += inserted.length;
	}
	for (const card of input.untrackedFormerCards) {
		// The old path's card is tracked from now on, reflecting no version yet,
		// with the controls it may have shown.
		await transaction
			.insert(approvalDeliveryMessage)
			.values({
				organizationId: input.organizationId,
				...legacy,
				approvalRequestId: input.approvalRequestId,
				recipientEmployeeId: input.formerApproverEmployeeId,
				...card,
				controls: "actionable",
				statusVersion: 0,
			})
			.onConflictDoNothing({
				target: [
					approvalDeliveryMessage.organizationId,
					approvalDeliveryMessage.provider,
					approvalDeliveryMessage.receiverScope,
					approvalDeliveryMessage.destinationId,
					approvalDeliveryMessage.remoteMessageId,
				],
			});
	}
	planned += await planLegacyMessageRefreshes(transaction, {
		organizationId: input.organizationId,
		lifecycle,
		approvalRequestId: input.approvalRequestId,
		recipientEmployeeId: input.formerApproverEmployeeId,
		escalationTransferId: input.escalationTransferId,
	});
	return planned;
}

/**
 * Cancels replacement work that became obsolete before it was sent: its
 * assignment is no longer pending (decided, or transferred again) or the
 * request settled. A legacy replacement (#408) is obsolete once its request is
 * no longer pending with the recipient (decided, withdrawn or transferred
 * again) or a later transfer of the request superseded it. Work in flight is
 * rechecked by its own worker.
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
	const legacy = input.workflowId
		? []
		: rows(
				await db.execute(sql`
					update approval_delivery_work d
					set status = 'cancelled', last_outcome = 'obsolete', processed_at = now(),
						updated_at = now()
					where d.organization_id = ${input.organizationId}
						and d.lifecycle = 'legacy'
						and d.effect = 'replacement'
						and d.status in ('pending', 'awaiting_repair', 'exhausted', 'failed')
						and (
							not exists (
								select 1 from approval_request r
								where r.organization_id = d.organization_id
									and r.id = d.legacy_approval_request_id
									and r.status = 'pending'
									and r.approver_id = d.recipient_employee_id
							)
							-- A later transfer superseded it, even one that moved the
							-- request back to the same holder: that transfer's card
							-- is the current one.
							or exists (
								select 1
								from approval_escalation_transfer own
								join approval_escalation_transfer later
									on later.organization_id = own.organization_id
									and later.authority_mode = 'legacy'
									and later.legacy_approval_request_id = own.legacy_approval_request_id
									and later.legacy_source_sequence > own.legacy_source_sequence
								where own.organization_id = d.organization_id
									and own.id = d.escalation_transfer_id
							)
						)
					returning d.id
				`),
			);
	return cancelled.length + legacy.length;
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
				select i.id, i.workflow_type, i.source_type, i.source_id, i.legacy_cycle_id,
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
				cycleId: nullableText(intent.legacy_cycle_id),
			};
			const key = `${lifecycle.workflowType}:${lifecycle.sourceType}:${lifecycle.sourceId}:${lifecycle.cycleId ?? ""}`;
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
					d.legacy_source_id, d.legacy_approval_request_id, d.legacy_cycle_id,
					d.recipient_employee_id,
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
									cycleId: nullableText(row.legacy_cycle_id),
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
 * here are supported; anything else is null. An absence (#384) or time (#432)
 * cycle has the status of its chain or single request; a request deleted or
 * withdrawn by ordinary cancellation reads as `cancelled` without an approver.
 */
export async function loadLegacyDeliveryState(input: {
	organizationId: string;
	lifecycle: LegacyDeliveryLifecycle;
	approvalRequestId: string;
}): Promise<{
	lifecycleStatus: "pending" | "approved" | "rejected" | "cancelled" | "unknown";
	version: number;
	requestStatus: string;
	approverEmployeeId: string | null;
} | null> {
	const { cycleId } = input.lifecycle;
	if (
		cycleId &&
		input.lifecycle.workflowType === "absence" &&
		input.lifecycle.sourceType === "absence_entry"
	) {
		// A cycle's status is its own: its chain's, or its single request's.
		// Ordinary cancellation deletes the absence and its pending requests
		// (withdrawn); the cycle's delivery rows outlive them until privileged
		// cleanup.
		const [cycle] = rows(
			await db.execute(sql`
				select a.id as source_id, c.status::text as chain_status,
					root.status::text as root_status, r.status as request_status, r.approver_id,
					${legacyLifecycleVersionSql(input.organizationId, input.lifecycle)} as version
				from (select 1) as lifecycle
				left join absence_entry a
					on a.organization_id = ${input.organizationId}
					and a.id = ${input.lifecycle.sourceId}::uuid
				left join approval_chain_instance c
					on c.organization_id = ${input.organizationId} and c.id = ${cycleId}::uuid
				left join approval_request root
					on root.organization_id = ${input.organizationId} and root.id = ${cycleId}::uuid
				left join approval_request r
					on r.organization_id = ${input.organizationId}
					and r.id = ${input.approvalRequestId}::uuid
					and r.entity_type = 'absence_entry'
					and r.entity_id = ${input.lifecycle.sourceId}::uuid
			`),
		);
		if (!cycle) return null;
		const cycleStatus = cycle.source_id
			? (nullableText(cycle.chain_status) ?? nullableText(cycle.root_status) ?? "cancelled")
			: "cancelled";
		return {
			lifecycleStatus:
				cycleStatus === "pending" ||
				cycleStatus === "approved" ||
				cycleStatus === "rejected" ||
				cycleStatus === "cancelled"
					? cycleStatus
					: "unknown",
			version: Number(cycle.version),
			requestStatus: nullableText(cycle.request_status) ?? "cancelled",
			approverEmployeeId: nullableText(cycle.approver_id),
		};
	}
	if (
		cycleId &&
		isTimeApprovalWorkflowType(input.lifecycle.workflowType) &&
		input.lifecycle.sourceType === "time_entry"
	) {
		// A time cycle (#432) has the status of its chain or single request.
		// Requester cancellation of a correction keeps a direct request as a
		// decided-looking tombstone, so the cycle's own `withdrawn` intent is
		// what marks it cancelled.
		const [cycle] = rows(
			await db.execute(sql`
				select c.status::text as chain_status, root.status::text as root_status,
					r.status as request_status, r.approver_id,
					exists (
						select 1 from approval_delivery_intent w
						where w.organization_id = ${input.organizationId}
							and w.legacy_cycle_id = ${cycleId}::uuid
							and w.event = 'withdrawn'
					) as withdrawn,
					${legacyLifecycleVersionSql(input.organizationId, input.lifecycle)} as version
				from (select 1) as lifecycle
				left join approval_chain_instance c
					on c.organization_id = ${input.organizationId} and c.id = ${cycleId}::uuid
				left join approval_request root
					on root.organization_id = ${input.organizationId} and root.id = ${cycleId}::uuid
				left join approval_request r
					on r.organization_id = ${input.organizationId}
					and r.id = ${input.approvalRequestId}::uuid
					and r.entity_type = 'time_entry'
					and r.entity_id = ${input.lifecycle.sourceId}::uuid
			`),
		);
		if (!cycle) return null;
		const withdrawn = cycle.withdrawn === true;
		const cycleStatus = withdrawn
			? "cancelled"
			: (nullableText(cycle.chain_status) ?? nullableText(cycle.root_status) ?? "cancelled");
		return {
			lifecycleStatus:
				cycleStatus === "pending" ||
				cycleStatus === "approved" ||
				cycleStatus === "rejected" ||
				cycleStatus === "cancelled"
					? cycleStatus
					: "unknown",
			version: Number(cycle.version),
			requestStatus: withdrawn ? "cancelled" : (nullableText(cycle.request_status) ?? "cancelled"),
			approverEmployeeId: withdrawn ? null : nullableText(cycle.approver_id),
		};
	}
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

/** Rolls back a legacy message whose sending work was purged meanwhile. */
class LegacyLifecyclePurgedError extends Error {}

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
 * refreshed. A lifecycle purged meanwhile cannot be recreated: a canonical
 * message's FKs fail, and a legacy message (whose request is kept by value,
 * #384) is recorded only while the work that sent it still exists, which the
 * purge deletes under its table locks.
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
				legacyCycleId: legacy.cycleId,
			}
		: { ...remote, workflowId, stageId, assignmentId };
	try {
		const inserted = await db.transaction(async (transaction) => {
			// The insert takes the message table lock first, the same order as the
			// purge (which locks every delivery table up front), so the two
			// serialize instead of deadlocking.
			const [row] = await transaction
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
			if (legacy && row) {
				const origin = input.originWorkId
					? rows(
							await transaction.execute(sql`
								select id from approval_delivery_work
								where organization_id = ${input.organizationId}
									and id = ${input.originWorkId}::uuid
								for key share
							`),
						)
					: [];
				if (origin.length !== 1) throw new LegacyLifecyclePurgedError();
			}
			return row ?? null;
		});
		if (inserted) return { kind: "recorded", messageId: inserted.id };
	} catch (error) {
		if (error instanceof LegacyLifecyclePurgedError) return { kind: "purged" };
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
		"lifecycle" | "workflowType" | "legacySourceType" | "legacySourceId" | "legacyCycleId"
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
				cycleId: message.legacyCycleId,
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
		| "organizationId"
		| "lifecycle"
		| "workflowId"
		| "assignmentId"
		| "legacyApprovalRequestId"
		| "recipientEmployeeId"
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
		// A former holder's card (#408) is no longer pending for its recipient.
		return request?.status === "pending" && !(await isApprovalDeliveryAssignmentReplaced(message));
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
 * (escalation or reassignment): its cards then say it was reassigned. A legacy
 * lifecycle card (#296) has no canonical assignment; it is replaced once
 * escalation transferred its request away from its recipient (#408).
 */
export async function isApprovalDeliveryAssignmentReplaced(
	message: Pick<
		ApprovalDeliveryMessageRecord,
		| "organizationId"
		| "lifecycle"
		| "workflowId"
		| "assignmentId"
		| "legacyApprovalRequestId"
		| "recipientEmployeeId"
	>,
): Promise<boolean> {
	if (message.lifecycle === "legacy") {
		if (!message.legacyApprovalRequestId) return false;
		const [replaced] = rows(
			await db.execute(sql`
				select ${legacyRecipientReplacedSql({
					organizationId: sql`${message.organizationId}`,
					approvalRequestId: sql`${message.legacyApprovalRequestId}::uuid`,
					recipientEmployeeId: sql`${message.recipientEmployeeId}::uuid`,
				})} as replaced
			`),
		);
		return replaced?.replaced === true;
	}
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
