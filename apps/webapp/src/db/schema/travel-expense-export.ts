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
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { TravelExpenseExportManifest } from "@/lib/travel-expenses/export-manifest";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { travelExpenseReport } from "./travel-expense";

export const TRAVEL_EXPENSE_EXPORT_BATCH_STATUSES = [
	"queued",
	"processing",
	"completed",
	"failed",
	"cancelled",
] as const;
export type TravelExpenseExportBatchStatus = (typeof TRAVEL_EXPENSE_EXPORT_BATCH_STATUSES)[number];

export interface TravelExpenseExportBatchTotal {
	currency: string;
	reimbursable: string;
	companyPaid: string;
}

// A tracked CSV/receipt export of approved report revisions (#613). The
// manifest (the exact frozen revisions and receipt objects) is captured when
// the batch is created and never changes; the job only turns it into one
// private ZIP. `attempt` names the job run allowed to finish the batch, so a
// retried or cancelled run can never overwrite a newer outcome. Completed and
// cancelled batches are terminal (an UPDATE trigger enforces it). An export
// is not a reimbursement and never touches settlement entries.
export const travelExpenseExportBatch = pgTable(
	"travel_expense_export_batch",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		status: text("status").$type<TravelExpenseExportBatchStatus>().notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		selectionFingerprint: text("selection_fingerprint").notNull(),
		manifestVersion: integer("manifest_version").notNull(),
		manifest: jsonb("manifest").$type<TravelExpenseExportManifest>().notNull(),
		manifestDigest: text("manifest_digest").notNull(),
		revisionCount: integer("revision_count").notNull(),
		itemCount: integer("item_count").notNull(),
		receiptCount: integer("receipt_count").notNull(),
		totals: jsonb("totals").$type<TravelExpenseExportBatchTotal[]>().notNull(),
		attempt: integer("attempt").notNull().default(1),
		requestedByEmployeeId: uuid("requested_by_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),
		requestedByUserId: text("requested_by_user_id").notNull(),
		requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
		// When the current attempt was queued (creation or retry); null before 0131 (use requestedAt).
		queuedAt: timestamp("queued_at", { withTimezone: true }),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		failedAt: timestamp("failed_at", { withTimezone: true }),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		cancelReason: text("cancel_reason"),
		cancelledByUserId: text("cancelled_by_user_id"),
		fileName: text("file_name"),
		storageBucket: text("storage_bucket"),
		storageKey: text("storage_key"),
		storageVersionId: text("storage_version_id"),
		sizeBytes: integer("size_bytes"),
		checksumSha256: text("checksum_sha256"),
	},
	(table) => [
		uniqueIndex("travelExpenseExportBatch_id_org_idx").on(table.id, table.organizationId),
		uniqueIndex("travelExpenseExportBatch_org_idempotency_idx").on(
			table.organizationId,
			table.idempotencyKey,
		),
		index("travelExpenseExportBatch_org_requested_idx").on(table.organizationId, table.requestedAt),
		check(
			"travel_expense_export_batch_status_check",
			sql`${table.status} IN ('queued', 'processing', 'completed', 'failed', 'cancelled')`,
		),
		check(
			"travel_expense_export_batch_counts_check",
			sql`${table.revisionCount} >= 1 AND ${table.itemCount} >= ${table.revisionCount}
			AND ${table.receiptCount} >= 0 AND ${table.attempt} >= 1`,
		),
		check(
			"travel_expense_export_batch_outcome_check",
			sql`(${table.status} <> 'completed' OR (${table.completedAt} IS NOT NULL AND ${table.fileName} IS NOT NULL
				AND ${table.storageKey} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL AND ${table.checksumSha256} IS NOT NULL))
			AND (${table.status} <> 'failed' OR (${table.failedAt} IS NOT NULL AND ${table.errorCode} IS NOT NULL))
			AND (${table.status} <> 'cancelled' OR (${table.cancelledAt} IS NOT NULL AND ${table.cancelReason} IS NOT NULL))
			AND (${table.status} <> 'processing' OR ${table.startedAt} IS NOT NULL)`,
		),
	],
);

// The approved revisions a batch consumes. A revision belongs to at most one
// batch that is not cancelled (partial unique index): it is exported once,
// re-downloaded as often as needed, and released only by cancelling the batch
// (finance, or #614 reopening the report before the export completed).
export const travelExpenseExportBatchRevision = pgTable(
	"travel_expense_export_batch_revision",
	{
		batchId: uuid("batch_id").notNull(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		// `approval_submitted_revision.id`, kept by value like other expense history.
		submittedRevisionId: uuid("submitted_revision_id").notNull(),
		submissionCycle: integer("submission_cycle").notNull(),
		releasedAt: timestamp("released_at", { withTimezone: true }),
	},
	(table) => [
		primaryKey({
			name: "travel_expense_export_batch_revision_pk",
			columns: [table.batchId, table.submittedRevisionId],
		}),
		foreignKey({
			name: "travel_expense_export_batch_revision_batch_fk",
			columns: [table.batchId, table.organizationId],
			foreignColumns: [travelExpenseExportBatch.id, travelExpenseExportBatch.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_export_batch_revision_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseExportBatchRevision_active_revision_idx")
			.on(table.organizationId, table.submittedRevisionId)
			.where(sql`released_at IS NULL`),
		index("travelExpenseExportBatchRevision_org_report_idx").on(
			table.organizationId,
			table.reportId,
		),
	],
);
