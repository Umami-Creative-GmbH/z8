import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "./timestamp";

export type LocaleTranslationMap = Record<string, string>;

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { approvalWorkflow } from "./approval-workflow";
import { absenceTypeEnum, approvalStatusEnum, dayPeriodEnum, sickDetailEnum } from "./enums";
import { employee } from "./organization";
import { timeRecord } from "./time-record";

// ============================================
// ABSENCE MANAGEMENT
// ============================================

// Configurable absence categories
export const absenceCategory = pgTable(
	"absence_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: absenceTypeEnum("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		nameTranslations: jsonb("name_translations").$type<LocaleTranslationMap | null>(),
		descriptionTranslations: jsonb("description_translations").$type<LocaleTranslationMap | null>(),
		requiresWorkTime: boolean("requires_work_time").default(false).notNull(), // Does work need to be logged on this day?
		requiresApproval: boolean("requires_approval").default(true).notNull(),
		countsAgainstVacation: boolean("counts_against_vacation").default(true).notNull(), // Determines if absence deducts from vacation balance
		// Time off in lieu (#1000): an approved absence keeps its days' required time, so the
		// work balance falls by it. Never combined with the vacation or work-time rules.
		drawsOnWorkBalance: boolean("draws_on_work_balance").default(false).notNull(),
		color: text("color"), // For UI display
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("absenceCategory_organizationId_idx").on(table.organizationId),
		unique("absenceCategory_id_organizationId_idx").on(table.id, table.organizationId),
		check(
			"absence_category_draws_on_work_balance_check",
			sql`NOT ${table.drawsOnWorkBalance} OR (NOT ${table.countsAgainstVacation} AND NOT ${table.requiresWorkTime})`,
		),
	],
);

/**
 * A built-in category added to an organization that existed before it (#1000). Each
 * row tells the organization's owners and admins once, in-app, that the category is
 * available; the delivery marks it delivered.
 */
export const absenceCategoryNotice = pgTable(
	"absence_category_notice",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => absenceCategory.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		deliveredAt: timestamp("delivered_at"),
	},
	(table) => [
		unique("absenceCategoryNotice_categoryId_unique").on(table.categoryId),
		index("absenceCategoryNotice_pending_idx").on(table.createdAt).where(sql`delivered_at IS NULL`),
	],
);

// Absence entries (sick days, vacation, etc.)
export const absenceEntry = pgTable(
	"absence_entry",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => absenceCategory.id),

		// Logical calendar dates (YYYY-MM-DD) - timezone-independent
		startDate: date("start_date").notNull(),
		startPeriod: dayPeriodEnum("start_period").default("full_day").notNull(),
		endDate: date("end_date").notNull(),
		endPeriod: dayPeriodEnum("end_period").default("full_day").notNull(),

		status: approvalStatusEnum("status").default("pending").notNull(),
		notes: text("notes"),
		sickDetail: sickDetailEnum("sick_detail"),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		// Legacy-to-canonical linkage used during big-bang cutover.
		canonicalRecordId: uuid("canonical_record_id"),
		approvalWorkflowId: uuid("approval_workflow_id"),

		// Approval tracking
		approvedBy: uuid("approved_by").references(() => employee.id),
		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("absenceEntry_employeeId_idx").on(table.employeeId),
		index("absenceEntry_startDate_idx").on(table.startDate),
		index("absenceEntry_status_idx").on(table.status),
		index("absenceEntry_org_canonicalRecordId_idx").on(
			table.organizationId,
			table.canonicalRecordId,
		),
		index("absenceEntry_categoryId_idx").on(table.categoryId),
		foreignKey({
			columns: [table.canonicalRecordId, table.organizationId],
			foreignColumns: [timeRecord.id, timeRecord.organizationId],
		}),
		foreignKey({
			columns: [table.approvalWorkflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}),
		check(
			"absence_entry_approval_workflow_organization_check",
			sql`${table.approvalWorkflowId} IS NULL OR ${table.organizationId} IS NOT NULL`,
		),
		index("absenceEntry_org_approvalWorkflowId_idx").on(
			table.organizationId,
			table.approvalWorkflowId,
		),
		index("absenceEntry_employeeId_status_idx").on(table.employeeId, table.status),
		// Target of org-scoped references such as a sick note's link (#982).
		unique("absenceEntry_id_organizationId_idx").on(table.id, table.organizationId),
	],
);

/**
 * Absence settings of an organization (#982). No row means the defaults.
 * Only owners and admins change them.
 */
export const absenceSetting = pgTable("absence_setting", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	/** Employees may attach sick notes to their sick-leave absences (needs personnel files). */
	employeeSickNoteUpload: boolean("employee_sick_note_upload").default(false).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => currentTimestamp())
		.notNull(),
	updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});
