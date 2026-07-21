import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schemaContract from "../../../../scripts/approval-workflow-schema-contract";
import {
	APPROVAL_EXPANSION_CONTRACT,
	type ApprovalExpansionCatalog,
	loadAndValidateApprovalExpansionSchema,
	validateApprovalExpansionCatalog,
} from "../../../../scripts/approval-workflow-schema-contract";

const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

function expectedPhysicalIdentifier(value: string): string {
	const encoder = new TextEncoder();
	let bytes = 0;
	let result = "";
	for (const codePoint of value) {
		const codePointBytes = encoder.encode(codePoint).length;
		if (bytes + codePointBytes > POSTGRES_IDENTIFIER_MAX_BYTES) break;
		result += codePoint;
		bytes += codePointBytes;
	}
	return result;
}

const EXPECTED_COLUMN_INVENTORY = {
	approval_workflow: [
		"id",
		"organization_id",
		"workflow_type",
		"source_type",
		"source_id",
		"requester_employee_id",
		"status",
		"current_stage_order",
		"version",
		"policy_snapshot",
		"context_snapshot",
		"display_snapshot",
		"submitted_at",
		"completed_at",
		"cancelled_at",
		"decision_reason",
		"created_at",
		"updated_at",
	],
	approval_workflow_stage: [
		"id",
		"organization_id",
		"workflow_id",
		"stage_order",
		"label",
		"resolver_snapshot",
		"activation_mode",
		"status",
		"activated_at",
		"decided_at",
		"decision_reason",
		"legacy_approval_request_id",
		"created_at",
		"updated_at",
	],
	approval_stage_assignment: [
		"id",
		"organization_id",
		"workflow_id",
		"stage_id",
		"assignment_sequence",
		"approver_employee_id",
		"status",
		"assigned_at",
		"resolved_at",
		"resolved_by_actor_kind",
		"resolved_by_actor_id",
		"reassigned_by_employee_id",
		"reassigned_from_assignment_id",
		"reassignment_metadata",
		"created_at",
		"updated_at",
	],
	approval_workflow_event: [
		"id",
		"organization_id",
		"workflow_id",
		"version",
		"event_index",
		"event_type",
		"actor_kind",
		"actor_employee_id",
		"actor_user_id",
		"previous_state",
		"resulting_state",
		"reason",
		"metadata",
		"idempotency_key",
		"occurred_at",
		"created_at",
	],
	approval_workflow_command: [
		"id",
		"organization_id",
		"workflow_id",
		"idempotency_key",
		"actor_fingerprint",
		"command_fingerprint",
		"state",
		"result",
		"created_at",
		"updated_at",
	],
	approval_requester_projection: [
		"id",
		"organization_id",
		"workflow_id",
		"requester_employee_id",
		"source_type",
		"source_id",
		"status",
		"current_stage_order",
		"display_payload",
		"search_text",
		"created_at",
		"updated_at",
	],
	approval_inbox_projection: [
		"id",
		"organization_id",
		"workflow_id",
		"active_stage_id",
		"source_type",
		"source_id",
		"status",
		"display_payload",
		"search_text",
		"created_at",
		"updated_at",
	],
	approval_outbox: [
		"id",
		"organization_id",
		"workflow_id",
		"event_id",
		"event_type",
		"dedupe_key",
		"payload",
		"disposition",
		"expansion_status",
		"expanded_at",
		"created_at",
	],
	approval_outbox_delivery: [
		"id",
		"organization_id",
		"outbox_id",
		"dedupe_key",
		"disposition",
		"status",
		"channel",
		"recipient_kind",
		"recipient_employee_id",
		"recipient_address",
		"available_at",
		"claimed_at",
		"claim_token",
		"retry_count",
		"attempt_count",
		"processed_at",
		"last_error",
		"created_at",
		"updated_at",
	],
	approval_workflow_rollout: [
		"id",
		"organization_id",
		"workflow_type",
		"lifecycle_mode",
		"side_effect_mode",
		"backfilled_through",
		"mismatch_count",
		"last_reconciled_at",
		"created_at",
		"updated_at",
	],
	approval_workflow_migration_issue: [
		"id",
		"organization_id",
		"workflow_id",
		"workflow_type",
		"legacy_type",
		"legacy_id",
		"source_type",
		"source_id",
		"issue_code",
		"evidence",
		"disposition",
		"operator_user_id",
		"disposed_at",
		"created_at",
		"updated_at",
	],
	audit_log: [
		"id",
		"organization_id",
		"entity_type",
		"entity_id",
		"action",
		"performed_by",
		"employee_id",
		"changes",
		"metadata",
		"ip_address",
		"user_agent",
		"timestamp",
	],
} as const;

const EXPECTED_RELATION_INVENTORY = [
	"approval_workflow|full",
	"approval_workflow_stage|full",
	"approval_stage_assignment|full",
	"approval_workflow_event|full",
	"approval_workflow_command|full",
	"approval_requester_projection|full",
	"approval_inbox_projection|full",
	"approval_outbox|full",
	"approval_outbox_delivery|full",
	"approval_workflow_rollout|full",
	"approval_workflow_migration_issue|full",
	"audit_log|full",
	"absence_entry|required_subset",
	"work_period|required_subset",
	"travel_expense_claim|required_subset",
	"shift_request|required_subset",
	"compliance_exception|required_subset",
	"notification|required_subset",
	"shift|required_subset",
] as const;

const EXPECTED_FULL_COLUMN_INVENTORY = {
	approval_workflow: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_type|approval_workflow_type|required|none",
		"source_type|text|required|none",
		"source_id|uuid|required|none",
		"requester_employee_id|uuid|nullable|none",
		"status|approval_workflow_status|required|'pending'::approval_workflow_status",
		"current_stage_order|integer|nullable|none",
		"version|integer|required|1",
		"policy_snapshot|jsonb|required|none",
		"context_snapshot|jsonb|required|none",
		"display_snapshot|jsonb|required|none",
		"submitted_at|timestamp with time zone|required|now()",
		"completed_at|timestamp with time zone|nullable|none",
		"cancelled_at|timestamp with time zone|nullable|none",
		"decision_reason|text|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_workflow_stage: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"stage_order|integer|required|none",
		"label|text|required|none",
		"resolver_snapshot|jsonb|required|none",
		"activation_mode|text|required|none",
		"status|approval_stage_status|required|'waiting'::approval_stage_status",
		"activated_at|timestamp with time zone|nullable|none",
		"decided_at|timestamp with time zone|nullable|none",
		"decision_reason|text|nullable|none",
		"legacy_approval_request_id|uuid|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_stage_assignment: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"stage_id|uuid|required|none",
		"assignment_sequence|integer|required|none",
		"approver_employee_id|uuid|required|none",
		"status|approval_assignment_status|required|'pending'::approval_assignment_status",
		"assigned_at|timestamp with time zone|required|now()",
		"resolved_at|timestamp with time zone|nullable|none",
		"resolved_by_actor_kind|approval_actor_kind|nullable|none",
		"resolved_by_actor_id|uuid|nullable|none",
		"reassigned_by_employee_id|uuid|nullable|none",
		"reassigned_from_assignment_id|uuid|nullable|none",
		"reassignment_metadata|jsonb|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_workflow_event: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"version|integer|required|none",
		"event_index|integer|required|none",
		"event_type|text|required|none",
		"actor_kind|approval_actor_kind|required|none",
		"actor_employee_id|uuid|nullable|none",
		"actor_user_id|text|nullable|none",
		"previous_state|jsonb|nullable|none",
		"resulting_state|jsonb|required|none",
		"reason|text|nullable|none",
		"metadata|jsonb|nullable|none",
		"idempotency_key|text|nullable|none",
		"occurred_at|timestamp with time zone|required|now()",
		"created_at|timestamp with time zone|required|now()",
	],
	approval_workflow_command: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"idempotency_key|text|required|none",
		"actor_fingerprint|text|required|none",
		"command_fingerprint|text|required|none",
		"state|approval_command_state|required|'reserved'::approval_command_state",
		"result|jsonb|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_requester_projection: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"requester_employee_id|uuid|nullable|none",
		"source_type|text|required|none",
		"source_id|uuid|required|none",
		"status|approval_workflow_status|required|none",
		"current_stage_order|integer|nullable|none",
		"display_payload|jsonb|required|none",
		"search_text|text|required|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_inbox_projection: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"active_stage_id|uuid|required|none",
		"source_type|text|required|none",
		"source_id|uuid|required|none",
		"status|approval_workflow_status|required|none",
		"display_payload|jsonb|required|none",
		"search_text|text|required|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_outbox: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|required|none",
		"event_id|uuid|required|none",
		"event_type|text|required|none",
		"dedupe_key|text|required|none",
		"payload|jsonb|required|none",
		"disposition|approval_outbox_disposition|required|none",
		"expansion_status|approval_outbox_expansion_status|required|'pending'::approval_outbox_expansion_status",
		"expanded_at|timestamp with time zone|nullable|none",
		"created_at|timestamp with time zone|required|now()",
	],
	approval_outbox_delivery: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"outbox_id|uuid|required|none",
		"dedupe_key|text|required|none",
		"disposition|approval_outbox_disposition|required|none",
		"status|approval_outbox_status|required|'pending'::approval_outbox_status",
		"channel|approval_outbox_channel|required|none",
		"recipient_kind|text|required|none",
		"recipient_employee_id|uuid|nullable|none",
		"recipient_address|text|nullable|none",
		"available_at|timestamp with time zone|required|now()",
		"claimed_at|timestamp with time zone|nullable|none",
		"claim_token|text|nullable|none",
		"retry_count|integer|required|0",
		"attempt_count|integer|required|0",
		"processed_at|timestamp with time zone|nullable|none",
		"last_error|text|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_workflow_rollout: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_type|approval_workflow_type|required|none",
		"lifecycle_mode|approval_workflow_lifecycle_mode|required|'legacy'::approval_workflow_lifecycle_mode",
		"side_effect_mode|approval_side_effect_mode|required|'legacy'::approval_side_effect_mode",
		"backfilled_through|timestamp with time zone|nullable|none",
		"mismatch_count|integer|required|0",
		"last_reconciled_at|timestamp with time zone|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	approval_workflow_migration_issue: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"workflow_id|uuid|nullable|none",
		"workflow_type|approval_workflow_type|required|none",
		"legacy_type|text|nullable|none",
		"legacy_id|uuid|nullable|none",
		"source_type|text|required|none",
		"source_id|uuid|required|none",
		"issue_code|text|required|none",
		"evidence|jsonb|required|none",
		"disposition|text|required|'open'::text",
		"operator_user_id|text|nullable|none",
		"disposed_at|timestamp with time zone|nullable|none",
		"created_at|timestamp with time zone|required|now()",
		"updated_at|timestamp with time zone|required|none",
	],
	audit_log: [
		"id|uuid|required|gen_random_uuid()",
		"organization_id|text|required|none",
		"entity_type|text|required|none",
		"entity_id|uuid|required|none",
		"action|text|required|none",
		"performed_by|text|required|none",
		"employee_id|uuid|nullable|none",
		"changes|text|nullable|none",
		"metadata|text|nullable|none",
		"ip_address|text|nullable|none",
		"user_agent|text|nullable|none",
		"timestamp|timestamp without time zone|required|now()",
	],
} as const;

const EXPECTED_SOURCE_COLUMN_INVENTORY = {
	absence_entry: [
		"organization_id|text|nullable|none",
		"approval_workflow_id|uuid|nullable|none",
	],
	work_period: [
		"organization_id|text|required|none",
		"approval_workflow_id|uuid|nullable|none",
	],
	travel_expense_claim: [
		"organization_id|text|required|none",
		"approval_workflow_id|uuid|nullable|none",
	],
	shift_request: [
		"organization_id|text|nullable|none",
		"shift_id|uuid|required|none",
		"lifecycle_status|shift_request_status|nullable|none",
		"approval_workflow_id|uuid|nullable|none",
	],
	compliance_exception: [
		"organization_id|text|required|none",
		"approval_workflow_id|uuid|nullable|none",
	],
	notification: [
		"organization_id|text|required|none",
		"idempotency_key|text|nullable|none",
	],
	shift: [
		"organization_id|text|required|none",
		"id|uuid|required|gen_random_uuid()",
	],
} as const;

const EXPECTED_ENUM_INVENTORY = {
	approval_actor_kind: ["employee", "system", "legacy_unknown"],
	approval_assignment_status: [
		"pending",
		"approved",
		"rejected",
		"cancelled",
		"expired",
	],
	approval_command_state: ["reserved", "completed"],
	approval_outbox_channel: [
		"in_app",
		"push",
		"email",
		"webhook",
		"teams",
		"telegram",
		"discord",
		"slack",
	],
	approval_outbox_disposition: ["observe", "deliver"],
	approval_outbox_expansion_status: ["pending", "expanded"],
	approval_outbox_status: [
		"pending",
		"processing",
		"delivered",
		"failed",
		"suppressed",
	],
	approval_side_effect_mode: ["legacy", "canonical"],
	approval_stage_status: [
		"waiting",
		"pending",
		"approved",
		"rejected",
		"cancelled",
		"expired",
	],
	approval_workflow_lifecycle_mode: [
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	],
	approval_workflow_status: [
		"pending",
		"approved",
		"rejected",
		"cancelled",
		"expired",
	],
	approval_workflow_type: [
		"absence",
		"time_correction",
		"manual_time_submission",
		"policy_clock_out",
		"travel_expense",
		"shift_request",
		"compliance_exception",
	],
	shift_request_status: ["pending", "approved", "rejected", "cancelled"],
} as const;

const EXPECTED_FOREIGN_KEY_INVENTORY = [
	"approval_workflow_organization_id_organization_id_fk|approval_workflow|organization_id|organization|id|cascade|no action",
	"approval_workflow_requester_employee_id_organization_id_employee_id_organization_id_fk|approval_workflow|requester_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_workflow_stage_organization_id_organization_id_fk|approval_workflow_stage|organization_id|organization|id|cascade|no action",
	"approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk|approval_workflow_stage|workflow_id,organization_id|approval_workflow|id,organization_id|cascade|no action",
	"approval_stage_assignment_organization_id_organization_id_fk|approval_stage_assignment|organization_id|organization|id|cascade|no action",
	"approval_stage_assignment_workflow_id_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk|approval_stage_assignment|workflow_id,stage_id,organization_id|approval_workflow_stage|workflow_id,id,organization_id|cascade|no action",
	"approval_stage_assignment_approver_employee_id_organization_id_employee_id_organization_id_fk|approval_stage_assignment|approver_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_stage_assignment_resolved_by_actor_id_organization_id_employee_id_organization_id_fk|approval_stage_assignment|resolved_by_actor_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_stage_assignment_reassigned_by_employee_id_organization_id_employee_id_organization_id_fk|approval_stage_assignment|reassigned_by_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_stage_assignment_workflow_id_stage_id_reassigned_from_assignment_id_organization_id_approval_stage_assignment_workflow_id_stage_id_id_organization_id_fk|approval_stage_assignment|workflow_id,stage_id,reassigned_from_assignment_id,organization_id|approval_stage_assignment|workflow_id,stage_id,id,organization_id|no action|no action",
	"approval_workflow_event_organization_id_organization_id_fk|approval_workflow_event|organization_id|organization|id|cascade|no action",
	"approval_workflow_event_workflow_id_organization_id_approval_workflow_id_organization_id_fk|approval_workflow_event|workflow_id,organization_id|approval_workflow|id,organization_id|cascade|no action",
	"approval_workflow_event_actor_employee_id_organization_id_employee_id_organization_id_fk|approval_workflow_event|actor_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_workflow_event_actor_user_id_user_id_fk|approval_workflow_event|actor_user_id|user|id|no action|no action",
	"approval_workflow_command_organization_id_organization_id_fk|approval_workflow_command|organization_id|organization|id|cascade|no action",
	"approval_workflow_command_workflow_id_organization_id_approval_workflow_id_organization_id_fk|approval_workflow_command|workflow_id,organization_id|approval_workflow|id,organization_id|cascade|no action",
	"approval_requester_projection_organization_id_organization_id_fk|approval_requester_projection|organization_id|organization|id|cascade|no action",
	"approval_requester_projection_workflow_id_organization_id_approval_workflow_id_organization_id_fk|approval_requester_projection|workflow_id,organization_id|approval_workflow|id,organization_id|cascade|no action",
	"approval_requester_projection_requester_employee_id_organization_id_employee_id_organization_id_fk|approval_requester_projection|requester_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_inbox_projection_organization_id_organization_id_fk|approval_inbox_projection|organization_id|organization|id|cascade|no action",
	"approval_inbox_projection_workflow_id_active_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk|approval_inbox_projection|workflow_id,active_stage_id,organization_id|approval_workflow_stage|workflow_id,id,organization_id|cascade|no action",
	"approval_outbox_organization_id_organization_id_fk|approval_outbox|organization_id|organization|id|cascade|no action",
	"approval_outbox_workflow_id_event_id_organization_id_event_type_approval_workflow_event_workflow_id_id_organization_id_event_type_fk|approval_outbox|workflow_id,event_id,organization_id,event_type|approval_workflow_event|workflow_id,id,organization_id,event_type|cascade|no action",
	"approval_outbox_delivery_organization_id_organization_id_fk|approval_outbox_delivery|organization_id|organization|id|cascade|no action",
	"approval_outbox_delivery_outbox_id_organization_id_disposition_approval_outbox_id_organization_id_disposition_fk|approval_outbox_delivery|outbox_id,organization_id,disposition|approval_outbox|id,organization_id,disposition|cascade|no action",
	"approval_outbox_delivery_recipient_employee_id_organization_id_employee_id_organization_id_fk|approval_outbox_delivery|recipient_employee_id,organization_id|employee|id,organization_id|no action|no action",
	"approval_workflow_rollout_organization_id_organization_id_fk|approval_workflow_rollout|organization_id|organization|id|cascade|no action",
	"approval_workflow_migration_issue_organization_id_organization_id_fk|approval_workflow_migration_issue|organization_id|organization|id|cascade|no action",
	"approval_workflow_migration_issue_workflow_id_organization_id_approval_workflow_id_organization_id_fk|approval_workflow_migration_issue|workflow_id,organization_id|approval_workflow|id,organization_id|cascade|no action",
	"approval_workflow_migration_issue_operator_user_id_user_id_fk|approval_workflow_migration_issue|operator_user_id|user|id|no action|no action",
	"audit_log_organization_id_organization_id_fk|audit_log|organization_id|organization|id|cascade|no action",
	"audit_log_performed_by_user_id_fk|audit_log|performed_by|user|id|no action|no action",
	"audit_log_employee_id_employee_id_fk|audit_log|employee_id|employee|id|no action|no action",
	"absence_entry_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk|absence_entry|approval_workflow_id,organization_id|approval_workflow|id,organization_id|no action|no action",
	"compliance_exception_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk|compliance_exception|approval_workflow_id,organization_id|approval_workflow|id,organization_id|no action|no action",
	"shift_request_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk|shift_request|approval_workflow_id,organization_id|approval_workflow|id,organization_id|no action|no action",
	"work_period_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk|work_period|approval_workflow_id,organization_id|approval_workflow|id,organization_id|no action|no action",
	"travel_expense_claim_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk|travel_expense_claim|approval_workflow_id,organization_id|approval_workflow|id,organization_id|no action|no action",
	"shift_request_organization_id_shift_id_shift_organization_id_id_fk|shift_request|organization_id,shift_id|shift|organization_id,id|cascade|no action",
] as const;

const EXPECTED_INDEX_INVENTORY = [
	"approval_workflow_pkey|approval_workflow|id|unique|primary|none",
	"approval_workflow_stage_pkey|approval_workflow_stage|id|unique|primary|none",
	"approval_stage_assignment_pkey|approval_stage_assignment|id|unique|primary|none",
	"approval_workflow_event_pkey|approval_workflow_event|id|unique|primary|none",
	"approval_workflow_command_pkey|approval_workflow_command|id|unique|primary|none",
	"approval_requester_projection_pkey|approval_requester_projection|id|unique|primary|none",
	"approval_inbox_projection_pkey|approval_inbox_projection|id|unique|primary|none",
	"approval_outbox_pkey|approval_outbox|id|unique|primary|none",
	"approval_outbox_delivery_pkey|approval_outbox_delivery|id|unique|primary|none",
	"approval_workflow_rollout_pkey|approval_workflow_rollout|id|unique|primary|none",
	"approval_workflow_migration_issue_pkey|approval_workflow_migration_issue|id|unique|primary|none",
	"audit_log_pkey|audit_log|id|unique|primary|none",
	"approvalWorkflow_id_organizationId_idx|approval_workflow|id,organization_id|unique|secondary|none",
	"approvalWorkflow_org_source_pending_idx|approval_workflow|organization_id,workflow_type,source_type,source_id|unique|secondary|status = 'pending'",
	"approvalWorkflow_org_status_idx|approval_workflow|organization_id,status|nonunique|secondary|none",
	"approvalWorkflowStage_id_organizationId_idx|approval_workflow_stage|id,organization_id|unique|secondary|none",
	"approvalWorkflowStage_workflow_id_organizationId_idx|approval_workflow_stage|workflow_id,id,organization_id|unique|secondary|none",
	"approvalWorkflowStage_org_workflow_order_idx|approval_workflow_stage|organization_id,workflow_id,stage_order|unique|secondary|none",
	"approvalStageAssignment_id_organizationId_idx|approval_stage_assignment|id,organization_id|unique|secondary|none",
	"approvalStageAssignment_workflow_stage_id_organizationId_idx|approval_stage_assignment|workflow_id,stage_id,id,organization_id|unique|secondary|none",
	"approvalStageAssignment_org_workflow_stage_sequence_idx|approval_stage_assignment|organization_id,workflow_id,stage_id,assignment_sequence|unique|secondary|none",
	"approvalStageAssignment_org_workflow_stage_pending_approver_idx|approval_stage_assignment|organization_id,workflow_id,stage_id,approver_employee_id|unique|secondary|status = 'pending'",
	"approvalWorkflowEvent_id_organizationId_idx|approval_workflow_event|id,organization_id|unique|secondary|none",
	"approvalWorkflowEvent_workflow_id_organizationId_idx|approval_workflow_event|workflow_id,id,organization_id|unique|secondary|none",
	"approvalWorkflowEvent_workflow_id_organizationId_eventType_idx|approval_workflow_event|workflow_id,id,organization_id,event_type|unique|secondary|none",
	"approvalWorkflowEvent_org_workflow_version_index_idx|approval_workflow_event|organization_id,workflow_id,version,event_index|unique|secondary|none",
	"approvalWorkflowEvent_org_idempotency_idx|approval_workflow_event|organization_id,idempotency_key|unique|secondary|idempotency_key is not null",
	"approvalWorkflowCommand_org_workflow_idempotency_idx|approval_workflow_command|organization_id,workflow_id,idempotency_key|unique|secondary|none",
	"approvalRequesterProjection_org_workflow_idx|approval_requester_projection|organization_id,workflow_id|unique|secondary|none",
	"approvalRequesterProjection_org_requester_status_idx|approval_requester_projection|organization_id,requester_employee_id,status|nonunique|secondary|none",
	"approvalInboxProjection_org_workflow_stage_idx|approval_inbox_projection|organization_id,workflow_id,active_stage_id|unique|secondary|none",
	"approvalInboxProjection_org_status_idx|approval_inbox_projection|organization_id,status|nonunique|secondary|none",
	"approvalOutbox_id_organizationId_idx|approval_outbox|id,organization_id|unique|secondary|none",
	"approvalOutbox_id_organizationId_disposition_idx|approval_outbox|id,organization_id,disposition|unique|secondary|none",
	"approvalOutbox_org_dedupe_idx|approval_outbox|organization_id,dedupe_key|unique|secondary|none",
	"approvalOutbox_org_createdAt_idx|approval_outbox|organization_id,created_at|nonunique|secondary|none",
	"approvalOutbox_pendingExpansion_createdAt_idx|approval_outbox|expansion_status,created_at|nonunique|secondary|expansion_status = 'pending'",
	"approvalOutboxDelivery_org_dedupe_idx|approval_outbox_delivery|organization_id,dedupe_key|unique|secondary|none",
	"approvalOutboxDelivery_status_available_idx|approval_outbox_delivery|status,available_at|nonunique|secondary|none",
	"approvalWorkflowRollout_org_type_idx|approval_workflow_rollout|organization_id,workflow_type|unique|secondary|none",
	"approvalWorkflowMigrationIssue_org_type_disposition_idx|approval_workflow_migration_issue|organization_id,workflow_type,disposition|nonunique|secondary|none",
	"absenceEntry_org_approvalWorkflowId_idx|absence_entry|organization_id,approval_workflow_id|nonunique|secondary|none",
	"complianceException_org_approvalWorkflowId_idx|compliance_exception|organization_id,approval_workflow_id|nonunique|secondary|none",
	"shiftRequest_org_approvalWorkflowId_idx|shift_request|organization_id,approval_workflow_id|nonunique|secondary|none",
	"workPeriod_org_approvalWorkflowId_idx|work_period|organization_id,approval_workflow_id|nonunique|secondary|none",
	"travelExpenseClaim_org_approvalWorkflowId_idx|travel_expense_claim|organization_id,approval_workflow_id|nonunique|secondary|none",
	"notification_org_idempotencyKey_idx|notification|organization_id,idempotency_key|unique|secondary|idempotency_key is not null",
	"shift_organizationId_id_idx|shift|organization_id,id|unique|secondary|none",
	"auditLog_organizationId_idx|audit_log|organization_id|nonunique|secondary|none",
	"auditLog_organizationId_timestamp_idx|audit_log|organization_id,timestamp|nonunique|secondary|none",
	"auditLog_entityType_entityId_idx|audit_log|entity_type,entity_id|nonunique|secondary|none",
	"auditLog_performedBy_idx|audit_log|performed_by|nonunique|secondary|none",
	"auditLog_timestamp_idx|audit_log|timestamp|nonunique|secondary|none",
] as const;

const EXPECTED_CHECK_INVENTORY = [
	"absence_entry_approval_workflow_organization_check|absence_entry|approval_workflow_id is null or organization_id is not null",
	"shift_request_approval_workflow_organization_check|shift_request|approval_workflow_id is null or organization_id is not null",
] as const;

function columnSignature(column: {
	name: string;
	type: string;
	notNull: boolean;
	default: string | null;
}): string {
	return `${column.name}|${column.type}|${column.notNull ? "required" : "nullable"}|${column.default ?? "none"}`;
}

function expectedSourceColumns() {
	return Object.entries(EXPECTED_SOURCE_COLUMN_INVENTORY).flatMap(
		([table, signatures]) =>
			signatures.map((signature) => {
				const [name, type, requirement, defaultExpression] =
					signature.split("|");
				return {
					table,
					name: name as string,
					type: type as string,
					notNull: requirement === "required",
					default:
						defaultExpression === "none" ? null : (defaultExpression as string),
				};
			}),
	);
}

function validCatalog(): ApprovalExpansionCatalog {
	return {
		tables: [...APPROVAL_EXPANSION_CONTRACT.tables],
		operationalTables: [...APPROVAL_EXPANSION_CONTRACT.operationalTables],
		sourceTables: Object.keys(EXPECTED_SOURCE_COLUMN_INVENTORY),
		enums: Object.fromEntries(
			Object.entries(APPROVAL_EXPANSION_CONTRACT.enums).map(
				([name, values]) => [name, [...values]],
			),
		),
		columns: [
			...APPROVAL_EXPANSION_CONTRACT.columns
				.filter((column) => !(column.table in EXPECTED_SOURCE_COLUMN_INVENTORY))
				.map((column) => ({ ...column })),
			...expectedSourceColumns(),
		],
		foreignKeys: APPROVAL_EXPANSION_CONTRACT.foreignKeys.map((foreignKey) => ({
			...foreignKey,
			sourceSchema: "public",
			foreignSchema: "public",
			columns: [...foreignKey.columns],
			foreignColumns: [...foreignKey.foreignColumns],
		})),
		indexes: APPROVAL_EXPANSION_CONTRACT.indexes.map((index) => ({
			...index,
			columns: [...index.columns],
		})),
		checks: APPROVAL_EXPANSION_CONTRACT.checks.map((check) => ({ ...check })),
	};
}

describe("approval workflow expansion physical contract", () => {
	it("declares every relation and its validation mode independently", () => {
		const contract =
			APPROVAL_EXPANSION_CONTRACT as typeof APPROVAL_EXPANSION_CONTRACT & {
				relations: readonly { name: string; mode: string }[];
			};
		expect(
			contract.relations.map((relation) => `${relation.name}|${relation.mode}`),
		).toEqual(EXPECTED_RELATION_INVENTORY);
	});

	it("declares the complete independent canonical and audit column inventory", () => {
		for (const [table, expectedColumns] of Object.entries(
			EXPECTED_COLUMN_INVENTORY,
		)) {
			const declared = APPROVAL_EXPANSION_CONTRACT.columns
				.filter((column) => column.table === table)
				.map((column) => column.name);
			expect(declared, table).toEqual(expectedColumns);
		}
		expect(APPROVAL_EXPANSION_CONTRACT.tables).toHaveLength(11);
		expect(APPROVAL_EXPANSION_CONTRACT.operationalTables).toEqual([
			"audit_log",
		]);
	});

	it("declares exact canonical and audit column shapes independently", () => {
		for (const [table, expectedColumns] of Object.entries(
			EXPECTED_FULL_COLUMN_INVENTORY,
		)) {
			const declared = APPROVAL_EXPANSION_CONTRACT.columns
				.filter((column) => column.table === table)
				.map(columnSignature);
			expect(declared, table).toEqual(expectedColumns);
		}
	});

	it("declares every required source relation column independently", () => {
		for (const [table, expectedColumns] of Object.entries(
			EXPECTED_SOURCE_COLUMN_INVENTORY,
		)) {
			const declared = APPROVAL_EXPANSION_CONTRACT.columns
				.filter((column) => column.table === table)
				.map(columnSignature);
			expect(declared, table).toEqual(expectedColumns);
		}
	});

	it("declares every enum with exact ordered values independently", () => {
		expect(APPROVAL_EXPANSION_CONTRACT.enums).toEqual(EXPECTED_ENUM_INVENTORY);
	});

	it("declares every named foreign key independently", () => {
		const expectedPhysicalInventory = EXPECTED_FOREIGN_KEY_INVENTORY.map(
			(signature) => {
				const separator = signature.indexOf("|");
				const logicalName = signature.slice(0, separator);
				return `${expectedPhysicalIdentifier(logicalName)}${signature.slice(separator)}|public|public`;
			},
		);
		expect(
			APPROVAL_EXPANSION_CONTRACT.foreignKeys.map(
				(foreignKey) =>
					`${"name" in foreignKey ? foreignKey.name : "missing"}|${foreignKey.table}|${foreignKey.columns.join(",")}|${foreignKey.foreignTable}|${foreignKey.foreignColumns.join(",")}|${foreignKey.onDelete}|${foreignKey.onUpdate}|${"sourceSchema" in foreignKey ? foreignKey.sourceSchema : "missing"}|${"foreignSchema" in foreignKey ? foreignKey.foreignSchema : "missing"}`,
			),
		).toEqual(expectedPhysicalInventory);
	});

	it.each([
		[
			91,
			"approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		],
		[
			120,
			"approval_stage_assignment_workflow_id_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk",
		],
		[
			132,
			"approval_outbox_workflow_id_event_id_organization_id_event_type_approval_workflow_event_workflow_id_id_organization_id_event_type_fk",
		],
	] as const)("accepts PostgreSQL's physical truncation of a %i-byte FK name", (expectedBytes, logicalName) => {
		const encoder = new TextEncoder();
		expect(encoder.encode(logicalName)).toHaveLength(expectedBytes);
		const physicalName = expectedPhysicalIdentifier(logicalName);
		expect(encoder.encode(physicalName)).toHaveLength(
			POSTGRES_IDENTIFIER_MAX_BYTES,
		);

		const catalog = validCatalog();
		const foreignKey = catalog.foreignKeys.find(
			(candidate) =>
				candidate.name === logicalName || candidate.name === physicalName,
		);
		if (!foreignKey) throw new Error(`fixture missing FK ${logicalName}`);
		foreignKey.name = physicalName;
		expect(() => validateApprovalExpansionCatalog(catalog)).not.toThrow();
	});

	it("truncates PostgreSQL identifiers by UTF-8 bytes without splitting code points", () => {
		const truncate = (
			schemaContract as typeof schemaContract & {
				toPostgresIdentifier?: (value: string) => string;
			}
		).toPostgresIdentifier;
		expect(truncate).toBeTypeOf("function");
		if (!truncate) return;

		expect(truncate(`${"a".repeat(61)}éz`)).toBe(`${"a".repeat(61)}é`);
		expect(truncate(`${"a".repeat(62)}é`)).toBe("a".repeat(62));
		expect(truncate("é".repeat(40))).toBe("é".repeat(31));
		expect(
			new TextEncoder().encode(truncate("é".repeat(40))).length,
		).toBeLessThanOrEqual(POSTGRES_IDENTIFIER_MAX_BYTES);
	});

	it("exports only collision-free PostgreSQL physical FK names", () => {
		const encoder = new TextEncoder();
		const identities = new Set<string>();
		for (const foreignKey of APPROVAL_EXPANSION_CONTRACT.foreignKeys) {
			expect(
				encoder.encode(foreignKey.name).length,
				foreignKey.name,
			).toBeLessThanOrEqual(POSTGRES_IDENTIFIER_MAX_BYTES);
			const identity = `${foreignKey.table}\0${foreignKey.name}`;
			expect(identities.has(identity), identity).toBe(false);
			identities.add(identity);
		}
	});

	it("fails physical FK contract construction on overlength names or same-table collisions", () => {
		const assertNames = (
			schemaContract as typeof schemaContract & {
				assertPhysicalForeignKeyNames?: (
					foreignKeys: readonly { table: string; name: string }[],
				) => void;
			}
		).assertPhysicalForeignKeyNames;
		expect(assertNames).toBeTypeOf("function");
		if (!assertNames) return;

		expect(() =>
			assertNames([
				{ table: "source", name: "duplicate" },
				{ table: "source", name: "duplicate" },
			]),
		).toThrow(/collision/i);
		expect(() =>
			assertNames([{ table: "source", name: "x".repeat(64) }]),
		).toThrow(/63 bytes/i);
		expect(() =>
			assertNames([
				{ table: "source_one", name: "shared" },
				{ table: "source_two", name: "shared" },
			]),
		).not.toThrow();
	});

	it("declares every index including primary identity independently", () => {
		expect(
			APPROVAL_EXPANSION_CONTRACT.indexes.map(
				(index) =>
					`${index.name}|${index.table}|${index.columns.join(",")}|${index.unique ? "unique" : "nonunique"}|${"primary" in index && index.primary ? "primary" : "secondary"}|${index.predicate ?? "none"}`,
			),
		).toEqual(EXPECTED_INDEX_INVENTORY);
	});

	it("declares every exact check expression independently", () => {
		expect(
			APPROVAL_EXPANSION_CONTRACT.checks.map(
				(check) => `${check.name}|${check.table}|${check.definition}`,
			),
		).toEqual(EXPECTED_CHECK_INVENTORY);
	});

	it("accepts the complete Phase 1 catalog", () => {
		expect(() =>
			validateApprovalExpansionCatalog(validCatalog()),
		).not.toThrow();
	});

	it("catalog SQL constrains FK sources but retains every target namespace", async () => {
		const calls: SQL[] = [];
		await loadAndValidateApprovalExpansionSchema({
			execute: async (query: SQL) => {
				calls.push(query);
				return { rows: [{ catalog: validCatalog() }] };
			},
		});
		const rendered = new PgDialect().sqlToQuery(calls[0] as SQL).sql;
		expect(rendered).not.toContain("target_namespace.nspname = 'public'");
		expect(rendered).toContain("source_namespace.nspname = 'public'");
		expect(rendered).toContain("expected.contract->'relations'");
	});

	it("allows unrelated columns on required-subset source relations", () => {
		const catalog = validCatalog();
		catalog.columns.push({
			table: "shift_request",
			name: "unrelated_existing_column",
			type: "text",
			notNull: false,
			default: null,
		});
		expect(() => validateApprovalExpansionCatalog(catalog)).not.toThrow();
	});

	it("allows unrelated FKs, indexes, and checks on required-subset source relations", () => {
		const catalog = validCatalog();
		catalog.foreignKeys.push({
			name: "absence_entry_unrelated_fk",
			table: "absence_entry",
			columns: ["category_id"],
			foreignTable: "absence_category",
			foreignColumns: ["id"],
			onDelete: "no action",
			onUpdate: "no action",
			sourceSchema: "public",
			foreignSchema: "public",
		});
		catalog.indexes.push({
			name: "absence_entry_unrelated_idx",
			table: "absence_entry",
			columns: ["category_id"],
			unique: false,
			primary: false,
			predicate: null,
		});
		catalog.checks.push({
			name: "absence_entry_unrelated_check",
			table: "absence_entry",
			definition: "category_id is not null",
		});
		expect(() => validateApprovalExpansionCatalog(catalog)).not.toThrow();
	});

	it.each([
		"foreignKey",
		"index",
		"check",
	] as const)("rejects an unexpected %s on a full relation", (kind) => {
		const catalog = validCatalog();
		if (kind === "foreignKey") {
			catalog.foreignKeys.push({
				name: "approval_workflow_unexpected_fk",
				table: "approval_workflow",
				columns: ["organization_id"],
				foreignTable: "user",
				foreignColumns: ["id"],
				onDelete: "no action",
				onUpdate: "no action",
				sourceSchema: "public",
				foreignSchema: "public",
			});
		}
		if (kind === "index") {
			catalog.indexes.push({
				name: "approval_workflow_unexpected_idx",
				table: "approval_workflow",
				columns: ["source_id"],
				unique: false,
				primary: false,
				predicate: null,
			});
		}
		if (kind === "check") {
			catalog.checks.push({
				name: "approval_workflow_unexpected_check",
				table: "approval_workflow",
				definition: "version > 0",
			});
		}
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			new RegExp(`unexpected.*${kind}|exact.*${kind}`, "i"),
		);
	});

	it("rejects an unexpected cross-schema FK on a full relation", () => {
		const catalog = validCatalog();
		catalog.foreignKeys.push({
			name: "approval_workflow_cross_schema_fk",
			table: "approval_workflow",
			columns: ["source_id"],
			foreignTable: "external_source",
			foreignColumns: ["id"],
			onDelete: "no action",
			onUpdate: "no action",
			sourceSchema: "public",
			foreignSchema: "integration_private",
		});

		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/unexpected foreignKey.*approval_workflow/i,
		);
	});

	it("rejects expected FK evidence targeting a non-public schema", () => {
		const catalog = validCatalog();
		const foreignKey = catalog.foreignKeys.find(
			(candidate) => candidate.table === "approval_workflow",
		) as (typeof catalog.foreignKeys)[number] & { foreignSchema: string };
		foreignKey.foreignSchema = "tenant_shadow";
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/foreign key.*approval_workflow/i,
		);
	});

	it("rejects undeclared columns on full canonical relations", () => {
		const catalog = validCatalog();
		catalog.columns.push({
			table: "approval_workflow",
			name: "undeclared_column",
			type: "text",
			notNull: false,
			default: null,
		});
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/exact columns.*approval_workflow/i,
		);
	});

	it("accepts harmless PostgreSQL check wrappers and qualifiers", () => {
		const catalog = validCatalog();
		const check = catalog.checks.find(
			(candidate) =>
				candidate.name === "absence_entry_approval_workflow_organization_check",
		);
		if (!check) throw new Error("fixture missing source check");
		check.definition =
			'CHECK ((("absence_entry"."approval_workflow_id" IS NULL OR "absence_entry"."organization_id" IS NOT NULL)))';
		expect(() => validateApprovalExpansionCatalog(catalog)).not.toThrow();
	});

	it.each([
		"approval_outbox_delivery",
		"approval_workflow_migration_issue",
	])("rejects a missing canonical table: %s", (table) => {
		const catalog = validCatalog();
		catalog.tables = catalog.tables.filter((candidate) => candidate !== table);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			new RegExp(`table.*${table}`, "i"),
		);
	});

	it("rejects a missing required-subset source relation", () => {
		const catalog = validCatalog();
		catalog.sourceTables = catalog.sourceTables.filter(
			(table) => table !== "notification",
		);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/table.*notification/i,
		);
	});

	it("rejects a missing critical organization/version/source/outbox column", () => {
		for (const [table, column] of [
			["approval_workflow", "organization_id"],
			["approval_workflow", "version"],
			["approval_workflow", "source_id"],
			["approval_outbox", "expansion_status"],
			["approval_outbox_delivery", "disposition"],
		] as const) {
			const catalog = validCatalog();
			catalog.columns = catalog.columns.filter(
				(candidate) => candidate.table !== table || candidate.name !== column,
			);
			expect(
				() => validateApprovalExpansionCatalog(catalog),
				`${table}.${column}`,
			).toThrow(new RegExp(`column.*${table}.${column}`, "i"));
		}
	});

	it.each([
		["approval_requester_projection", "requester_employee_id"],
		["approval_requester_projection", "current_stage_order"],
		["approval_requester_projection", "display_payload"],
		["approval_requester_projection", "search_text"],
		["approval_outbox", "payload"],
		["approval_outbox", "created_at"],
		["approval_workflow_event", "actor_kind"],
		["approval_workflow_event", "resulting_state"],
		["approval_workflow_event", "occurred_at"],
		["approval_workflow", "requester_employee_id"],
		["approval_workflow", "policy_snapshot"],
		["approval_workflow", "completed_at"],
		["approval_workflow", "cancelled_at"],
		["approval_workflow_stage", "resolver_snapshot"],
		["approval_workflow_stage", "activation_mode"],
		["approval_workflow_stage", "activated_at"],
		["audit_log", "performed_by"],
		["audit_log", "timestamp"],
	] as const)("rejects omitted required inventory column %s.%s", (table, column) => {
		const catalog = validCatalog();
		catalog.columns = catalog.columns.filter(
			(candidate) => candidate.table !== table || candidate.name !== column,
		);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			new RegExp(`column.*${table}.${column}`, "i"),
		);
	});

	it("rejects a missing or malformed required default", () => {
		for (const [table, column] of [
			["approval_workflow", "id"],
			["approval_workflow", "status"],
			["approval_workflow", "version"],
			["approval_outbox", "expansion_status"],
			["approval_outbox_delivery", "retry_count"],
			["audit_log", "timestamp"],
		] as const) {
			const catalog = validCatalog();
			const target = catalog.columns.find(
				(candidate) => candidate.table === table && candidate.name === column,
			);
			if (!target) throw new Error(`fixture missing ${table}.${column}`);
			target.default = null;
			expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
				new RegExp(`default.*${table}.${column}`, "i"),
			);
		}
	});

	it("rejects a missing Phase 1 enum value", () => {
		const catalog = validCatalog();
		catalog.enums.approval_workflow_lifecycle_mode = [
			"legacy",
			"shadow",
			"ready",
			"canonical",
		];
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/enum.*approval_workflow_lifecycle_mode.*complete/i,
		);
	});

	it("rejects extra and reordered enum values", () => {
		const extra = validCatalog();
		extra.enums.approval_actor_kind.push("unexpected");
		expect(() => validateApprovalExpansionCatalog(extra)).toThrow(
			/enum.*approval_actor_kind/i,
		);

		const reordered = validCatalog();
		reordered.enums.approval_workflow_status = [
			"approved",
			"pending",
			"rejected",
			"cancelled",
			"expired",
		];
		expect(() => validateApprovalExpansionCatalog(reordered)).toThrow(
			/enum.*approval_workflow_status/i,
		);
	});

	it.each(
		Object.entries(EXPECTED_SOURCE_COLUMN_INVENTORY).flatMap(
			([table, signatures]) =>
				signatures.map(
					(signature) => [table, signature.split("|")[0]] as const,
				),
		),
	)("rejects changed source-column shape %s.%s", (table, column) => {
		for (const mutation of ["type", "notNull", "default"] as const) {
			const catalog = validCatalog();
			const target = catalog.columns.find(
				(candidate) => candidate.table === table && candidate.name === column,
			);
			if (!target) throw new Error(`fixture missing ${table}.${column}`);
			if (mutation === "type") target.type = "boolean";
			if (mutation === "notNull") target.notNull = !target.notNull;
			if (mutation === "default") {
				target.default = target.default === null ? "now()" : null;
			}
			expect(
				() => validateApprovalExpansionCatalog(catalog),
				`${table}.${column}.${mutation}`,
			).toThrow(
				new RegExp(
					`${mutation === "default" ? "default" : "column"}.*${table}.${column}`,
					"i",
				),
			);
		}
	});

	it("rejects a missing organization-composite foreign key", () => {
		const catalog = validCatalog();
		catalog.foreignKeys = catalog.foreignKeys.filter(
			(foreignKey) =>
				foreignKey.table !== "approval_outbox" ||
				foreignKey.foreignTable !== "approval_workflow_event",
		);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/foreign key.*approval_outbox.*approval_workflow_event/i,
		);
	});

	it("rejects malformed foreign-key actions", () => {
		const catalog = validCatalog();
		const foreignKey = catalog.foreignKeys.find(
			(candidate) =>
				candidate.table === "approval_outbox" &&
				candidate.foreignTable === "approval_workflow_event",
		);
		if (!foreignKey)
			throw new Error("fixture missing outbox event foreign key");
		foreignKey.onDelete = "no action";
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/foreign key.*approval_outbox.*on delete/i,
		);
	});

	it("rejects a renamed foreign key with otherwise identical semantics", () => {
		const catalog = validCatalog();
		const foreignKey = catalog.foreignKeys.find(
			(candidate) =>
				candidate.name ===
				"approval_workflow_organization_id_organization_id_fk",
		);
		if (!foreignKey)
			throw new Error("fixture missing workflow organization FK");
		foreignKey.name = "renamed_foreign_key";
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/foreign key.*approval_workflow/i,
		);
	});

	it("requires the operational audit relation, columns, and tenant/actor foreign keys", () => {
		const missingTable = validCatalog();
		missingTable.operationalTables = [];
		expect(() => validateApprovalExpansionCatalog(missingTable)).toThrow(
			/table.*audit_log/i,
		);

		for (const foreignTable of ["organization", "user"] as const) {
			const catalog = validCatalog();
			catalog.foreignKeys = catalog.foreignKeys.filter(
				(foreignKey) =>
					foreignKey.table !== "audit_log" ||
					foreignKey.foreignTable !== foreignTable,
			);
			expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
				new RegExp(`foreign key.*audit_log.*${foreignTable}`, "i"),
			);
		}
	});

	it("rejects a missing scoped dedupe unique index", () => {
		const catalog = validCatalog();
		catalog.indexes = catalog.indexes.filter(
			(index) => index.name !== "approvalOutbox_org_dedupe_idx",
		);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/unique index.*approvalOutbox_org_dedupe_idx/i,
		);
	});

	it("rejects a primary index reported as secondary", () => {
		const catalog = validCatalog();
		const primary = catalog.indexes.find(
			(index) => index.name === "approval_workflow_pkey",
		);
		if (!primary) throw new Error("fixture missing workflow primary index");
		primary.primary = false;
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/unique index.*approval_workflow_pkey/i,
		);
	});

	it("rejects a missing or weakened pending partial index", () => {
		const catalog = validCatalog();
		const index = catalog.indexes.find(
			(candidate) =>
				candidate.name === "approvalWorkflow_org_source_pending_idx",
		);
		if (!index) throw new Error("fixture missing pending index");
		index.predicate = null;
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/partial index.*approvalWorkflow_org_source_pending_idx/i,
		);
	});

	it("requires the pending source index to use the exact typed source tuple in order", () => {
		const catalog = validCatalog();
		const index = catalog.indexes.find(
			(candidate) =>
				candidate.name === "approvalWorkflow_org_source_pending_idx",
		);
		if (!index) throw new Error("fixture missing pending index");
		expect(index.columns).toEqual([
			"organization_id",
			"workflow_type",
			"source_type",
			"source_id",
		]);
		expect(index.predicate).toBe("status = 'pending'");
	});

	it("rejects changed partial predicates and predicates on non-partial indexes", () => {
		const changedPartial = validCatalog();
		const partial = changedPartial.indexes.find(
			(index) => index.name === "approvalWorkflow_org_source_pending_idx",
		);
		if (!partial) throw new Error("fixture missing partial index");
		partial.predicate = "status = 'approved'";
		expect(() => validateApprovalExpansionCatalog(changedPartial)).toThrow(
			/partial index.*approvalWorkflow_org_source_pending_idx/i,
		);

		const unexpectedPartial = validCatalog();
		const nonPartial = unexpectedPartial.indexes.find(
			(index) => index.name === "approvalWorkflow_org_status_idx",
		);
		if (!nonPartial) throw new Error("fixture missing non-partial index");
		nonPartial.predicate = "status = 'pending'";
		expect(() => validateApprovalExpansionCatalog(unexpectedPartial)).toThrow(
			/index.*approvalWorkflow_org_status_idx/i,
		);
	});

	it("rejects a missing source organization check", () => {
		const catalog = validCatalog();
		catalog.checks = catalog.checks.filter(
			(check) =>
				check.name !== "absence_entry_approval_workflow_organization_check",
		);
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/check.*absence_entry_approval_workflow_organization_check/i,
		);
	});

	it("rejects a semantically weakened check instead of accepting containment", () => {
		const catalog = validCatalog();
		const check = catalog.checks.find(
			(candidate) =>
				candidate.name === "absence_entry_approval_workflow_organization_check",
		);
		if (!check) throw new Error("fixture missing source check");
		check.definition = `CHECK ((${check.definition}) OR true)`;
		expect(() => validateApprovalExpansionCatalog(catalog)).toThrow(
			/check.*absence_entry_approval_workflow_organization_check/i,
		);
	});
});
