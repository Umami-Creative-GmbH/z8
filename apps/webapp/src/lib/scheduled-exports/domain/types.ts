/**
 * Scheduled Exports Domain Types
 *
 * Core type definitions for the scheduled exports feature.
 * These types are used across all layers of the application.
 */
import type { DateTime } from "luxon";

// ============================================
// SCHEDULE CONFIGURATION
// ============================================

/**
 * Schedule frequency types
 */
export type ScheduleType = "daily" | "weekly" | "monthly" | "quarterly" | "cron";

/**
 * Schedule configuration interface
 */
export interface ScheduleConfig {
	type: ScheduleType;
	cronExpression?: string; // Required if type = "cron"
	timezone: string;
}

// ============================================
// DATE RANGE CONFIGURATION
// ============================================

/**
 * Date range calculation strategies
 */
export type DateRangeStrategy =
	| "previous_day"
	| "previous_week"
	| "previous_month"
	| "previous_quarter"
	| "custom_offset";

/**
 * Custom offset for date range calculation
 */
export interface CustomOffsetConfig {
	startOffset?: { days?: number; months?: number };
	endOffset?: { days?: number; months?: number };
}

/**
 * Date range configuration
 */
export interface DateRangeConfig {
	strategy: DateRangeStrategy;
	customOffset?: CustomOffsetConfig;
}

/**
 * Calculated date range result
 */
export interface CalculatedDateRange {
	start: DateTime;
	end: DateTime;
}

// ============================================
// REPORT CONFIGURATION
// ============================================

/**
 * Report types supported by scheduled exports
 */
export type ReportType = "payroll_export" | "data_export" | "audit_report";

/**
 * Payroll export report configuration
 */
export interface PayrollExportReportConfig {
	formatId: string; // "datev_lohn", "sage", "lexware", "personio"
	includeMetadata?: boolean;
}

/**
 * Data export report configuration
 */
export interface DataExportReportConfig {
	categories: string[]; // ["employees", "time_entries", "absences"]
	compressionLevel?: number;
}

/**
 * Audit report configuration
 */
export interface AuditReportConfig {
	auditEventTypes?: string[];
	includeMetadata?: boolean;
}

/**
 * Union of all report config types
 */
export type ReportConfig = PayrollExportReportConfig | DataExportReportConfig | AuditReportConfig;

// ============================================
// DELIVERY CONFIGURATION
// ============================================

/**
 * Delivery method options
 */
export type DeliveryMethod = "s3_only" | "email_only" | "s3_and_email";

/**
 * Delivery configuration
 */
export interface DeliveryConfig {
	method: DeliveryMethod;
	emailRecipients: string[];
	emailSubjectTemplate?: string;
	useOrgS3Config: boolean;
	customS3Prefix?: string;
}

// ============================================
// FILTER CONFIGURATION
// ============================================

/**
 * Static filter configuration applied to each execution
 */
export interface FilterConfig {
	employeeIds?: string[];
	teamIds?: string[];
	projectIds?: string[];
}

// ============================================
// SCHEDULED EXPORT DEFINITION
// ============================================

/**
 * Complete scheduled export definition
 */
export interface ScheduledExportDefinition {
	id: string;
	organizationId: string;
	name: string;
	description?: string;
	schedule: ScheduleConfig;
	reportType: ReportType;
	reportConfig: ReportConfig;
	payrollConfigId?: string;
	filters?: FilterConfig;
	dateRange: DateRangeConfig;
	delivery: DeliveryConfig;
	isActive: boolean;
	lastExecutionAt?: DateTime;
	nextExecutionAt?: DateTime;
	createdAt: DateTime;
	createdBy: string;
}

// ============================================
// EXECUTION RESULT
// ============================================

/**
 * Result of an export execution
 */
export interface ExecutionResult {
	success: boolean;
	underlyingJobId?: string;
	underlyingJobType?: string;
	s3Key?: string;
	s3Url?: string;
	fileSizeBytes?: number;
	recordCount?: number;
	error?: string;
}

/**
 * Email delivery error (matches db schema)
 */
export interface EmailError {
	recipient: string;
	error: string;
	timestamp: string;
}

/**
 * Result of email delivery
 */
export interface EmailDeliveryResult {
	sent: number;
	failed: number;
	errors?: EmailError[];
}

/**
 * Combined delivery result
 */
export interface DeliveryResult {
	s3Key?: string;
	s3Url?: string;
	emailsSent: number;
	emailsFailed: number;
	emailErrors?: EmailError[];
}

// ============================================
// PROCESSOR RESULT
// ============================================

/**
 * Result from scheduled exports processor job
 */
export interface ScheduledExportsProcessorResult {
	success: boolean;
	processed: number;
	succeeded: number;
	failed: number;
	errors: Array<{ scheduleId: string; error: string }>;
}

// ============================================
// PRESET SCHEDULE CONSTANTS
// ============================================

/**
 * Preset schedule descriptions for UI
 */
export const PRESET_SCHEDULES: Record<Exclude<ScheduleType, "cron">, { label: string; description: string }> = {
	daily: {
		label: "Daily",
		description: "Runs every day at midnight",
	},
	weekly: {
		label: "Weekly",
		description: "Runs every Monday at midnight",
	},
	monthly: {
		label: "Monthly",
		description: "Runs on the 1st of each month at midnight",
	},
	quarterly: {
		label: "Quarterly",
		description: "Runs on the 1st of Jan, Apr, Jul, Oct at midnight",
	},
};

/**
 * Date range strategy descriptions for UI
 */
export const DATE_RANGE_STRATEGIES: Record<DateRangeStrategy, { label: string; description: string }> = {
	previous_day: {
		label: "Previous Day",
		description: "Yesterday (00:00 - 23:59)",
	},
	previous_week: {
		label: "Previous Week",
		description: "Last week (Monday - Sunday)",
	},
	previous_month: {
		label: "Previous Month",
		description: "Last month (1st - last day)",
	},
	previous_quarter: {
		label: "Previous Quarter",
		description: "Last quarter (3 months)",
	},
	custom_offset: {
		label: "Custom Offset",
		description: "Custom date range offset",
	},
};
