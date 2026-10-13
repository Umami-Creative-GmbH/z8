import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { exportStatusEnum } from "./enums";
import { employee } from "./organization";

// ============================================
// PERSONAL DATA EXPORTS (#811)
// ============================================

/**
 * Who started a personal data export (Organization glossary): the employee for
 * themselves (employee export) or an org admin on the employee's behalf
 * (admin export, which also holds the withheld data).
 */
export const PERSONAL_DATA_EXPORT_KINDS = ["employee", "admin"] as const;
export type PersonalDataExportKind = (typeof PERSONAL_DATA_EXPORT_KINDS)[number];

/**
 * One personal data export: a ZIP of everything one organization holds about
 * one employee, built by the worker and kept privately for 7 days. Separate
 * from the org-wide `data_export`; neither blocks the other.
 *
 * - At most one export per employee is pending or processing, whoever started
 *   it (partial unique index `personalDataExport_one_in_progress_idx`).
 * - The storage location is a secret: it never leaves the server. Downloads
 *   re-sign a short-lived URL for the signed-in requester.
 * - Deleting the row (expiry, or a cascade from the employee or organization)
 *   hands a stored file to `personal_data_export_file_cleanup` through the
 *   `personal_data_export_cleanup` trigger, so no file outlives its row.
 */
export const personalDataExport = pgTable(
	"personal_data_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Whose data the export holds. */
		employeeId: uuid("employee_id").notNull(),
		kind: text("kind").$type<PersonalDataExportKind>().notNull(),
		/** Who started it; null once that user is deleted. */
		requestedByUserId: text("requested_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		status: exportStatusEnum("status").default("pending").notNull(),
		/** A machine-readable failure reason; never a raw error message. */
		errorCode: text("error_code"),
		storageKey: text("storage_key"),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		sizeBytes: integer("size_bytes"),
		checksumSha256: text("checksum_sha256"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		/** When the row and its file are deleted: 7 days after completion (or the request). */
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "personal_data_export_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("personalDataExport_one_in_progress_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`status IN ('pending', 'processing')`),
		index("personalDataExport_org_employee_createdAt_idx").on(
			table.organizationId,
			table.employeeId,
			table.createdAt,
		),
		index("personalDataExport_org_requester_createdAt_idx").on(
			table.organizationId,
			table.requestedByUserId,
			table.createdAt,
		),
		index("personalDataExport_expiresAt_idx").on(table.expiresAt),
		check("personal_data_export_kind_check", sql`kind IN ('employee', 'admin')`),
		check(
			"personal_data_export_completed_file_check",
			sql`status <> 'completed' OR (storage_key IS NOT NULL AND completed_at IS NOT NULL)`,
		),
	],
);

/**
 * Stored personal data export files whose row is gone, waiting for the sweep
 * to delete them. Kept by value (no foreign keys) so it outlives the employee
 * and the organization. Filled only by the `personal_data_export_cleanup`
 * trigger.
 */
export const personalDataExportFileCleanup = pgTable(
	"personal_data_export_file_cleanup",
	{
		/** The deleted export's id. */
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		storageKey: text("storage_key").notNull(),
		storageBucket: text("storage_bucket"),
		storageVersionId: text("storage_version_id"),
		attempts: integer("attempts").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index("personalDataExportFileCleanup_nextAttemptAt_idx").on(table.nextAttemptAt)],
);
