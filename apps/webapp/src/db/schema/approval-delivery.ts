import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { approvalReviewBinding } from "./approval-evidence";
import { approvalRequest } from "./approval";
import { approvalOutbox, approvalStageAssignment, approvalWorkflow } from "./approval-workflow";
import { approvalWorkflowTypeEnum } from "./enums";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// #291: providers whose approval-card delivery has one durable owner. Slack
// joined in #294 with review-only cards, Teams in #293.
export const APPROVAL_DELIVERY_PROVIDERS = ["telegram", "teams", "slack"] as const;
export type ApprovalDeliveryProvider = (typeof APPROVAL_DELIVERY_PROVIDERS)[number];

/** `initial` sends a card for one assignment; `refresh` updates one sent message. */
export const APPROVAL_DELIVERY_EFFECTS = ["initial", "refresh"] as const;
export type ApprovalDeliveryEffect = (typeof APPROVAL_DELIVERY_EFFECTS)[number];

export const APPROVAL_DELIVERY_STATUSES = [
	"pending",
	"processing",
	"delivered",
	"suppressed",
	"cancelled",
	"awaiting_repair",
	"exhausted",
	"failed",
] as const;
export type ApprovalDeliveryStatus = (typeof APPROVAL_DELIVERY_STATUSES)[number];

export const APPROVAL_DELIVERY_MESSAGE_STATES = ["current", "retired", "gone"] as const;
export type ApprovalDeliveryMessageState = (typeof APPROVAL_DELIVERY_MESSAGE_STATES)[number];

/**
 * Which approval authority owns the delivered lifecycle (#296). A canonical
 * lifecycle is a workflow with stages and assignments; a legacy lifecycle is a
 * legacy-authoritative source (e.g. an expense claim) whose legacy requests are
 * the assignment equivalents. Legacy rows never name a canonical workflow.
 */
export const APPROVAL_DELIVERY_LIFECYCLES = ["canonical", "legacy"] as const;
export type ApprovalDeliveryLifecycle = (typeof APPROVAL_DELIVERY_LIFECYCLES)[number];

function lifecycleCheck(table: {
	lifecycle: unknown;
	workflowId: unknown;
	assignmentId: unknown;
	workflowType: unknown;
	legacySourceType: unknown;
	legacySourceId: unknown;
	legacyApprovalRequestId: unknown;
}) {
	return sql`(${table.lifecycle} = 'canonical' AND ${table.workflowId} IS NOT NULL
		AND ${table.assignmentId} IS NOT NULL AND ${table.legacyApprovalRequestId} IS NULL
		AND ${table.legacySourceType} IS NULL AND ${table.legacySourceId} IS NULL)
	OR (${table.lifecycle} = 'legacy' AND ${table.workflowId} IS NULL
		AND ${table.assignmentId} IS NULL AND ${table.workflowType} IS NOT NULL
		AND ${table.legacySourceType} IS NOT NULL AND ${table.legacySourceId} IS NOT NULL
		AND ${table.legacyApprovalRequestId} IS NOT NULL)`;
}

// Per organization/kind/provider ownership switch. No row keeps the existing
// notification path; a row moves that provider's approval cards to the
// delivery owner for lifecycle intents created at or after `activated_at`.
export const approvalDeliveryControl = pgTable(
	"approval_delivery_control",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		provider: text("provider").$type<ApprovalDeliveryProvider>().notNull(),
		activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({
			name: "approval_delivery_control_pk",
			columns: [table.organizationId, table.workflowType, table.provider],
		}),
		check(
			"approval_delivery_control_provider_check",
			sql`${table.provider} IN ('telegram', 'teams', 'slack')`,
		),
	],
);

// Every actual remote approval message, including duplicates and late sends,
// with its complete destination and binding identity. `status_version` is the
// workflow version the remote content reflects; it only increases, and only
// an initial send ever shows controls, so refreshes cannot revive them.
export const approvalDeliveryMessage = pgTable(
	"approval_delivery_message",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		lifecycle: text("lifecycle").$type<ApprovalDeliveryLifecycle>().default("canonical").notNull(),
		workflowId: uuid("workflow_id"),
		stageId: uuid("stage_id"),
		assignmentId: uuid("assignment_id"),
		approvalRequestId: uuid("approval_request_id"),
		// Legacy lifecycle identity: its kind, source and the exact legacy request.
		workflowType: approvalWorkflowTypeEnum("workflow_type"),
		legacySourceType: text("legacy_source_type"),
		legacySourceId: uuid("legacy_source_id"),
		legacyApprovalRequestId: uuid("legacy_approval_request_id"),
		recipientEmployeeId: uuid("recipient_employee_id").notNull(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ApprovalDeliveryProvider>().notNull(),
		receiverScope: text("receiver_scope").notNull(),
		destinationId: text("destination_id").notNull(),
		remoteMessageId: text("remote_message_id").notNull(),
		bindingId: uuid("binding_id"),
		originWorkId: uuid("origin_work_id"),
		controls: text("controls").$type<"actionable" | "none">().notNull(),
		state: text("state").$type<ApprovalDeliveryMessageState>().default("current").notNull(),
		statusVersion: integer("status_version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("approvalDeliveryMessage_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("approvalDeliveryMessage_remote_identity_idx").on(
			table.organizationId,
			table.provider,
			table.receiverScope,
			table.destinationId,
			table.remoteMessageId,
		),
		index("approvalDeliveryMessage_org_workflow_idx").on(table.organizationId, table.workflowId),
		index("approvalDeliveryMessage_org_legacy_source_idx")
			.on(table.organizationId, table.legacySourceType, table.legacySourceId)
			.where(sql`${table.lifecycle} = 'legacy'`),
		check("approval_delivery_message_provider_check", sql`${table.provider} IN ('telegram', 'teams', 'slack')`),
		check("approval_delivery_message_lifecycle_check", lifecycleCheck(table)),
		check(
			"approval_delivery_message_legacy_reference_check",
			sql`${table.lifecycle} <> 'legacy' OR ${table.approvalRequestId} = ${table.legacyApprovalRequestId}`,
		),
		check(
			"approval_delivery_message_controls_check",
			sql`${table.controls} IN ('actionable', 'none')`,
		),
		check(
			"approval_delivery_message_state_check",
			sql`${table.state} IN ('current', 'retired', 'gone')`,
		),
		foreignKey({
			name: "approval_delivery_message_workflow_fk",
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_message_assignment_fk",
			columns: [table.assignmentId, table.organizationId],
			foreignColumns: [approvalStageAssignment.id, approvalStageAssignment.organizationId],
		}).onDelete("cascade"),
		// A purged legacy lifecycle takes its messages with it; a late send then
		// cannot record a message for it.
		foreignKey({
			name: "approval_delivery_message_legacy_request_fk",
			columns: [table.legacyApprovalRequestId, table.organizationId],
			foreignColumns: [approvalRequest.id, approvalRequest.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_message_binding_fk",
			columns: [table.bindingId, table.organizationId],
			foreignColumns: [approvalReviewBinding.id, approvalReviewBinding.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_message_recipient_fk",
			columns: [table.recipientEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

// One logical delivery effect per row, with a stable dedupe identity. Workers
// lease rows (`claim_token`, `lease_expires_at`) and complete them only while
// their token still holds; an expired lease is recovered by the next claim.
export const approvalDeliveryWork = pgTable(
	"approval_delivery_work",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The lifecycle intent that first required this effect, when one did. */
		outboxId: uuid("outbox_id"),
		lifecycle: text("lifecycle").$type<ApprovalDeliveryLifecycle>().default("canonical").notNull(),
		workflowId: uuid("workflow_id"),
		effect: text("effect").$type<ApprovalDeliveryEffect>().notNull(),
		provider: text("provider").$type<ApprovalDeliveryProvider>().notNull(),
		assignmentId: uuid("assignment_id"),
		// Legacy lifecycle identity: its kind, source and the recipient's legacy request.
		workflowType: approvalWorkflowTypeEnum("workflow_type"),
		legacySourceType: text("legacy_source_type"),
		legacySourceId: uuid("legacy_source_id"),
		legacyApprovalRequestId: uuid("legacy_approval_request_id"),
		recipientEmployeeId: uuid("recipient_employee_id").notNull(),
		messageId: uuid("message_id"),
		dedupeKey: text("dedupe_key").notNull(),
		status: text("status").$type<ApprovalDeliveryStatus>().default("pending").notNull(),
		availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
		claimToken: uuid("claim_token"),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		attemptCount: integer("attempt_count").default(0).notNull(),
		retryCount: integer("retry_count").default(0).notNull(),
		lastOutcome: text("last_outcome"),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("approvalDeliveryWork_org_dedupe_idx").on(table.organizationId, table.dedupeKey),
		index("approvalDeliveryWork_org_workflow_idx").on(table.organizationId, table.workflowId),
		index("approvalDeliveryWork_org_legacy_source_idx")
			.on(table.organizationId, table.legacySourceType, table.legacySourceId)
			.where(sql`${table.lifecycle} = 'legacy'`),
		check("approval_delivery_work_lifecycle_check", lifecycleCheck(table)),
		index("approvalDeliveryWork_due_idx")
			.on(table.organizationId, table.availableAt)
			.where(sql`status IN ('pending', 'processing')`),
		check(
			"approval_delivery_work_provider_check",
			sql`${table.provider} IN ('telegram', 'teams', 'slack')`,
		),
		check(
			"approval_delivery_work_effect_check",
			sql`(${table.effect} = 'initial' AND ${table.messageId} IS NULL) OR (${table.effect} = 'refresh' AND ${table.messageId} IS NOT NULL)`,
		),
		check(
			"approval_delivery_work_status_check",
			sql`${table.status} IN ('pending', 'processing', 'delivered', 'suppressed', 'cancelled', 'awaiting_repair', 'exhausted', 'failed')`,
		),
		foreignKey({
			name: "approval_delivery_work_outbox_fk",
			columns: [table.outboxId, table.organizationId],
			foreignColumns: [approvalOutbox.id, approvalOutbox.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_workflow_fk",
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_legacy_request_fk",
			columns: [table.legacyApprovalRequestId, table.organizationId],
			foreignColumns: [approvalRequest.id, approvalRequest.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_assignment_fk",
			columns: [table.assignmentId, table.organizationId],
			foreignColumns: [approvalStageAssignment.id, approvalStageAssignment.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_message_fk",
			columns: [table.messageId, table.organizationId],
			foreignColumns: [approvalDeliveryMessage.id, approvalDeliveryMessage.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_recipient_fk",
			columns: [table.recipientEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

export const APPROVAL_DELIVERY_INTENT_EVENTS = ["submitted", "decided"] as const;
export type ApprovalDeliveryIntentEvent = (typeof APPROVAL_DELIVERY_INTENT_EVENTS)[number];

// Lifecycle intents of legacy-authoritative approvals (#296), the counterpart
// of a canonical workflow's outbox rows. The legacy submission/decision owner
// writes one in the transaction that changes the lifecycle, only while the kind
// has a delivery control; the delivery owner plans from current state. A purged
// legacy request takes its intents with it.
export const approvalDeliveryIntent = pgTable(
	"approval_delivery_intent",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		/** The legacy request whose state this transaction changed. */
		legacyApprovalRequestId: uuid("legacy_approval_request_id").notNull(),
		event: text("event").$type<ApprovalDeliveryIntentEvent>().notNull(),
		expansionStatus: text("expansion_status")
			.$type<"pending" | "expanded">()
			.default("pending")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		expandedAt: timestamp("expanded_at", { withTimezone: true }),
	},
	(table) => [
		index("approvalDeliveryIntent_pending_idx")
			.on(table.organizationId, table.createdAt)
			.where(sql`expansion_status = 'pending'`),
		index("approvalDeliveryIntent_org_legacy_request_idx").on(
			table.organizationId,
			table.legacyApprovalRequestId,
		),
		check("approval_delivery_intent_event_check", sql`${table.event} IN ('submitted', 'decided')`),
		check(
			"approval_delivery_intent_expansion_check",
			sql`${table.expansionStatus} IN ('pending', 'expanded')`,
		),
		foreignKey({
			name: "approval_delivery_intent_legacy_request_fk",
			columns: [table.legacyApprovalRequestId, table.organizationId],
			foreignColumns: [approvalRequest.id, approvalRequest.organizationId],
		}).onDelete("cascade"),
	],
);
