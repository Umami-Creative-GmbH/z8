import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { payrollExportFormatEnum, payrollExportStatusEnum } from "./enums";
import { employee, team } from "./organization";
import { project } from "./project";
import { absenceCategory } from "./absence";
import { workCategory } from "./work-category";

// ============================================
// PAYROLL EXPORT
// ============================================

/**
 * Payroll export format definitions (DATEV, SAGE, etc.)
 * This is a registry of available export formats with their metadata
 */
export const payrollExportFormat = pgTable(
	"payroll_export_format",
	{
		id: text("id").primaryKey(), // "datev_lohn", "sage", etc.
		name: text("name").notNull(), // "DATEV Lohn & Gehalt"
		version: text("version").notNull(), // "2024.1"
		description: text("description"),
		isEnabled: boolean("is_enabled").default(true).notNull(),
		requiresConfiguration: boolean("requires_configuration").default(true).notNull(),

		// Format capabilities
		supportsAsync: boolean("supports_async").default(true).notNull(),
		syncThreshold: integer("sync_threshold").default(100), // Max work periods for sync export

		// Metadata
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("payrollExportFormat_isEnabled_idx").on(table.isEnabled)],
);

/**
 * Organization-specific payroll export configuration
 * Stores master data like DATEV client/consultant numbers
 */
export const payrollExportConfig = pgTable(
	"payroll_export_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		formatId: text("format_id")
			.notNull()
			.references(() => payrollExportFormat.id, { onDelete: "cascade" }),

		// Format-specific configuration stored as JSON
		// For DATEV: { mandantennummer, beraternummer, personnelNumberType }
		config: jsonb("config").$type<Record<string, unknown>>().notNull(),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Audit
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
		index("payrollExportConfig_organizationId_idx").on(table.organizationId),
		index("payrollExportConfig_formatId_idx").on(table.formatId),
		// One active config per format per organization
		uniqueIndex("payrollExportConfig_org_format_active_idx")
			.on(table.organizationId, table.formatId)
			.where(sql`is_active = true`),
	],
);

/**
 * Wage type mappings (normalized)
 * Maps work categories and absence types to payroll-specific codes
 * Example: "Working time" → DATEV code 1000, "Vacation" → 1600
 */
export const payrollWageTypeMapping = pgTable(
	"payroll_wage_type_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		configId: uuid("config_id")
			.notNull()
			.references(() => payrollExportConfig.id, { onDelete: "cascade" }),

		// Source: either a work category OR an absence category OR a special type
		workCategoryId: uuid("work_category_id").references(() => workCategory.id, {
			onDelete: "cascade",
		}),
		absenceCategoryId: uuid("absence_category_id").references(() => absenceCategory.id, {
			onDelete: "cascade",
		}),
		// Special categories not covered by work/absence categories
		// e.g., "overtime", "holiday_compensation", "overtime_reduction"
		specialCategory: text("special_category"),

		// Legacy generic wage type code (deprecated - use format-specific columns)
		wageTypeCode: text("wage_type_code").notNull().default(""), // Kept for backwards compatibility
		wageTypeName: text("wage_type_name"), // Kept for backwards compatibility

		// Format-specific wage type codes
		datevWageTypeCode: text("datev_wage_type_code"), // e.g., "1000", "1900"
		datevWageTypeName: text("datev_wage_type_name"), // e.g., "Arbeitszeit"
		lexwareWageTypeCode: text("lexware_wage_type_code"), // e.g., "100", "200"
		lexwareWageTypeName: text("lexware_wage_type_name"), // e.g., "Lohn"
		sageWageTypeCode: text("sage_wage_type_code"), // e.g., "1000", "1600"
		sageWageTypeName: text("sage_wage_type_name"), // e.g., "Arbeitszeit"
		successFactorsTimeTypeCode: text("successfactors_time_type_code"), // e.g., "REGULAR", "OVERTIME"
		successFactorsTimeTypeName: text("successfactors_time_type_name"), // e.g., "Regular Hours"

		// Additional mapping configuration
		factor: numeric("factor", { precision: 4, scale: 2 }).default("1.00"), // Override category factor
		isActive: boolean("is_active").default(true).notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("payrollWageTypeMapping_configId_idx").on(table.configId),
		index("payrollWageTypeMapping_workCategoryId_idx").on(table.workCategoryId),
		index("payrollWageTypeMapping_absenceCategoryId_idx").on(table.absenceCategoryId),
		// Unique constraint: one mapping per work category per config
		uniqueIndex("payrollWageTypeMapping_config_workCategory_idx")
			.on(table.configId, table.workCategoryId)
			.where(sql`work_category_id IS NOT NULL AND is_active = true`),
		// Unique constraint: one mapping per absence category per config
		uniqueIndex("payrollWageTypeMapping_config_absenceCategory_idx")
			.on(table.configId, table.absenceCategoryId)
			.where(sql`absence_category_id IS NOT NULL AND is_active = true`),
		// Unique constraint: one mapping per special category per config
		uniqueIndex("payrollWageTypeMapping_config_specialCategory_idx")
			.on(table.configId, table.specialCategory)
			.where(sql`special_category IS NOT NULL AND is_active = true`),
	],
);

// Type for payroll export job filters stored as JSON
export interface PayrollExportJobFilters {
	dateRange: {
		start: string; // ISO date string
		end: string; // ISO date string
	};
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

/**
 * Payroll export jobs
 * Tracks export requests with filters and status
 */
export const payrollExportJob = pgTable(
	"payroll_export_job",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		configId: uuid("config_id")
			.notNull()
			.references(() => payrollExportConfig.id, { onDelete: "cascade" }),
		requestedById: uuid("requested_by_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// Export filters (stored as JSON for flexibility)
		filters: jsonb("filters").$type<PayrollExportJobFilters>().notNull(),

		// Execution mode
		isAsync: boolean("is_async").default(false).notNull(),

		// Status tracking
		status: payrollExportStatusEnum("status").default("pending").notNull(),
		errorMessage: text("error_message"),

		// Results
		fileName: text("file_name"), // Generated file name
		s3Key: text("s3_key"), // Path in S3 bucket (for async exports)
		fileSizeBytes: integer("file_size_bytes"),
		workPeriodCount: integer("work_period_count"), // Total periods processed
		employeeCount: integer("employee_count"), // Total employees in export

		// API export results (for Personio and similar)
		syncedRecordCount: integer("synced_record_count"), // Successfully synced to external system
		failedRecordCount: integer("failed_record_count"), // Failed to sync

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		expiresAt: timestamp("expires_at"), // When S3 object should be deleted
	},
	(table) => [
		index("payrollExportJob_organizationId_idx").on(table.organizationId),
		index("payrollExportJob_configId_idx").on(table.configId),
		index("payrollExportJob_requestedById_idx").on(table.requestedById),
		index("payrollExportJob_status_idx").on(table.status),
		index("payrollExportJob_createdAt_idx").on(table.createdAt),
		// Composite index for finding pending async jobs
		index("payrollExportJob_status_isAsync_idx").on(table.status, table.isAsync),
	],
);

/**
 * Payroll export sync records
 * Tracks individual record sync status for API-based exports (Personio, etc.)
 * Enables partial success handling and selective retry
 */
export const payrollExportSyncRecord = pgTable(
	"payroll_export_sync_record",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => payrollExportJob.id, { onDelete: "cascade" }),

		// Record identification
		recordType: text("record_type").notNull(), // "attendance" | "absence"
		sourceRecordId: uuid("source_record_id").notNull(), // workPeriod.id or absenceEntry.id
		employeeId: uuid("employee_id").notNull(),

		// Sync status
		status: text("status").notNull(), // "pending" | "synced" | "failed" | "skipped"
		externalId: text("external_id"), // ID returned by external system (e.g., Personio)

		// Error tracking
		errorMessage: text("error_message"),
		isRetryable: boolean("is_retryable").default(true),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastAttemptAt: timestamp("last_attempt_at"),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		syncedAt: timestamp("synced_at"),
	},
	(table) => [
		index("payrollExportSyncRecord_jobId_idx").on(table.jobId),
		index("payrollExportSyncRecord_status_idx").on(table.status),
		index("payrollExportSyncRecord_sourceRecordId_idx").on(table.sourceRecordId),
		// Composite index for retry queries
		index("payrollExportSyncRecord_job_status_retryable_idx").on(
			table.jobId,
			table.status,
			table.isRetryable,
		),
	],
);
