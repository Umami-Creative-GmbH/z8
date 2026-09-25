import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { approvalStageAssignment, approvalWorkflow } from "./approval-workflow";
import {
	approvalActorKindEnum,
	approvalWorkflowStatusEnum,
	approvalWorkflowTypeEnum,
} from "./enums";
import { employee } from "./organization";

type JsonObject = Record<string, unknown>;

export const APPROVAL_EVIDENCE_MODES = ["inactive", "capture"] as const;
export type ApprovalEvidenceMode = (typeof APPROVAL_EVIDENCE_MODES)[number];

// Which authority committed the evidenced operation. Legacy evidence never
// references a canonical workflow as its lifecycle: an observed shadow workflow
// is kept separately so storing an observation cannot promote authority.
export const APPROVAL_EVIDENCE_AUTHORITIES = ["canonical", "legacy"] as const;
export type ApprovalEvidenceAuthority =
	(typeof APPROVAL_EVIDENCE_AUTHORITIES)[number];

// Per organization/kind evidence adoption. No row keeps capture inactive; the
// authorized adoption writer changes it under the exclusive rollout lock.
export const approvalEvidenceControl = pgTable(
	"approval_evidence_control",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		mode: text("mode")
			.$type<ApprovalEvidenceMode>()
			.default("inactive")
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.workflowType] }),
		check(
			"approval_evidence_control_mode_check",
			sql`${table.mode} IN ('inactive', 'capture')`,
		),
	],
);

// Immutable request-specific facts captured by the submission owner before
// lossy normalization. Rows are never updated; the workflow FK removes them only
// through privileged linked-lifecycle or whole-organization cleanup. Legacy
// rows reference their legacy request/chain by value: ordinary cancellation
// deletes pending legacy requests and must not delete or be blocked by evidence.
export const approvalSubmittedRevision = pgTable(
	"approval_submitted_revision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		authority: text("authority")
			.$type<ApprovalEvidenceAuthority>()
			.default("canonical")
			.notNull(),
		workflowId: uuid("workflow_id"),
		legacyApprovalRequestId: uuid("legacy_approval_request_id"),
		legacyChainInstanceId: uuid("legacy_chain_instance_id"),
		observedWorkflowId: uuid("observed_workflow_id"),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		sourceType: text("source_type").notNull(),
		sourceId: uuid("source_id").notNull(),
		requestCycleKey: text("request_cycle_key").notNull(),
		revision: integer("revision").notNull(),
		subjectEmployeeId: uuid("subject_employee_id").notNull(),
		requesterEmployeeId: uuid("requester_employee_id").notNull(),
		submitterActorKind: approvalActorKindEnum("submitter_actor_kind").notNull(),
		submitterEmployeeId: uuid("submitter_employee_id"),
		submitterUserId: text("submitter_user_id").references(() => user.id),
		schemaVersion: integer("schema_version").notNull(),
		materialFingerprint: text("material_fingerprint").notNull(),
		facts: jsonb("facts").$type<JsonObject>().notNull(),
		labels: jsonb("labels").$type<JsonObject>().notNull(),
		provenance: text("provenance").notNull(),
		submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalSubmittedRevision_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		unique("approvalSubmittedRevision_id_workflow_organizationId_idx").on(
			table.id,
			table.workflowId,
			table.organizationId,
		),
		unique("approvalSubmittedRevision_id_organizationId_authority_idx").on(
			table.id,
			table.organizationId,
			table.authority,
		),
		check(
			"approval_submitted_revision_revision_check",
			sql`${table.revision} >= 1`,
		),
		check(
			"approval_submitted_revision_authority_check",
			sql`(${table.authority} = 'canonical' AND ${table.workflowId} IS NOT NULL
				AND ${table.legacyApprovalRequestId} IS NULL
				AND ${table.legacyChainInstanceId} IS NULL
				AND ${table.observedWorkflowId} IS NULL)
			OR (${table.authority} = 'legacy' AND ${table.workflowId} IS NULL
				AND ${table.legacyApprovalRequestId} IS NOT NULL)`,
		),
		uniqueIndex("approvalSubmittedRevision_org_workflow_revision_idx").on(
			table.organizationId,
			table.workflowId,
			table.revision,
		),
		uniqueIndex("approvalSubmittedRevision_org_legacy_cycle_revision_idx")
			.on(
				table.organizationId,
				table.sourceType,
				table.sourceId,
				table.requestCycleKey,
				table.revision,
			)
			.where(sql`${table.authority} = 'legacy'`),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.subjectEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [table.requesterEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		foreignKey({
			columns: [table.submitterEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

// Opaque handle binding one recipient's reviewed card/view to an exact
// assignment and submitted revision. It is neither authority nor invocation
// identity and is never retargeted.
export const approvalReviewBinding = pgTable(
	"approval_review_binding",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recipientEmployeeId: uuid("recipient_employee_id").notNull(),
		workflowId: uuid("workflow_id").notNull(),
		stageId: uuid("stage_id").notNull(),
		assignmentId: uuid("assignment_id").notNull(),
		submittedRevisionId: uuid("submitted_revision_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("approvalReviewBinding_id_organizationId_idx").on(
			table.id,
			table.organizationId,
		),
		uniqueIndex(
			"approvalReviewBinding_org_recipient_assignment_revision_idx",
		).on(
			table.organizationId,
			table.recipientEmployeeId,
			table.assignmentId,
			table.submittedRevisionId,
		),
		foreignKey({
			columns: [
				table.workflowId,
				table.stageId,
				table.assignmentId,
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
			columns: [
				table.submittedRevisionId,
				table.workflowId,
				table.organizationId,
			],
			foreignColumns: [
				approvalSubmittedRevision.id,
				approvalSubmittedRevision.workflowId,
				approvalSubmittedRevision.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.recipientEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

// Immutable outcome of one committed decision operation, written atomically
// with the authoritative transition and linked to its receipt. Replays read it;
// they never write another row. For legacy authority the row is also the
// operation receipt, keyed by the one legacy request it decided.
export const approvalDecisionEvidence = pgTable(
	"approval_decision_evidence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		authority: text("authority")
			.$type<ApprovalEvidenceAuthority>()
			.default("canonical")
			.notNull(),
		workflowId: uuid("workflow_id"),
		legacyApprovalRequestId: uuid("legacy_approval_request_id"),
		legacyChainStageId: uuid("legacy_chain_stage_id"),
		observedWorkflowId: uuid("observed_workflow_id"),
		submittedRevisionId: uuid("submitted_revision_id").notNull(),
		operationKind: text("operation_kind")
			.$type<"command" | "submission_activation">()
			.notNull(),
		receiptIdempotencyKey: text("receipt_idempotency_key").notNull(),
		receiptActorFingerprint: text("receipt_actor_fingerprint").notNull(),
		receiptCommandFingerprint: text("receipt_command_fingerprint").notNull(),
		action: text("action").$type<"approve" | "reject">().notNull(),
		stageId: uuid("stage_id"),
		assignmentId: uuid("assignment_id"),
		assignmentOutcome: text("assignment_outcome").$type<
			"approved" | "rejected"
		>(),
		requestOutcome: approvalWorkflowStatusEnum("request_outcome").notNull(),
		actorKind: approvalActorKindEnum("actor_kind").notNull(),
		actorEmployeeId: uuid("actor_employee_id"),
		actorUserId: text("actor_user_id").references(() => user.id),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
		eventIds: jsonb("event_ids").$type<string[]>().notNull(),
		result: jsonb("result").$type<JsonObject>().notNull(),
		labels: jsonb("labels").$type<JsonObject>().notNull(),
		reviewedBindingId: uuid("reviewed_binding_id"),
		schemaVersion: integer("schema_version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"approval_decision_evidence_operation_kind_check",
			sql`${table.operationKind} IN ('command', 'submission_activation')`,
		),
		check(
			"approval_decision_evidence_action_check",
			sql`${table.action} IN ('approve', 'reject')`,
		),
		check(
			"approval_decision_evidence_assignment_outcome_check",
			sql`${table.assignmentOutcome} IS NULL OR ${table.assignmentOutcome} IN ('approved', 'rejected')`,
		),
		check(
			"approval_decision_evidence_authority_check",
			sql`(${table.authority} = 'canonical' AND ${table.workflowId} IS NOT NULL
				AND ${table.legacyApprovalRequestId} IS NULL
				AND ${table.legacyChainStageId} IS NULL
				AND ${table.observedWorkflowId} IS NULL)
			OR (${table.authority} = 'legacy' AND ${table.workflowId} IS NULL
				AND ${table.legacyApprovalRequestId} IS NOT NULL
				AND ${table.stageId} IS NULL AND ${table.assignmentId} IS NULL
				AND ${table.reviewedBindingId} IS NULL)`,
		),
		uniqueIndex("approvalDecisionEvidence_org_workflow_receipt_idx").on(
			table.organizationId,
			table.workflowId,
			table.receiptIdempotencyKey,
		),
		uniqueIndex("approvalDecisionEvidence_org_legacy_request_idx")
			.on(table.organizationId, table.legacyApprovalRequestId)
			.where(sql`${table.authority} = 'legacy'`),
		index("approvalDecisionEvidence_org_revision_idx").on(
			table.organizationId,
			table.submittedRevisionId,
		),
		unique("approvalDecisionEvidence_id_workflow_organizationId_idx").on(
			table.id,
			table.workflowId,
			table.organizationId,
		),
		// Enforced for both authorities (the workflow-scoped FK is MATCH SIMPLE and
		// skips rows without a workflow); a decision never crosses authorities.
		foreignKey({
			columns: [
				table.submittedRevisionId,
				table.organizationId,
				table.authority,
			],
			foreignColumns: [
				approvalSubmittedRevision.id,
				approvalSubmittedRevision.organizationId,
				approvalSubmittedRevision.authority,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [
				table.submittedRevisionId,
				table.workflowId,
				table.organizationId,
			],
			foreignColumns: [
				approvalSubmittedRevision.id,
				approvalSubmittedRevision.workflowId,
				approvalSubmittedRevision.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.reviewedBindingId, table.organizationId],
			foreignColumns: [
				approvalReviewBinding.id,
				approvalReviewBinding.organizationId,
			],
		}),
		foreignKey({
			columns: [table.actorEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);

// Per organization/kind/provider admission of actionable bot cards (#290).
// No row keeps cards review-only; the authorized adoption writer changes it
// under the exclusive rollout lock. Slack has no established per-invocation
// identity (#261), so it can never be admitted.
export const APPROVAL_PRESENTATION_PROVIDERS = [
	"telegram",
	"discord",
	"teams",
	"slack",
] as const;
export type ApprovalPresentationProvider =
	(typeof APPROVAL_PRESENTATION_PROVIDERS)[number];
export const APPROVAL_PRESENTATION_MODES = [
	"review_only",
	"actionable",
] as const;
export type ApprovalPresentationMode =
	(typeof APPROVAL_PRESENTATION_MODES)[number];

export const approvalPresentationControl = pgTable(
	"approval_presentation_control",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		workflowType: approvalWorkflowTypeEnum("workflow_type").notNull(),
		provider: text("provider").$type<ApprovalPresentationProvider>().notNull(),
		mode: text("mode")
			.$type<ApprovalPresentationMode>()
			.default("review_only")
			.notNull(),
	},
	(table) => [
		primaryKey({
			name: "approval_presentation_control_pk",
			columns: [table.organizationId, table.workflowType, table.provider],
		}),
		check(
			"approval_presentation_control_provider_check",
			sql`${table.provider} IN ('telegram', 'discord', 'teams', 'slack')`,
		),
		check(
			"approval_presentation_control_mode_check",
			sql`${table.mode} IN ('review_only', 'actionable')`,
		),
		check(
			"approval_presentation_control_slack_check",
			sql`NOT (${table.provider} = 'slack' AND ${table.mode} = 'actionable')`,
		),
	],
);

// Immutable association of one authenticated provider invocation with the bound
// command it carried and the decision it committed (#257 §7, #261). Written in
// the decision transaction; the engine receipt uses the invocation-derived key.
// The transport delivery identity (Telegram update_id) is kept separately and
// is not part of invocation identity.
export const approvalInvocation = pgTable(
	"approval_invocation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		scheme: text("scheme").$type<"telegram_callback_query">().notNull(),
		schemeVersion: integer("scheme_version").notNull(),
		receiverScope: text("receiver_scope").notNull(),
		invocationId: text("invocation_id").notNull(),
		deliveryId: text("delivery_id"),
		providerActorId: text("provider_actor_id").notNull(),
		actorEmployeeId: uuid("actor_employee_id").notNull(),
		actorUserId: text("actor_user_id")
			.notNull()
			.references(() => user.id),
		workflowId: uuid("workflow_id").notNull(),
		reviewedBindingId: uuid("reviewed_binding_id").notNull(),
		action: text("action").$type<"approve" | "reject">().notNull(),
		commandFingerprint: text("command_fingerprint").notNull(),
		receiptIdempotencyKey: text("receipt_idempotency_key").notNull(),
		decisionEvidenceId: uuid("decision_evidence_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"approval_invocation_scheme_check",
			sql`${table.scheme} IN ('telegram_callback_query') AND ${table.schemeVersion} = 1`,
		),
		check(
			"approval_invocation_action_check",
			sql`${table.action} IN ('approve', 'reject')`,
		),
		uniqueIndex("approvalInvocation_org_identity_idx").on(
			table.organizationId,
			table.scheme,
			table.receiverScope,
			table.invocationId,
		),
		uniqueIndex("approvalInvocation_org_workflow_receipt_idx").on(
			table.organizationId,
			table.workflowId,
			table.receiptIdempotencyKey,
		),
		index("approvalInvocation_org_workflow_idx").on(
			table.organizationId,
			table.workflowId,
		),
		foreignKey({
			columns: [table.workflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.reviewedBindingId, table.organizationId],
			foreignColumns: [
				approvalReviewBinding.id,
				approvalReviewBinding.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [
				table.decisionEvidenceId,
				table.workflowId,
				table.organizationId,
			],
			foreignColumns: [
				approvalDecisionEvidence.id,
				approvalDecisionEvidence.workflowId,
				approvalDecisionEvidence.organizationId,
			],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.actorEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
	],
);
