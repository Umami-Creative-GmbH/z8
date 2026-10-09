import { sql } from "drizzle-orm";
import {
	boolean,
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
import { employee, team } from "./organization";
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

/**
 * Personnel file officer grants (#866, ADR 0001): the only way for someone
 * who is not an owner or admin to see and manage other employees' documents.
 * Scoped like payroll access and expense officer grants (all employees, or
 * named employees plus the current members of named teams) and to a
 * non-empty set of document categories. At most one active grant per officer;
 * a revoked grant stays inactive, a later grant for the same officer is a new
 * row. A departure revokes the grant the departed officer holds (#750 path).
 */
export const personnelFileOfficerGrant = pgTable(
	"personnel_file_officer_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		officerEmployeeId: uuid("officer_employee_id").notNull(),
		scope: text("scope").$type<"all" | "specific">().default("specific").notNull(),
		categories: text("categories").array().$type<DocumentCategory[]>().notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("personnelFileOfficerGrant_organizationId_idx").on(table.organizationId),
		index("personnelFileOfficerGrant_officerEmployeeId_idx").on(table.officerEmployeeId),
		unique("personnelFileOfficerGrant_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("personnelFileOfficerGrant_active_officer_idx")
			.on(table.organizationId, table.officerEmployeeId)
			.where(sql`is_active = true`),
		check("personnel_file_officer_grant_scope_check", sql`${table.scope} IN ('all', 'specific')`),
		check(
			"personnel_file_officer_grant_categories_check",
			sql`cardinality(${table.categories}) > 0
			AND ${table.categories} <@ ARRAY['contract', 'payslip', 'certificate', 'sick_note', 'other']::text[]`,
		),
		foreignKey({
			name: "personnel_file_officer_grant_officer_fk",
			columns: [table.officerEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

export const personnelFileOfficerTeam = pgTable(
	"personnel_file_officer_team",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id").notNull(),
		teamId: uuid("team_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("personnelFileOfficerTeam_organizationId_idx").on(table.organizationId),
		index("personnelFileOfficerTeam_teamId_idx").on(table.teamId),
		uniqueIndex("personnelFileOfficerTeam_grant_team_idx").on(table.grantId, table.teamId),
		foreignKey({
			name: "personnel_file_officer_team_grant_fk",
			columns: [table.grantId, table.organizationId],
			foreignColumns: [personnelFileOfficerGrant.id, personnelFileOfficerGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "personnel_file_officer_team_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
	],
);

export const personnelFileOfficerEmployee = pgTable(
	"personnel_file_officer_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("personnelFileOfficerEmployee_organizationId_idx").on(table.organizationId),
		index("personnelFileOfficerEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("personnelFileOfficerEmployee_grant_employee_idx").on(
			table.grantId,
			table.employeeId,
		),
		foreignKey({
			name: "personnel_file_officer_employee_grant_fk",
			columns: [table.grantId, table.organizationId],
			foreignColumns: [personnelFileOfficerGrant.id, personnelFileOfficerGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "personnel_file_officer_employee_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

/**
 * Retention periods (#870): how many whole years the organization keeps the
 * employee documents of one category after their retention start. A category
 * without a row has no period, so its documents never become due for deletion.
 */
export const personnelFileRetentionPeriod = pgTable(
	"personnel_file_retention_period",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		category: text("category").$type<DocumentCategory>().notNull(),
		retentionYears: integer("retention_years").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		uniqueIndex("personnelFileRetentionPeriod_org_category_idx").on(
			table.organizationId,
			table.category,
		),
		check(
			"personnel_file_retention_period_category_check",
			sql`${table.category} IN ('contract', 'payslip', 'certificate', 'sick_note', 'other')`,
		),
		check(
			"personnel_file_retention_period_years_check",
			sql`${table.retentionYears} BETWEEN 1 AND 100`,
		),
	],
);

/**
 * Documents the daily retention job already reported as due for deletion
 * (#870), per retention start: a rehire and a later departure give a new
 * retention start and report the document again. Gone with the document.
 */
export const personnelFileDueNotice = pgTable(
	"personnel_file_due_notice",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		documentId: uuid("document_id").notNull(),
		retentionStart: date("retention_start", { mode: "string" }).notNull(),
		/** The organization's calendar day the document was reported on. */
		noticedOn: date("noticed_on", { mode: "string" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("personnelFileDueNotice_document_start_idx").on(
			table.documentId,
			table.retentionStart,
		),
		index("personnelFileDueNotice_organizationId_idx").on(table.organizationId),
		foreignKey({
			name: "personnel_file_due_notice_document_fk",
			columns: [table.documentId, table.organizationId],
			foreignColumns: [employeeDocument.id, employeeDocument.organizationId],
		}).onDelete("cascade"),
	],
);

/**
 * One due-for-deletion reminder per recipient and organization day (#870):
 * the job claims a row before it notifies, so nobody is told twice a day.
 */
export const personnelFileDueReminder = pgTable(
	"personnel_file_due_reminder",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		localDate: date("local_date", { mode: "string" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("personnelFileDueReminder_org_user_date_idx").on(
			table.organizationId,
			table.userId,
			table.localDate,
		),
	],
);
