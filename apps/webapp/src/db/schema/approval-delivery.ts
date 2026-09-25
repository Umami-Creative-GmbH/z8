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
import { approvalEscalationTransfer } from "./approval-escalation";
import { approvalReviewBinding } from "./approval-evidence";
import { approvalOutbox, approvalStageAssignment, approvalWorkflow } from "./approval-workflow";
import { approvalWorkflowTypeEnum } from "./enums";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// #291: providers whose approval-card delivery has one durable owner. Slack
// joined in #294 with review-only cards.
export const APPROVAL_DELIVERY_PROVIDERS = ["telegram", "slack"] as const;
export type ApprovalDeliveryProvider = (typeof APPROVAL_DELIVERY_PROVIDERS)[number];

/**
 * `initial` sends a card for one assignment; `replacement` sends the card of an
 * escalation's replacement assignment (#300); `refresh` updates one sent message.
 */
export const APPROVAL_DELIVERY_EFFECTS = ["initial", "replacement", "refresh"] as const;
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
		check("approval_delivery_control_provider_check", sql`${table.provider} IN ('telegram', 'slack')`),
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
		workflowId: uuid("workflow_id").notNull(),
		stageId: uuid("stage_id").notNull(),
		assignmentId: uuid("assignment_id").notNull(),
		approvalRequestId: uuid("approval_request_id"),
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
		check("approval_delivery_message_provider_check", sql`${table.provider} IN ('telegram', 'slack')`),
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
// Work linked to an escalation transfer (#300) belongs to escalation's
// replacement delivery; the delivery owner executes all other work. A refresh
// has one row whichever owner planned it first (shared dedupe identity).
export const approvalDeliveryWork = pgTable(
	"approval_delivery_work",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The lifecycle intent that first required this effect, when one did. */
		outboxId: uuid("outbox_id"),
		workflowId: uuid("workflow_id").notNull(),
		effect: text("effect").$type<ApprovalDeliveryEffect>().notNull(),
		provider: text("provider").$type<ApprovalDeliveryProvider>().notNull(),
		assignmentId: uuid("assignment_id").notNull(),
		recipientEmployeeId: uuid("recipient_employee_id").notNull(),
		messageId: uuid("message_id"),
		/** The committed transfer whose replacement delivery owns this work. */
		escalationTransferId: uuid("escalation_transfer_id"),
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
		index("approvalDeliveryWork_org_transfer_idx")
			.on(table.organizationId, table.escalationTransferId)
			.where(sql`escalation_transfer_id IS NOT NULL`),
		index("approvalDeliveryWork_due_idx")
			.on(table.organizationId, table.availableAt)
			.where(sql`status IN ('pending', 'processing')`),
		check("approval_delivery_work_provider_check", sql`${table.provider} IN ('telegram', 'slack')`),
		check(
			"approval_delivery_work_effect_check",
			sql`(${table.effect} = 'initial' AND ${table.messageId} IS NULL AND ${table.escalationTransferId} IS NULL) OR (${table.effect} = 'replacement' AND ${table.messageId} IS NULL AND ${table.escalationTransferId} IS NOT NULL) OR (${table.effect} = 'refresh' AND ${table.messageId} IS NOT NULL)`,
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
			name: "approval_delivery_work_escalation_transfer_fk",
			columns: [table.escalationTransferId, table.organizationId],
			foreignColumns: [approvalEscalationTransfer.id, approvalEscalationTransfer.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_delivery_work_recipient_fk",
			columns: [table.recipientEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);
