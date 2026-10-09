import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	DocumentCategory,
	DocumentVisibility,
	PersonnelFileCleanupReason,
	PersonnelFileUploadStatus,
} from "@/lib/personnel-file/document.types";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

/**
 * Employee documents of the personnel file (#865, Personnel File context).
 * One stored private object per row, written once by upload finalization;
 * metadata may change, the file never does (replacing means delete + upload).
 * Deleting a row (directly, through the employee or the organization) hands
 * its object to the cleanup ledger below through an AFTER DELETE trigger
 * (migration 0142), so storage is purged durably.
 */
export const employeeDocument = pgTable(
	"employee_document",
	{
		// App-generated: the storage key contains it before the row exists.
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		category: text("category").$type<DocumentCategory>().notNull(),
		title: text("title").notNull(),
		documentDate: date("document_date", { mode: "string" }).notNull(),
		payPeriodYear: integer("pay_period_year"),
		payPeriodMonth: integer("pay_period_month"),
		visibility: text("visibility").$type<DocumentVisibility>().notNull(),
		expiryDate: date("expiry_date", { mode: "string" }),
		storageProvider: text("storage_provider").notNull(),
		storageBucket: text("storage_bucket"),
		storageKey: text("storage_key").notNull(),
		storageVersionId: text("storage_version_id"),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		checksumSha256: text("checksum_sha256").notNull(),
		uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("employeeDocument_id_organizationId_idx").on(table.id, table.organizationId),
		foreignKey({
			name: "employee_document_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		index("employeeDocument_org_employee_category_idx").on(
			table.organizationId,
			table.employeeId,
			table.category,
		),
		uniqueIndex("employeeDocument_org_storageKey_idx").on(table.organizationId, table.storageKey),
		check(
			"employee_document_category_check",
			sql`${table.category} IN ('contract', 'payslip', 'certificate', 'sick_note', 'other')`,
		),
		check("employee_document_visibility_check", sql`${table.visibility} IN ('shared', 'hr_only')`),
		check(
			"employee_document_title_check",
			sql`char_length(btrim(${table.title})) BETWEEN 1 AND 200`,
		),
		check(
			"employee_document_pay_period_check",
			sql`(${table.category} = 'payslip'
				AND ${table.payPeriodYear} IS NOT NULL AND ${table.payPeriodMonth} IS NOT NULL
				AND ${table.payPeriodYear} BETWEEN 1900 AND 2999
				AND ${table.payPeriodMonth} BETWEEN 1 AND 12)
			OR (${table.category} <> 'payslip'
				AND ${table.payPeriodYear} IS NULL AND ${table.payPeriodMonth} IS NULL)`,
		),
		check(
			"employee_document_expiry_check",
			sql`${table.expiryDate} IS NULL OR ${table.category} IN ('certificate', 'other')`,
		),
		check("employee_document_size_check", sql`${table.sizeBytes} > 0`),
	],
);

/**
 * Durable staging and cleanup ledger for personnel file objects, shaped like
 * the receipt ledger (`travel_expense_receipt_upload`). A row is written
 * before an object is stored and removed in the transaction that records the
 * document; a failed, abandoned or deleted document's object stays here
 * until the cleanup worker deleted it. Organization and employee are kept by
 * value so cleanup outlives tenant deletion.
 */
export const personnelFileUpload = pgTable(
	"personnel_file_upload",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		uploadedBy: text("uploaded_by"),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		status: text("status").$type<PersonnelFileUploadStatus>().default("pending").notNull(),
		reason: text("reason").$type<PersonnelFileCleanupReason>(),
		attempts: integer("attempts").default(0).notNull(),
		lastError: text("last_error"),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("personnelFileUpload_org_storageKey_idx").on(
			table.organizationId,
			table.storageKey,
		),
		index("personnelFileUpload_status_nextAttemptAt_idx").on(table.status, table.nextAttemptAt),
		check(
			"personnel_file_upload_status_check",
			sql`${table.status} IN ('pending', 'cleanup_required')`,
		),
		check(
			"personnel_file_upload_reason_check",
			sql`(${table.status} = 'pending' AND ${table.reason} IS NULL)
			OR (${table.status} = 'cleanup_required'
				AND ${table.reason} IN ('finalization_failed', 'abandoned', 'removed'))`,
		),
	],
);
