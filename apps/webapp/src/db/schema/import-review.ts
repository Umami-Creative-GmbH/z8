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
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";

export const importBatch = pgTable(
	"import_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<"clockodo" | "clockin">().notNull(),
		status: text("status")
			.$type<
				| "draft"
				| "scanning"
				| "needs_review"
				| "committing"
				| "completed"
				| "scan_failed"
				| "commit_failed"
				| "cancelled"
			>()
			.notNull()
			.default("draft"),
		selectedScope: jsonb("selected_scope").$type<Record<string, unknown>>().notNull(),
		dateRange: jsonb("date_range").$type<{ startDate: string; endDate: string }>().notNull(),
		totalRows: integer("total_rows").notNull().default(0),
		processedRows: integer("processed_rows").notNull().default(0),
		issueCount: integer("issue_count").notNull().default(0),
		errorMessage: text("error_message"),
		startedBy: text("started_by")
			.notNull()
			.references(() => user.id),
		reviewedBy: text("reviewed_by").references(() => user.id),
		committedBy: text("committed_by").references(() => user.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("importBatch_id_organizationId_idx").on(table.id, table.organizationId),
		index("importBatch_organizationId_idx").on(table.organizationId),
		index("importBatch_status_idx").on(table.status),
		index("importBatch_org_status_created_idx").on(
			table.organizationId,
			table.status,
			table.createdAt,
		),
	],
);

export const importBatchJob = pgTable(
	"import_batch_job",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kind: text("kind").$type<"scan" | "commit">().notNull(),
		status: text("status")
			.$type<"queued" | "running" | "completed" | "failed">()
			.notNull()
			.default("queued"),
		entityType: text("entity_type").notNull(),
		partitionKey: text("partition_key").notNull(),
		processedRows: integer("processed_rows").notNull().default(0),
		retryCount: integer("retry_count").notNull().default(0),
		errorMessage: text("error_message"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("importBatchJob_batchId_idx").on(table.batchId),
		index("importBatchJob_org_status_idx").on(table.organizationId, table.status),
		foreignKey({
			columns: [table.batchId, table.organizationId],
			foreignColumns: [importBatch.id, importBatch.organizationId],
			name: "import_batch_job_batch_org_import_batch_fk",
		}).onDelete("cascade"),
		uniqueIndex("importBatchJob_batch_kind_partition_idx").on(
			table.batchId,
			table.kind,
			table.partitionKey,
		),
	],
);

export const importStagedRow = pgTable(
	"import_staged_row",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		entityType: text("entity_type").notNull(),
		providerSourceId: text("provider_source_id").notNull(),
		sourcePayloadHash: text("source_payload_hash").notNull(),
		sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>().notNull(),
		normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>().notNull(),
		matchTarget: jsonb("match_target").$type<Record<string, unknown> | null>(),
		rowStatus: text("row_status")
			.$type<
				| "staged"
				| "accepted"
				| "rejected"
				| "blocked"
				| "needs_mapping"
				| "committing"
				| "committed"
				| "commit_failed"
			>()
			.notNull()
			.default("staged"),
		issueSeverity: text("issue_severity")
			.$type<"none" | "info" | "warning" | "blocking">()
			.notNull()
			.default("none"),
		decisionReason: text("decision_reason"),
		decidedBy: text("decided_by").references(() => user.id),
		decidedAt: timestamp("decided_at"),
		commitTargetTable: text("commit_target_table"),
		commitTargetId: text("commit_target_id"),
		commitError: text("commit_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("import_staged_row_id_batch_org_idx").on(table.id, table.batchId, table.organizationId),
		index("importStagedRow_batchId_idx").on(table.batchId),
		index("importStagedRow_org_entity_idx").on(table.organizationId, table.entityType),
		index("importStagedRow_status_idx").on(table.rowStatus),
		index("importStagedRow_org_batch_status_created_id_idx").on(
			table.organizationId,
			table.batchId,
			table.rowStatus,
			table.createdAt,
			table.id,
		),
		foreignKey({
			columns: [table.batchId, table.organizationId],
			foreignColumns: [importBatch.id, importBatch.organizationId],
			name: "import_staged_row_batch_org_import_batch_fk",
		}).onDelete("cascade"),
		uniqueIndex("importStagedRow_batch_source_unique_idx").on(
			table.batchId,
			table.entityType,
			table.providerSourceId,
			table.sourcePayloadHash,
		),
	],
);

export const importIssue = pgTable(
	"import_issue",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		stagedRowId: uuid("staged_row_id"),
		issueType: text("issue_type")
			.$type<
				| "duplicate"
				| "suspicious_gap"
				| "unmatched_employee"
				| "unmatched_project"
				| "validation_error"
				| "dependency_blocker"
			>()
			.notNull(),
		severity: text("severity").$type<"info" | "warning" | "blocking">().notNull(),
		clusterKey: text("cluster_key"),
		message: text("message").notNull(),
		details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
		detectionRuleVersion: text("detection_rule_version").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("importIssue_batchId_idx").on(table.batchId),
		index("importIssue_org_type_idx").on(table.organizationId, table.issueType),
		index("importIssue_clusterKey_idx").on(table.clusterKey),
		uniqueIndex("importIssue_retry_unique_idx").on(
			table.batchId,
			table.organizationId,
			table.stagedRowId,
			table.issueType,
			table.clusterKey,
			table.detectionRuleVersion,
		),
		foreignKey({
			columns: [table.batchId, table.organizationId],
			foreignColumns: [importBatch.id, importBatch.organizationId],
			name: "import_issue_batch_org_import_batch_fk",
		}).onDelete("cascade"),
	],
);

export const importRejectedExport = pgTable(
	"import_rejected_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		exportedBy: text("exported_by")
			.notNull()
			.references(() => user.id),
		rowCount: integer("row_count").notNull(),
		fileName: text("file_name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("importRejectedExport_batchId_idx").on(table.batchId),
		index("importRejectedExport_organizationId_idx").on(table.organizationId),
		foreignKey({
			columns: [table.batchId, table.organizationId],
			foreignColumns: [importBatch.id, importBatch.organizationId],
			name: "import_rejected_export_batch_org_import_batch_fk",
		}).onDelete("cascade"),
	],
);

export const importJobSecret = pgTable(
	"import_job_secret",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		ciphertext: text("ciphertext").notNull(),
		iv: text("iv").notNull(),
		authTag: text("auth_tag").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("importJobSecret_batchId_idx").on(table.batchId),
		index("importJobSecret_organizationId_idx").on(table.organizationId),
		index("importJobSecret_expiresAt_idx").on(table.expiresAt),
		foreignKey({
			columns: [table.batchId, table.organizationId],
			foreignColumns: [importBatch.id, importBatch.organizationId],
			name: "import_job_secret_batch_org_import_batch_fk",
		}).onDelete("cascade"),
	],
);
