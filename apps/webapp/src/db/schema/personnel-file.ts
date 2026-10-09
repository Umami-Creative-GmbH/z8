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
