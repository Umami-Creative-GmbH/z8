import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration0004 = readFileSync(
	new URL("../../../drizzle/0004_hard_bill_hollister.sql", import.meta.url),
	"utf8",
);
const migration0008 = readFileSync(
	new URL("../../../drizzle/0008_demo_data_feature_flag.sql", import.meta.url),
	"utf8",
);
const migration0014 = readFileSync(
	new URL(
		"../../../drizzle/0014_team_membership_primary_manager.sql",
		import.meta.url,
	),
	"utf8",
);
const migration0019 = readFileSync(
	new URL("../../../drizzle/0019_regular_sandman.sql", import.meta.url),
	"utf8",
);
const migration0003SnapshotUrl = new URL(
	"../../../drizzle/meta/0003_snapshot.json",
	import.meta.url,
);
const migration0020Url = new URL(
	"../../../drizzle/0020_drop_organization_fiscal_year.sql",
	import.meta.url,
);
const migration0026Url = new URL(
	"../../../drizzle/0026_remove_employee_manager_id.sql",
	import.meta.url,
);
const migration0026SnapshotUrl = new URL(
	"../../../drizzle/meta/0026_snapshot.json",
	import.meta.url,
);
const migration0030SnapshotUrl = new URL(
	"../../../drizzle/meta/0030_snapshot.json",
	import.meta.url,
);
const migrationJournal = JSON.parse(
	readFileSync(
		new URL("../../../drizzle/meta/_journal.json", import.meta.url),
		"utf8",
	),
) as { entries: Array<{ idx: number; tag: string; when: number }> };
const migration0008Snapshot = JSON.parse(
	readFileSync(
		new URL("../../../drizzle/meta/0008_snapshot.json", import.meta.url),
		"utf8",
	),
) as {
	tables: {
		"public.organization": { columns: Record<string, { default?: boolean }> };
	};
};
const migration0032 = readFileSync(
	new URL(
		"../../../drizzle/0032_works_council_feature_flag.sql",
		import.meta.url,
	),
	"utf8",
);
const migration0032Snapshot = JSON.parse(
	readFileSync(
		new URL("../../../drizzle/meta/0032_snapshot.json", import.meta.url),
		"utf8",
	),
) as {
	tables: {
		"public.organization": { columns: Record<string, { default?: boolean }> };
	};
};
const migration0035Url = new URL(
	"../../../drizzle/0035_approval_request_metadata_recovery.sql",
	import.meta.url,
);
const migration0036Url = new URL(
	"../../../drizzle/0036_time_entry_timezone_capture.sql",
	import.meta.url,
);
const migration0036SnapshotUrl = new URL(
	"../../../drizzle/meta/0036_snapshot.json",
	import.meta.url,
);
const migration0037Url = new URL(
	"../../../drizzle/0037_holiday_category_assignment.sql",
	import.meta.url,
);
const migration0038SnapshotUrl = new URL(
	"../../../drizzle/meta/0038_snapshot.json",
	import.meta.url,
);
const drizzleDirUrl = new URL("../../../drizzle/", import.meta.url);
const migration0048Url = new URL(
	"../../../drizzle/0048_payroll_access_scope.sql",
	import.meta.url,
);
const migration0051Url = new URL(
	"../../../drizzle/0051_sick_detail_recovery.sql",
	import.meta.url,
);
const migration0052Url = new URL(
	"../../../drizzle/0052_time_entry_timezone_recovery.sql",
	import.meta.url,
);
const migration0054Url = new URL(
	"../../../drizzle/0055_approval_workflow_expand.sql",
	import.meta.url,
);
const migration0054SnapshotUrl = new URL(
	"../../../drizzle/meta/0055_snapshot.json",
	import.meta.url,
);
const migration0055Url = new URL(
	"../../../drizzle/0056_approval_workflow_cycle_identity.sql",
	import.meta.url,
);
const migration0055SnapshotUrl = new URL(
	"../../../drizzle/meta/0056_snapshot.json",
	import.meta.url,
);
const migration0054InvitationDraftIdentityUrl = new URL(
	"../../../drizzle/0054_employee_invitation_draft_identity.sql",
	import.meta.url,
);

function readRequiredMigration(url: URL, label: string): string {
	const exists = existsSync(url);
	expect(exists, `${label} must exist`).toBe(true);
	return exists ? readFileSync(url, "utf8") : "";
}

type ExpectedEnum = { name: string; values: string[] };
type ExpectedIndex = {
	name: string;
	table: string;
	columns: string[];
	unique: boolean;
	where?: string;
};
type ExpectedForeignKey = {
	name?: string;
	table: string;
	columns: string[];
	foreignTable: string;
	foreignColumns: string[];
	onDelete?: string;
	onUpdate?: string;
};
type ExpectedUniqueConstraint = {
	name: string;
	table: string;
	columns: string[];
};
type ExpectedCheckConstraint = {
	name: string;
	table: string;
	value: string;
};
type MigrationSnapshot = {
	prevId: string;
	tables: Record<
		string,
		{
			columns: Record<
				string,
				{
					type: string;
					notNull: boolean;
					primaryKey: boolean;
					default?: unknown;
				}
			>;
			indexes: Record<
				string,
				{
					columns: Array<{ expression: string; isExpression: boolean }>;
					isUnique: boolean;
					where?: string;
				}
			>;
			foreignKeys: Record<
				string,
				{
					name: string;
					columnsFrom: string[];
					tableTo: string;
					columnsTo: string[];
					onDelete: string;
					onUpdate: string;
				}
			>;
			uniqueConstraints: Record<string, { columns: string[] }>;
			checkConstraints: Record<string, { value: string }>;
		}
	>;
	enums: Record<string, { values: string[] }>;
};

const approvalWorkflowEnums: ExpectedEnum[] = [
	{
		name: "approval_actor_kind",
		values: ["employee", "system", "legacy_unknown"],
	},
	{
		name: "approval_assignment_status",
		values: ["pending", "approved", "rejected", "cancelled", "expired"],
	},
	{ name: "approval_command_state", values: ["reserved", "completed"] },
	{
		name: "approval_outbox_channel",
		values: [
			"in_app",
			"push",
			"email",
			"webhook",
			"teams",
			"telegram",
			"discord",
			"slack",
		],
	},
	{ name: "approval_outbox_disposition", values: ["observe", "deliver"] },
	{
		name: "approval_outbox_expansion_status",
		values: ["pending", "expanded"],
	},
	{
		name: "approval_outbox_status",
		values: ["pending", "processing", "delivered", "failed", "suppressed"],
	},
	{ name: "approval_side_effect_mode", values: ["legacy", "canonical"] },
	{
		name: "approval_stage_status",
		values: [
			"waiting",
			"pending",
			"approved",
			"rejected",
			"cancelled",
			"expired",
		],
	},
	{
		name: "approval_workflow_lifecycle_mode",
		values: ["legacy", "shadow", "ready", "canonical", "complete"],
	},
	{
		name: "approval_workflow_status",
		values: ["pending", "approved", "rejected", "cancelled", "expired"],
	},
	{
		name: "approval_workflow_type",
		values: [
			"absence",
			"time_correction",
			"manual_time_submission",
			"policy_clock_out",
			"travel_expense",
			"shift_request",
			"compliance_exception",
		],
	},
	{
		name: "shift_request_status",
		values: ["pending", "approved", "rejected", "cancelled"],
	},
];

const canonicalApprovalTableColumns: Record<string, string[]> = {
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
};

type ExpectedSnapshotColumn = [
	name: string,
	type: string,
	notNull: boolean,
	primaryKey: boolean,
	defaultValue: unknown,
];

const canonicalApprovalSnapshotColumns: Record<
	string,
	ExpectedSnapshotColumn[]
> = {
	approval_workflow: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_type", "approval_workflow_type", true, false, null],
		["source_type", "text", true, false, null],
		["source_id", "uuid", true, false, null],
		["requester_employee_id", "uuid", false, false, null],
		["status", "approval_workflow_status", true, false, "'pending'"],
		["current_stage_order", "integer", false, false, null],
		["version", "integer", true, false, 1],
		["policy_snapshot", "jsonb", true, false, null],
		["context_snapshot", "jsonb", true, false, null],
		["display_snapshot", "jsonb", true, false, null],
		["submitted_at", "timestamp with time zone", true, false, "now()"],
		["completed_at", "timestamp with time zone", false, false, null],
		["cancelled_at", "timestamp with time zone", false, false, null],
		["decision_reason", "text", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_workflow_stage: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["stage_order", "integer", true, false, null],
		["label", "text", true, false, null],
		["resolver_snapshot", "jsonb", true, false, null],
		["activation_mode", "text", true, false, null],
		["status", "approval_stage_status", true, false, "'waiting'"],
		["activated_at", "timestamp with time zone", false, false, null],
		["decided_at", "timestamp with time zone", false, false, null],
		["decision_reason", "text", false, false, null],
		["legacy_approval_request_id", "uuid", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_stage_assignment: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["stage_id", "uuid", true, false, null],
		["assignment_sequence", "integer", true, false, null],
		["approver_employee_id", "uuid", true, false, null],
		["status", "approval_assignment_status", true, false, "'pending'"],
		["assigned_at", "timestamp with time zone", true, false, "now()"],
		["resolved_at", "timestamp with time zone", false, false, null],
		["resolved_by_actor_kind", "approval_actor_kind", false, false, null],
		["resolved_by_actor_id", "uuid", false, false, null],
		["reassigned_by_employee_id", "uuid", false, false, null],
		["reassigned_from_assignment_id", "uuid", false, false, null],
		["reassignment_metadata", "jsonb", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_workflow_event: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["version", "integer", true, false, null],
		["event_index", "integer", true, false, null],
		["event_type", "text", true, false, null],
		["actor_kind", "approval_actor_kind", true, false, null],
		["actor_employee_id", "uuid", false, false, null],
		["actor_user_id", "text", false, false, null],
		["previous_state", "jsonb", false, false, null],
		["resulting_state", "jsonb", true, false, null],
		["reason", "text", false, false, null],
		["metadata", "jsonb", false, false, null],
		["idempotency_key", "text", false, false, null],
		["occurred_at", "timestamp with time zone", true, false, "now()"],
		["created_at", "timestamp with time zone", true, false, "now()"],
	],
	approval_workflow_command: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["idempotency_key", "text", true, false, null],
		["actor_fingerprint", "text", true, false, null],
		["command_fingerprint", "text", true, false, null],
		["state", "approval_command_state", true, false, "'reserved'"],
		["result", "jsonb", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_requester_projection: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["requester_employee_id", "uuid", false, false, null],
		["source_type", "text", true, false, null],
		["source_id", "uuid", true, false, null],
		["status", "approval_workflow_status", true, false, null],
		["current_stage_order", "integer", false, false, null],
		["display_payload", "jsonb", true, false, null],
		["search_text", "text", true, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_inbox_projection: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["active_stage_id", "uuid", true, false, null],
		["source_type", "text", true, false, null],
		["source_id", "uuid", true, false, null],
		["status", "approval_workflow_status", true, false, null],
		["display_payload", "jsonb", true, false, null],
		["search_text", "text", true, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_outbox: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", true, false, null],
		["event_id", "uuid", true, false, null],
		["event_type", "text", true, false, null],
		["dedupe_key", "text", true, false, null],
		["payload", "jsonb", true, false, null],
		["disposition", "approval_outbox_disposition", true, false, null],
		[
			"expansion_status",
			"approval_outbox_expansion_status",
			true,
			false,
			"'pending'",
		],
		["expanded_at", "timestamp with time zone", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
	],
	approval_outbox_delivery: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["outbox_id", "uuid", true, false, null],
		["dedupe_key", "text", true, false, null],
		["disposition", "approval_outbox_disposition", true, false, null],
		["status", "approval_outbox_status", true, false, "'pending'"],
		["channel", "approval_outbox_channel", true, false, null],
		["recipient_kind", "text", true, false, null],
		["recipient_employee_id", "uuid", false, false, null],
		["recipient_address", "text", false, false, null],
		["available_at", "timestamp with time zone", true, false, "now()"],
		["claimed_at", "timestamp with time zone", false, false, null],
		["claim_token", "text", false, false, null],
		["retry_count", "integer", true, false, 0],
		["attempt_count", "integer", true, false, 0],
		["processed_at", "timestamp with time zone", false, false, null],
		["last_error", "text", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_workflow_rollout: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_type", "approval_workflow_type", true, false, null],
		[
			"lifecycle_mode",
			"approval_workflow_lifecycle_mode",
			true,
			false,
			"'legacy'",
		],
		["side_effect_mode", "approval_side_effect_mode", true, false, "'legacy'"],
		["backfilled_through", "timestamp with time zone", false, false, null],
		["mismatch_count", "integer", true, false, 0],
		["last_reconciled_at", "timestamp with time zone", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
	approval_workflow_migration_issue: [
		["id", "uuid", true, true, "gen_random_uuid()"],
		["organization_id", "text", true, false, null],
		["workflow_id", "uuid", false, false, null],
		["workflow_type", "approval_workflow_type", true, false, null],
		["legacy_type", "text", false, false, null],
		["legacy_id", "uuid", false, false, null],
		["source_type", "text", true, false, null],
		["source_id", "uuid", true, false, null],
		["issue_code", "text", true, false, null],
		["evidence", "jsonb", true, false, null],
		["disposition", "text", true, false, "'open'"],
		["operator_user_id", "text", false, false, null],
		["disposed_at", "timestamp with time zone", false, false, null],
		["created_at", "timestamp with time zone", true, false, "now()"],
		["updated_at", "timestamp with time zone", true, false, null],
	],
};

const approvalWorkflowUniqueConstraints: ExpectedUniqueConstraint[] = [
	{
		name: "approvalWorkflow_id_organizationId_idx",
		table: "approval_workflow",
		columns: ["id", "organization_id"],
	},
	{
		name: "approvalWorkflowStage_id_organizationId_idx",
		table: "approval_workflow_stage",
		columns: ["id", "organization_id"],
	},
	{
		name: "approvalWorkflowStage_workflow_id_organizationId_idx",
		table: "approval_workflow_stage",
		columns: ["workflow_id", "id", "organization_id"],
	},
	{
		name: "approvalStageAssignment_id_organizationId_idx",
		table: "approval_stage_assignment",
		columns: ["id", "organization_id"],
	},
	{
		name: "approvalStageAssignment_workflow_stage_id_organizationId_idx",
		table: "approval_stage_assignment",
		columns: ["workflow_id", "stage_id", "id", "organization_id"],
	},
	{
		name: "approvalWorkflowEvent_id_organizationId_idx",
		table: "approval_workflow_event",
		columns: ["id", "organization_id"],
	},
	{
		name: "approvalWorkflowEvent_workflow_id_organizationId_idx",
		table: "approval_workflow_event",
		columns: ["workflow_id", "id", "organization_id"],
	},
	{
		name: "approvalWorkflowEvent_workflow_id_organizationId_eventType_idx",
		table: "approval_workflow_event",
		columns: ["workflow_id", "id", "organization_id", "event_type"],
	},
	{
		name: "approvalOutbox_id_organizationId_idx",
		table: "approval_outbox",
		columns: ["id", "organization_id"],
	},
	{
		name: "approvalOutbox_id_organizationId_disposition_idx",
		table: "approval_outbox",
		columns: ["id", "organization_id", "disposition"],
	},
	{
		name: "shift_organizationId_id_idx",
		table: "shift",
		columns: ["organization_id", "id"],
	},
];

const approvalWorkflowIndexes: ExpectedIndex[] = [
	{
		name: "approvalInboxProjection_org_workflow_stage_idx",
		table: "approval_inbox_projection",
		columns: ["organization_id", "workflow_id", "active_stage_id"],
		unique: true,
	},
	{
		name: "approvalInboxProjection_org_status_idx",
		table: "approval_inbox_projection",
		columns: ["organization_id", "status"],
		unique: false,
	},
	{
		name: "approvalOutbox_org_dedupe_idx",
		table: "approval_outbox",
		columns: ["organization_id", "dedupe_key"],
		unique: true,
	},
	{
		name: "approvalOutbox_org_createdAt_idx",
		table: "approval_outbox",
		columns: ["organization_id", "created_at"],
		unique: false,
	},
	{
		name: "approvalOutbox_pendingExpansion_createdAt_idx",
		table: "approval_outbox",
		columns: ["expansion_status", "created_at"],
		unique: false,
		where: "expansion_status = 'pending'",
	},
	{
		name: "approvalOutboxDelivery_org_dedupe_idx",
		table: "approval_outbox_delivery",
		columns: ["organization_id", "dedupe_key"],
		unique: true,
	},
	{
		name: "approvalOutboxDelivery_status_available_idx",
		table: "approval_outbox_delivery",
		columns: ["status", "available_at"],
		unique: false,
	},
	{
		name: "approvalRequesterProjection_org_workflow_idx",
		table: "approval_requester_projection",
		columns: ["organization_id", "workflow_id"],
		unique: true,
	},
	{
		name: "approvalRequesterProjection_org_requester_status_idx",
		table: "approval_requester_projection",
		columns: ["organization_id", "requester_employee_id", "status"],
		unique: false,
	},
	{
		name: "approvalStageAssignment_org_workflow_stage_sequence_idx",
		table: "approval_stage_assignment",
		columns: [
			"organization_id",
			"workflow_id",
			"stage_id",
			"assignment_sequence",
		],
		unique: true,
	},
	{
		name: "approvalStageAssignment_org_workflow_stage_pending_approver_idx",
		table: "approval_stage_assignment",
		columns: [
			"organization_id",
			"workflow_id",
			"stage_id",
			"approver_employee_id",
		],
		unique: true,
		where: "status = 'pending'",
	},
	{
		name: "approvalWorkflow_org_source_pending_idx",
		table: "approval_workflow",
		columns: ["organization_id", "source_type", "source_id"],
		unique: true,
		where: "status = 'pending'",
	},
	{
		name: "approvalWorkflow_org_status_idx",
		table: "approval_workflow",
		columns: ["organization_id", "status"],
		unique: false,
	},
	{
		name: "approvalWorkflowCommand_org_workflow_idempotency_idx",
		table: "approval_workflow_command",
		columns: ["organization_id", "workflow_id", "idempotency_key"],
		unique: true,
	},
	{
		name: "approvalWorkflowEvent_org_workflow_version_index_idx",
		table: "approval_workflow_event",
		columns: ["organization_id", "workflow_id", "version", "event_index"],
		unique: true,
	},
	{
		name: "approvalWorkflowEvent_org_idempotency_idx",
		table: "approval_workflow_event",
		columns: ["organization_id", "idempotency_key"],
		unique: true,
		where: "idempotency_key IS NOT NULL",
	},
	{
		name: "approvalWorkflowMigrationIssue_org_type_disposition_idx",
		table: "approval_workflow_migration_issue",
		columns: ["organization_id", "workflow_type", "disposition"],
		unique: false,
	},
	{
		name: "approvalWorkflowRollout_org_type_idx",
		table: "approval_workflow_rollout",
		columns: ["organization_id", "workflow_type"],
		unique: true,
	},
	{
		name: "approvalWorkflowStage_org_workflow_order_idx",
		table: "approval_workflow_stage",
		columns: ["organization_id", "workflow_id", "stage_order"],
		unique: true,
	},
	{
		name: "absenceEntry_org_approvalWorkflowId_idx",
		table: "absence_entry",
		columns: ["organization_id", "approval_workflow_id"],
		unique: false,
	},
	{
		name: "complianceException_org_approvalWorkflowId_idx",
		table: "compliance_exception",
		columns: ["organization_id", "approval_workflow_id"],
		unique: false,
	},
	{
		name: "notification_org_idempotencyKey_idx",
		table: "notification",
		columns: ["organization_id", "idempotency_key"],
		unique: true,
		where: "idempotency_key IS NOT NULL",
	},
	{
		name: "shiftRequest_org_approvalWorkflowId_idx",
		table: "shift_request",
		columns: ["organization_id", "approval_workflow_id"],
		unique: false,
	},
	{
		name: "workPeriod_org_approvalWorkflowId_idx",
		table: "work_period",
		columns: ["organization_id", "approval_workflow_id"],
		unique: false,
	},
	{
		name: "travelExpenseClaim_org_approvalWorkflowId_idx",
		table: "travel_expense_claim",
		columns: ["organization_id", "approval_workflow_id"],
		unique: false,
	},
];

const approvalWorkflowCheckConstraints: ExpectedCheckConstraint[] = [
	{
		name: "absence_entry_approval_workflow_organization_check",
		table: "absence_entry",
		value:
			'"absence_entry"."approval_workflow_id" IS NULL OR "absence_entry"."organization_id" IS NOT NULL',
	},
	{
		name: "shift_request_approval_workflow_organization_check",
		table: "shift_request",
		value:
			'"shift_request"."approval_workflow_id" IS NULL OR "shift_request"."organization_id" IS NOT NULL',
	},
];

const approvalWorkflowForeignKeys: ExpectedForeignKey[] = [
	...[
		"approval_inbox_projection",
		"approval_outbox",
		"approval_outbox_delivery",
		"approval_requester_projection",
		"approval_stage_assignment",
		"approval_workflow",
		"approval_workflow_command",
		"approval_workflow_event",
		"approval_workflow_migration_issue",
		"approval_workflow_rollout",
		"approval_workflow_stage",
	].map((table) => ({
		name: `${table}_organization_id_organization_id_fk`,
		table,
		columns: ["organization_id"],
		foreignTable: "organization",
		foreignColumns: ["id"],
		onDelete: "cascade",
	})),
	{
		name: "approval_workflow_requester_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_workflow",
		columns: ["requester_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		table: "approval_workflow_stage",
		columns: ["workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_stage_assignment_workflow_id_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk",
		table: "approval_stage_assignment",
		columns: ["workflow_id", "stage_id", "organization_id"],
		foreignTable: "approval_workflow_stage",
		foreignColumns: ["workflow_id", "id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_stage_assignment_approver_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_stage_assignment",
		columns: ["approver_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_stage_assignment_resolved_by_actor_id_organization_id_employee_id_organization_id_fk",
		table: "approval_stage_assignment",
		columns: ["resolved_by_actor_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_stage_assignment_reassigned_by_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_stage_assignment",
		columns: ["reassigned_by_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_stage_assignment_workflow_id_stage_id_reassigned_from_assignment_id_organization_id_approval_stage_assignment_workflow_id_stage_id_id_organization_id_fk",
		table: "approval_stage_assignment",
		columns: [
			"workflow_id",
			"stage_id",
			"reassigned_from_assignment_id",
			"organization_id",
		],
		foreignTable: "approval_stage_assignment",
		foreignColumns: ["workflow_id", "stage_id", "id", "organization_id"],
	},
	{
		name: "approval_workflow_event_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		table: "approval_workflow_event",
		columns: ["workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_workflow_event_actor_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_workflow_event",
		columns: ["actor_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_workflow_event_actor_user_id_user_id_fk",
		table: "approval_workflow_event",
		columns: ["actor_user_id"],
		foreignTable: "user",
		foreignColumns: ["id"],
	},
	{
		name: "approval_workflow_command_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		table: "approval_workflow_command",
		columns: ["workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_requester_projection_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		table: "approval_requester_projection",
		columns: ["workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_requester_projection_requester_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_requester_projection",
		columns: ["requester_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_inbox_projection_workflow_id_active_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk",
		table: "approval_inbox_projection",
		columns: ["workflow_id", "active_stage_id", "organization_id"],
		foreignTable: "approval_workflow_stage",
		foreignColumns: ["workflow_id", "id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_outbox_workflow_id_event_id_organization_id_event_type_approval_workflow_event_workflow_id_id_organization_id_event_type_fk",
		table: "approval_outbox",
		columns: ["workflow_id", "event_id", "organization_id", "event_type"],
		foreignTable: "approval_workflow_event",
		foreignColumns: ["workflow_id", "id", "organization_id", "event_type"],
		onDelete: "cascade",
	},
	{
		name: "approval_outbox_delivery_outbox_id_organization_id_disposition_approval_outbox_id_organization_id_disposition_fk",
		table: "approval_outbox_delivery",
		columns: ["outbox_id", "organization_id", "disposition"],
		foreignTable: "approval_outbox",
		foreignColumns: ["id", "organization_id", "disposition"],
		onDelete: "cascade",
	},
	{
		name: "approval_outbox_delivery_recipient_employee_id_organization_id_employee_id_organization_id_fk",
		table: "approval_outbox_delivery",
		columns: ["recipient_employee_id", "organization_id"],
		foreignTable: "employee",
		foreignColumns: ["id", "organization_id"],
	},
	{
		name: "approval_workflow_migration_issue_workflow_id_organization_id_approval_workflow_id_organization_id_fk",
		table: "approval_workflow_migration_issue",
		columns: ["workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
		onDelete: "cascade",
	},
	{
		name: "approval_workflow_migration_issue_operator_user_id_user_id_fk",
		table: "approval_workflow_migration_issue",
		columns: ["operator_user_id"],
		foreignTable: "user",
		foreignColumns: ["id"],
	},
	{
		name: "shift_request_organization_id_organization_id_fk",
		table: "shift_request",
		columns: ["organization_id"],
		foreignTable: "organization",
		foreignColumns: ["id"],
		onDelete: "cascade",
	},
	{
		name: "absence_entry_organization_id_organization_id_fk",
		table: "absence_entry",
		columns: ["organization_id"],
		foreignTable: "organization",
		foreignColumns: ["id"],
		onDelete: "cascade",
	},
	{
		name: "shift_request_organization_id_shift_id_shift_organization_id_id_fk",
		table: "shift_request",
		columns: ["organization_id", "shift_id"],
		foreignTable: "shift",
		foreignColumns: ["organization_id", "id"],
		onDelete: "cascade",
	},
	...[
		"absence_entry",
		"compliance_exception",
		"shift_request",
		"work_period",
		"travel_expense_claim",
	].map((table) => ({
		name: `${table}_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk`,
		table,
		columns: ["approval_workflow_id", "organization_id"],
		foreignTable: "approval_workflow",
		foreignColumns: ["id", "organization_id"],
	})),
];

function migrationStatements(sql: string): string[] {
	return sql
		.split("--> statement-breakpoint")
		.map((statement) =>
			statement
				.trim()
				.replace(/^(?:--[^\n]*\n)+/, "")
				.trim(),
		)
		.filter(Boolean);
}

function quotedIdentifiers(value: string): string[] {
	return Array.from(value.matchAll(/"([^"]+)"/g), (match) => match[1]);
}

function normalizePredicate(value: string | undefined): string | undefined {
	return value?.replace(/;$/, "").replace(/\s+/g, " ").trim();
}

function parsedEnums(sql: string): Map<string, string[]> {
	const enums = new Map<string, string[]>();

	for (const statement of migrationStatements(sql)) {
		const match = statement.match(
			/^CREATE TYPE (?:(?:"public"\.)?)"([^"]+)" AS ENUM\(([\s\S]*)\);?$/,
		);
		if (!match) continue;

		enums.set(
			match[1],
			Array.from(match[2].matchAll(/'((?:''|[^'])*)'/g), (value) =>
				value[1].replaceAll("''", "'"),
			),
		);
	}

	return enums;
}

function parsedTables(
	sql: string,
): Map<string, { columns: string[]; body: string }> {
	const tables = new Map<string, { columns: string[]; body: string }>();

	for (const statement of migrationStatements(sql)) {
		const match = statement.match(/^CREATE TABLE "([^"]+)" \(([\s\S]*)\);?$/);
		if (!match) continue;

		tables.set(match[1], {
			columns: Array.from(
				match[2].matchAll(/^\s*"([^"]+)"\s+/gm),
				(column) => column[1],
			),
			body: match[2],
		});
	}

	return tables;
}

function parsedIndexes(sql: string): ExpectedIndex[] {
	const indexes: ExpectedIndex[] = [];

	for (const statement of migrationStatements(sql)) {
		const match = statement.match(
			/^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)" USING \w+ \(([^)]*)\)(?: WHERE ([\s\S]*?))?;?$/,
		);
		if (!match) continue;

		indexes.push({
			name: match[2],
			table: match[3],
			columns: quotedIdentifiers(match[4]),
			unique: Boolean(match[1]),
			where: normalizePredicate(match[5]),
		});
	}

	return indexes;
}

function deliveryFanoutUniqueIndexViolations(
	indexes: ExpectedIndex[],
): string[] {
	const forbiddenColumns = new Set(["organization_id", "outbox_id", "channel"]);

	return indexes
		.filter(
			(index) =>
				index.table === "approval_outbox_delivery" &&
				index.unique &&
				index.columns.length === forbiddenColumns.size &&
				index.columns.every((column) => forbiddenColumns.has(column)),
		)
		.map(({ name }) => name);
}

function parsedForeignKeys(sql: string): ExpectedForeignKey[] {
	const foreignKeys: ExpectedForeignKey[] = [];

	for (const statement of migrationStatements(sql)) {
		const match = statement.match(
			/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]*)\) REFERENCES (?:(?:"public"\.)?)"([^"]+)"\(([^)]*)\)(?: ON DELETE (cascade|restrict|no action|set null|set default))?(?: ON UPDATE (cascade|restrict|no action|set null|set default))?/,
		);
		if (!match) continue;

		foreignKeys.push({
			table: match[1],
			name: match[2],
			columns: quotedIdentifiers(match[3]),
			foreignTable: match[4],
			foreignColumns: quotedIdentifiers(match[5]),
			onDelete: match[6] ?? "no action",
			onUpdate: match[7] ?? "no action",
		});
	}

	return foreignKeys;
}

function parsedUniqueConstraints(sql: string): ExpectedUniqueConstraint[] {
	const constraints: ExpectedUniqueConstraint[] = [];

	for (const [table, definition] of parsedTables(sql)) {
		for (const match of definition.body.matchAll(
			/CONSTRAINT "([^"]+)" UNIQUE\(([^)]*)\)/g,
		)) {
			constraints.push({
				name: match[1],
				table,
				columns: quotedIdentifiers(match[2]),
			});
		}
	}
	for (const statement of migrationStatements(sql)) {
		const match = statement.match(
			/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" UNIQUE\(([^)]*)\);?$/,
		);
		if (!match) continue;

		constraints.push({
			name: match[2],
			table: match[1],
			columns: quotedIdentifiers(match[3]),
		});
	}

	return constraints;
}

function foreignKeyTargetIdentityOrderViolations(sql: string): string[] {
	const statements = migrationStatements(sql);
	const identities: Array<{
		table: string;
		columns: string[];
		statementIndex: number;
	}> = [];

	for (const [statementIndex, statement] of statements.entries()) {
		const tableMatch = statement.match(
			/^CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)" \(([\s\S]*)\);?$/,
		);
		if (tableMatch) {
			for (const primaryKey of tableMatch[2].matchAll(
				/^\s*"([^"]+)"[^,\n]*\bPRIMARY KEY\b/gm,
			)) {
				identities.push({
					table: tableMatch[1],
					columns: [primaryKey[1]],
					statementIndex,
				});
			}
			for (const uniqueConstraint of tableMatch[2].matchAll(
				/CONSTRAINT "[^"]+" UNIQUE\(([^)]*)\)/g,
			)) {
				identities.push({
					table: tableMatch[1],
					columns: quotedIdentifiers(uniqueConstraint[1]),
					statementIndex,
				});
			}
		}

		const uniqueIndexMatch = statement.match(
			/^CREATE UNIQUE INDEX(?: IF NOT EXISTS)? "[^"]+" ON "([^"]+)" USING \w+ \(([^)]*)\)(?: WHERE ([\s\S]*?))?;?$/,
		);
		if (uniqueIndexMatch && !normalizePredicate(uniqueIndexMatch[3])) {
			identities.push({
				table: uniqueIndexMatch[1],
				columns: quotedIdentifiers(uniqueIndexMatch[2]),
				statementIndex,
			});
		}

		const uniqueConstraintMatch = statement.match(
			/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" UNIQUE\(([^)]*)\);?$/,
		);
		if (uniqueConstraintMatch) {
			identities.push({
				table: uniqueConstraintMatch[1],
				columns: quotedIdentifiers(uniqueConstraintMatch[2]),
				statementIndex,
			});
		}
	}

	const violations: string[] = [];
	for (const [statementIndex, statement] of statements.entries()) {
		const foreignKeyMatch = statement.match(
			/^ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \([^)]*\) REFERENCES (?:(?:"public"\.)?)"([^"]+)"\(([^)]*)\)/,
		);
		if (!foreignKeyMatch) continue;

		const foreignColumns = quotedIdentifiers(foreignKeyMatch[3]);
		const targetIdentities = identities.filter(
			(identity) =>
				identity.table === foreignKeyMatch[2] &&
				JSON.stringify(identity.columns) === JSON.stringify(foreignColumns),
		);
		if (
			targetIdentities.length > 0 &&
			targetIdentities.every(
				(identity) => identity.statementIndex >= statementIndex,
			)
		) {
			violations.push(
				`${foreignKeyMatch[1]} -> ${foreignKeyMatch[2]}(${foreignColumns.join(",")})`,
			);
		}
	}

	return violations;
}

function parsedCheckConstraints(sql: string): ExpectedCheckConstraint[] {
	const constraints: ExpectedCheckConstraint[] = [];

	for (const statement of migrationStatements(sql)) {
		const match = statement.match(
			/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" CHECK \(([\s\S]*)\);?$/,
		);
		if (!match) continue;

		constraints.push({
			name: match[2],
			table: match[1],
			value: match[3].replace(/\)$/, "").replace(/\s+/g, " ").trim(),
		});
	}

	return constraints;
}

const absenceOrganizationForeignKeyDrop =
	'ALTER TABLE "absence_entry" DROP CONSTRAINT "absence_entry_organization_id_organization_id_fk";';
const absenceOrganizationForeignKeyRecreation =
	'ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;';

function additiveMigrationViolations(sql: string): string[] {
	const violations: string[] = [];
	const allowedStatements = [
		/^CREATE TYPE (?:(?:"public"\.)?)"[^"]+" AS ENUM\([\s\S]*\);?$/,
		/^CREATE TABLE "[^"]+" \([\s\S]*\);?$/,
		/^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "[^"]+" USING \w+ \([\s\S]*\)(?: WHERE [\s\S]+)?;?$/,
		/^ALTER TABLE "[^"]+" ADD COLUMN "[^"]+" [\s\S]+;?$/,
		/^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" [\s\S]+;?$/,
		/^ALTER TABLE "absence_entry" DROP CONSTRAINT "absence_entry_organization_id_organization_id_fk";$/,
	];
	const dailyRecoveryStatements = [
		/^CREATE TABLE IF NOT EXISTS "daily_digest_delivery" \([\s\S]*\);?$/,
		/^CREATE UNIQUE INDEX IF NOT EXISTS "dailyDigestDelivery_recipient_date_unique_idx" ON "daily_digest_delivery" USING btree \("organization_id","recipient_user_id","platform","type","recipient_local_date"\);?$/,
		/^CREATE INDEX IF NOT EXISTS "dailyDigestDelivery_organization_status_idx" ON "daily_digest_delivery" USING btree \("organization_id","status"\);?$/,
	];

	const statements = migrationStatements(sql);
	const recreatesAbsenceOrganizationForeignKey = statements.includes(
		absenceOrganizationForeignKeyRecreation,
	);
	for (const statement of statements) {
		const statementBody = statement;
		const isAllowedAbsenceOrganizationForeignKeyDrop =
			statementBody === absenceOrganizationForeignKeyDrop &&
			recreatesAbsenceOrganizationForeignKey;

		if (
			/\bDROP\b/i.test(statementBody) &&
			!isAllowedAbsenceOrganizationForeignKeyDrop
		) {
			violations.push("DROP");
		}
		if (/\bRENAME\b/i.test(statementBody)) violations.push("RENAME");
		if (/^TRUNCATE\b/i.test(statementBody)) violations.push("TRUNCATE");
		if (/^DELETE\b/i.test(statementBody)) violations.push("DELETE");
		if (/^UPDATE\b/i.test(statementBody)) violations.push("UPDATE");
		if (/\bALTER\s+COLUMN\b/i.test(statementBody))
			violations.push("ALTER COLUMN");
		if (/\bSET\s+NOT\s+NULL\b/i.test(statementBody))
			violations.push("SET NOT NULL");
		if (/\bALTER\s+TYPE\b/i.test(statementBody)) violations.push("ALTER TYPE");
		if (
			/^ALTER TABLE "daily_digest_delivery" ADD CONSTRAINT/i.test(statementBody)
		)
			violations.push("separate daily digest constraint");
		if (
			![...allowedStatements, ...dailyRecoveryStatements].some((pattern) =>
				pattern.test(statementBody),
			)
		) {
			violations.push(
				`unsupported: ${statementBody.split(/\s+/, 3).join(" ")}`,
			);
		}
	}

	return [...new Set(violations)];
}

function dailyRecoveryViolations(sql: string): string[] {
	const violations: string[] = [];
	const recoveryStart = sql.indexOf("-- daily digest recovery: begin");
	const recoveryEnd = sql.indexOf("-- daily digest recovery: end");
	const recovery = sql.slice(recoveryStart, recoveryEnd);
	const normalizedRecovery = recovery.replace(/\s+/g, " ");
	const requiredFragments = [
		'CREATE TABLE IF NOT EXISTS "daily_digest_delivery" ( "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "organization_id" text NOT NULL, "recipient_user_id" text NOT NULL, "platform" text NOT NULL, "type" text NOT NULL, "recipient_local_date" date NOT NULL, "status" text DEFAULT \'processing\' NOT NULL, "attempt_count" integer DEFAULT 0 NOT NULL, "last_error" text, "attempted_at" timestamp DEFAULT now() NOT NULL, "sent_at" timestamp, "created_at" timestamp DEFAULT now() NOT NULL, CONSTRAINT "daily_digest_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action, CONSTRAINT "daily_digest_delivery_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action, CONSTRAINT "daily_digest_delivery_status_check" CHECK ("status" IN (\'processing\', \'sent\', \'failed\')) );',
		'CREATE UNIQUE INDEX IF NOT EXISTS "dailyDigestDelivery_recipient_date_unique_idx"',
		'CREATE INDEX IF NOT EXISTS "dailyDigestDelivery_organization_status_idx"',
	];
	const recoveryStatements = migrationStatements(recovery);

	if (recoveryStart !== 0 || recoveryEnd <= recoveryStart)
		violations.push("markers");
	for (const fragment of requiredFragments) {
		if (!normalizedRecovery.includes(fragment)) violations.push(fragment);
	}
	if (recoveryStatements.length !== 3)
		violations.push("recovery statement count");
	if (
		recoveryStatements.some(
			(statement) =>
				statement.startsWith('ALTER TABLE "daily_digest_delivery"') ||
				statement.includes('ALTER TABLE "daily_digest_delivery"'),
		)
	) {
		violations.push("separate daily digest constraint");
	}

	return violations;
}

function enumMismatches(sql: string, expected: ExpectedEnum[]): string[] {
	const actual = parsedEnums(sql);
	return expected
		.filter(
			({ name, values }) =>
				JSON.stringify(actual.get(name)) !== JSON.stringify(values),
		)
		.map(({ name }) => name);
}

function tableColumnMismatches(
	sql: string,
	expected: Record<string, string[]>,
): string[] {
	const actual = parsedTables(sql);
	const mismatches: string[] = [];

	for (const [table, columns] of Object.entries(expected)) {
		const actualColumns = new Set(actual.get(table)?.columns ?? []);
		for (const column of columns) {
			if (!actualColumns.has(column)) mismatches.push(`${table}.${column}`);
		}
	}

	return mismatches;
}

function sqlColumnDefinitionMismatches(
	sql: string,
	expected: Record<string, ExpectedSnapshotColumn[]>,
): string[] {
	const actualTables = parsedTables(sql);

	return Object.entries(expected)
		.filter(([tableName, expectedColumns]) => {
			const body = actualTables.get(tableName)?.body ?? "";
			const actualColumns: ExpectedSnapshotColumn[] = body
				.split("\n")
				.map((line) => line.match(/^\s*"([^"]+)"\s+(.+?)(?:,)?$/))
				.filter((match): match is RegExpMatchArray => match !== null)
				.map((match) => {
					const definition = match[2].replace(/,$/, "");
					const type = definition
						.match(/^(.+?)(?=\s+(?:PRIMARY KEY|DEFAULT|NOT NULL)\b|$)/)?.[1]
						.replaceAll('"', "");
					const defaultValue = definition.match(
						/\bDEFAULT\s+(.+?)(?=\s+(?:PRIMARY KEY|NOT NULL)\b|$)/,
					)?.[1];

					return [
						match[1],
						type ?? "",
						/\bNOT NULL\b/.test(definition),
						/\bPRIMARY KEY\b/.test(definition),
						defaultValue ?? null,
					];
				});
			const normalizedExpected = expectedColumns.map(
				([name, type, notNull, primaryKey, defaultValue]) => [
					name,
					type,
					notNull,
					primaryKey,
					defaultValue === null ? null : String(defaultValue),
				],
			);

			return (
				JSON.stringify(actualColumns) !== JSON.stringify(normalizedExpected)
			);
		})
		.map(([tableName]) => tableName);
}

function indexMismatches(sql: string, expected: ExpectedIndex[]): string[] {
	return indexDefinitionMismatches(parsedIndexes(sql), expected);
}

function indexDefinitionMismatches(
	actualDefinitions: ExpectedIndex[],
	expected: ExpectedIndex[],
): string[] {
	const actual = new Map(actualDefinitions.map((index) => [index.name, index]));

	return expected
		.filter((index) => {
			const candidate = actual.get(index.name);
			return (
				!candidate ||
				candidate.table !== index.table ||
				candidate.unique !== index.unique ||
				JSON.stringify(candidate.columns) !== JSON.stringify(index.columns) ||
				normalizePredicate(candidate.where) !== normalizePredicate(index.where)
			);
		})
		.map(({ name }) => name);
}

function foreignKeyLabel(foreignKey: ExpectedForeignKey): string {
	return `${foreignKey.table}(${foreignKey.columns.join(",")})`;
}

function foreignKeyDefinitionMismatches(
	actual: ExpectedForeignKey[],
	expected: ExpectedForeignKey[],
): string[] {
	return expected
		.filter(
			(foreignKey) =>
				!actual.some(
					(candidate) =>
						(foreignKey.name === undefined ||
							candidate.name === foreignKey.name) &&
						candidate.table === foreignKey.table &&
						candidate.foreignTable === foreignKey.foreignTable &&
						JSON.stringify(candidate.columns) ===
							JSON.stringify(foreignKey.columns) &&
						JSON.stringify(candidate.foreignColumns) ===
							JSON.stringify(foreignKey.foreignColumns) &&
						candidate.onDelete === (foreignKey.onDelete ?? "no action") &&
						candidate.onUpdate === (foreignKey.onUpdate ?? "no action"),
				),
		)
		.map(foreignKeyLabel);
}

function foreignKeySetMismatches(
	actual: ExpectedForeignKey[],
	expected: ExpectedForeignKey[],
): string[] {
	const normalized = (foreignKey: ExpectedForeignKey) =>
		JSON.stringify({
			name: foreignKey.name,
			table: foreignKey.table,
			columns: foreignKey.columns,
			foreignTable: foreignKey.foreignTable,
			foreignColumns: foreignKey.foreignColumns,
			onDelete: foreignKey.onDelete ?? "no action",
			onUpdate: foreignKey.onUpdate ?? "no action",
		});
	const actualDefinitions = actual.map(normalized);
	const expectedDefinitions = expected.map(normalized);
	const actualSet = new Set(actualDefinitions);
	const expectedSet = new Set(expectedDefinitions);

	return [
		...expectedDefinitions
			.filter((definition) => !actualSet.has(definition))
			.map((definition) => `missing:${definition}`),
		...actualDefinitions
			.filter((definition) => !expectedSet.has(definition))
			.map((definition) => `unexpected:${definition}`),
	];
}

function uniqueConstraintMismatches(
	sql: string,
	expected: ExpectedUniqueConstraint[],
): string[] {
	return uniqueConstraintDefinitionMismatches(
		parsedUniqueConstraints(sql),
		expected,
	);
}

function uniqueConstraintDefinitionMismatches(
	actualDefinitions: ExpectedUniqueConstraint[],
	expected: ExpectedUniqueConstraint[],
): string[] {
	const actual = new Map(
		actualDefinitions.map((constraint) => [constraint.name, constraint]),
	);

	return expected
		.filter((constraint) => {
			const candidate = actual.get(constraint.name);
			return (
				!candidate ||
				candidate.table !== constraint.table ||
				JSON.stringify(candidate.columns) !== JSON.stringify(constraint.columns)
			);
		})
		.map(({ name }) => name);
}

function checkConstraintDefinitionMismatches(
	actualDefinitions: ExpectedCheckConstraint[],
	expected: ExpectedCheckConstraint[],
): string[] {
	const actual = new Map(
		actualDefinitions.map((constraint) => [constraint.name, constraint]),
	);

	return expected
		.filter((constraint) => {
			const candidate = actual.get(constraint.name);
			return (
				!candidate ||
				candidate.table !== constraint.table ||
				candidate.value.replace(/\s+/g, " ").trim() !==
					constraint.value.replace(/\s+/g, " ").trim()
			);
		})
		.map(({ name }) => name);
}

function snapshotIndexes(snapshot: MigrationSnapshot): ExpectedIndex[] {
	return Object.entries(snapshot.tables).flatMap(([qualifiedTable, table]) =>
		Object.entries(table.indexes).map(([name, index]) => ({
			name,
			table: qualifiedTable.replace(/^public\./, ""),
			columns: index.columns.map((column) => column.expression),
			unique: index.isUnique,
			where: normalizePredicate(index.where),
		})),
	);
}

function snapshotForeignKeys(
	snapshot: MigrationSnapshot,
): ExpectedForeignKey[] {
	return Object.entries(snapshot.tables).flatMap(([qualifiedTable, table]) =>
		Object.values(table.foreignKeys).map((foreignKey) => ({
			name: foreignKey.name,
			table: qualifiedTable.replace(/^public\./, ""),
			columns: foreignKey.columnsFrom,
			foreignTable: foreignKey.tableTo,
			foreignColumns: foreignKey.columnsTo,
			onDelete: foreignKey.onDelete,
			onUpdate: foreignKey.onUpdate,
		})),
	);
}

function snapshotUniqueConstraints(
	snapshot: MigrationSnapshot,
): ExpectedUniqueConstraint[] {
	return Object.entries(snapshot.tables).flatMap(([qualifiedTable, table]) =>
		Object.entries(table.uniqueConstraints).map(([name, constraint]) => ({
			name,
			table: qualifiedTable.replace(/^public\./, ""),
			columns: constraint.columns,
		})),
	);
}

function snapshotCheckConstraints(
	snapshot: MigrationSnapshot,
): ExpectedCheckConstraint[] {
	return Object.entries(snapshot.tables).flatMap(([qualifiedTable, table]) =>
		Object.entries(table.checkConstraints).map(([name, constraint]) => ({
			name,
			table: qualifiedTable.replace(/^public\./, ""),
			value: constraint.value,
		})),
	);
}

function snapshotColumnMismatches(
	snapshot: MigrationSnapshot,
	expected: Record<string, ExpectedSnapshotColumn[]>,
): string[] {
	return Object.entries(expected)
		.filter(([tableName, expectedColumns]) => {
			const table = snapshot.tables[`public.${tableName}`];
			const actualColumns: ExpectedSnapshotColumn[] = Object.entries(
				table?.columns ?? {},
			).map(([name, column]) => [
				name,
				column.type,
				column.notNull,
				column.primaryKey,
				Object.hasOwn(column, "default") ? column.default : null,
			]);

			return JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns);
		})
		.map(([tableName]) => tableName);
}
const migration0004Statements = migration0004
	.split("--> statement-breakpoint")
	.map((statement) => statement.trim())
	.filter(Boolean);

describe("drizzle follow-up migrations", () => {
	it("replaces the pending workflow index with exact typed source cycle identity", () => {
		const migration = readRequiredMigration(
			migration0055Url,
			"0056 approval workflow cycle identity migration",
		);
		const statements = migrationStatements(migration);
		expect(statements).toHaveLength(2);
		expect(statements[0]).toBe(
			'DROP INDEX "approvalWorkflow_org_source_pending_idx";',
		);
		expect(parsedIndexes(migration)).toEqual([
			{
				name: "approvalWorkflow_org_source_pending_idx",
				table: "approval_workflow",
				columns: [
					"organization_id",
					"workflow_type",
					"source_type",
					"source_id",
				],
				unique: true,
				where: "status = 'pending'",
			},
		]);

		const entries = migrationJournal.entries.filter((entry) =>
			entry.tag.startsWith("0056_"),
		);
		expect(entries).toEqual([
			expect.objectContaining({
				idx: 56,
				tag: "0056_approval_workflow_cycle_identity",
				breakpoints: true,
			}),
		]);
		expect(entries[0]?.when).toBeGreaterThan(
			migrationJournal.entries.find(
				(entry) => entry.tag === "0055_approval_workflow_expand",
			)?.when ?? 0,
		);
		expect(existsSync(migration0055SnapshotUrl)).toBe(true);
		if (!existsSync(migration0055SnapshotUrl)) return;
		const previous = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot & { id: string };
		const snapshot = JSON.parse(
			readFileSync(migration0055SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		expect(snapshot.prevId).toBe(previous.id);
		expect(
			snapshotIndexes(snapshot).find(
				(index) => index.name === "approvalWorkflow_org_source_pending_idx",
			),
		).toEqual({
			name: "approvalWorkflow_org_source_pending_idx",
			table: "approval_workflow",
			columns: ["organization_id", "workflow_type", "source_type", "source_id"],
			unique: true,
			where: "status = 'pending'",
		});
		expect(
			snapshot.tables["public.invitation"].indexes
				.invitation_id_organization_id_idx,
		).toEqual(
			previous.tables["public.invitation"].indexes
				.invitation_id_organization_id_idx,
		);
		for (const foreignKeyName of [
			"employee_invitation_draft_invitation_org_fk",
			"employee_invitation_draft_team_org_fk",
		]) {
			expect(
				snapshot.tables["public.employee_invitation_draft"].foreignKeys[
					foreignKeyName
				],
				foreignKeyName,
			).toEqual(
				previous.tables["public.employee_invitation_draft"].foreignKeys[
					foreignKeyName
				],
			);
		}
	});

	it("rejects destructive and structurally weakened approval workflow migrations", () => {
		for (const unsafeSql of [
			'DROP INDEX "approvalWorkflow_org_status_idx";',
			'ALTER TABLE "approval_workflow" RENAME COLUMN "status" TO "state";',
			'ALTER TABLE "approval_workflow" RENAME TO "approval_workflow_old";',
			'TRUNCATE TABLE "approval_workflow";',
			'INSERT INTO "approval_workflow" ("id") VALUES (gen_random_uuid());',
			'DELETE FROM "approval_workflow";',
			'UPDATE "approval_workflow" SET "status" = \'approved\';',
			'ALTER TABLE "approval_workflow" ALTER COLUMN "status" SET NOT NULL;',
			"ALTER TYPE \"approval_workflow_status\" ADD VALUE 'archived';",
		]) {
			expect(additiveMigrationViolations(unsafeSql), unsafeSql).not.toEqual([]);
		}

		const migration0054 = readFileSync(migration0054Url, "utf8");
		expect(
			migrationStatements(migration0054).filter((statement) =>
				/\bDROP\b/i.test(statement),
			),
		).toEqual([absenceOrganizationForeignKeyDrop]);

		const wrongAbsenceOrganizationForeignKeyDrop = migration0054.replace(
			absenceOrganizationForeignKeyDrop,
			'ALTER TABLE "absence_entry" DROP CONSTRAINT "absence_entry_employee_id_employee_id_fk";',
		);
		expect(wrongAbsenceOrganizationForeignKeyDrop).not.toBe(migration0054);
		expect(
			additiveMigrationViolations(wrongAbsenceOrganizationForeignKeyDrop),
		).toContain("DROP");

		const missingAbsenceOrganizationForeignKeyRecreation =
			migration0054.replace(absenceOrganizationForeignKeyRecreation, "");
		expect(missingAbsenceOrganizationForeignKeyRecreation).not.toBe(
			migration0054,
		);
		expect(
			additiveMigrationViolations(
				missingAbsenceOrganizationForeignKeyRecreation,
			),
		).toContain("DROP");

		const weakenedAbsenceOrganizationForeignKeyRecreation =
			migration0054.replace(
				absenceOrganizationForeignKeyRecreation,
				absenceOrganizationForeignKeyRecreation.replace(
					"ON DELETE cascade",
					"ON DELETE no action",
				),
			);
		expect(weakenedAbsenceOrganizationForeignKeyRecreation).not.toBe(
			migration0054,
		);
		expect(
			additiveMigrationViolations(
				weakenedAbsenceOrganizationForeignKeyRecreation,
			),
		).toContain("DROP");
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(weakenedAbsenceOrganizationForeignKeyRecreation),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const reorderedEnum = migration0054.replace(
			"AS ENUM('employee', 'system', 'legacy_unknown')",
			"AS ENUM('system', 'employee', 'legacy_unknown')",
		);
		expect(enumMismatches(reorderedEnum, approvalWorkflowEnums)).toContain(
			"approval_actor_kind",
		);

		for (const [label, mutatedSql, expectedTable] of [
			[
				"enum type",
				migration0054.replace(
					'\t"workflow_type" "approval_workflow_type" NOT NULL,',
					'\t"workflow_type" text NOT NULL,',
				),
				"approval_workflow",
			],
			[
				"default",
				migration0054.replace(
					'\t"status" "approval_workflow_status" DEFAULT \'pending\' NOT NULL,',
					'\t"status" "approval_workflow_status" DEFAULT \'approved\' NOT NULL,',
				),
				"approval_workflow",
			],
			[
				"nullability",
				migration0054.replace('\t"label" text NOT NULL,', '\t"label" text,'),
				"approval_workflow_stage",
			],
			[
				"primary key",
				migration0054.replace(
					'CREATE TABLE "approval_workflow" (\n\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,',
					'CREATE TABLE "approval_workflow" (\n\t"id" uuid DEFAULT gen_random_uuid() NOT NULL,',
				),
				"approval_workflow",
			],
			[
				"unexpected column",
				migration0054.replace(
					'CREATE TABLE "approval_workflow" (',
					'CREATE TABLE "approval_workflow" (\n\t"unexpected_column" text,',
				),
				"approval_workflow",
			],
		] as const) {
			expect(mutatedSql, `${label} mutation must change SQL`).not.toBe(
				migration0054,
			);
			expect(
				sqlColumnDefinitionMismatches(
					mutatedSql,
					canonicalApprovalSnapshotColumns,
				),
				label,
			).toContain(expectedTable);
		}

		const missingAssignmentSequence = migration0054.replace(
			'\t"assignment_sequence" integer NOT NULL,\n',
			"",
		);
		expect(
			tableColumnMismatches(missingAssignmentSequence, {
				approval_stage_assignment: ["assignment_sequence"],
			}),
		).toContain("approval_stage_assignment.assignment_sequence");

		const weakenedPendingIndex = migration0054.replace(
			"WHERE status = 'pending';",
			";",
		);
		expect(
			indexMismatches(weakenedPendingIndex, [
				{
					name: "approvalStageAssignment_org_workflow_stage_pending_approver_idx",
					table: "approval_stage_assignment",
					columns: [
						"organization_id",
						"workflow_id",
						"stage_id",
						"approver_employee_id",
					],
					unique: true,
					where: "status = 'pending'",
				},
			]),
		).toContain(
			"approvalStageAssignment_org_workflow_stage_pending_approver_idx",
		);

		const weakenedOutboxForeignKey = migration0054.replace(
			'FOREIGN KEY ("workflow_id","event_id","organization_id","event_type") REFERENCES "public"."approval_workflow_event"("workflow_id","id","organization_id","event_type")',
			'FOREIGN KEY ("event_id","workflow_id","organization_id","event_type") REFERENCES "public"."approval_workflow_event"("id","workflow_id","organization_id","event_type")',
		);
		expect(weakenedOutboxForeignKey).not.toBe(migration0054);
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(weakenedOutboxForeignKey),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const wrongOutboxForeignTarget = migration0054.replace(
			'REFERENCES "public"."approval_workflow_event"("workflow_id","id","organization_id","event_type")',
			'REFERENCES "public"."approval_workflow"("id","id","organization_id","source_type")',
		);
		expect(wrongOutboxForeignTarget).not.toBe(migration0054);
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(wrongOutboxForeignTarget),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const duplicateOutboxForeignKey = `${migration0054}--> statement-breakpoint
ALTER TABLE "approval_outbox" ADD CONSTRAINT "duplicate_outbox_event_fk" FOREIGN KEY ("workflow_id","event_id","organization_id","event_type") REFERENCES "public"."approval_workflow_event"("workflow_id","id","organization_id","event_type") ON DELETE cascade ON UPDATE no action;`;
		expect(duplicateOutboxForeignKey).not.toBe(migration0054);
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(duplicateOutboxForeignKey),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const weakenedStageDeleteAction = migration0054.replace(
			'ALTER TABLE "approval_workflow_stage" ADD CONSTRAINT "approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;',
			'ALTER TABLE "approval_workflow_stage" ADD CONSTRAINT "approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;',
		);
		expect(weakenedStageDeleteAction).not.toBe(migration0054);
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(weakenedStageDeleteAction),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const missingStageForeignKey = migration0054.replace(
			'ALTER TABLE "approval_workflow_stage" ADD CONSTRAINT "approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint\n',
			"",
		);
		expect(missingStageForeignKey).not.toBe(migration0054);
		expect(
			foreignKeySetMismatches(
				parsedForeignKeys(missingStageForeignKey),
				approvalWorkflowForeignKeys,
			),
		).not.toEqual([]);

		const missingAbsenceOrganizationCheck = migration0054.replace(
			'ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_approval_workflow_organization_check" CHECK ("absence_entry"."approval_workflow_id" IS NULL OR "absence_entry"."organization_id" IS NOT NULL);',
			"",
		);
		expect(missingAbsenceOrganizationCheck).not.toBe(migration0054);
		expect(
			checkConstraintDefinitionMismatches(
				parsedCheckConstraints(missingAbsenceOrganizationCheck),
				approvalWorkflowCheckConstraints,
			),
		).toContain("absence_entry_approval_workflow_organization_check");

		const weakenedShiftRequestOrganizationCheck = migration0054.replace(
			'"shift_request"."approval_workflow_id" IS NULL OR "shift_request"."organization_id" IS NOT NULL',
			'"shift_request"."approval_workflow_id" IS NULL',
		);
		expect(weakenedShiftRequestOrganizationCheck).not.toBe(migration0054);
		expect(
			checkConstraintDefinitionMismatches(
				parsedCheckConstraints(weakenedShiftRequestOrganizationCheck),
				approvalWorkflowCheckConstraints,
			),
		).toContain("shift_request_approval_workflow_organization_check");

		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const workflowTable = snapshot.tables["public.approval_workflow"];
		const snapshotWithUnexpectedColumn: MigrationSnapshot = {
			...snapshot,
			tables: {
				...snapshot.tables,
				"public.approval_workflow": {
					...workflowTable,
					columns: {
						...workflowTable.columns,
						unexpected_column: {
							type: "text",
							notNull: false,
							primaryKey: false,
						},
					},
				},
			},
		};
		expect(
			snapshotColumnMismatches(snapshotWithUnexpectedColumn, {
				approval_workflow: canonicalApprovalSnapshotColumns.approval_workflow,
			}),
		).toContain("approval_workflow");

		const missingAssignmentContainment = migration0054.replace(
			'\tCONSTRAINT "approvalStageAssignment_workflow_stage_id_organizationId_idx" UNIQUE("workflow_id","stage_id","id","organization_id")\n',
			"",
		);
		expect(
			uniqueConstraintMismatches(missingAssignmentContainment, [
				{
					name: "approvalStageAssignment_workflow_stage_id_organizationId_idx",
					table: "approval_stage_assignment",
					columns: ["workflow_id", "stage_id", "id", "organization_id"],
				},
			]),
		).toContain("approvalStageAssignment_workflow_stage_id_organizationId_idx");

		const forbiddenFanoutUnique = `${migration0054}--> statement-breakpoint
CREATE UNIQUE INDEX "forbidden_delivery_fanout_idx" ON "approval_outbox_delivery" USING btree ("organization_id","outbox_id","channel");`;
		expect(
			deliveryFanoutUniqueIndexViolations(parsedIndexes(forbiddenFanoutUnique)),
		).toContain("forbidden_delivery_fanout_idx");

		const reorderedForbiddenFanoutUnique = `${migration0054}--> statement-breakpoint
CREATE UNIQUE INDEX "reordered_forbidden_delivery_fanout_idx" ON "approval_outbox_delivery" USING btree ("channel","organization_id","outbox_id");`;
		expect(
			deliveryFanoutUniqueIndexViolations(
				parsedIndexes(reorderedForbiddenFanoutUnique),
			),
		).toContain("reordered_forbidden_delivery_fanout_idx");

		const nonIdempotentDailyRecovery = migration0054.replace(
			'CREATE TABLE IF NOT EXISTS "daily_digest_delivery"',
			'CREATE TABLE "daily_digest_delivery"',
		);
		expect(dailyRecoveryViolations(nonIdempotentDailyRecovery)).not.toEqual([]);
		const separateDailyForeignKey = migration0054.replace(
			"-- daily digest recovery: end",
			`ALTER TABLE "daily_digest_delivery" ADD CONSTRAINT "duplicate_daily_digest_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- daily digest recovery: end`,
		);
		expect(separateDailyForeignKey).not.toBe(migration0054);
		expect(additiveMigrationViolations(separateDailyForeignKey)).toContain(
			"separate daily digest constraint",
		);
		expect(dailyRecoveryViolations(separateDailyForeignKey)).toContain(
			"separate daily digest constraint",
		);

		const missingInlineDailyForeignKey = migration0054.replace(
			'\tCONSTRAINT "daily_digest_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,\n',
			"",
		);
		expect(missingInlineDailyForeignKey).not.toBe(migration0054);
		expect(dailyRecoveryViolations(missingInlineDailyForeignKey)).not.toEqual(
			[],
		);
	});

	it("keeps 0004 limited to the follow-up auth alters", () => {
		expect(migration0004Statements).toEqual([
			'ALTER TABLE "sso_provider" ALTER COLUMN "user_id" SET NOT NULL;',
			'ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT true;',
		]);
	});

	it("registers the demo data feature flag migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0008_demo_data_feature_flag",
			),
		).toBe(true);
		expect(migration0008).toContain(
			'ADD COLUMN "demo_data_enabled" boolean DEFAULT true',
		);
		expect(
			migration0008Snapshot.tables["public.organization"].columns
				.demo_data_enabled?.default,
		).toBe(true);
	});

	it("registers the works council feature flag migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0032_works_council_feature_flag",
			),
		).toBe(true);
		expect(migration0032).toContain(
			'ADD COLUMN "works_council_enabled" boolean DEFAULT false',
		);
		expect(
			migration0032Snapshot.tables["public.organization"].columns
				.works_council_enabled?.default,
		).toBe(false);
	});

	it("creates composite uniqueness before migration 0014 composite foreign keys", () => {
		const employeeUniquePosition = migration0014.indexOf(
			'ADD CONSTRAINT "employee_id_organizationId_idx" UNIQUE("id","organization_id")',
		);
		const teamUniquePosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_id_organizationId_idx" UNIQUE("id","organization_id")',
		);
		const teamPrimaryManagerFkPosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_primary_manager_id_organization_id_employee_id_organization_id_fk"',
		);
		const teamMembershipTeamFkPosition = migration0014.indexOf(
			'ADD CONSTRAINT "team_membership_team_id_organization_id_team_id_organization_id_fk"',
		);

		expect(employeeUniquePosition).toBeGreaterThanOrEqual(0);
		expect(teamUniquePosition).toBeGreaterThanOrEqual(0);
		expect(employeeUniquePosition).toBeLessThan(teamPrimaryManagerFkPosition);
		expect(teamUniquePosition).toBeLessThan(teamMembershipTeamFkPosition);
	});

	it("registers the organization fiscal year start migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0019_regular_sandman",
			),
		).toBe(true);
		expect(migration0019.trim()).toBe(
			'ALTER TABLE "organization" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 1;',
		);
	});

	it("registers the fiscal year start column drop migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0020_drop_organization_fiscal_year",
			),
		).toBe(true);
		expect(existsSync(migration0020Url)).toBe(true);

		const migration0020 = readFileSync(migration0020Url, "utf8");

		expect(migration0020.trim()).toBe(
			'ALTER TABLE "organization" DROP COLUMN "fiscal_year_start_month";',
		);
	});

	it("registers the employee manager_id removal migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0026_remove_employee_manager_id",
			),
		).toBe(true);
		expect(existsSync(migration0026Url)).toBe(true);

		const migration0026 = readFileSync(migration0026Url, "utf8");
		const guardPosition = migration0026.indexOf("DO $$");
		const insertPosition = migration0026.indexOf(
			'INSERT INTO "employee_managers"',
		);
		const duplicateGuardPosition = migration0026.indexOf(
			"Duplicate employee manager assignments must be resolved before removing employee.manager_id",
		);
		const existingCrossOrganizationGuardPosition = migration0026.indexOf(
			"Cross-organization employee manager assignments must be resolved before removing employee.manager_id",
		);
		const primaryUpdatePosition = migration0026.indexOf(
			'UPDATE "employee_managers" AS "existing_assignment"',
		);
		const uniqueIndexPosition = migration0026.indexOf(
			'CREATE UNIQUE INDEX "employeeManagers_unique_idx"',
		);

		expect(guardPosition).toBeGreaterThanOrEqual(0);
		expect(guardPosition).toBeLessThan(insertPosition);
		expect(duplicateGuardPosition).toBeGreaterThanOrEqual(0);
		expect(duplicateGuardPosition).toBeLessThan(primaryUpdatePosition);
		expect(duplicateGuardPosition).toBeLessThan(uniqueIndexPosition);
		expect(existingCrossOrganizationGuardPosition).toBeGreaterThanOrEqual(0);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(insertPosition);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(
			primaryUpdatePosition,
		);
		expect(existingCrossOrganizationGuardPosition).toBeLessThan(
			uniqueIndexPosition,
		);
		expect(migration0026).toContain("RAISE EXCEPTION");
		expect(migration0026).toContain('GROUP BY "employee_id", "manager_id"');
		expect(migration0026).toContain("HAVING count(*) > 1");
		expect(migration0026).toContain('FROM "employee_managers" AS "em"');
		expect(migration0026).toContain('INNER JOIN "employee" AS "managed"');
		expect(migration0026).toContain('INNER JOIN "employee" AS "manager"');
		expect(migration0026).toContain(
			'"managed"."organization_id" <> "manager"."organization_id"',
		);
		expect(migration0026).toContain(
			'"manager"."organization_id" = "e"."organization_id"',
		);
		expect(migration0026).toContain('"manager"."id" IS NULL');
		expect(migration0026).toContain('"assigned_user"."id" IS NULL');
		expect(migration0026).toContain(
			'UPDATE "employee_managers" AS "existing_assignment"',
		);
		expect(migration0026).toContain('SET "is_primary" = true');
		expect(migration0026).toContain(
			'"existing_assignment"."is_primary" = false',
		);
		expect(migration0026).toContain(
			'DROP INDEX IF EXISTS "employeeManagers_unique_idx";',
		);
		expect(migration0026).toContain(
			'CREATE UNIQUE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");',
		);
		expect(migration0026).toContain('INSERT INTO "employee_managers"');
		expect(migration0026).toContain('FROM "employee" AS "e"');
		expect(migration0026).toContain('"e"."manager_id" IS NOT NULL');
		expect(migration0026).toContain("NOT EXISTS (");
		expect(migration0026).toContain('"existing_primary"."is_primary" = true');
		expect(migration0026).toContain('"e"."user_id"');
		expect(migration0026).toContain(
			'DROP INDEX IF EXISTS "employee_managerId_idx";',
		);
		expect(migration0026).toContain(
			'ALTER TABLE "employee" DROP COLUMN "manager_id";',
		);
	});

	it("keeps manual follow-up migrations journal-only when no snapshot was generated", () => {
		// Some existing hand-authored follow-up migrations are journaled without a snapshot.
		expect(existsSync(migration0003SnapshotUrl)).toBe(false);
		expect(existsSync(migration0026SnapshotUrl)).toBe(false);
	});

	it("includes snapshot metadata for the platform system email template migration", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0030_platform_system_email_template",
			),
		).toBe(true);
		expect(existsSync(migration0030SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(
			readFileSync(migration0030SnapshotUrl, "utf8"),
		) as {
			tables: Record<string, { columns: Record<string, unknown> }>;
		};

		expect(
			snapshot.tables["public.platform_system_email_template"]?.columns,
		).toEqual(
			expect.objectContaining({
				template_key: expect.objectContaining({ type: "text", notNull: true }),
				editor_document: expect.objectContaining({
					type: "jsonb",
					notNull: true,
				}),
			}),
		);
	});

	it("registers a later idempotent approval request metadata recovery migration", () => {
		const recoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0035_approval_request_metadata_recovery",
		);
		const recoveryEntry = migrationJournal.entries[recoveryIndex];
		const latestPriorWhen = Math.max(
			...migrationJournal.entries
				.slice(0, recoveryIndex)
				.map((entry) => entry.when),
		);

		expect(recoveryIndex).toBeGreaterThanOrEqual(0);
		expect(recoveryEntry?.when).toBeGreaterThan(latestPriorWhen);
		expect(existsSync(migration0035Url)).toBe(true);

		const migration0035 = readFileSync(migration0035Url, "utf8");

		expect(migration0035).toContain(
			'ADD COLUMN IF NOT EXISTS "metadata" jsonb',
		);
		expect(migration0035).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "approvalRequest_pending_entity_unique_idx"',
		);
	});

	it("registers the time entry timezone capture migration after approval metadata recovery", () => {
		const recoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0035_approval_request_metadata_recovery",
		);
		const timezoneCaptureIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0036_time_entry_timezone_capture",
		);

		expect(recoveryIndex).toBeGreaterThanOrEqual(0);
		expect(timezoneCaptureIndex).toBeGreaterThan(recoveryIndex);
	});

	it("infers historical time entry timezone capture without fixed location values", () => {
		expect(existsSync(migration0036Url)).toBe(true);

		const migration0036 = readFileSync(migration0036Url, "utf8");

		expect(migration0036).toContain(
			'ADD COLUMN IF NOT EXISTS "utc_offset_minutes" integer',
		);
		expect(migration0036).toContain('ADD COLUMN IF NOT EXISTS "timezone" text');
		expect(migration0036).toContain(
			'ADD COLUMN IF NOT EXISTS "timezone_source" text',
		);
		expect(migration0036).not.toContain('COALESCE("utc_offset_minutes", 120)');
		expect(migration0036).not.toContain(
			"COALESCE(\"timezone\", 'Europe/Berlin')",
		);
		expect(migration0036).toContain("pg_timezone_names");
		expect(migration0036).toContain("historical_inference");
		expect(migration0036).toContain(
			'"time_entry"."timestamp" AT TIME ZONE \'UTC\'',
		);
	});

	it("snapshots the time entry timezone capture columns", () => {
		expect(existsSync(migration0036SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(
			readFileSync(migration0036SnapshotUrl, "utf8"),
		) as {
			tables: Record<string, { columns: Record<string, unknown> }>;
		};

		expect(snapshot.tables["public.time_entry"]?.columns).toEqual(
			expect.objectContaining({
				utc_offset_minutes: expect.objectContaining({
					type: "integer",
					notNull: true,
				}),
				timezone: expect.objectContaining({ type: "text", notNull: false }),
				timezone_source: expect.objectContaining({
					type: "text",
					notNull: true,
				}),
			}),
		);
	});
	it("uses the holiday category primary key for category assignment foreign keys", () => {
		expect(existsSync(migration0037Url)).toBe(true);

		const migration0037 = readFileSync(migration0037Url, "utf8");

		expect(migration0037).toContain(
			'FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id")',
		);
		expect(migration0037).not.toContain(
			'FOREIGN KEY ("category_id", "organization_id") REFERENCES "public"."holiday_category"("id", "organization_id")',
		);
	});

	it("snapshots work policy preset ownership and partial unique indexes", () => {
		expect(
			migrationJournal.entries.some(
				(entry) => entry.tag === "0038_work_policy_preset_ownership",
			),
		).toBe(true);
		expect(existsSync(migration0038SnapshotUrl)).toBe(true);

		const snapshot = JSON.parse(
			readFileSync(migration0038SnapshotUrl, "utf8"),
		) as {
			tables: Record<
				string,
				{
					columns: Record<string, unknown>;
					indexes: Record<string, { isUnique?: boolean; where?: string }>;
				}
			>;
		};
		const presetTable = snapshot.tables["public.work_policy_preset"];

		expect(presetTable?.columns).toEqual(
			expect.objectContaining({
				organization_id: expect.objectContaining({
					type: "text",
					notNull: false,
				}),
			}),
		);
		expect(presetTable?.indexes.workPolicyPreset_system_name_idx).toEqual(
			expect.objectContaining({
				isUnique: true,
				where: '"organization_id" IS NULL',
			}),
		);
		expect(presetTable?.indexes.workPolicyPreset_org_name_idx).toEqual(
			expect.objectContaining({
				isUnique: true,
				where: '"organization_id" IS NOT NULL',
			}),
		);
	});

	it("keeps the 0048 payroll access scope migration unique and idempotent", () => {
		const migration0048Files = readdirSync(drizzleDirUrl).filter((fileName) =>
			fileName.startsWith("0048_"),
		);
		const migration0048Entries = migrationJournal.entries.filter((entry) =>
			entry.tag.startsWith("0048_"),
		);

		expect(migration0048Files).toEqual(["0048_payroll_access_scope.sql"]);
		expect(migration0048Entries.map((entry) => entry.tag)).toEqual([
			"0048_payroll_access_scope",
		]);
		expect(existsSync(migration0048Url)).toBe(true);

		const migration0048 = readFileSync(migration0048Url, "utf8");

		expect(migration0048).toContain('ADD COLUMN IF NOT EXISTS "scope" text');
		expect(migration0048).toContain(
			'ADD CONSTRAINT "payroll_access_grant_scope_check"',
		);
		expect(migration0048).toContain("WHEN duplicate_object THEN null");
		expect(migration0048).not.toContain("CREATE TABLE");
		expect(migration0048).not.toContain("ALTER TYPE");
	});

	it("registers a later idempotent sick detail recovery migration", () => {
		const recoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0051_sick_detail_recovery",
		);
		const recoveryEntry = migrationJournal.entries[recoveryIndex];
		const latestPriorWhen = Math.max(
			...migrationJournal.entries
				.slice(0, recoveryIndex)
				.map((entry) => entry.when),
		);

		expect(recoveryIndex).toBeGreaterThanOrEqual(0);
		expect(recoveryEntry?.when).toBeGreaterThan(latestPriorWhen);
		expect(existsSync(migration0051Url)).toBe(true);

		const migration0051 = readFileSync(migration0051Url, "utf8");
		expect(migration0051).toContain("WHEN duplicate_object THEN null");
		expect(migration0051).toContain(
			'ALTER TABLE "absence_entry" ADD COLUMN IF NOT EXISTS "sick_detail" "sick_detail";',
		);
	});

	it("registers a targeted historical timezone recovery after sick detail recovery", () => {
		const sickRecoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0051_sick_detail_recovery",
		);
		const timezoneRecoveryIndex = migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0052_time_entry_timezone_recovery",
		);
		const timezoneRecoveryEntry =
			migrationJournal.entries[timezoneRecoveryIndex];

		expect(timezoneRecoveryIndex).toBeGreaterThan(sickRecoveryIndex);
		expect(timezoneRecoveryEntry?.when).toBeGreaterThan(
			migrationJournal.entries[sickRecoveryIndex]?.when ?? 0,
		);
		expect(existsSync(migration0052Url)).toBe(true);

		const migration0052 = readFileSync(migration0052Url, "utf8");
		expect(migration0052).toContain("\"timezone_source\" = 'backfill'");
		expect(migration0052).toContain("\"timezone\" = 'Europe/Berlin'");
		expect(migration0052).toContain('"utc_offset_minutes" = 120');
		expect(migration0052).toContain(
			"\"created_at\" <= TIMESTAMP '2026-05-31 00:00:00'",
		);
		expect(migration0052).toContain("pg_timezone_names");
		expect(migration0052).toContain("historical_inference");
		expect(migration0052).toContain(
			'"time_entry"."timestamp" AT TIME ZONE \'UTC\'',
		);
	});

	it("registers coherent approval workflow expansion metadata after every prior migration", () => {
		const migration0054Files = readdirSync(drizzleDirUrl).filter((fileName) =>
			fileName.startsWith("0055_"),
		);
		const migration0054Entries = migrationJournal.entries.filter((entry) =>
			entry.tag.startsWith("0055_"),
		);
		const migration0054Entry = migration0054Entries[0];
		const priorEntries = migrationJournal.entries.filter(
			(entry) =>
				entry.idx < (migration0054Entry?.idx ?? Number.POSITIVE_INFINITY),
		);
		const latestPriorWhen = Math.max(
			...priorEntries.map((entry) => entry.when),
		);
		const latestPriorIndex = Math.max(
			...priorEntries.map((entry) => entry.idx),
		);

		expect(migration0054Files).toEqual(["0055_approval_workflow_expand.sql"]);
		expect(migration0054Entries.map((entry) => entry.tag)).toEqual([
			"0055_approval_workflow_expand",
		]);
		expect(migration0054Entry?.when).toBeGreaterThan(latestPriorWhen);
		expect(migration0054Entry?.when).toBeGreaterThan(1781096400000);
		expect(migration0054Entry?.idx).toBe(latestPriorIndex + 1);
		expect(existsSync(migration0054SnapshotUrl)).toBe(true);

		if (!existsSync(migration0054SnapshotUrl)) return;

		const previousSnapshot = JSON.parse(
			readFileSync(
				new URL("../../../drizzle/meta/0054_snapshot.json", import.meta.url),
				"utf8",
			),
		) as { id: string };
		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;

		// Approval expansion follows dev's employee invitation identity snapshot.
		expect(snapshot.prevId).toBe(previousSnapshot.id);
		for (const tableName of [
			"approval_workflow",
			"approval_workflow_stage",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_workflow_command",
			"approval_requester_projection",
			"approval_inbox_projection",
			"approval_outbox",
			"approval_outbox_delivery",
			"approval_workflow_rollout",
			"approval_workflow_migration_issue",
		]) {
			expect(snapshot.tables[`public.${tableName}`], tableName).toBeDefined();
		}

		for (const tableName of [
			"absence_entry",
			"work_period",
			"travel_expense_claim",
			"shift_request",
			"compliance_exception",
		]) {
			expect(
				snapshot.tables[`public.${tableName}`]?.columns.approval_workflow_id,
				`${tableName}.approval_workflow_id`,
			).toEqual(expect.objectContaining({ notNull: false }));
		}
		expect(
			snapshot.tables["public.shift_request"]?.columns.organization_id,
		).toEqual(expect.objectContaining({ notNull: false }));
		expect(
			snapshot.tables["public.shift_request"]?.columns.lifecycle_status,
		).toEqual(expect.objectContaining({ notNull: false }));
		expect(
			snapshot.tables["public.notification"]?.columns.idempotency_key,
		).toEqual(expect.objectContaining({ notNull: false }));
	});

	it("recovers the unjournaled daily digest schema idempotently before approval expansion", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);
		const recoveryStart = migration0054.indexOf(
			"-- daily digest recovery: begin",
		);
		const recoveryEnd = migration0054.indexOf("-- daily digest recovery: end");
		const firstApprovalEnum = migration0054.indexOf(
			'CREATE TYPE "public"."approval_actor_kind"',
		);
		const recovery = migration0054.slice(recoveryStart, recoveryEnd);
		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const recoveryStatements = migrationStatements(recovery);
		const tableStatement = recoveryStatements.find((statement) =>
			statement.startsWith(
				'CREATE TABLE IF NOT EXISTS "daily_digest_delivery"',
			),
		);

		expect(dailyRecoveryViolations(migration0054)).toEqual([]);
		expect(recoveryStart).toBe(0);
		expect(recoveryEnd).toBeGreaterThan(recoveryStart);
		expect(recoveryEnd).toBeLessThan(firstApprovalEnum);
		expect(tableStatement).toContain(
			'CONSTRAINT "daily_digest_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action',
		);
		expect(tableStatement).toContain(
			'CONSTRAINT "daily_digest_delivery_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action',
		);
		expect(tableStatement).toContain(
			"CONSTRAINT \"daily_digest_delivery_status_check\" CHECK (\"status\" IN ('processing', 'sent', 'failed'))",
		);
		expect(recovery).not.toContain('ALTER TABLE "daily_digest_delivery"');
		expect(recovery).not.toContain("DO $$");
		expect(recoveryStatements).toHaveLength(3);
		expect(recovery).toContain(
			'CREATE UNIQUE INDEX IF NOT EXISTS "dailyDigestDelivery_recipient_date_unique_idx"',
		);
		expect(recovery).toContain(
			'CREATE INDEX IF NOT EXISTS "dailyDigestDelivery_organization_status_idx"',
		);
		expect(
			migration0054.match(
				/CREATE TABLE IF NOT EXISTS "daily_digest_delivery"/g,
			),
		).toHaveLength(1);
		expect(
			snapshot.tables["public.daily_digest_delivery"].checkConstraints
				.daily_digest_delivery_status_check?.value,
		).toBe(
			`"daily_digest_delivery"."status" IN ('processing', 'sent', 'failed')`,
		);
		expect(
			Object.keys(
				snapshot.tables["public.daily_digest_delivery"].foreignKeys,
			).sort(),
		).toEqual([
			"daily_digest_delivery_organization_id_fkey",
			"daily_digest_delivery_recipient_user_id_fkey",
		]);
		expect(
			snapshot.tables["public.daily_digest_delivery"].foreignKeys,
		).toMatchObject({
			daily_digest_delivery_organization_id_fkey: {
				name: "daily_digest_delivery_organization_id_fkey",
				columnsFrom: ["organization_id"],
				tableTo: "organization",
				columnsTo: ["id"],
				onDelete: "cascade",
				onUpdate: "no action",
			},
			daily_digest_delivery_recipient_user_id_fkey: {
				name: "daily_digest_delivery_recipient_user_id_fkey",
				columnsFrom: ["recipient_user_id"],
				tableTo: "user",
				columnsTo: ["id"],
				onDelete: "cascade",
				onUpdate: "no action",
			},
		});
	});

	it("preserves journaled Telegram delivery metadata without recreating it in 0055", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);
		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const telegramTable = snapshot.tables["public.telegram_digest_delivery"];

		expect(telegramTable.columns.updated_at?.default).toBe("now()");
		expect(
			telegramTable.checkConstraints.telegram_digest_delivery_status_check
				?.value,
		).toBe(
			`"telegram_digest_delivery"."status" IN ('sending', 'sent', 'failed')`,
		);
		expect(migration0054).not.toMatch(
			/(?:CREATE|ALTER) TABLE "telegram_digest_delivery"/,
		);
	});

	it("preserves deployed 0050 employee invitation metadata without replaying it", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);
		const snapshot0050 = JSON.parse(
			readFileSync(
				new URL("../../../drizzle/meta/0050_snapshot.json", import.meta.url),
				"utf8",
			),
		) as MigrationSnapshot;
		const snapshot0054 = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const deployedInvitation = snapshot0050.tables["public.invitation"];
		const latestInvitation = snapshot0054.tables["public.invitation"];
		const deployedDraft =
			snapshot0050.tables["public.employee_invitation_draft"];
		const latestDraft = snapshot0054.tables["public.employee_invitation_draft"];

		expect(latestDraft.columns.updated_at?.default).toBe("now()");
		expect(latestInvitation.indexes.invitation_id_organization_id_idx).toEqual(
			deployedInvitation.indexes.invitation_id_organization_id_idx,
		);
		for (const foreignKeyName of [
			"employee_invitation_draft_invitation_org_fk",
			"employee_invitation_draft_team_org_fk",
		]) {
			expect(latestDraft.foreignKeys[foreignKeyName], foreignKeyName).toEqual(
				deployedDraft.foreignKeys[foreignKeyName],
			);
		}
		expect(migration0054).not.toMatch(
			/(?:employee_invitation_draft|invitation_id_organization_id_idx)/,
		);
	});

	it("matches canonical enum values and table columns in SQL and snapshot", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);
		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const sqlEnums = parsedEnums(migration0054);
		const sqlTables = parsedTables(migration0054);

		expect([...sqlEnums.keys()].sort()).toEqual(
			approvalWorkflowEnums.map(({ name }) => name).sort(),
		);
		expect(enumMismatches(migration0054, approvalWorkflowEnums)).toEqual([]);
		for (const expectedEnum of approvalWorkflowEnums) {
			expect(
				snapshot.enums[`public.${expectedEnum.name}`]?.values,
				expectedEnum.name,
			).toEqual(expectedEnum.values);
		}

		expect([...sqlTables.keys()].sort()).toEqual(
			Object.keys(canonicalApprovalTableColumns).sort(),
		);
		expect(
			tableColumnMismatches(migration0054, canonicalApprovalTableColumns),
		).toEqual([]);
		expect(
			snapshotColumnMismatches(snapshot, canonicalApprovalSnapshotColumns),
		).toEqual([]);
		expect(
			sqlColumnDefinitionMismatches(
				migration0054,
				canonicalApprovalSnapshotColumns,
			),
		).toEqual([]);
	});

	it("matches canonical composite constraints, foreign keys, and indexes in SQL and snapshot", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);
		const snapshot = JSON.parse(
			readFileSync(migration0054SnapshotUrl, "utf8"),
		) as MigrationSnapshot;
		const migrationForeignKeys = parsedForeignKeys(migration0054);
		const migrationCheckConstraints = parsedCheckConstraints(migration0054);

		expect(
			uniqueConstraintMismatches(
				migration0054,
				approvalWorkflowUniqueConstraints,
			),
		).toEqual([]);
		expect(indexMismatches(migration0054, approvalWorkflowIndexes)).toEqual([]);
		expect(approvalWorkflowForeignKeys).toHaveLength(38);
		expect(migrationForeignKeys).toHaveLength(38);
		expect(
			foreignKeySetMismatches(
				migrationForeignKeys,
				approvalWorkflowForeignKeys,
			),
		).toEqual([]);
		expect(foreignKeyTargetIdentityOrderViolations(migration0054)).toEqual([]);
		expect(migrationCheckConstraints).toHaveLength(2);
		expect(
			checkConstraintDefinitionMismatches(
				migrationCheckConstraints,
				approvalWorkflowCheckConstraints,
			),
		).toEqual([]);

		expect(
			uniqueConstraintDefinitionMismatches(
				snapshotUniqueConstraints(snapshot),
				approvalWorkflowUniqueConstraints,
			),
		).toEqual([]);
		expect(
			checkConstraintDefinitionMismatches(
				snapshotCheckConstraints(snapshot),
				approvalWorkflowCheckConstraints,
			),
		).toEqual([]);
		expect(
			indexDefinitionMismatches(
				snapshotIndexes(snapshot),
				approvalWorkflowIndexes,
			),
		).toEqual([]);
		expect(
			foreignKeyDefinitionMismatches(
				snapshotForeignKeys(snapshot),
				approvalWorkflowForeignKeys,
			),
		).toEqual([]);

		for (const indexes of [
			parsedIndexes(migration0054),
			snapshotIndexes(snapshot),
		]) {
			expect(deliveryFanoutUniqueIndexViolations(indexes)).toEqual([]);
		}
	});

	it("keeps the approval workflow expansion additive and organization-scoped", () => {
		const migration0054 = readRequiredMigration(
			migration0054Url,
			"0055 approval workflow expansion migration",
		);

		for (const [tableName, columnName] of [
			["absence_entry", "approval_workflow_id"],
			["work_period", "approval_workflow_id"],
			["travel_expense_claim", "approval_workflow_id"],
			["shift_request", "organization_id"],
			["shift_request", "lifecycle_status"],
			["shift_request", "approval_workflow_id"],
			["compliance_exception", "approval_workflow_id"],
			["notification", "idempotency_key"],
		] as const) {
			const addColumnPattern = new RegExp(
				`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}"[^;]*;`,
			);
			const statement = migration0054.match(addColumnPattern)?.[0];
			expect(statement, `${tableName}.${columnName}`).toBeDefined();
			expect(
				statement,
				`${tableName}.${columnName} must remain nullable`,
			).not.toMatch(/\bNOT NULL\b/i);
		}

		const firstTablePosition = migration0054.indexOf(
			'CREATE TABLE "approval_inbox_projection"',
		);
		const lastEnumPosition = migration0054.lastIndexOf("CREATE TYPE");
		const firstForeignKeyPosition = migration0054.indexOf(
			'ALTER TABLE "approval_inbox_projection" ADD CONSTRAINT',
		);
		expect(lastEnumPosition).toBeLessThan(firstTablePosition);
		expect(firstForeignKeyPosition).toBeGreaterThan(
			migration0054.lastIndexOf('CREATE TABLE "approval_workflow_stage"'),
		);

		const constraintNamesByTable = new Map<string, string[]>();
		for (const match of migration0054.matchAll(
			/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/g,
		)) {
			const names = constraintNamesByTable.get(match[1]) ?? [];
			names.push(match[2].slice(0, 63));
			constraintNamesByTable.set(match[1], names);
		}
		for (const [tableName, names] of constraintNamesByTable) {
			expect(new Set(names).size, `${tableName} constraint names`).toBe(
				names.length,
			);
		}

		const generatedIndexNames = Array.from(
			migration0054.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g),
			(match) => match[1].slice(0, 63),
		);
		expect(new Set(generatedIndexNames).size).toBe(generatedIndexNames.length);
		expect(additiveMigrationViolations(migration0054)).toEqual([]);
		expect(migration0054).not.toContain('CREATE TABLE "daily_digest_delivery"');
		expect(migration0054).not.toContain(
			'CREATE TABLE "telegram_digest_delivery"',
		);
	});

	it("deterministically repairs employee invitation draft identity", () => {
		expect(existsSync(migration0054InvitationDraftIdentityUrl)).toBe(true);

		const migration0054 = readFileSync(
			migration0054InvitationDraftIdentityUrl,
			"utf8",
		);
		const addColumnPosition = migration0054.indexOf(
			'ADD COLUMN IF NOT EXISTS "normalized_email" text',
		);
		const addPermissionColumnPosition = migration0054.indexOf(
			'ADD COLUMN IF NOT EXISTS "can_create_organizations" boolean DEFAULT false NOT NULL',
		);
		const permissionBackfillPosition = migration0054.indexOf(
			'UPDATE "employee_invitation_draft" AS "draft"\nSET "can_create_organizations"',
		);
		const permissionBackfillEnd = migration0054.indexOf(
			"--> statement-breakpoint",
			permissionBackfillPosition,
		);
		const permissionBackfill = migration0054.slice(
			permissionBackfillPosition,
			permissionBackfillEnd,
		);
		const backfillPosition = migration0054.indexOf(
			'UPDATE "employee_invitation_draft" AS "draft"',
		);
		const employeeDeletePosition = migration0054.indexOf(
			'DELETE FROM "employee_invitation_draft" AS "draft"\nUSING "employee"',
		);
		const inactiveDeletePosition = migration0054.indexOf(
			'DELETE FROM "employee_invitation_draft" AS "draft"\nWHERE NOT EXISTS',
		);
		const repairTablePosition = migration0054.indexOf(
			'CREATE TEMP TABLE "employee_invitation_draft_identity_repair"',
		);
		const duplicateDeletePosition = migration0054.indexOf(
			'DELETE FROM "employee_invitation_draft" AS "draft"\nUSING "employee_invitation_draft_identity_repair"',
		);
		const relinkPosition = migration0054.indexOf(
			'UPDATE "employee_invitation_draft" AS "draft"\nSET "invitation_id"',
		);
		const notNullPosition = migration0054.indexOf(
			'ALTER COLUMN "normalized_email" SET NOT NULL',
		);
		const uniqueIndexPosition = migration0054.indexOf(
			'CREATE UNIQUE INDEX IF NOT EXISTS "employeeInvitationDraft_organizationNormalizedEmail_unique_idx"',
		);

		const repairPhasePositions = [
			addColumnPosition,
			addPermissionColumnPosition,
			permissionBackfillPosition,
			backfillPosition,
			employeeDeletePosition,
			inactiveDeletePosition,
			repairTablePosition,
			duplicateDeletePosition,
			relinkPosition,
			notNullPosition,
			uniqueIndexPosition,
		];

		expect(Math.min(...repairPhasePositions)).toBeGreaterThanOrEqual(0);
		expect(addColumnPosition).toBeLessThan(backfillPosition);
		expect(addPermissionColumnPosition).toBeLessThan(
			permissionBackfillPosition,
		);
		expect(permissionBackfillPosition).toBeLessThan(repairTablePosition);
		expect(permissionBackfillPosition).toBeLessThan(duplicateDeletePosition);
		expect(permissionBackfillPosition).toBeLessThan(relinkPosition);
		expect(permissionBackfill).toContain(
			'SET "can_create_organizations" = COALESCE("invitation"."can_create_organizations", false)',
		);
		expect(permissionBackfill).toContain('FROM "invitation" AS "invitation"');
		expect(permissionBackfill).toContain(
			'WHERE "invitation"."id" = "draft"."invitation_id"',
		);
		expect(permissionBackfill).toContain(
			'AND "invitation"."organization_id" = "draft"."organization_id"',
		);
		expect(backfillPosition).toBeLessThan(employeeDeletePosition);
		expect(employeeDeletePosition).toBeLessThan(inactiveDeletePosition);
		expect(inactiveDeletePosition).toBeLessThan(repairTablePosition);
		expect(repairTablePosition).toBeLessThan(duplicateDeletePosition);
		expect(duplicateDeletePosition).toBeLessThan(relinkPosition);
		expect(relinkPosition).toBeLessThan(notNullPosition);
		expect(notNullPosition).toBeLessThan(uniqueIndexPosition);
		expect(migration0054).toContain('lower(btrim("invitation"."email"))');
		expect(migration0054).toContain(
			'"invitation"."organization_id" = "draft"."organization_id"',
		);
		expect(migration0054).toContain(
			'lower(btrim("user"."email")) = "draft"."normalized_email"',
		);
		expect(migration0054).toContain(
			'"employee"."organization_id" = "draft"."organization_id"',
		);
		expect(migration0054).toContain('"invitation"."status" = \'pending\'');
		expect(migration0054).toContain(
			'"invitation"."expires_at" > CURRENT_TIMESTAMP',
		);
		expect(migration0054).toContain(
			'PARTITION BY "draft"."organization_id", "draft"."normalized_email"\n\t\t\tORDER BY "draft"."updated_at" DESC, "draft"."created_at" DESC, "draft"."id" DESC',
		);
		expect(migration0054).toContain(
			'PARTITION BY "invitation"."organization_id", lower(btrim("invitation"."email"))\n\t\t\tORDER BY "invitation"."created_at" DESC, "invitation"."id" DESC',
		);
		expect(migration0054).not.toContain('CREATE TABLE "daily_digest_delivery"');
		expect(migration0054).not.toContain(
			'CREATE TABLE "telegram_digest_delivery"',
		);
		expect(migration0054).not.toContain("DROP CONSTRAINT");
	});

	it("serializes every employee writer by organization and normalized user email", () => {
		const migration0054 = readFileSync(
			migration0054InvitationDraftIdentityUrl,
			"utf8",
		);
		const replaceFunctionPosition = migration0054.indexOf(
			'CREATE OR REPLACE FUNCTION "employee_identity_advisory_lock"()',
		);
		const dropTriggerPosition = migration0054.indexOf(
			'DROP TRIGGER IF EXISTS "employee_identity_advisory_lock_trigger" ON "employee"',
		);
		const createTriggerPosition = migration0054.indexOf(
			'CREATE TRIGGER "employee_identity_advisory_lock_trigger"',
		);

		expect(replaceFunctionPosition).toBeGreaterThanOrEqual(0);
		expect(dropTriggerPosition).toBeGreaterThan(replaceFunctionPosition);
		expect(createTriggerPosition).toBeGreaterThan(dropTriggerPosition);
		expect(migration0054).toContain(
			'SELECT lower(btrim("user"."email"))\n\tINTO normalized_email',
		);
		expect(migration0054).toContain('WHERE "user"."id" = NEW.user_id');
		expect(migration0054).toContain("IF normalized_email IS NULL THEN");
		expect(migration0054).toContain("RAISE EXCEPTION");
		expect(migration0054).toContain(
			"pg_advisory_xact_lock(hashtextextended(jsonb_build_array(NEW.organization_id, normalized_email)::text, 0))",
		);
		expect(migration0054).toContain(
			'BEFORE INSERT OR UPDATE OF "user_id", "organization_id" ON "employee"',
		);
		expect(migration0054).toContain(
			'FOR EACH ROW EXECUTE FUNCTION "employee_identity_advisory_lock"()',
		);
	});
});
