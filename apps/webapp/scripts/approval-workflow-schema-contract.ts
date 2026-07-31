import { sql } from "drizzle-orm";
import type { ApprovalTransactionClient } from "@/lib/approvals/workflow/ports";

const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

export function toPostgresIdentifier(value: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= POSTGRES_IDENTIFIER_MAX_BYTES)
		return value;

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

export function assertPhysicalForeignKeyNames(
	foreignKeys: readonly { table: string; name: string }[],
): void {
	const encoder = new TextEncoder();
	const identities = new Set<string>();
	for (const foreignKey of foreignKeys) {
		if (
			encoder.encode(foreignKey.name).length > POSTGRES_IDENTIFIER_MAX_BYTES
		) {
			throw new Error(
				`Physical foreign key name exceeds ${POSTGRES_IDENTIFIER_MAX_BYTES} bytes: ${foreignKey.name}`,
			);
		}
		const identity = `${foreignKey.table}\0${foreignKey.name}`;
		if (identities.has(identity)) {
			throw new Error(
				`Physical foreign key name collision on ${foreignKey.table}: ${foreignKey.name}`,
			);
		}
		identities.add(identity);
	}
}

export interface ApprovalCatalogColumn {
	table: string;
	name: string;
	type: string;
	notNull: boolean;
	default: string | null;
}

export interface ApprovalCatalogForeignKey {
	name: string;
	sourceSchema: string;
	table: string;
	columns: string[];
	foreignTable: string;
	foreignSchema: string;
	foreignColumns: string[];
	onDelete: "cascade" | "no action" | "restrict" | "set null" | "set default";
	onUpdate: "cascade" | "no action" | "restrict" | "set null" | "set default";
}

export interface ApprovalCatalogIndex {
	table: string;
	name: string;
	unique: boolean;
	primary: boolean;
	columns: string[];
	predicate: string | null;
}

export interface ApprovalCatalogCheck {
	table: string;
	name: string;
	definition: string;
}

export interface ApprovalExpansionCatalog {
	tables: string[];
	operationalTables: string[];
	sourceTables: string[];
	enums: Record<string, string[]>;
	columns: ApprovalCatalogColumn[];
	foreignKeys: ApprovalCatalogForeignKey[];
	indexes: ApprovalCatalogIndex[];
	checks: ApprovalCatalogCheck[];
}

export interface ApprovalExpansionContract {
	tables: readonly string[];
	operationalTables: readonly string[];
	sourceTables: readonly string[];
	relations: readonly {
		name: string;
		mode: "full" | "required_subset";
	}[];
	enums: Readonly<Record<string, readonly string[]>>;
	columns: readonly ApprovalCatalogColumn[];
	foreignKeys: readonly ApprovalCatalogForeignKey[];
	indexes: readonly ApprovalCatalogIndex[];
	checks: readonly ApprovalCatalogCheck[];
}

const tables = [
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
] as const;

const operationalTables = ["audit_log"] as const;

const sourceTables = [
	"absence_entry",
	"work_period",
	"travel_expense_claim",
	"shift_request",
	"compliance_exception",
	"notification",
	"shift",
] as const;

const relations = [
	...tables.map((name) => ({ name, mode: "full" as const })),
	...operationalTables.map((name) => ({ name, mode: "full" as const })),
	...sourceTables.map((name) => ({ name, mode: "required_subset" as const })),
] as const;

const enums = {
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

function column(
	table: string,
	name: string,
	type: string,
	notNull = true,
	defaultExpression: string | null = null,
): ApprovalCatalogColumn {
	return { table, name, type, notNull, default: defaultExpression };
}

const columns = [
	column("approval_workflow", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_workflow", "organization_id", "text"),
	column("approval_workflow", "workflow_type", "approval_workflow_type"),
	column("approval_workflow", "source_type", "text"),
	column("approval_workflow", "source_id", "uuid"),
	column("approval_workflow", "requester_employee_id", "uuid", false),
	column(
		"approval_workflow",
		"status",
		"approval_workflow_status",
		true,
		"'pending'::approval_workflow_status",
	),
	column("approval_workflow", "current_stage_order", "integer", false),
	column("approval_workflow", "version", "integer", true, "1"),
	column("approval_workflow", "policy_snapshot", "jsonb"),
	column("approval_workflow", "context_snapshot", "jsonb"),
	column("approval_workflow", "display_snapshot", "jsonb"),
	column(
		"approval_workflow",
		"submitted_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_workflow",
		"completed_at",
		"timestamp with time zone",
		false,
	),
	column(
		"approval_workflow",
		"cancelled_at",
		"timestamp with time zone",
		false,
	),
	column("approval_workflow", "decision_reason", "text", false),
	column(
		"approval_workflow",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_workflow", "updated_at", "timestamp with time zone"),

	column("approval_workflow_stage", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_workflow_stage", "organization_id", "text"),
	column("approval_workflow_stage", "workflow_id", "uuid"),
	column("approval_workflow_stage", "stage_order", "integer"),
	column("approval_workflow_stage", "label", "text"),
	column("approval_workflow_stage", "resolver_snapshot", "jsonb"),
	column("approval_workflow_stage", "activation_mode", "text"),
	column(
		"approval_workflow_stage",
		"status",
		"approval_stage_status",
		true,
		"'waiting'::approval_stage_status",
	),
	column(
		"approval_workflow_stage",
		"activated_at",
		"timestamp with time zone",
		false,
	),
	column(
		"approval_workflow_stage",
		"decided_at",
		"timestamp with time zone",
		false,
	),
	column("approval_workflow_stage", "decision_reason", "text", false),
	column(
		"approval_workflow_stage",
		"legacy_approval_request_id",
		"uuid",
		false,
	),
	column(
		"approval_workflow_stage",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_workflow_stage", "updated_at", "timestamp with time zone"),

	column("approval_stage_assignment", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_stage_assignment", "organization_id", "text"),
	column("approval_stage_assignment", "workflow_id", "uuid"),
	column("approval_stage_assignment", "stage_id", "uuid"),
	column("approval_stage_assignment", "assignment_sequence", "integer"),
	column("approval_stage_assignment", "approver_employee_id", "uuid"),
	column(
		"approval_stage_assignment",
		"status",
		"approval_assignment_status",
		true,
		"'pending'::approval_assignment_status",
	),
	column(
		"approval_stage_assignment",
		"assigned_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_stage_assignment",
		"resolved_at",
		"timestamp with time zone",
		false,
	),
	column(
		"approval_stage_assignment",
		"resolved_by_actor_kind",
		"approval_actor_kind",
		false,
	),
	column("approval_stage_assignment", "resolved_by_actor_id", "uuid", false),
	column(
		"approval_stage_assignment",
		"reassigned_by_employee_id",
		"uuid",
		false,
	),
	column(
		"approval_stage_assignment",
		"reassigned_from_assignment_id",
		"uuid",
		false,
	),
	column("approval_stage_assignment", "reassignment_metadata", "jsonb", false),
	column(
		"approval_stage_assignment",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_stage_assignment", "updated_at", "timestamp with time zone"),

	column("approval_workflow_event", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_workflow_event", "organization_id", "text"),
	column("approval_workflow_event", "workflow_id", "uuid"),
	column("approval_workflow_event", "version", "integer"),
	column("approval_workflow_event", "event_index", "integer"),
	column("approval_workflow_event", "event_type", "text"),
	column("approval_workflow_event", "actor_kind", "approval_actor_kind"),
	column("approval_workflow_event", "actor_employee_id", "uuid", false),
	column("approval_workflow_event", "actor_user_id", "text", false),
	column("approval_workflow_event", "previous_state", "jsonb", false),
	column("approval_workflow_event", "resulting_state", "jsonb"),
	column("approval_workflow_event", "reason", "text", false),
	column("approval_workflow_event", "metadata", "jsonb", false),
	column("approval_workflow_event", "idempotency_key", "text", false),
	column(
		"approval_workflow_event",
		"occurred_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_workflow_event",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),

	column("approval_workflow_command", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_workflow_command", "organization_id", "text"),
	column("approval_workflow_command", "workflow_id", "uuid"),
	column("approval_workflow_command", "idempotency_key", "text"),
	column("approval_workflow_command", "actor_fingerprint", "text"),
	column("approval_workflow_command", "command_fingerprint", "text"),
	column(
		"approval_workflow_command",
		"state",
		"approval_command_state",
		true,
		"'reserved'::approval_command_state",
	),
	column("approval_workflow_command", "result", "jsonb", false),
	column(
		"approval_workflow_command",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_workflow_command", "updated_at", "timestamp with time zone"),

	column(
		"approval_requester_projection",
		"id",
		"uuid",
		true,
		"gen_random_uuid()",
	),
	column("approval_requester_projection", "organization_id", "text"),
	column("approval_requester_projection", "workflow_id", "uuid"),
	column(
		"approval_requester_projection",
		"requester_employee_id",
		"uuid",
		false,
	),
	column("approval_requester_projection", "source_type", "text"),
	column("approval_requester_projection", "source_id", "uuid"),
	column("approval_requester_projection", "status", "approval_workflow_status"),
	column(
		"approval_requester_projection",
		"current_stage_order",
		"integer",
		false,
	),
	column("approval_requester_projection", "display_payload", "jsonb"),
	column("approval_requester_projection", "search_text", "text"),
	column(
		"approval_requester_projection",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_requester_projection",
		"updated_at",
		"timestamp with time zone",
	),

	column("approval_inbox_projection", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_inbox_projection", "organization_id", "text"),
	column("approval_inbox_projection", "workflow_id", "uuid"),
	column("approval_inbox_projection", "active_stage_id", "uuid"),
	column("approval_inbox_projection", "source_type", "text"),
	column("approval_inbox_projection", "source_id", "uuid"),
	column("approval_inbox_projection", "status", "approval_workflow_status"),
	column("approval_inbox_projection", "display_payload", "jsonb"),
	column("approval_inbox_projection", "search_text", "text"),
	column(
		"approval_inbox_projection",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_inbox_projection", "updated_at", "timestamp with time zone"),

	column("approval_outbox", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_outbox", "organization_id", "text"),
	column("approval_outbox", "workflow_id", "uuid"),
	column("approval_outbox", "event_id", "uuid"),
	column("approval_outbox", "event_type", "text"),
	column("approval_outbox", "dedupe_key", "text"),
	column("approval_outbox", "payload", "jsonb"),
	column("approval_outbox", "disposition", "approval_outbox_disposition"),
	column(
		"approval_outbox",
		"expansion_status",
		"approval_outbox_expansion_status",
		true,
		"'pending'::approval_outbox_expansion_status",
	),
	column("approval_outbox", "expanded_at", "timestamp with time zone", false),
	column(
		"approval_outbox",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),

	column("approval_outbox_delivery", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_outbox_delivery", "organization_id", "text"),
	column("approval_outbox_delivery", "outbox_id", "uuid"),
	column("approval_outbox_delivery", "dedupe_key", "text"),
	column(
		"approval_outbox_delivery",
		"disposition",
		"approval_outbox_disposition",
	),
	column(
		"approval_outbox_delivery",
		"status",
		"approval_outbox_status",
		true,
		"'pending'::approval_outbox_status",
	),
	column("approval_outbox_delivery", "channel", "approval_outbox_channel"),
	column("approval_outbox_delivery", "recipient_kind", "text"),
	column("approval_outbox_delivery", "recipient_employee_id", "uuid", false),
	column("approval_outbox_delivery", "recipient_address", "text", false),
	column(
		"approval_outbox_delivery",
		"available_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_outbox_delivery",
		"claimed_at",
		"timestamp with time zone",
		false,
	),
	column("approval_outbox_delivery", "claim_token", "text", false),
	column("approval_outbox_delivery", "retry_count", "integer", true, "0"),
	column("approval_outbox_delivery", "attempt_count", "integer", true, "0"),
	column(
		"approval_outbox_delivery",
		"processed_at",
		"timestamp with time zone",
		false,
	),
	column("approval_outbox_delivery", "last_error", "text", false),
	column(
		"approval_outbox_delivery",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_outbox_delivery", "updated_at", "timestamp with time zone"),

	column("approval_workflow_rollout", "id", "uuid", true, "gen_random_uuid()"),
	column("approval_workflow_rollout", "organization_id", "text"),
	column(
		"approval_workflow_rollout",
		"workflow_type",
		"approval_workflow_type",
	),
	column(
		"approval_workflow_rollout",
		"lifecycle_mode",
		"approval_workflow_lifecycle_mode",
		true,
		"'legacy'::approval_workflow_lifecycle_mode",
	),
	column(
		"approval_workflow_rollout",
		"side_effect_mode",
		"approval_side_effect_mode",
		true,
		"'legacy'::approval_side_effect_mode",
	),
	column(
		"approval_workflow_rollout",
		"backfilled_through",
		"timestamp with time zone",
		false,
	),
	column("approval_workflow_rollout", "mismatch_count", "integer", true, "0"),
	column(
		"approval_workflow_rollout",
		"last_reconciled_at",
		"timestamp with time zone",
		false,
	),
	column(
		"approval_workflow_rollout",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column("approval_workflow_rollout", "updated_at", "timestamp with time zone"),

	column(
		"approval_workflow_migration_issue",
		"id",
		"uuid",
		true,
		"gen_random_uuid()",
	),
	column("approval_workflow_migration_issue", "organization_id", "text"),
	column("approval_workflow_migration_issue", "workflow_id", "uuid", false),
	column(
		"approval_workflow_migration_issue",
		"workflow_type",
		"approval_workflow_type",
	),
	column("approval_workflow_migration_issue", "legacy_type", "text", false),
	column("approval_workflow_migration_issue", "legacy_id", "uuid", false),
	column("approval_workflow_migration_issue", "source_type", "text"),
	column("approval_workflow_migration_issue", "source_id", "uuid"),
	column("approval_workflow_migration_issue", "issue_code", "text"),
	column("approval_workflow_migration_issue", "evidence", "jsonb"),
	column(
		"approval_workflow_migration_issue",
		"disposition",
		"text",
		true,
		"'open'::text",
	),
	column(
		"approval_workflow_migration_issue",
		"operator_user_id",
		"text",
		false,
	),
	column(
		"approval_workflow_migration_issue",
		"disposed_at",
		"timestamp with time zone",
		false,
	),
	column(
		"approval_workflow_migration_issue",
		"created_at",
		"timestamp with time zone",
		true,
		"now()",
	),
	column(
		"approval_workflow_migration_issue",
		"updated_at",
		"timestamp with time zone",
	),

	column("audit_log", "id", "uuid", true, "gen_random_uuid()"),
	column("audit_log", "organization_id", "text"),
	column("audit_log", "entity_type", "text"),
	column("audit_log", "entity_id", "uuid"),
	column("audit_log", "action", "text"),
	column("audit_log", "performed_by", "text"),
	column("audit_log", "employee_id", "uuid", false),
	column("audit_log", "changes", "text", false),
	column("audit_log", "metadata", "text", false),
	column("audit_log", "ip_address", "text", false),
	column("audit_log", "user_agent", "text", false),
	column(
		"audit_log",
		"timestamp",
		"timestamp without time zone",
		true,
		"now()",
	),

	column("absence_entry", "organization_id", "text", false),
	column("absence_entry", "approval_workflow_id", "uuid", false),
	column("work_period", "organization_id", "text"),
	column("work_period", "approval_workflow_id", "uuid", false),
	column("travel_expense_claim", "organization_id", "text"),
	column("travel_expense_claim", "approval_workflow_id", "uuid", false),
	column("shift_request", "organization_id", "text", false),
	column("shift_request", "shift_id", "uuid"),
	column("shift_request", "lifecycle_status", "shift_request_status", false),
	column("shift_request", "approval_workflow_id", "uuid", false),
	column("compliance_exception", "organization_id", "text"),
	column("compliance_exception", "approval_workflow_id", "uuid", false),
	column("notification", "organization_id", "text"),
	column("notification", "idempotency_key", "text", false),
	column("shift", "organization_id", "text"),
	column("shift", "id", "uuid", true, "gen_random_uuid()"),
] as const;

function foreignKey(
	table: string,
	columns: string[],
	foreignTable: string,
	foreignColumns: string[],
	onDelete: ApprovalCatalogForeignKey["onDelete"] = "no action",
	onUpdate: ApprovalCatalogForeignKey["onUpdate"] = "no action",
): ApprovalCatalogForeignKey {
	const logicalName = [
		table,
		...columns,
		foreignTable,
		...foreignColumns,
		"fk",
	].join("_");
	return {
		name: toPostgresIdentifier(logicalName),
		sourceSchema: "public",
		table,
		columns,
		foreignTable,
		foreignSchema: "public",
		foreignColumns,
		onDelete,
		onUpdate,
	};
}

const foreignKeys = [
	foreignKey(
		"approval_workflow",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow",
		["requester_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_workflow_stage",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_stage",
		["workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_stage_assignment",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_stage_assignment",
		["workflow_id", "stage_id", "organization_id"],
		"approval_workflow_stage",
		["workflow_id", "id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_stage_assignment",
		["approver_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_stage_assignment",
		["resolved_by_actor_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_stage_assignment",
		["reassigned_by_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_stage_assignment",
		[
			"workflow_id",
			"stage_id",
			"reassigned_from_assignment_id",
			"organization_id",
		],
		"approval_stage_assignment",
		["workflow_id", "stage_id", "id", "organization_id"],
	),
	foreignKey(
		"approval_workflow_event",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_event",
		["workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_event",
		["actor_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey("approval_workflow_event", ["actor_user_id"], "user", ["id"]),
	foreignKey(
		"approval_workflow_command",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_command",
		["workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_requester_projection",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_requester_projection",
		["workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_requester_projection",
		["requester_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_inbox_projection",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_inbox_projection",
		["workflow_id", "active_stage_id", "organization_id"],
		"approval_workflow_stage",
		["workflow_id", "id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_outbox",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_outbox",
		["workflow_id", "event_id", "organization_id", "event_type"],
		"approval_workflow_event",
		["workflow_id", "id", "organization_id", "event_type"],
		"cascade",
	),
	foreignKey(
		"approval_outbox_delivery",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_outbox_delivery",
		["outbox_id", "organization_id", "disposition"],
		"approval_outbox",
		["id", "organization_id", "disposition"],
		"cascade",
	),
	foreignKey(
		"approval_outbox_delivery",
		["recipient_employee_id", "organization_id"],
		"employee",
		["id", "organization_id"],
	),
	foreignKey(
		"approval_workflow_rollout",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_migration_issue",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_migration_issue",
		["workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
		"cascade",
	),
	foreignKey(
		"approval_workflow_migration_issue",
		["operator_user_id"],
		"user",
		["id"],
	),
	foreignKey(
		"audit_log",
		["organization_id"],
		"organization",
		["id"],
		"cascade",
	),
	foreignKey("audit_log", ["performed_by"], "user", ["id"]),
	foreignKey("audit_log", ["employee_id"], "employee", ["id"]),
	foreignKey(
		"absence_entry",
		["approval_workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
	),
	foreignKey(
		"compliance_exception",
		["approval_workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
	),
	foreignKey(
		"shift_request",
		["approval_workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
	),
	foreignKey(
		"work_period",
		["approval_workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
	),
	foreignKey(
		"travel_expense_claim",
		["approval_workflow_id", "organization_id"],
		"approval_workflow",
		["id", "organization_id"],
	),
	foreignKey(
		"shift_request",
		["organization_id", "shift_id"],
		"shift",
		["organization_id", "id"],
		"cascade",
	),
] as const;

assertPhysicalForeignKeyNames(foreignKeys);

function index(
	table: string,
	name: string,
	unique: boolean,
	columns: string[],
	predicate: string | null = null,
	primary = false,
): ApprovalCatalogIndex {
	return { table, name, unique, primary, columns, predicate };
}

const indexes = [
	...[
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
		"audit_log",
	].map((table) => index(table, `${table}_pkey`, true, ["id"], null, true)),
	index("approval_workflow", "approvalWorkflow_id_organizationId_idx", true, [
		"id",
		"organization_id",
	]),
	index(
		"approval_workflow",
		"approvalWorkflow_org_source_pending_idx",
		true,
		["organization_id", "workflow_type", "source_type", "source_id"],
		"status = 'pending'",
	),
	index("approval_workflow", "approvalWorkflow_org_status_idx", false, [
		"organization_id",
		"status",
	]),
	index(
		"approval_workflow_stage",
		"approvalWorkflowStage_id_organizationId_idx",
		true,
		["id", "organization_id"],
	),
	index(
		"approval_workflow_stage",
		"approvalWorkflowStage_workflow_id_organizationId_idx",
		true,
		["workflow_id", "id", "organization_id"],
	),
	index(
		"approval_workflow_stage",
		"approvalWorkflowStage_org_workflow_order_idx",
		true,
		["organization_id", "workflow_id", "stage_order"],
	),
	index(
		"approval_stage_assignment",
		"approvalStageAssignment_id_organizationId_idx",
		true,
		["id", "organization_id"],
	),
	index(
		"approval_stage_assignment",
		"approvalStageAssignment_workflow_stage_id_organizationId_idx",
		true,
		["workflow_id", "stage_id", "id", "organization_id"],
	),
	index(
		"approval_stage_assignment",
		"approvalStageAssignment_org_workflow_stage_sequence_idx",
		true,
		["organization_id", "workflow_id", "stage_id", "assignment_sequence"],
	),
	index(
		"approval_stage_assignment",
		"approvalStageAssignment_org_workflow_stage_pending_approver_idx",
		true,
		["organization_id", "workflow_id", "stage_id", "approver_employee_id"],
		"status = 'pending'",
	),
	index(
		"approval_workflow_event",
		"approvalWorkflowEvent_id_organizationId_idx",
		true,
		["id", "organization_id"],
	),
	index(
		"approval_workflow_event",
		"approvalWorkflowEvent_workflow_id_organizationId_idx",
		true,
		["workflow_id", "id", "organization_id"],
	),
	index(
		"approval_workflow_event",
		"approvalWorkflowEvent_workflow_id_organizationId_eventType_idx",
		true,
		["workflow_id", "id", "organization_id", "event_type"],
	),
	index(
		"approval_workflow_event",
		"approvalWorkflowEvent_org_workflow_version_index_idx",
		true,
		["organization_id", "workflow_id", "version", "event_index"],
	),
	index(
		"approval_workflow_event",
		"approvalWorkflowEvent_org_idempotency_idx",
		true,
		["organization_id", "idempotency_key"],
		"idempotency_key is not null",
	),
	index(
		"approval_workflow_command",
		"approvalWorkflowCommand_org_workflow_idempotency_idx",
		true,
		["organization_id", "workflow_id", "idempotency_key"],
	),
	index(
		"approval_requester_projection",
		"approvalRequesterProjection_org_workflow_idx",
		true,
		["organization_id", "workflow_id"],
	),
	index(
		"approval_requester_projection",
		"approvalRequesterProjection_org_requester_status_idx",
		false,
		["organization_id", "requester_employee_id", "status"],
	),
	index(
		"approval_inbox_projection",
		"approvalInboxProjection_org_workflow_stage_idx",
		true,
		["organization_id", "workflow_id", "active_stage_id"],
	),
	index(
		"approval_inbox_projection",
		"approvalInboxProjection_org_status_idx",
		false,
		["organization_id", "status"],
	),
	index("approval_outbox", "approvalOutbox_id_organizationId_idx", true, [
		"id",
		"organization_id",
	]),
	index(
		"approval_outbox",
		"approvalOutbox_id_organizationId_disposition_idx",
		true,
		["id", "organization_id", "disposition"],
	),
	index("approval_outbox", "approvalOutbox_org_dedupe_idx", true, [
		"organization_id",
		"dedupe_key",
	]),
	index("approval_outbox", "approvalOutbox_org_createdAt_idx", false, [
		"organization_id",
		"created_at",
	]),
	index(
		"approval_outbox",
		"approvalOutbox_pendingExpansion_createdAt_idx",
		false,
		["expansion_status", "created_at"],
		"expansion_status = 'pending'",
	),
	index(
		"approval_outbox_delivery",
		"approvalOutboxDelivery_org_dedupe_idx",
		true,
		["organization_id", "dedupe_key"],
	),
	index(
		"approval_outbox_delivery",
		"approvalOutboxDelivery_status_available_idx",
		false,
		["status", "available_at"],
	),
	index(
		"approval_workflow_rollout",
		"approvalWorkflowRollout_org_type_idx",
		true,
		["organization_id", "workflow_type"],
	),
	index(
		"approval_workflow_migration_issue",
		"approvalWorkflowMigrationIssue_org_type_disposition_idx",
		false,
		["organization_id", "workflow_type", "disposition"],
	),
	index("absence_entry", "absenceEntry_org_approvalWorkflowId_idx", false, [
		"organization_id",
		"approval_workflow_id",
	]),
	index(
		"compliance_exception",
		"complianceException_org_approvalWorkflowId_idx",
		false,
		["organization_id", "approval_workflow_id"],
	),
	index("shift_request", "shiftRequest_org_approvalWorkflowId_idx", false, [
		"organization_id",
		"approval_workflow_id",
	]),
	index("work_period", "workPeriod_org_approvalWorkflowId_idx", false, [
		"organization_id",
		"approval_workflow_id",
	]),
	index(
		"travel_expense_claim",
		"travelExpenseClaim_org_approvalWorkflowId_idx",
		false,
		["organization_id", "approval_workflow_id"],
	),
	index(
		"notification",
		"notification_org_idempotencyKey_idx",
		true,
		["organization_id", "idempotency_key"],
		"idempotency_key is not null",
	),
	index("shift", "shift_organizationId_id_idx", true, [
		"organization_id",
		"id",
	]),
	index("audit_log", "auditLog_organizationId_idx", false, ["organization_id"]),
	index("audit_log", "auditLog_organizationId_timestamp_idx", false, [
		"organization_id",
		"timestamp",
	]),
	index("audit_log", "auditLog_entityType_entityId_idx", false, [
		"entity_type",
		"entity_id",
	]),
	index("audit_log", "auditLog_performedBy_idx", false, ["performed_by"]),
	index("audit_log", "auditLog_timestamp_idx", false, ["timestamp"]),
] as const;

const checks = [
	{
		table: "absence_entry",
		name: "absence_entry_approval_workflow_organization_check",
		definition: "approval_workflow_id is null or organization_id is not null",
	},
	{
		table: "shift_request",
		name: "shift_request_approval_workflow_organization_check",
		definition: "approval_workflow_id is null or organization_id is not null",
	},
] as const;

export const APPROVAL_EXPANSION_CONTRACT = {
	tables,
	operationalTables,
	sourceTables,
	relations,
	enums,
	columns,
	foreignKeys,
	indexes,
	checks,
} as const satisfies ApprovalExpansionContract;

function sameValues(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function removeBalancedOuterParentheses(value: string): string {
	let result = value.trim();
	while (result.startsWith("(") && result.endsWith(")")) {
		let depth = 0;
		let wrapsWholeExpression = true;
		for (let index = 0; index < result.length; index += 1) {
			if (result[index] === "(") depth += 1;
			if (result[index] === ")") depth -= 1;
			if (depth === 0 && index < result.length - 1) {
				wrapsWholeExpression = false;
				break;
			}
			if (depth < 0) {
				wrapsWholeExpression = false;
				break;
			}
		}
		if (!wrapsWholeExpression || depth !== 0) break;
		result = result.slice(1, -1).trim();
	}
	return result;
}

function normalizeExpression(value: string): string {
	const normalized = value
		.toLowerCase()
		.replaceAll('"', "")
		.replace(/::[a-z_][a-z0-9_]*(?:\s+(?:with|without)\s+time\s+zone)?/g, "")
		.replace(/\b[a-z_][a-z0-9_]*\./g, "")
		.replace(/\s+/g, " ")
		.trim();
	const withoutCheck = normalized.replace(/^check\s*/, "");
	return removeBalancedOuterParentheses(withoutCheck);
}

function defaultsMatch(
	actual: string | null,
	expected: string | null,
): boolean {
	if (actual === null || expected === null) return actual === expected;
	return normalizeExpression(actual) === normalizeExpression(expected);
}

export function validateApprovalExpansionCatalog(
	catalog: ApprovalExpansionCatalog,
	contract: ApprovalExpansionContract = APPROVAL_EXPANSION_CONTRACT,
): void {
	const missing: string[] = [];
	for (const table of contract.tables) {
		if (!catalog.tables.includes(table)) missing.push(`table ${table}`);
	}
	for (const table of contract.operationalTables) {
		if (!catalog.operationalTables.includes(table))
			missing.push(`table ${table}`);
	}
	for (const table of contract.sourceTables) {
		if (!catalog.sourceTables.includes(table)) missing.push(`table ${table}`);
	}
	for (const [name, values] of Object.entries(contract.enums)) {
		const actual = catalog.enums[name];
		if (!actual || !sameValues(actual, values)) {
			missing.push(`enum ${name} expected ordered values ${values.join(",")}`);
		}
	}
	for (const expected of contract.columns) {
		const actual = catalog.columns.find(
			(candidate) =>
				candidate.table === expected.table && candidate.name === expected.name,
		);
		if (!actual) {
			missing.push(`column ${expected.table}.${expected.name}`);
		} else if (
			actual.type !== expected.type ||
			actual.notNull !== expected.notNull
		) {
			missing.push(
				`column ${expected.table}.${expected.name} expected ${expected.type} ${expected.notNull ? "not null" : "nullable"}`,
			);
		} else if (!defaultsMatch(actual.default, expected.default)) {
			missing.push(
				`default for column ${expected.table}.${expected.name} expected ${expected.default ?? "none"}`,
			);
		}
	}
	for (const relation of contract.relations) {
		if (relation.mode !== "full") continue;
		const expectedNames = contract.columns
			.filter((column) => column.table === relation.name)
			.map((column) => column.name)
			.sort();
		const actualNames = catalog.columns
			.filter((column) => column.table === relation.name)
			.map((column) => column.name)
			.sort();
		if (!sameValues(actualNames, expectedNames)) {
			missing.push(`exact columns for full relation ${relation.name}`);
		}
	}
	for (const expected of contract.foreignKeys) {
		const matchingIdentity = catalog.foreignKeys.find(
			(candidate) =>
				candidate.name === expected.name &&
				candidate.sourceSchema === expected.sourceSchema &&
				candidate.table === expected.table &&
				candidate.foreignTable === expected.foreignTable &&
				candidate.foreignSchema === expected.foreignSchema &&
				sameValues(candidate.columns, expected.columns) &&
				sameValues(candidate.foreignColumns, expected.foreignColumns),
		);
		if (!matchingIdentity) {
			missing.push(
				`foreign key ${expected.table}(${expected.columns.join(",")}) -> ${expected.foreignTable}(${expected.foreignColumns.join(",")})`,
			);
		} else if (
			matchingIdentity.onDelete !== expected.onDelete ||
			matchingIdentity.onUpdate !== expected.onUpdate
		) {
			missing.push(
				`foreign key ${expected.table} -> ${expected.foreignTable} expected on delete ${expected.onDelete} on update ${expected.onUpdate}`,
			);
		}
	}
	for (const relation of contract.relations) {
		if (relation.mode !== "full") continue;
		const expectedForeignKeyCount = contract.foreignKeys.filter(
			(foreignKey) => foreignKey.table === relation.name,
		).length;
		const actualForeignKeyCount = catalog.foreignKeys.filter(
			(foreignKey) => foreignKey.table === relation.name,
		).length;
		if (actualForeignKeyCount > expectedForeignKeyCount) {
			missing.push(`unexpected foreignKey on full relation ${relation.name}`);
		}
		const expectedIndexCount = contract.indexes.filter(
			(index) => index.table === relation.name,
		).length;
		const actualIndexCount = catalog.indexes.filter(
			(index) => index.table === relation.name,
		).length;
		if (actualIndexCount > expectedIndexCount) {
			missing.push(`unexpected index on full relation ${relation.name}`);
		}
		const expectedCheckCount = contract.checks.filter(
			(check) => (check.table as string) === relation.name,
		).length;
		const actualCheckCount = catalog.checks.filter(
			(check) => check.table === relation.name,
		).length;
		if (actualCheckCount > expectedCheckCount) {
			missing.push(`unexpected check on full relation ${relation.name}`);
		}
	}
	for (const expected of contract.indexes) {
		const actual = catalog.indexes.find(
			(candidate) => candidate.name === expected.name,
		);
		const kind = expected.predicate
			? "partial index"
			: expected.unique
				? "unique index"
				: "index";
		if (
			!actual ||
			actual.table !== expected.table ||
			actual.unique !== expected.unique ||
			actual.primary !== expected.primary ||
			!sameValues(actual.columns, expected.columns) ||
			(actual.predicate === null || expected.predicate === null
				? actual.predicate !== expected.predicate
				: normalizeExpression(actual.predicate) !==
					normalizeExpression(expected.predicate))
		) {
			missing.push(`${kind} ${expected.name}`);
		}
	}
	for (const expected of contract.checks) {
		const actual = catalog.checks.find(
			(candidate) => candidate.name === expected.name,
		);
		if (
			!actual ||
			actual.table !== expected.table ||
			normalizeExpression(actual.definition) !==
				normalizeExpression(expected.definition)
		) {
			missing.push(`check ${expected.name}`);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Approval workflow expansion schema is incomplete:\n- ${missing.join("\n- ")}`,
		);
	}
}

function catalogFromResult(result: unknown): ApprovalExpansionCatalog {
	if (!result || typeof result !== "object" || !("rows" in result)) {
		throw new Error("Approval workflow catalog query returned no rows");
	}
	const rows = result.rows;
	if (!Array.isArray(rows) || rows.length !== 1) {
		throw new Error("Approval workflow catalog query returned no rows");
	}
	const row = rows[0];
	if (!row || typeof row !== "object" || !("catalog" in row)) {
		throw new Error(
			"Approval workflow catalog query returned malformed evidence",
		);
	}
	return row.catalog as ApprovalExpansionCatalog;
}

export async function loadAndValidateApprovalExpansionSchema(
	transaction: ApprovalTransactionClient,
	contract: ApprovalExpansionContract = APPROVAL_EXPANSION_CONTRACT,
): Promise<ApprovalExpansionCatalog> {
	const expected = JSON.stringify(contract);
	const result = await transaction.execute(sql`
		with expected as (select ${expected}::jsonb as contract)
		select jsonb_build_object(
			'tables', coalesce((
				select jsonb_agg(c.relname order by c.relname)
				from pg_catalog.pg_class c
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public'
					and c.relkind in ('r', 'p')
					and c.relname in (select jsonb_array_elements_text(expected.contract->'tables'))
			), '[]'::jsonb),
			'operationalTables', coalesce((
				select jsonb_agg(c.relname order by c.relname)
				from pg_catalog.pg_class c
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public'
					and c.relkind in ('r', 'p')
					and c.relname in (select jsonb_array_elements_text(expected.contract->'operationalTables'))
			), '[]'::jsonb),
			'sourceTables', coalesce((
				select jsonb_agg(c.relname order by c.relname)
				from pg_catalog.pg_class c
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public'
					and c.relkind in ('r', 'p')
					and c.relname in (select jsonb_array_elements_text(expected.contract->'sourceTables'))
			), '[]'::jsonb),
			'enums', coalesce((
				select jsonb_object_agg(enum_name, enum_values)
				from (
					select t.typname as enum_name,
						jsonb_agg(e.enumlabel order by e.enumsortorder) as enum_values
					from pg_catalog.pg_type t
					join pg_catalog.pg_namespace n on n.oid = t.typnamespace
					join pg_catalog.pg_enum e on e.enumtypid = t.oid
					where n.nspname = 'public'
						and t.typname in (select jsonb_object_keys(expected.contract->'enums'))
					group by t.typname
				) enum_catalog
			), '{}'::jsonb),
			'columns', coalesce((
				select jsonb_agg(jsonb_build_object(
					'table', c.relname,
					'name', a.attname,
					'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
					'notNull', a.attnotnull,
					'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
				))
				from pg_catalog.pg_attribute a
				join pg_catalog.pg_class c on c.oid = a.attrelid
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				left join pg_catalog.pg_attrdef default_value
					on default_value.adrelid = a.attrelid and default_value.adnum = a.attnum
				where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
					and c.relname in (
						select distinct column_requirement->>'table'
						from jsonb_array_elements(expected.contract->'columns') column_requirement
					)
			), '[]'::jsonb),
			'foreignKeys', coalesce((
				select jsonb_agg(jsonb_build_object(
					'name', con.conname,
					'sourceSchema', source_namespace.nspname,
					'table', source.relname,
					'columns', (select jsonb_agg(a.attname order by key.ordinality) from unnest(con.conkey) with ordinality key(attnum, ordinality) join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = key.attnum),
					'foreignTable', target.relname,
					'foreignSchema', target_namespace.nspname,
					'foreignColumns', (select jsonb_agg(a.attname order by key.ordinality) from unnest(con.confkey) with ordinality key(attnum, ordinality) join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = key.attnum),
					'onDelete', case con.confdeltype when 'c' then 'cascade' when 'r' then 'restrict' when 'n' then 'set null' when 'd' then 'set default' else 'no action' end,
					'onUpdate', case con.confupdtype when 'c' then 'cascade' when 'r' then 'restrict' when 'n' then 'set null' when 'd' then 'set default' else 'no action' end
				))
				from pg_catalog.pg_constraint con
				join pg_catalog.pg_class source on source.oid = con.conrelid
				join pg_catalog.pg_class target on target.oid = con.confrelid
				join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source.relnamespace
				join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target.relnamespace
				where source_namespace.nspname = 'public'
					and con.contype = 'f'
					and source.relname in (
						select relation_requirement->>'name'
						from jsonb_array_elements(expected.contract->'relations') relation_requirement
					)
			), '[]'::jsonb),
			'indexes', coalesce((
				select jsonb_agg(jsonb_build_object(
					'table', table_class.relname,
					'name', index_class.relname,
					'unique', idx.indisunique,
					'primary', idx.indisprimary,
					'columns', (select jsonb_agg(pg_catalog.pg_get_indexdef(idx.indexrelid, position, true) order by position) from generate_series(1, idx.indnkeyatts) position),
					'predicate', pg_catalog.pg_get_expr(idx.indpred, idx.indrelid)
				))
				from pg_catalog.pg_index idx
				join pg_catalog.pg_class table_class on table_class.oid = idx.indrelid
				join pg_catalog.pg_class index_class on index_class.oid = idx.indexrelid
				join pg_catalog.pg_namespace n on n.oid = table_class.relnamespace
				where n.nspname = 'public'
					and table_class.relname in (
						select relation_requirement->>'name'
						from jsonb_array_elements(expected.contract->'relations') relation_requirement
					)
			), '[]'::jsonb),
			'checks', coalesce((
				select jsonb_agg(jsonb_build_object(
					'table', c.relname,
					'name', con.conname,
					'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
				))
				from pg_catalog.pg_constraint con
				join pg_catalog.pg_class c on c.oid = con.conrelid
				join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public' and con.contype = 'c'
					and c.relname in (
						select relation_requirement->>'name'
						from jsonb_array_elements(expected.contract->'relations') relation_requirement
					)
			), '[]'::jsonb)
		) as catalog
		from expected
	`);
	const catalog = catalogFromResult(result);
	validateApprovalExpansionCatalog(catalog, contract);
	return catalog;
}
