import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "./timestamp";

import { organization, user } from "../auth-schema";
import { approvalWorkflow } from "./approval-workflow";
import {
	travelExpenseClaimStatusEnum,
	travelExpenseDecisionActionEnum,
	travelExpenseTypeEnum,
} from "./enums";
import { employee } from "./organization";
import { project } from "./project";

export const travelExpenseClaim = pgTable(
	"travel_expense_claim",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		approverId: uuid("approver_id").references(() => employee.id, { onDelete: "set null" }),
		approvalWorkflowId: uuid("approval_workflow_id"),
		type: travelExpenseTypeEnum("type").notNull(),
		status: travelExpenseClaimStatusEnum("status").notNull().default("draft"),
		tripStart: timestamp("trip_start").notNull(),
		tripEnd: timestamp("trip_end").notNull(),
		// Logical trip dates exactly as entered, and the zone used to derive the
		// compatibility bounds above. Null for claims created before capture.
		tripStartDate: date("trip_start_date"),
		tripEndDate: date("trip_end_date"),
		tripDateTimeZone: text("trip_date_time_zone"),
		destinationCity: text("destination_city"),
		destinationCountry: text("destination_country"),
		projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
		originalCurrency: text("original_currency").notNull(),
		originalAmount: decimal("original_amount", { precision: 12, scale: 2 }).notNull(),
		calculatedCurrency: text("calculated_currency").notNull(),
		calculatedAmount: decimal("calculated_amount", { precision: 12, scale: 2 }).notNull(),
		notes: text("notes"),
		submittedAt: timestamp("submitted_at"),
		decidedAt: timestamp("decided_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("travelExpenseClaim_organizationId_idx").on(table.organizationId),
		index("travelExpenseClaim_employeeId_idx").on(table.employeeId),
		index("travelExpenseClaim_approverId_idx").on(table.approverId),
		index("travelExpenseClaim_projectId_idx").on(table.projectId),
		index("travelExpenseClaim_status_idx").on(table.status),
		index("travelExpenseClaim_type_idx").on(table.type),
		index("travelExpenseClaim_tripStart_idx").on(table.tripStart),
		index("travelExpenseClaim_submittedAt_idx").on(table.submittedAt),
		index("travelExpenseClaim_org_approvalWorkflowId_idx").on(
			table.organizationId,
			table.approvalWorkflowId,
		),
		foreignKey({
			columns: [table.approvalWorkflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}),
		check(
			"travel_expense_claim_trip_dates_check",
			sql`(${table.tripStartDate} IS NULL AND ${table.tripEndDate} IS NULL
				AND ${table.tripDateTimeZone} IS NULL)
			OR (${table.tripStartDate} IS NOT NULL AND ${table.tripEndDate} IS NOT NULL
				AND ${table.tripDateTimeZone} IS NOT NULL
				AND ${table.tripEndDate} >= ${table.tripStartDate})`,
		),
	],
);

export const travelExpenseAttachment = pgTable(
	"travel_expense_attachment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		claimId: uuid("claim_id")
			.notNull()
			.references(() => travelExpenseClaim.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		storageProvider: text("storage_provider").notNull(),
		storageBucket: text("storage_bucket"),
		storageKey: text("storage_key").notNull(),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type"),
		sizeBytes: integer("size_bytes"),
		// Server-computed over the exact stored bytes; null only for historical uploads.
		checksumSha256: text("checksum_sha256"),
		// Provider object version, when the bucket reports one. The key is write-once.
		storageVersionId: text("storage_version_id"),
		uploadedBy: uuid("uploaded_by")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("travelExpenseAttachment_claimId_idx").on(table.claimId),
		index("travelExpenseAttachment_organizationId_idx").on(table.organizationId),
		index("travelExpenseAttachment_uploadedBy_idx").on(table.uploadedBy),
		uniqueIndex("travelExpenseAttachment_claim_storageKey_idx").on(table.claimId, table.storageKey),
	],
);

export const TRAVEL_EXPENSE_RECEIPT_UPLOAD_STATUSES = ["pending", "cleanup_required"] as const;
export type TravelExpenseReceiptUploadStatus =
	(typeof TRAVEL_EXPENSE_RECEIPT_UPLOAD_STATUSES)[number];

export const TRAVEL_EXPENSE_RECEIPT_CLEANUP_REASONS = [
	"claim_not_draft",
	"finalization_failed",
	"abandoned",
] as const;
export type TravelExpenseReceiptCleanupReason =
	(typeof TRAVEL_EXPENSE_RECEIPT_CLEANUP_REASONS)[number];

// Durable staging claim for one private receipt object. It is written before
// the object is stored and removed in the transaction that attaches it, so an
// upload that is rejected (claim no longer a draft), fails or is abandoned
// always leaves recoverable storage cleanup work. Organization and claim are
// kept by value: cleanup must outlive claim and tenant deletion.
export const travelExpenseReceiptUpload = pgTable(
	"travel_expense_receipt_upload",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		claimId: uuid("claim_id").notNull(),
		uploadedBy: uuid("uploaded_by").notNull(),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		status: text("status")
			.$type<TravelExpenseReceiptUploadStatus>()
			.default("pending")
			.notNull(),
		reason: text("reason").$type<TravelExpenseReceiptCleanupReason>(),
		attempts: integer("attempts").default(0).notNull(),
		lastError: text("last_error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("travelExpenseReceiptUpload_org_storageKey_idx").on(
			table.organizationId,
			table.storageKey,
		),
		index("travelExpenseReceiptUpload_status_nextAttemptAt_idx").on(
			table.status,
			table.nextAttemptAt,
		),
		check(
			"travel_expense_receipt_upload_status_check",
			sql`${table.status} IN ('pending', 'cleanup_required')`,
		),
		check(
			"travel_expense_receipt_upload_reason_check",
			sql`(${table.status} = 'pending' AND ${table.reason} IS NULL)
			OR (${table.status} = 'cleanup_required'
				AND ${table.reason} IN ('claim_not_draft', 'finalization_failed', 'abandoned'))`,
		),
	],
);

export const travelExpensePolicy = pgTable(
	"travel_expense_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		effectiveFrom: timestamp("effective_from").notNull(),
		effectiveTo: timestamp("effective_to"),
		currency: text("currency").notNull(),
		mileageRatePerKm: decimal("mileage_rate_per_km", { precision: 10, scale: 4 }),
		perDiemRatePerDay: decimal("per_diem_rate_per_day", { precision: 10, scale: 2 }),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("travelExpensePolicy_organizationId_idx").on(table.organizationId),
		index("travelExpensePolicy_effectiveFrom_idx").on(table.effectiveFrom),
		index("travelExpensePolicy_effectiveTo_idx").on(table.effectiveTo),
		index("travelExpensePolicy_isActive_idx").on(table.isActive),
		uniqueIndex("travelExpensePolicy_org_active_idx")
			.on(table.organizationId)
			.where(sql`is_active = true`),
	],
);

export const travelExpenseDecisionLog = pgTable(
	"travel_expense_decision_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		claimId: uuid("claim_id")
			.notNull()
			.references(() => travelExpenseClaim.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		actorEmployeeId: uuid("actor_employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		approverId: uuid("approver_id").references(() => employee.id, { onDelete: "set null" }),
		action: travelExpenseDecisionActionEnum("action").notNull(),
		reason: text("reason"),
		comment: text("comment"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("travelExpenseDecisionLog_claimId_idx").on(table.claimId),
		index("travelExpenseDecisionLog_organizationId_idx").on(table.organizationId),
		index("travelExpenseDecisionLog_actorEmployeeId_idx").on(table.actorEmployeeId),
		index("travelExpenseDecisionLog_approverId_idx").on(table.approverId),
		index("travelExpenseDecisionLog_createdAt_idx").on(table.createdAt),
	],
);
