import { sql } from "drizzle-orm";
import {
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
import { currentTimestamp } from "@/lib/datetime/drizzle-schema";
import { organization, user } from "../auth-schema";
import {
	approvalActorKindEnum,
	approvalAssignmentStatusEnum,
	approvalCommandStateEnum,
	approvalOutboxChannelEnum,
	approvalOutboxDispositionEnum,
	approvalOutboxExpansionStatusEnum,
	approvalOutboxStatusEnum,
	approvalSideEffectModeEnum,
	approvalStageStatusEnum,
	approvalWorkflowLifecycleModeEnum,
	approvalWorkflowStatusEnum,
	approvalWorkflowTypeEnum,
} from "./enums";
import { employee } from "./organization";

type JsonObject = Record<string, unknown>;

export const approvalWorkflow = pgTable(
	"approval_workflow",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		requesterEmployeeId: uuid("requester_employee_id"),
		status: approvalWorkflowStatusEnum("status").default("pending").notNull(),
		currentStageOrder: integer("current_stage_order"),
		version: integer("version").default(1).notNull(),
		policySnapshot: jsonb("policy_snapshot").$type<JsonObject>().notNull(),
		contextSnapshot: jsonb("context_snapshot").$type<JsonObject>().notNull(),
		displaySnapshot: jsonb("display_snapshot").$type<JsonObject>().notNull(),
		submittedAt: timestamp("submitted_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		decisionReason: text("decision_reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("approvalWorkflow_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		uniqueIndex("approvalWorkflow_org_source_pending_idx")
			.on(
				table.organizationId,
				table.workflowType,
				table.sourceType,
				table.sourceId,
			)
			.where(sql`status = 'pending'`),
		index("approvalWorkflow_org_status_idx").on(
			table.organizationId,
			table.status,
		),
		foreignKey({
			columns: [table.requesterEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

export const approvalWorkflowStage = pgTable(
	"approval_workflow_stage",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		sequence: integer("stage_order").notNull(),
		label: text("label").notNull(),
		resolverSnapshot: jsonb("resolver_snapshot").$type<JsonObject>().notNull(),
		activationMode: text("activation_mode").notNull(),
		status: approvalStageStatusEnum("status").default("waiting").notNull(),
		activatedAt: timestamp("activated_at", { withTimezone: true }),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		decisionReason: text("decision_reason"),
		legacyApprovalRequestId: uuid("legacy_approval_request_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("approvalWorkflowStage_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		unique("approvalWorkflowStage_workflow_id_organizationId_idx").on(
			table.workflowId,
			table.id,
			table.organizationId,
		),
		uniqueIndex("approvalWorkflowStage_org_workflow_order_idx").on(
			table.organizationId,
			table.workflowId,
			table.sequence,
		),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
	],
);

export const approvalStageAssignment = pgTable(
	"approval_stage_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		stageId: uuid("stage_id").notNull(),
		sequence: integer("assignment_sequence").notNull(),
		approverEmployeeId: uuid("approver_employee_id").notNull(),
		status: approvalAssignmentStatusEnum("status").default("pending").notNull(),
		assignedAt: timestamp("assigned_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedByActorKind: approvalActorKindEnum("resolved_by_actor_kind"),
		resolvedByActorId: uuid("resolved_by_actor_id"),
		reassignedByEmployeeId: uuid("reassigned_by_employee_id"),
		reassignedFromAssignmentId: uuid("reassigned_from_assignment_id"),
		reassignmentMetadata: jsonb("reassignment_metadata").$type<JsonObject>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("approvalStageAssignment_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		unique("approvalStageAssignment_workflow_stage_id_organizationId_idx").on(
			table.workflowId,
			table.stageId,
			table.id,
			table.organizationId,
		),
		uniqueIndex("approvalStageAssignment_org_workflow_stage_sequence_idx").on(
			table.organizationId,
			table.workflowId,
			table.stageId,
			table.sequence,
		),
		uniqueIndex(
			"approvalStageAssignment_org_workflow_stage_pending_approver_idx",
		)
			.on(
				table.organizationId,
				table.workflowId,
				table.stageId,
				table.approverEmployeeId,
			)
			.where(sql`status = 'pending'`),
		foreignKey({
			columns: [table.workflowId, table.stageId, table.organizationId],
			foreignColumns: [
				approvalWorkflowStage.workflowId,
				approvalWorkflowStage.id,
				approvalWorkflowStage.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.approverEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [table.resolvedByActorId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [table.reassignedByEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [
				table.workflowId,
				table.stageId,
				table.reassignedFromAssignmentId,
				table.organizationId,
			],
			foreignColumns: [
				table.workflowId,
				table.stageId,
				table.id,
				table.organizationId,
			],
		}),
	],
);

export const approvalWorkflowEvent = pgTable(
	"approval_workflow_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		version: integer("version").notNull(),
		eventIndex: integer("event_index").notNull(),
		eventType: text("event_type").notNull(),
		actorKind: approvalActorKindEnum("actor_kind").notNull(),
		actorEmployeeId: uuid("actor_employee_id"),
		actorUserId: text("actor_user_id").references(() => user.id),
		previousState: jsonb("previous_state").$type<JsonObject>(),
		resultingState: jsonb("resulting_state").$type<JsonObject>().notNull(),
		reason: text("reason"),
		metadata: jsonb("metadata").$type<JsonObject>(),
		idempotencyKey: text("idempotency_key"),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalWorkflowEvent_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		unique("approvalWorkflowEvent_workflow_id_organizationId_idx").on(
			table.workflowId,
			table.id,
			table.organizationId,
		),
		unique("approvalWorkflowEvent_workflow_id_organizationId_eventType_idx").on(
			table.workflowId,
			table.id,
			table.organizationId,
			table.eventType,
		),
		uniqueIndex("approvalWorkflowEvent_org_workflow_version_index_idx").on(
			table.organizationId,
			table.workflowId,
			table.version,
			table.eventIndex,
		),
		uniqueIndex("approvalWorkflowEvent_org_idempotency_idx")
			.on(table.organizationId, table.idempotencyKey)
			.where(sql`idempotency_key IS NOT NULL`),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.actorEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

export const approvalWorkflowCommand = pgTable(
	"approval_workflow_command",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		actorFingerprint: text("actor_fingerprint").notNull(),
		commandFingerprint: text("command_fingerprint").notNull(),
		state: approvalCommandStateEnum("state").default("reserved").notNull(),
		result: jsonb("result").$type<JsonObject>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalWorkflowCommand_org_workflow_idempotency_idx").on(
			table.organizationId,
			table.workflowId,
			table.idempotencyKey,
		),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
	],
);

export const approvalRequesterProjection = pgTable(
	"approval_requester_projection",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		requesterEmployeeId: uuid("requester_employee_id"),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		status: approvalWorkflowStatusEnum("status").notNull(),
		currentStageOrder: integer("current_stage_order"),
		displayPayload: jsonb("display_payload").$type<JsonObject>().notNull(),
		searchText: text("search_text").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalRequesterProjection_org_workflow_idx").on(
			table.organizationId,
			table.workflowId,
		),
		index("approvalRequesterProjection_org_requester_status_idx").on(
			table.organizationId,
			table.requesterEmployeeId,
			table.status,
		),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.requesterEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

export const approvalInboxProjection = pgTable(
	"approval_inbox_projection",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		activeStageId: uuid("active_stage_id").notNull(),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		status: approvalWorkflowStatusEnum("status").notNull(),
		displayPayload: jsonb("display_payload").$type<JsonObject>().notNull(),
		searchText: text("search_text").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalInboxProjection_org_workflow_stage_idx").on(
			table.organizationId,
			table.workflowId,
			table.activeStageId,
		),
		index("approvalInboxProjection_org_status_idx").on(
			table.organizationId,
			table.status,
		),
		foreignKey({
			columns: [table.workflowId, table.activeStageId, table.organizationId],
			foreignColumns: [
				approvalWorkflowStage.workflowId,
				approvalWorkflowStage.id,
				approvalWorkflowStage.organizationId,
			],
		}).onDelete("cascade"),
	],
);

export const approvalOutbox = pgTable(
	"approval_outbox",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id").notNull(),
		eventId: uuid("event_id").notNull(),
		eventType: text("event_type").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		payload: jsonb("payload").$type<JsonObject>().notNull(),
		disposition: approvalOutboxDispositionEnum("disposition").notNull(),
		expansionStatus: approvalOutboxExpansionStatusEnum("expansion_status")
			.default("pending")
			.notNull(),
		expandedAt: timestamp("expanded_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalOutbox_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		unique("approvalOutbox_id_organizationId_disposition_idx").on(
			table.id,
			table.organizationId,
			table.disposition,
		),
		uniqueIndex("approvalOutbox_org_dedupe_idx").on(
			table.organizationId,
			table.dedupeKey,
		),
		index("approvalOutbox_org_createdAt_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("approvalOutbox_pendingExpansion_createdAt_idx")
			.on(table.expansionStatus, table.createdAt)
			.where(sql`expansion_status = 'pending'`),
		foreignKey({
			columns: [
				table.workflowId,
				table.eventId,
				table.organizationId,
				table.eventType,
			],
			foreignColumns: [
				approvalWorkflowEvent.workflowId,
				approvalWorkflowEvent.id,
				approvalWorkflowEvent.organizationId,
				approvalWorkflowEvent.eventType,
			],
		}).onDelete("cascade"),
	],
);

export const approvalOutboxDelivery = pgTable(
	"approval_outbox_delivery",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		outboxId: uuid("outbox_id").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		disposition: approvalOutboxDispositionEnum("disposition").notNull(),
		status: approvalOutboxStatusEnum("status").default("pending").notNull(),
		channel: approvalOutboxChannelEnum("channel").notNull(),
		recipientKind: text("recipient_kind").notNull(),
		recipientEmployeeId: uuid("recipient_employee_id"),
		recipientAddress: text("recipient_address"),
		availableAt: timestamp("available_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		claimToken: text("claim_token"),
		retryCount: integer("retry_count").default(0).notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalOutboxDelivery_org_dedupe_idx").on(
			table.organizationId,
			table.dedupeKey,
		),
		index("approvalOutboxDelivery_status_available_idx").on(
			table.status,
			table.availableAt,
		),
		foreignKey({
			columns: [table.outboxId, table.organizationId, table.disposition],
			foreignColumns: [
				approvalOutbox.id,
				approvalOutbox.organizationId,
				approvalOutbox.disposition,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.recipientEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

export const approvalWorkflowRollout = pgTable(
	"approval_workflow_rollout",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		lifecycleMode: approvalWorkflowLifecycleModeEnum("lifecycle_mode")
			.default("legacy")
			.notNull(),
		sideEffectMode: approvalSideEffectModeEnum("side_effect_mode")
			.default("legacy")
			.notNull(),
		backfilledThrough: timestamp("backfilled_through", { withTimezone: true }),
		mismatchCount: integer("mismatch_count").default(0).notNull(),
		lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalWorkflowRollout_org_type_idx").on(
			table.organizationId,
			table.workflowType,
		),
	],
);

export const approvalWorkflowMigrationIssue = pgTable(
	"approval_workflow_migration_issue",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowId: uuid("workflow_id"),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		legacyType: text("legacy_type"),
		legacyId: uuid("legacy_id"),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		issueCode: text("issue_code").notNull(),
		evidence: jsonb("evidence").$type<JsonObject>().notNull(),
		disposition: text("disposition").default("open").notNull(),
		operatorUserId: text("operator_user_id").references(() => user.id),
		disposedAt: timestamp("disposed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("approvalWorkflowMigrationIssue_org_type_disposition_idx").on(
			table.organizationId,
			table.workflowType,
			table.disposition,
		),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
	],
);
