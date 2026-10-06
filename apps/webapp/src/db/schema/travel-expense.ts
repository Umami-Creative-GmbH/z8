import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { MileageVehicle, StampedMileagePolicy } from "@/lib/travel-expenses/mileage";
import type { ExpensePayer, ReceiptExpenseCategory } from "@/lib/travel-expenses/receipt-report";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { organization, user } from "../auth-schema";
import { approvalWorkflow } from "./approval-workflow";
import {
	travelExpenseClaimStatusEnum,
	travelExpenseDecisionActionEnum,
	travelExpenseTypeEnum,
} from "./enums";
import { employee } from "./organization";
import { project } from "./project";
import { currentTimestamp } from "./timestamp";

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

export const TRAVEL_EXPENSE_REPORT_KINDS = ["standalone", "trip"] as const;
export type TravelExpenseReportKind = (typeof TRAVEL_EXPENSE_REPORT_KINDS)[number];
export const TRAVEL_EXPENSE_REPORT_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TravelExpenseReportStatus = (typeof TRAVEL_EXPENSE_REPORT_STATUSES)[number];

// Travel expense report (#600): groups expense items beside the legacy claim
// model, which keeps its submitted and decided claims untouched. A trip report
// (#601) also holds the shared travel details its items have in common; a
// standalone report never has any. Trip dates are calendar days in the
// explicit `trip_time_zone`, never in a viewer's zone. `details_version`
// advances on every saved edit of those details, like an item's `version`.
// Submission (#602) freezes the whole report as an approval submitted
// revision; `submission_count` numbers its submission cycles, and only a
// draft is ever edited.
export const travelExpenseReport = pgTable(
	"travel_expense_report",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		kind: text("kind").$type<TravelExpenseReportKind>().notNull(),
		status: text("status").$type<TravelExpenseReportStatus>().default("draft").notNull(),
		reimbursementCurrency: text("reimbursement_currency").notNull(),
		tripPurpose: text("trip_purpose"),
		tripStartDate: date("trip_start_date"),
		tripEndDate: date("trip_end_date"),
		tripTimeZone: text("trip_time_zone"),
		tripDestinations: jsonb("trip_destinations")
			.$type<TripDestination[]>()
			.default(sql`'[]'::jsonb`)
			.notNull(),
		detailsVersion: integer("details_version").default(1).notNull(),
		submissionCount: integer("submission_count").default(0).notNull(),
		submittedAt: timestamp("submitted_at", { withTimezone: true }),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		uniqueIndex("travelExpenseReport_id_org_idx").on(table.id, table.organizationId),
		index("travelExpenseReport_org_employee_status_idx").on(
			table.organizationId,
			table.employeeId,
			table.status,
		),
		check("travel_expense_report_kind_check", sql`${table.kind} IN ('standalone', 'trip')`),
		check(
			"travel_expense_report_status_check",
			sql`${table.status} IN ('draft', 'submitted', 'approved', 'rejected')`,
		),
		check(
			"travel_expense_report_submission_check",
			sql`${table.submissionCount} >= 0
			AND (${table.status} = 'draft' AND ${table.decidedAt} IS NULL
				OR ${table.status} = 'submitted' AND ${table.submissionCount} >= 1
					AND ${table.submittedAt} IS NOT NULL AND ${table.decidedAt} IS NULL
				OR ${table.status} IN ('approved', 'rejected') AND ${table.submissionCount} >= 1
					AND ${table.submittedAt} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
		),
		check(
			"travel_expense_report_trip_details_check",
			sql`(${table.kind} = 'standalone' AND ${table.tripPurpose} IS NULL
				AND ${table.tripStartDate} IS NULL AND ${table.tripEndDate} IS NULL
				AND ${table.tripTimeZone} IS NULL AND ${table.tripDestinations} = '[]'::jsonb)
			OR (${table.kind} = 'trip' AND ${table.tripTimeZone} IS NOT NULL
				AND jsonb_typeof(${table.tripDestinations}) = 'array'
				AND (${table.tripStartDate} IS NULL OR ${table.tripEndDate} IS NULL
					OR ${table.tripEndDate} >= ${table.tripStartDate}))`,
		),
	],
);

export const TRAVEL_EXPENSE_REPORT_ITEM_TYPES = ["receipt", "mileage"] as const;
export type TravelExpenseReportItemType = (typeof TRAVEL_EXPENSE_REPORT_ITEM_TYPES)[number];

// One expense of a report. Draft facts may be missing but are never malformed.
// `version` advances on every saved edit; a save based on an older version is
// refused, so a stale or concurrent save cannot overwrite a newer edit.
export const travelExpenseReportItem = pgTable(
	"travel_expense_report_item",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		type: text("type").$type<TravelExpenseReportItemType>().notNull(),
		position: integer("position").notNull(),
		expenseDate: date("expense_date"),
		category: text("category").$type<ReceiptExpenseCategory>(),
		description: text("description"),
		originalAmount: decimal("original_amount", { precision: 12, scale: 2 }),
		originalCurrency: text("original_currency"),
		paidBy: text("paid_by").$type<ExpensePayer>(),
		accountingReference: text("accounting_reference"),
		// Mileage items (#606): entered facts, priced by the effective policy;
		// the applied policy is stamped at submission (`mileage-item-store.ts`).
		mileageRoute: text("mileage_route"),
		mileageDistanceKm: decimal("mileage_distance_km", { precision: 8, scale: 2 }),
		mileageVehicle: text("mileage_vehicle").$type<MileageVehicle>(),
		mileagePolicy: jsonb("mileage_policy").$type<StampedMileagePolicy>(),
		version: integer("version").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_item_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseReportItem_id_org_idx").on(table.id, table.organizationId),
		uniqueIndex("travelExpenseReportItem_report_position_idx").on(table.reportId, table.position),
		check("travel_expense_report_item_type_check", sql`${table.type} IN ('receipt', 'mileage')`),
		check(
			"travel_expense_report_item_mileage_check",
			sql`(${table.type} = 'mileage' OR (${table.mileageRoute} IS NULL
				AND ${table.mileageDistanceKm} IS NULL AND ${table.mileageVehicle} IS NULL
				AND ${table.mileagePolicy} IS NULL))
			AND (${table.type} <> 'mileage' OR (${table.originalAmount} IS NULL
				AND ${table.originalCurrency} IS NULL AND ${table.category} IS NULL
				AND (${table.mileageDistanceKm} IS NULL OR ${table.mileageDistanceKm} > 0)
				AND (${table.mileageVehicle} IS NULL OR ${table.mileageVehicle} IN ('car', 'other_motor_vehicle'))))`,
		),
		check(
			"travel_expense_report_item_category_check",
			sql`${table.category} IS NULL OR ${table.category} IN ('transport', 'accommodation', 'meals', 'parking', 'other')`,
		),
		check(
			"travel_expense_report_item_paid_by_check",
			sql`${table.paidBy} IS NULL OR ${table.paidBy} IN ('employee', 'company')`,
		),
		check(
			"travel_expense_report_item_amount_check",
			sql`${table.originalAmount} IS NULL OR ${table.originalAmount} > 0`,
		),
	],
);

// A private receipt file of a report item. Written only by upload finalization
// under the report row lock while the report is a draft.
export const travelExpenseReportReceipt = pgTable(
	"travel_expense_report_receipt",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		itemId: uuid("item_id").notNull(),
		storageProvider: text("storage_provider").notNull(),
		storageBucket: text("storage_bucket"),
		storageKey: text("storage_key").notNull(),
		storageVersionId: text("storage_version_id"),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		checksumSha256: text("checksum_sha256").notNull(),
		uploadedBy: uuid("uploaded_by")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_receipt_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_report_receipt_item_fk",
			columns: [table.itemId, table.organizationId],
			foreignColumns: [travelExpenseReportItem.id, travelExpenseReportItem.organizationId],
		}).onDelete("cascade"),
		index("travelExpenseReportReceipt_item_idx").on(table.itemId),
		index("travelExpenseReportReceipt_report_idx").on(table.reportId),
		uniqueIndex("travelExpenseReportReceipt_org_storageKey_idx").on(
			table.organizationId,
			table.storageKey,
		),
	],
);

export const TRAVEL_EXPENSE_RECEIPT_UPLOAD_STATUSES = ["pending", "cleanup_required"] as const;
export type TravelExpenseReceiptUploadStatus =
	(typeof TRAVEL_EXPENSE_RECEIPT_UPLOAD_STATUSES)[number];

export const TRAVEL_EXPENSE_RECEIPT_CLEANUP_REASONS = [
	"claim_not_draft",
	"report_not_draft",
	"finalization_failed",
	"abandoned",
	"removed",
] as const;
export type TravelExpenseReceiptCleanupReason =
	(typeof TRAVEL_EXPENSE_RECEIPT_CLEANUP_REASONS)[number];

// Durable staging claim for one private receipt object. It is written before
// the object is stored and removed in the transaction that attaches it, so an
// upload that is rejected (claim or report no longer a draft), fails or is
// abandoned always leaves recoverable storage cleanup work; a receipt removed
// from a draft report returns here for deletion. Organization and owner are
// kept by value: cleanup must outlive owner and tenant deletion. The owner is
// either a legacy claim or a report item.
export const travelExpenseReceiptUpload = pgTable(
	"travel_expense_receipt_upload",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		claimId: uuid("claim_id"),
		reportId: uuid("report_id"),
		itemId: uuid("item_id"),
		uploadedBy: uuid("uploaded_by").notNull(),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		status: text("status").$type<TravelExpenseReceiptUploadStatus>().default("pending").notNull(),
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
				AND ${table.reason} IN ('claim_not_draft', 'report_not_draft', 'finalization_failed', 'abandoned', 'removed'))`,
		),
		check(
			"travel_expense_receipt_upload_owner_check",
			sql`(${table.claimId} IS NOT NULL AND ${table.reportId} IS NULL AND ${table.itemId} IS NULL)
			OR (${table.claimId} IS NULL AND ${table.reportId} IS NOT NULL AND ${table.itemId} IS NOT NULL)`,
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

// Organization travel expense settings (#602). The expense approver reviews a
// submitted report when neither a direct nor a team manager other than the
// requester is eligible; routing checks they are active in this organization.
export const travelExpenseSettings = pgTable("travel_expense_settings", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	expenseApproverEmployeeId: uuid("expense_approver_employee_id").references(() => employee.id, {
		onDelete: "set null",
	}),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

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
