/**
 * Scheduled Export Schema
 *
 * Defines database tables for recurring export configurations and execution tracking.
 * Supports payroll exports, data exports, and audit reports with flexible scheduling.
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import {
	scheduledExportScheduleTypeEnum,
	scheduledExportReportTypeEnum,
	scheduledExportDeliveryMethodEnum,
	scheduledExportDateRangeStrategyEnum,
	scheduledExportExecutionStatusEnum,
} from "./enums";
import { payrollExportConfig } from "./payroll-export";

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Report-specific configuration stored as JSONB
 */
export interface ScheduledExportReportConfig {
	// For payroll exports
	formatId?: string; // "datev_lohn", "sage", "lexware", "personio"

	// For data exports
	categories?: string[]; // ["employees", "time_entries", "absences"]

	// For audit reports
	auditEventTypes?: string[];

	// Common options
	includeMetadata?: boolean;
}

/**
 * Filter configuration stored as JSONB
 */
export interface ScheduledExportFilters {
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

/**
 * Custom date range offset configuration
 */
export interface ScheduledExportCustomOffset {
	startOffset?: { days?: number; months?: number };
	endOffset?: { days?: number; months?: number };
}

/**
 * Email error tracking
 */
export interface ScheduledExportEmailError {
	recipient: string;
	error: string;
	timestamp: string;
}

// ============================================
// SCHEDULED EXPORT DEFINITION TABLE
// ============================================

/**
 * Scheduled Export Definition
 * Master table for configured recurring exports
 */
export const scheduledExport = pgTable(
	"scheduled_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Schedule identification
		name: text("name").notNull(), // "Monthly Payroll Export"
		description: text("description"),

		// Schedule configuration
		scheduleType: scheduledExportScheduleTypeEnum("schedule_type").notNull(),
		cronExpression: text("cron_expression"), // Required if scheduleType = 'cron'
		timezone: text("timezone").default("UTC").notNull(),

		// Report configuration
		reportType: scheduledExportReportTypeEnum("report_type").notNull(),
		reportConfig: jsonb("report_config").$type<ScheduledExportReportConfig>().notNull(),

		// Reference to payroll config (for payroll exports)
		payrollConfigId: uuid("payroll_config_id").references(() => payrollExportConfig.id, {
			onDelete: "set null",
		}),

		// Static filters (applied to each execution)
		filters: jsonb("filters").$type<ScheduledExportFilters>(),

		// Date range configuration
		dateRangeStrategy: scheduledExportDateRangeStrategyEnum("date_range_strategy").notNull(),
		customOffset: jsonb("custom_offset").$type<ScheduledExportCustomOffset>(),

		// Delivery configuration
		deliveryMethod: scheduledExportDeliveryMethodEnum("delivery_method")
			.default("s3_and_email")
			.notNull(),
		emailRecipients: text("email_recipients").array().notNull(),
		emailSubjectTemplate: text("email_subject_template"),

		// S3 configuration
		useOrgS3Config: boolean("use_org_s3_config").default(true).notNull(),
		customS3Prefix: text("custom_s3_prefix"),

		// Status and scheduling
		isActive: boolean("is_active").default(true).notNull(),
		lastExecutionAt: timestamp("last_execution_at", { withTimezone: true }),
		nextExecutionAt: timestamp("next_execution_at", { withTimezone: true }),

		// Audit fields
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("scheduledExport_organizationId_idx").on(table.organizationId),
		index("scheduledExport_isActive_idx").on(table.isActive),
		index("scheduledExport_nextExecutionAt_idx").on(table.nextExecutionAt),
		index("scheduledExport_reportType_idx").on(table.reportType),
		// Composite index for finding due executions efficiently
		index("scheduledExport_active_nextExecution_idx")
			.on(table.isActive, table.nextExecutionAt)
			.where(sql`is_active = true`),
	],
);

// ============================================
// SCHEDULED EXPORT EXECUTION TABLE
// ============================================

/**
 * Scheduled Export Execution
 * Tracks individual execution runs of scheduled exports
 */
export const scheduledExportExecution = pgTable(
	"scheduled_export_execution",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		scheduledExportId: uuid("scheduled_export_id")
			.notNull()
			.references(() => scheduledExport.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Execution timing
		triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
		scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),

		// Calculated date range for this execution
		dateRangeStart: text("date_range_start").notNull(), // ISO date string
		dateRangeEnd: text("date_range_end").notNull(), // ISO date string

		// Status tracking
		status: scheduledExportExecutionStatusEnum("status").default("pending").notNull(),

		// Reference to underlying export job (polymorphic)
		underlyingJobId: uuid("underlying_job_id"),
		underlyingJobType: text("underlying_job_type"), // "payroll_export" | "data_export"

		// Results
		s3Key: text("s3_key"),
		s3Url: text("s3_url"), // Presigned URL (temporary)
		fileSizeBytes: integer("file_size_bytes"),
		recordCount: integer("record_count"),

		// Email delivery tracking
		emailsSent: integer("emails_sent").default(0),
		emailsFailed: integer("emails_failed").default(0),
		emailErrors: jsonb("email_errors").$type<ScheduledExportEmailError[]>(),

		// Error tracking
		errorMessage: text("error_message"),
		errorStack: text("error_stack"),

		// Timestamps
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
	},
	(table) => [
		index("scheduledExportExecution_scheduledExportId_idx").on(table.scheduledExportId),
		index("scheduledExportExecution_organizationId_idx").on(table.organizationId),
		index("scheduledExportExecution_status_idx").on(table.status),
		index("scheduledExportExecution_triggeredAt_idx").on(table.triggeredAt),
		// Composite for querying recent executions by schedule
		index("scheduledExportExecution_schedule_triggered_idx").on(
			table.scheduledExportId,
			table.triggeredAt,
		),
	],
);

// ============================================
// TYPE EXPORTS
// ============================================

export type ScheduledExport = typeof scheduledExport.$inferSelect;
export type NewScheduledExport = typeof scheduledExport.$inferInsert;
export type ScheduledExportExecution = typeof scheduledExportExecution.$inferSelect;
export type NewScheduledExportExecution = typeof scheduledExportExecution.$inferInsert;

// Schedule type enum values
export type ScheduledExportScheduleType = "daily" | "weekly" | "monthly" | "quarterly" | "cron";

// Report type enum values
export type ScheduledExportReportType = "payroll_export" | "data_export" | "audit_report";

// Delivery method enum values
export type ScheduledExportDeliveryMethod = "s3_only" | "email_only" | "s3_and_email";

// Date range strategy enum values
export type ScheduledExportDateRangeStrategy =
	| "previous_day"
	| "previous_week"
	| "previous_month"
	| "previous_quarter"
	| "custom_offset";

// Execution status enum values
export type ScheduledExportExecutionStatus = "pending" | "processing" | "completed" | "failed";
