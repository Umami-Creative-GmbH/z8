import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import {
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowEvent,
} from "./approval-workflow";
import { approvalWorkflowTypeEnum } from "./enums";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// ============================================
// APPROVAL ESCALATION POLICY AND ATTENTION
// ============================================
// One organization-level policy owns escalation enablement and the response
// window. Slack/Telegram/Discord/Teams keep only their delivery preference
// (`enableEscalations`); their `escalationTimeoutHours` values are migration
// provenance, not competing deadlines. Nothing here grants assignment
// authority or activates automation: ownership stays gated by
// `approval_escalation_control`.

export type ApprovalEscalationChannel =
	| "slack"
	| "telegram"
	| "discord"
	| "teams";

/** Snapshot of one integration row inspected by the policy migration. */
export interface ApprovalEscalationPolicySource {
	channel: ApprovalEscalationChannel;
	/** Integration config row id (Teams may have several tenants per organization). */
	sourceId: string;
	displayName: string | null;
	setupStatus: string;
	active: boolean;
	escalationEnabled: boolean;
	escalationTimeoutHours: number;
	/** Whether this source determined the migrated enablement/window. */
	contributed: boolean;
}

export type ApprovalEscalationPolicyConflictCode =
	| "differing_timeouts"
	| "invalid_timeout"
	| "inactive_source_enabled"
	| "disabled_active_source";

export interface ApprovalEscalationPolicyConflict {
	code: ApprovalEscalationPolicyConflictCode;
	sourceIds: string[];
}

export interface ApprovalEscalationPolicyProvenance {
	/** Version of the derivation rules applied, so later readers can interpret the snapshot. */
	rule: "active_escalation_enabled_shortest_timeout@1";
	outcome: "enabled_from_sources" | "disabled_no_enabled_source";
	sources: ApprovalEscalationPolicySource[];
	conflicts: ApprovalEscalationPolicyConflict[];
}

export const approvalEscalationPolicy = pgTable(
	"approval_escalation_policy",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").notNull(),
		responseWindowHours: integer("response_window_hours").notNull(),
		// Monotonic revision; every change inserts an immutable revision row. Committed
		// outcomes record the revision they evaluated instead of re-reading it later.
		revision: integer("revision").default(1).notNull(),
		migratedAt: timestamp("migrated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		migrationProvenance: jsonb("migration_provenance")
			.$type<ApprovalEscalationPolicyProvenance>()
			.notNull(),
		conflictReviewStatus: text("conflict_review_status")
			.$type<"none" | "pending" | "reviewed">()
			.default("none")
			.notNull(),
		conflictReviewedByUserId: text("conflict_reviewed_by_user_id").references(
			() => user.id,
		),
		conflictReviewedAt: timestamp("conflict_reviewed_at", {
			withTimezone: true,
		}),
		updatedByUserId: text("updated_by_user_id").references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		check(
			"approval_escalation_policy_window_check",
			sql`${table.responseWindowHours} >= 1`,
		),
		check(
			"approval_escalation_policy_revision_check",
			sql`${table.revision} >= 1`,
		),
	],
);

export const approvalEscalationPolicyRevision = pgTable(
	"approval_escalation_policy_revision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		revision: integer("revision").notNull(),
		enabled: boolean("enabled").notNull(),
		responseWindowHours: integer("response_window_hours").notNull(),
		origin: text("origin").$type<"migration" | "management_edit">().notNull(),
		changedByUserId: text("changed_by_user_id").references(() => user.id),
		reason: text("reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalEscalationPolicyRevision_org_revision_idx").on(
			table.organizationId,
			table.revision,
		),
		foreignKey({
			name: "approvalEscalationPolicyRevision_policy_fk",
			columns: [table.organizationId],
			foreignColumns: [approvalEscalationPolicy.organizationId],
		}).onDelete("cascade"),
		check(
			"approval_escalation_policy_revision_origin_check",
			sql`${table.origin} IN ('migration', 'management_edit')`,
		),
	],
);

export type ApprovalEscalationAttentionReason =
	| "no_eligible_backup"
	| "replacement_overdue"
	| "unsupported_route"
	| "ambiguous_history"
	| "delivery_exhausted"
	| "delivery_unavailable";

export type ApprovalEscalationAttentionStatus =
	| "open"
	| "resolved"
	| "disposed";

/** A related transfer/delivery attempt summarized for management review. */
export interface ApprovalEscalationAttentionAttempt {
	kind: "transfer" | "delivery" | "retirement";
	channel?: ApprovalEscalationChannel;
	reference?: string;
	outcome: string;
	at: string;
}

export const approvalEscalationAttention = pgTable(
	"approval_escalation_attention",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Deterministic incident identity (reason + assignment/lineage/delivery scope).
		dedupeKey: text("dedupe_key").notNull(),
		reason: text("reason").$type<ApprovalEscalationAttentionReason>().notNull(),
		status: text("status")
			.$type<ApprovalEscalationAttentionStatus>()
			.default("open")
			.notNull(),
		approvalType: text("approval_type"),
		approvalRequestId: uuid("approval_request_id"),
		workflowId: uuid("workflow_id"),
		assignmentId: uuid("assignment_id"),
		lineageRootAssignmentId: uuid("lineage_root_assignment_id"),
		currentApproverEmployeeId: uuid("current_approver_employee_id"),
		deliveryChannel:
			text("delivery_channel").$type<ApprovalEscalationChannel>(),
		evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
		attempts: jsonb("attempts")
			.$type<ApprovalEscalationAttentionAttempt[]>()
			.default(sql`'[]'::jsonb`)
			.notNull(),
		policyRevision: integer("policy_revision"),
		firstRaisedAt: timestamp("first_raised_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		observationCount: integer("observation_count").default(1).notNull(),
		lastRecheckedAt: timestamp("last_rechecked_at", { withTimezone: true }),
		// Alert bookkeeping only. Alerts never resolve the incident.
		adminAlertedAt: timestamp("admin_alerted_at", { withTimezone: true }),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		closureNote: text("closure_note"),
		disposedByUserId: text("disposed_by_user_id").references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("approvalEscalationAttention_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		// At most one unresolved incident per condition; a recurrence after
		// closure opens a new incident with its own history.
		uniqueIndex("approvalEscalationAttention_open_dedupe_idx")
			.on(table.organizationId, table.dedupeKey)
			.where(sql`status = 'open'`),
		index("approvalEscalationAttention_org_status_idx").on(
			table.organizationId,
			table.status,
			table.lastObservedAt,
		),
		foreignKey({
			name: "approvalEscalationAttention_approver_fk",
			columns: [table.currentApproverEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check(
			"approval_escalation_attention_status_check",
			sql`${table.status} IN ('open', 'resolved', 'disposed')`,
		),
		check(
			"approval_escalation_attention_closure_check",
			sql`(${table.status} = 'open') = (${table.closedAt} IS NULL)`,
		),
		check(
			"approval_escalation_attention_disposal_check",
			sql`(${table.status} = 'disposed') = (${table.disposedByUserId} IS NOT NULL)`,
		),
	],
);

export type ApprovalEscalationAttentionEventType =
	| "raised"
	| "alerted"
	| "resolved"
	| "disposed";

export const approvalEscalationAttentionEvent = pgTable(
	"approval_escalation_attention_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		attentionId: uuid("attention_id").notNull(),
		organizationId: text("organization_id").notNull(),
		eventType: text("event_type")
			.$type<ApprovalEscalationAttentionEventType>()
			.notNull(),
		actorKind: text("actor_kind").$type<"system" | "user">().notNull(),
		actorUserId: text("actor_user_id").references(() => user.id),
		detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("approvalEscalationAttentionEvent_attention_idx").on(
			table.attentionId,
			table.createdAt,
		),
		foreignKey({
			name: "approvalEscalationAttentionEvent_attention_fk",
			columns: [table.attentionId, table.organizationId],
			foreignColumns: [
				approvalEscalationAttention.id,
				approvalEscalationAttention.organizationId,
			],
		}).onDelete("cascade"),
		check(
			"approval_escalation_attention_event_actor_check",
			sql`(${table.actorKind} = 'user') = (${table.actorUserId} IS NOT NULL)`,
		),
	],
);

// ============================================
// APPROVAL ESCALATION TRANSFER JOURNAL
// ============================================
// One row per committed authority transfer, written in the same transaction
// as the workflow `escalate` transition, its compatibility mirror and its
// receipt (#255 §2). Held outcomes are attention incidents, not journal rows.
// The journal links the canonical transition instead of copying it, and is
// immutable once written.

export type ApprovalEscalationTransferInitiator = "scheduled" | "human";

/** How the source assignment's actionable instant was established. */
export type ApprovalEscalationActionableEvidence =
	| "assignment_assigned_at"
	| "rollout_fallback";

export const approvalEscalationTransfer = pgTable(
	"approval_escalation_transfer",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Stable operation identity: organization + source assignment lineage for
		// automatic transfers, the caller's idempotency key for human transfers.
		operationKey: text("operation_key").notNull(),
		initiator: text("initiator")
			.$type<ApprovalEscalationTransferInitiator>()
			.notNull(),
		authorityMode: text("authority_mode").$type<"canonical">().notNull(),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		workflowId: uuid("workflow_id").notNull(),
		stageId: uuid("stage_id").notNull(),
		sourceAssignmentId: uuid("source_assignment_id").notNull(),
		replacementAssignmentId: uuid("replacement_assignment_id").notNull(),
		// Null only for a human transfer whose lineage could not be established.
		lineageRootAssignmentId: uuid("lineage_root_assignment_id"),
		sourceApproverEmployeeId: uuid("source_approver_employee_id").notNull(),
		replacementApproverEmployeeId: uuid(
			"replacement_approver_employee_id",
		).notNull(),
		requesterEmployeeId: uuid("requester_employee_id").notNull(),
		// Scheduled transfers record the evidenced actionable instant, the
		// evaluated deadline and the policy revision; later policy edits never
		// rewrite a committed transfer. Human transfers evaluate no deadline.
		actionableAt: timestamp("actionable_at", { withTimezone: true }),
		actionableEvidence: text(
			"actionable_evidence",
		).$type<ApprovalEscalationActionableEvidence>(),
		deadlineAt: timestamp("deadline_at", { withTimezone: true }),
		policyRevision: integer("policy_revision"),
		workflowEventId: uuid("workflow_event_id").notNull(),
		receiptIdempotencyKey: text("receipt_idempotency_key").notNull(),
		receiptActorFingerprint: text("receipt_actor_fingerprint").notNull(),
		receiptCommandFingerprint: text("receipt_command_fingerprint").notNull(),
		// Detects a reused human idempotency key carrying a different request.
		requestFingerprint: text("request_fingerprint").notNull(),
		actorKind: text("actor_kind").$type<"system" | "user">().notNull(),
		actorSystemId: text("actor_system_id").$type<"approval-escalation">(),
		actorUserId: text("actor_user_id").references(() => user.id),
		actorEmployeeId: uuid("actor_employee_id"),
		reason: text("reason"),
		transferredAt: timestamp("transferred_at", {
			withTimezone: true,
		}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalEscalationTransfer_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		uniqueIndex("approvalEscalationTransfer_org_operation_idx").on(
			table.organizationId,
			table.operationKey,
		),
		// One committed transfer per replaced assignment.
		uniqueIndex("approvalEscalationTransfer_org_source_idx").on(
			table.organizationId,
			table.sourceAssignmentId,
		),
		index("approvalEscalationTransfer_org_workflow_idx").on(
			table.organizationId,
			table.workflowId,
		),
		foreignKey({
			name: "approvalEscalationTransfer_workflow_fk",
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approvalEscalationTransfer_source_fk",
			columns: [
				table.workflowId,
				table.stageId,
				table.sourceAssignmentId,
				table.organizationId,
			],
			foreignColumns: [
				approvalStageAssignment.workflowId,
				approvalStageAssignment.stageId,
				approvalStageAssignment.id,
				approvalStageAssignment.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "approvalEscalationTransfer_replacement_fk",
			columns: [
				table.workflowId,
				table.stageId,
				table.replacementAssignmentId,
				table.organizationId,
			],
			foreignColumns: [
				approvalStageAssignment.workflowId,
				approvalStageAssignment.stageId,
				approvalStageAssignment.id,
				approvalStageAssignment.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "approvalEscalationTransfer_event_fk",
			columns: [table.workflowId, table.workflowEventId, table.organizationId],
			foreignColumns: [
				approvalWorkflowEvent.workflowId,
				approvalWorkflowEvent.id,
				approvalWorkflowEvent.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "approvalEscalationTransfer_source_approver_fk",
			columns: [table.sourceApproverEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			name: "approvalEscalationTransfer_replacement_approver_fk",
			columns: [table.replacementApproverEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			name: "approvalEscalationTransfer_requester_fk",
			columns: [table.requesterEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			name: "approvalEscalationTransfer_actor_employee_fk",
			columns: [table.actorEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check(
			"approval_escalation_transfer_initiator_check",
			sql`${table.initiator} IN ('scheduled', 'human')`,
		),
		check(
			"approval_escalation_transfer_mode_check",
			sql`${table.authorityMode} IN ('canonical')`,
		),
		check(
			"approval_escalation_transfer_evidence_check",
			sql`${table.actionableEvidence} IS NULL OR ${table.actionableEvidence} IN ('assignment_assigned_at', 'rollout_fallback')`,
		),
		check(
			"approval_escalation_transfer_actor_check",
			sql`(${table.actorKind} = 'system' AND ${table.initiator} = 'scheduled' AND ${table.actorSystemId} = 'approval-escalation' AND ${table.actorUserId} IS NULL AND ${table.actorEmployeeId} IS NULL) OR (${table.actorKind} = 'user' AND ${table.initiator} = 'human' AND ${table.actorSystemId} IS NULL AND ${table.actorUserId} IS NOT NULL AND ${table.actorEmployeeId} IS NOT NULL)`,
		),
		check(
			"approval_escalation_transfer_deadline_check",
			sql`(${table.initiator} = 'scheduled' AND ${table.actionableAt} IS NOT NULL AND ${table.actionableEvidence} IS NOT NULL AND ${table.deadlineAt} IS NOT NULL AND ${table.policyRevision} IS NOT NULL AND ${table.lineageRootAssignmentId} IS NOT NULL) OR (${table.initiator} = 'human' AND ${table.actionableAt} IS NULL AND ${table.actionableEvidence} IS NULL AND ${table.deadlineAt} IS NULL)`,
		),
		check(
			"approval_escalation_transfer_distinct_check",
			sql`${table.sourceAssignmentId} <> ${table.replacementAssignmentId} AND ${table.sourceApproverEmployeeId} <> ${table.replacementApproverEmployeeId}`,
		),
	],
);

/** Frozen facts of a committed transfer for replacement delivery (#300). */
export interface ApprovalEscalationTransferEventPayload {
	schemaVersion: 1;
	workflowType: string;
	workflowId: string;
	sourceType: string;
	sourceId: string;
	legacyApprovalRequestId: string | null;
	stageId: string;
	sourceAssignmentId: string;
	replacementAssignmentId: string;
	formerApproverEmployeeId: string;
	replacementApproverEmployeeId: string;
	requesterEmployeeId: string;
	transferredAt: string;
	policyRevision: number | null;
}

/**
 * Immutable delivery event committed with each transfer. Delivery expansion
 * (#300) marks it expanded; nothing else may change, and expansion can never
 * repeat the authority transfer.
 */
export const approvalEscalationTransferEvent = pgTable(
	"approval_escalation_transfer_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		transferId: uuid("transfer_id").notNull(),
		eventType: text("event_type").$type<"assignment_transferred">().notNull(),
		payload: jsonb("payload")
			.$type<ApprovalEscalationTransferEventPayload>()
			.notNull(),
		expansionStatus: text("expansion_status")
			.$type<"pending" | "expanded">()
			.default("pending")
			.notNull(),
		expandedAt: timestamp("expanded_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalEscalationTransferEvent_transfer_type_idx").on(
			table.transferId,
			table.eventType,
		),
		index("approvalEscalationTransferEvent_pending_idx")
			.on(table.organizationId, table.createdAt)
			.where(sql`expansion_status = 'pending'`),
		foreignKey({
			name: "approvalEscalationTransferEvent_transfer_fk",
			columns: [table.transferId, table.organizationId],
			foreignColumns: [
				approvalEscalationTransfer.id,
				approvalEscalationTransfer.organizationId,
			],
		}).onDelete("cascade"),
		check(
			"approval_escalation_transfer_event_type_check",
			sql`${table.eventType} IN ('assignment_transferred')`,
		),
		check(
			"approval_escalation_transfer_event_expansion_check",
			sql`(${table.expansionStatus} = 'pending' AND ${table.expandedAt} IS NULL) OR (${table.expansionStatus} = 'expanded' AND ${table.expandedAt} IS NOT NULL)`,
		),
	],
);
