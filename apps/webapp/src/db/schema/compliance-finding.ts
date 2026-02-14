import { index, integer, jsonb, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import {
	complianceFindingSeverityEnum,
	complianceFindingStatusEnum,
	complianceFindingTypeEnum,
} from "./enums";
import { employee } from "./organization";
import { workPolicy } from "./work-policy";
import { complianceException } from "./compliance";

// ============================================
// COMPLIANCE FINDING EVIDENCE TYPES
// ============================================

export type RestPeriodInsufficientEvidence = {
	type: "rest_period_insufficient";
	lastClockOutTime: string; // ISO timestamp
	nextClockInTime: string; // ISO timestamp
	actualRestMinutes: number;
	requiredRestMinutes: number;
	shortfallMinutes: number;
};

export type MaxHoursDailyExceededEvidence = {
	type: "max_hours_daily_exceeded";
	date: string; // ISO date
	workedMinutes: number;
	limitMinutes: number;
	exceedanceMinutes: number;
	workPeriodIds: string[];
};

export type MaxHoursWeeklyExceededEvidence = {
	type: "max_hours_weekly_exceeded";
	weekStartDate: string; // ISO date
	weekEndDate: string; // ISO date
	workedMinutes: number;
	limitMinutes: number;
	exceedanceMinutes: number;
	workPeriodIds: string[];
};

export type ConsecutiveDaysExceededEvidence = {
	type: "consecutive_days_exceeded";
	consecutiveDays: number;
	maxAllowedDays: number;
	startDate: string; // ISO date
	endDate: string; // ISO date
	workDates: string[]; // ISO dates
};

export type PresenceRequirementEvidence = {
	type: "presence_requirement";
	mode: "minimum_count" | "fixed_days";
	evaluationStart: string; // ISO date
	evaluationEnd: string; // ISO date
	requiredDays: number;
	actualOnsiteDays: number;
	// For fixed_days mode: which required days were missed
	missedDays?: string[]; // day_of_week values, e.g. ["monday", "wednesday"]
	// Days excluded from evaluation (sick, vacation, holiday)
	excludedDays: string[]; // ISO dates
	excludedReasons: string[]; // "sick", "vacation", "holiday", etc.
	// Work periods that counted as on-site
	onsiteWorkPeriodIds: string[];
	// Location constraint (null = any)
	locationId: string | null;
	locationName: string | null;
};

export type ComplianceFindingEvidence =
	| RestPeriodInsufficientEvidence
	| MaxHoursDailyExceededEvidence
	| MaxHoursWeeklyExceededEvidence
	| ConsecutiveDaysExceededEvidence
	| PresenceRequirementEvidence;

// ============================================
// COMPLIANCE FINDING TABLE
// ============================================

/**
 * Tracks detected compliance violations for audit and reporting.
 * Created by nightly detection job, managed by managers/admins.
 */
export const complianceFinding = pgTable(
	"compliance_finding",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Organization scoping - CRITICAL for multi-tenancy
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Employee who has the finding
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// Finding classification
		type: complianceFindingTypeEnum("type").notNull(),
		severity: complianceFindingSeverityEnum("severity").notNull(),

		// Time range affected
		occurrenceDate: timestamp("occurrence_date", { withTimezone: true }).notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

		// Evidence payload (JSON with typed interface)
		evidence: jsonb("evidence").$type<ComplianceFindingEvidence>().notNull(),

		// Status tracking
		status: complianceFindingStatusEnum("status").default("open").notNull(),

		// Acknowledgment
		acknowledgedBy: uuid("acknowledged_by").references(() => employee.id),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
		acknowledgmentNote: text("acknowledgment_note"),

		// Waiver (requires admin approval)
		waivedBy: uuid("waived_by").references(() => employee.id),
		waivedAt: timestamp("waived_at", { withTimezone: true }),
		waiverReason: text("waiver_reason"),

		// Resolution
		resolvedBy: uuid("resolved_by").references(() => employee.id),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolutionNote: text("resolution_note"),

		// Link to work policy if applicable
		workPolicyId: uuid("work_policy_id").references(() => workPolicy.id, {
			onDelete: "set null",
		}),

		// Link to compliance exception if pre-approved
		exceptionId: uuid("exception_id").references(() => complianceException.id, {
			onDelete: "set null",
		}),

		// Audit fields
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("complianceFinding_organizationId_idx").on(table.organizationId),
		index("complianceFinding_employeeId_idx").on(table.employeeId),
		index("complianceFinding_type_idx").on(table.type),
		index("complianceFinding_severity_idx").on(table.severity),
		index("complianceFinding_status_idx").on(table.status),
		index("complianceFinding_occurrenceDate_idx").on(table.occurrenceDate),
		// Composite indexes for common queries
		index("complianceFinding_org_status_idx").on(table.organizationId, table.status),
		index("complianceFinding_org_status_severity_idx").on(
			table.organizationId,
			table.status,
			table.severity,
		),
		index("complianceFinding_org_date_idx").on(table.organizationId, table.occurrenceDate),
		index("complianceFinding_emp_status_idx").on(table.employeeId, table.status),
	],
);

// ============================================
// COMPLIANCE CONFIG TABLE
// ============================================

/**
 * Per-organization configuration for compliance radar detection.
 * Separate from work policy regulation to allow independent control.
 */
export const complianceConfig = pgTable(
	"compliance_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.unique()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Detection rules (which violations to track)
		detectRestPeriodViolations: boolean("detect_rest_period_violations").default(true).notNull(),
		detectMaxHoursDaily: boolean("detect_max_hours_daily").default(true).notNull(),
		detectMaxHoursWeekly: boolean("detect_max_hours_weekly").default(true).notNull(),
		detectConsecutiveDays: boolean("detect_consecutive_days").default(true).notNull(),
		detectPresenceRequirement: boolean("detect_presence_requirement").default(true).notNull(),

		// Thresholds (can override work policy for compliance radar purposes)
		restPeriodMinutes: integer("rest_period_minutes"), // null = use work policy (default 660 = 11h)
		maxDailyMinutes: integer("max_daily_minutes"), // null = use work policy
		maxWeeklyMinutes: integer("max_weekly_minutes"), // null = use work policy
		maxConsecutiveDays: integer("max_consecutive_days").default(6), // Default: 6 days max

		// Visibility settings
		employeeVisibility: boolean("employee_visibility").default(false).notNull(),

		// Notification settings
		notifyManagers: boolean("notify_managers").default(true).notNull(),
		notifyOnSeverity: complianceFindingSeverityEnum("notify_on_severity").default("warning").notNull(),
		teamsDigestEnabled: boolean("teams_digest_enabled").default(false).notNull(),

		// Auto-resolution after N days (0 = disabled)
		autoResolveAfterDays: integer("auto_resolve_after_days").default(90).notNull(),

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
	(table) => [index("complianceConfig_organizationId_idx").on(table.organizationId)],
);

// ============================================
// TYPE EXPORTS
// ============================================

export type ComplianceFinding = typeof complianceFinding.$inferSelect;
export type NewComplianceFinding = typeof complianceFinding.$inferInsert;
export type ComplianceConfig = typeof complianceConfig.$inferSelect;
export type NewComplianceConfig = typeof complianceConfig.$inferInsert;

export type ComplianceFindingType = ComplianceFinding["type"];
export type ComplianceFindingSeverity = ComplianceFinding["severity"];
export type ComplianceFindingStatus = ComplianceFinding["status"];
