import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	date,
	decimal,
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
import { currentTimestamp } from "./timestamp";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import {
	contractChangeBatchItem,
	contractDefault,
	type WorkPolicyAssignmentSourceKind,
} from "./contract";
import { employeeEmploymentHistory } from "./employment-history";
import {
	dayOfWeekEnum,
	holidayPresetAssignmentTypeEnum,
	presenceEnforcementEnum,
	presenceEvaluationPeriodEnum,
	presenceModeEnum,
	restPeriodEnforcementEnum,
	scheduleCycleEnum,
	scheduleTypeEnum,
	timeRegulationViolationTypeEnum,
	workingDaysPresetEnum,
} from "./enums";
import { employee, location, team } from "./organization";
import { workPeriod } from "./time-tracking";
import type { TimeRegulationBreakRulesPreset, TimeRegulationViolationDetails } from "./types";

// ============================================
// WORK POLICIES (unified schedules + regulations)
// ============================================

/**
 * Main work policy table - combines scheduling and regulation configuration.
 * Each policy can have BOTH schedule AND regulation enabled, or just one.
 */
export const workPolicy = pgTable(
	"work_policy",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Policy identification
		name: text("name").notNull(),
		description: text("description"),

		// Feature toggles - each policy can have schedule, regulation, or both
		scheduleEnabled: boolean("schedule_enabled").default(true).notNull(),
		regulationEnabled: boolean("regulation_enabled").default(true).notNull(),
		presenceEnabled: boolean("presence_enabled").default(false).notNull(),

		// Status flags
		isActive: boolean("is_active").default(true).notNull(),
		isDefault: boolean("is_default").default(false).notNull(),

		// Audit fields
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
		index("workPolicy_organizationId_idx").on(table.organizationId),
		index("workPolicy_isActive_idx").on(table.isActive),
		uniqueIndex("workPolicy_org_name_idx").on(table.organizationId, table.name),
		unique("work_policy_id_org_uidx").on(table.id, table.organizationId),
	],
);

/**
 * Effective-dated immutable version of a work policy (0318).
 * Carries versioned schedule/regulation/presence enablement flags and seal state.
 */
export const workPolicyVersion = pgTable(
	"work_policy_version",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").notNull(),
		versionNumber: integer("version_number").notNull(),
		effectiveFromDate: date("effective_from_date", { mode: "string" }).notNull(),
		scheduleEnabled: boolean("schedule_enabled").notNull(),
		regulationEnabled: boolean("regulation_enabled").notNull(),
		presenceEnabled: boolean("presence_enabled").notNull(),
		isLegacyBaseline: boolean("is_legacy_baseline").default(false).notNull(),
		sealedAt: timestamp("sealed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "work_policy_version_policy_fk",
			columns: [table.policyId, table.organizationId],
			foreignColumns: [workPolicy.id, workPolicy.organizationId],
		}).onDelete("cascade"),
		unique("work_policy_version_id_policy_unique").on(table.id, table.policyId),
		unique("work_policy_version_id_org_policy_unique").on(
			table.id,
			table.organizationId,
			table.policyId,
		),
		unique("work_policy_version_policy_version_number_unique").on(
			table.policyId,
			table.versionNumber,
		),
		index("workPolicyVersion_organizationId_idx").on(table.organizationId),
		index("workPolicyVersion_policy_effective_idx").on(
			table.policyId,
			table.effectiveFromDate.desc(),
			table.versionNumber.desc(),
		),
		check("work_policy_version_version_number_check", sql`"version_number" >= 1`),
		check(
			"work_policy_version_legacy_v1_check",
			sql`NOT "is_legacy_baseline" OR "version_number" = 1`,
		),
	],
);

/** Singleton cutover state row recording when Drain Gate 2 sealed legacy v1 policy versions. */
export const workPolicyVersioningState = pgTable(
	"work_policy_versioning_state",
	{
		singleton: boolean("singleton").default(true).primaryKey().notNull(),
		sealedCutoverAt: timestamp("sealed_cutover_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	() => [check("work_policy_versioning_state_singleton_check", sql`"singleton" = true`)],
);

// ============================================
// SCHEDULE CONFIGURATION (1:1 with workPolicy)
// ============================================

/**
 * Schedule configuration - defines expected work hours.
 * Only used when policy.scheduleEnabled = true.
 */
export const workPolicySchedule = pgTable(
	"work_policy_schedule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => workPolicy.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// Schedule configuration
		scheduleCycle: scheduleCycleEnum("schedule_cycle").default("weekly").notNull(),
		scheduleType: scheduleTypeEnum("schedule_type").default("simple").notNull(),

		// Working days configuration
		workingDaysPreset: workingDaysPresetEnum("working_days_preset").default("weekdays").notNull(),

		// Simple mode: total hours per cycle
		hoursPerCycle: decimal("hours_per_cycle", { precision: 6, scale: 2 }),

		// Home office allowance per cycle
		homeOfficeDaysPerCycle: integer("home_office_days_per_cycle").default(0),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicySchedule_policyId_idx").on(table.policyId),
		unique("work_policy_schedule_version_uidx").on(table.policyVersionId),
		unique("work_policy_schedule_id_version_uidx").on(table.id, table.policyVersionId),
		foreignKey({
			name: "work_policy_schedule_policy_version_fk",
			columns: [table.policyVersionId, table.policyId],
			foreignColumns: [workPolicyVersion.id, workPolicyVersion.policyId],
		}).onDelete("cascade"),
	],
);

/**
 * Day-by-day configuration for detailed schedules.
 * Only used when schedule.scheduleType = 'detailed'.
 */
export const workPolicyScheduleDay = pgTable(
	"work_policy_schedule_day",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		scheduleId: uuid("schedule_id")
			.notNull()
			.references(() => workPolicySchedule.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// Day configuration
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		hoursPerDay: decimal("hours_per_day", { precision: 4, scale: 2 }).notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),

		// For biweekly cycles: which week (1 or 2)
		cycleWeek: integer("cycle_week").default(1),

		// Latest clock-in (#830): local wall-clock "HH:mm" by which the employee is expected to
		// have clocked in on this work day. Null means no expected start.
		latestClockIn: text("latest_clock_in"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		check(
			"work_policy_schedule_day_latest_clock_in_check",
			sql`${table.latestClockIn} IS NULL OR ${table.latestClockIn} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
		),
		index("workPolicyScheduleDay_scheduleId_idx").on(table.scheduleId),
		uniqueIndex("workPolicyScheduleDay_unique_idx").on(
			table.scheduleId,
			table.dayOfWeek,
			table.cycleWeek,
		),
		foreignKey({
			name: "work_policy_schedule_day_schedule_version_fk",
			columns: [table.scheduleId, table.policyVersionId],
			foreignColumns: [workPolicySchedule.id, workPolicySchedule.policyVersionId],
		}).onDelete("cascade"),
	],
);

// ============================================
// PRESENCE CONFIGURATION (1:1 with workPolicyVersion)
// ============================================

/**
 * Presence configuration - defines on-site requirements.
 * Only used when policy.presenceEnabled = true.
 */
export const workPolicyPresence = pgTable(
	"work_policy_presence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => workPolicy.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// Mode: minimum count of days or fixed specific days
		presenceMode: presenceModeEnum("presence_mode").default("minimum_count").notNull(),

		// For minimum_count mode: minimum on-site days per evaluation period
		requiredOnsiteDays: integer("required_onsite_days"),

		// For fixed_days mode: JSON array of day_of_week values, e.g. ["monday","wednesday","friday"]
		requiredOnsiteFixedDays: text("required_onsite_fixed_days"),

		// Optional: restrict to a specific location (null = any on-site location)
		locationId: uuid("location_id").references(() => location.id, {
			onDelete: "no action",
		}),

		// How often to evaluate compliance
		evaluationPeriod: presenceEvaluationPeriodEnum("evaluation_period").default("weekly").notNull(),

		// Enforcement level
		enforcement: presenceEnforcementEnum("enforcement").default("warn").notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicyPresence_policyId_idx").on(table.policyId),
		index("workPolicyPresence_locationId_idx").on(table.locationId),
		unique("work_policy_presence_version_uidx").on(table.policyVersionId),
		foreignKey({
			name: "work_policy_presence_policy_version_fk",
			columns: [table.policyVersionId, table.policyId],
			foreignColumns: [workPolicyVersion.id, workPolicyVersion.policyId],
		}).onDelete("cascade"),
	],
);

// ============================================
// REGULATION CONFIGURATION (1:1 with workPolicyVersion)
// ============================================

/**
 * Regulation configuration - defines working time limits.
 * Only used when policy.regulationEnabled = true.
 */
export const workPolicyRegulation = pgTable(
	"work_policy_regulation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => workPolicy.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// Maximum working time limits (in minutes)
		maxDailyMinutes: integer("max_daily_minutes"), // e.g., 600 = 10 hours
		maxWeeklyMinutes: integer("max_weekly_minutes"), // e.g., 2880 = 48 hours
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"), // e.g., 360 = 6 hours

		// ============================================
		// ArbZG COMPLIANCE FIELDS
		// ============================================

		// 11-hour rest period rule (ArbZG §5)
		minRestPeriodMinutes: integer("min_rest_period_minutes"), // e.g., 660 = 11 hours
		restPeriodEnforcement: restPeriodEnforcementEnum("rest_period_enforcement").default("warn"),

		// Overtime thresholds (beyond normal working hours)
		overtimeDailyThresholdMinutes: integer("overtime_daily_threshold_minutes"), // e.g., 480 = 8h (overtime after 8h)
		overtimeWeeklyThresholdMinutes: integer("overtime_weekly_threshold_minutes"), // e.g., 2400 = 40h
		overtimeMonthlyThresholdMinutes: integer("overtime_monthly_threshold_minutes"), // e.g., 10800 = 180h

		// Proactive warning configuration
		alertBeforeLimitMinutes: integer("alert_before_limit_minutes").default(30), // Warn 30 min before limit
		alertThresholdPercent: integer("alert_threshold_percent").default(80), // Warn at 80% of limit

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicyRegulation_policyId_idx").on(table.policyId),
		unique("work_policy_regulation_version_uidx").on(table.policyVersionId),
		unique("work_policy_regulation_id_version_uidx").on(table.id, table.policyVersionId),
		foreignKey({
			name: "work_policy_regulation_policy_version_fk",
			columns: [table.policyVersionId, table.policyId],
			foreignColumns: [workPolicyVersion.id, workPolicyVersion.policyId],
		}).onDelete("cascade"),
	],
);

/**
 * Break rules - defines required breaks based on working time.
 * Example: "After 6 hours of work, 30 minutes break required"
 */
export const workPolicyBreakRule = pgTable(
	"work_policy_break_rule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		regulationId: uuid("regulation_id")
			.notNull()
			.references(() => workPolicyRegulation.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// Trigger condition: "In case of more than X minutes of working time"
		workingMinutesThreshold: integer("working_minutes_threshold").notNull(),
		// Required total break: "Y minutes of break are necessary"
		requiredBreakMinutes: integer("required_break_minutes").notNull(),

		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicyBreakRule_regulationId_idx").on(table.regulationId),
		index("workPolicyBreakRule_sortOrder_idx").on(table.regulationId, table.sortOrder),
		unique("work_policy_break_rule_id_version_uidx").on(table.id, table.policyVersionId),
		foreignKey({
			name: "work_policy_break_rule_regulation_version_fk",
			columns: [table.regulationId, table.policyVersionId],
			foreignColumns: [workPolicyRegulation.id, workPolicyRegulation.policyVersionId],
		}).onDelete("cascade"),
	],
);

/**
 * Break split options - defines how breaks can be split.
 * Example: "30 minutes can be taken as 2x15min or 3x10min"
 */
export const workPolicyBreakOption = pgTable(
	"work_policy_break_option",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		breakRuleId: uuid("break_rule_id")
			.notNull()
			.references(() => workPolicyBreakRule.id, { onDelete: "cascade" }),
		policyVersionId: uuid("policy_version_id").notNull(),

		// null = any number of splits allowed
		splitCount: integer("split_count"), // 1 = no split (take at once), 2 = two parts, 3 = three parts, null = any
		// Minimum duration per split (null if splitCount is 1)
		minimumSplitMinutes: integer("minimum_split_minutes"),
		// For "any number" option, the minimum for the longest split
		minimumLongestSplitMinutes: integer("minimum_longest_split_minutes"),

		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workPolicyBreakOption_breakRuleId_idx").on(table.breakRuleId),
		foreignKey({
			name: "work_policy_break_option_break_rule_version_fk",
			columns: [table.breakRuleId, table.policyVersionId],
			foreignColumns: [workPolicyBreakRule.id, workPolicyBreakRule.policyVersionId],
		}).onDelete("cascade"),
	],
);

// ============================================
// HIERARCHICAL ASSIGNMENT
// ============================================

/**
 * Assigns work policies to organizations, teams, or employees.
 * Uses priority system: 0=org, 1=team, 2=employee (higher wins).
 */
export const workPolicyAssignment = pgTable(
	"work_policy_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => workPolicy.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Assignment target
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),

		// Priority: 0=org, 1=team, 2=employee (higher wins)
		priority: integer("priority").default(0).notNull(),

		// Half-open effective interval [from, until); null means unbounded.
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),
		// Canonical calendar-date interval & provenance (0319/0322)
		effectiveFromDate: date("effective_from_date", { mode: "string" })
			.default("1970-01-01")
			.notNull(),
		effectiveUntilDate: date("effective_until_date", { mode: "string" }),
		sourceKind: text("source_kind")
			.$type<WorkPolicyAssignmentSourceKind>()
			.default("legacy")
			.notNull(),
		sourceContractDefaultId: uuid("source_contract_default_id"),
		sourceEmploymentHistoryId: uuid("source_employment_history_id"),
		sourceBatchItemId: uuid("source_batch_item_id"),

		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPolicyAssignment_policyId_idx").on(table.policyId),
		index("workPolicyAssignment_organizationId_idx").on(table.organizationId),
		index("workPolicyAssignment_teamId_idx").on(table.teamId),
		index("workPolicyAssignment_employeeId_idx").on(table.employeeId),
		index("workPolicyAssignment_employee_effective_idx").on(
			table.employeeId,
			table.effectiveFrom,
			table.effectiveUntil,
		),
		index("workPolicyAssignment_employee_active_idx").on(table.employeeId, table.isActive),
		uniqueIndex("workPolicyAssignment_source_batch_item_uidx")
			.on(table.sourceBatchItemId)
			.where(sql`"source_batch_item_id" IS NOT NULL`),
		foreignKey({
			name: "work_policy_assignment_policy_tenant_fk",
			columns: [table.policyId, table.organizationId],
			foreignColumns: [workPolicy.id, workPolicy.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "work_policy_assignment_team_tenant_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "work_policy_assignment_employee_tenant_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "work_policy_assignment_source_contract_default_fk",
			columns: [table.sourceContractDefaultId, table.organizationId],
			foreignColumns: [
				contractDefault.id as AnyPgColumn,
				contractDefault.organizationId as AnyPgColumn,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "work_policy_assignment_source_employment_history_fk",
			columns: [table.sourceEmploymentHistoryId, table.organizationId],
			foreignColumns: [
				employeeEmploymentHistory.id as AnyPgColumn,
				employeeEmploymentHistory.organizationId as AnyPgColumn,
			],
		}).onDelete("set null"),
		foreignKey({
			name: "work_policy_assignment_batch_item_fk",
			columns: [table.sourceBatchItemId, table.organizationId],
			foreignColumns: [
				contractChangeBatchItem.id as AnyPgColumn,
				contractChangeBatchItem.organizationId as AnyPgColumn,
			],
		}).onDelete("no action"),
		check(
			"work_policy_assignment_source_kind_check",
			sql`"source_kind" IN ('contract_default', 'employment_terms', 'manager_assignment', 'legacy')`,
		),
		check(
			"work_policy_assignment_scope_target_check",
			sql`((("assignment_type" = 'organization' AND "team_id" IS NULL AND "employee_id" IS NULL AND "priority" = 0) OR ("assignment_type" = 'team' AND "team_id" IS NOT NULL AND "employee_id" IS NULL AND "priority" = 1) OR ("assignment_type" = 'employee' AND "team_id" IS NULL AND "employee_id" IS NOT NULL AND "priority" = 2)) IS TRUE)`,
		),
		check(
			"work_policy_assignment_source_provenance_check",
			sql`((("source_kind" = 'contract_default' AND "assignment_type" IN ('organization', 'team') AND "source_contract_default_id" IS NOT NULL AND "source_employment_history_id" IS NULL) OR ("source_kind" = 'employment_terms' AND "assignment_type" = 'employee' AND "source_contract_default_id" IS NULL) OR ("source_kind" = 'manager_assignment' AND "assignment_type" = 'employee' AND "source_contract_default_id" IS NULL AND "source_employment_history_id" IS NULL) OR ("source_kind" = 'legacy' AND "source_contract_default_id" IS NULL AND "source_employment_history_id" IS NULL)) IS TRUE)`,
		),
		check(
			"work_policy_assignment_date_range_check",
			sql`"effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date"`,
		),
	],
);

// ============================================
// COMPLIANCE VIOLATIONS
// ============================================

/**
 * Tracks violations of working time regulations.
 * Used for compliance reporting and auditing.
 */
export const workPolicyViolation = pgTable(
	"work_policy_violation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		policyId: uuid("policy_id").references(() => workPolicy.id, {
			onDelete: "set null",
		}),
		policyVersionId: uuid("policy_version_id"),

		// What triggered the violation
		workPeriodId: uuid("work_period_id").references(() => workPeriod.id, {
			onDelete: "set null",
		}),
		violationDate: timestamp("violation_date").notNull(),

		violationType: timeRegulationViolationTypeEnum("violation_type").notNull(),

		// JSON with specifics: { actualMinutes, limitMinutes, breakTakenMinutes, breakRequiredMinutes }
		details: text("details").$type<TimeRegulationViolationDetails>(),

		// Acknowledgment tracking
		acknowledgedBy: uuid("acknowledged_by").references(() => employee.id),
		acknowledgedAt: timestamp("acknowledged_at"),
		acknowledgedNote: text("acknowledged_note"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workPolicyViolation_employeeId_idx").on(table.employeeId),
		index("workPolicyViolation_organizationId_idx").on(table.organizationId),
		index("workPolicyViolation_policyId_idx").on(table.policyId),
		index("workPolicyViolation_violationDate_idx").on(table.violationDate),
		index("workPolicyViolation_violationType_idx").on(table.violationType),
		index("workPolicyViolation_org_date_idx").on(table.organizationId, table.violationDate),
		index("workPolicyViolation_emp_date_idx").on(table.employeeId, table.violationDate),
		check(
			"work_policy_violation_version_requires_policy_check",
			sql`"policy_version_id" IS NULL OR "policy_id" IS NOT NULL`,
		),
		foreignKey({
			name: "work_policy_violation_policy_version_fk",
			columns: [table.policyVersionId, table.organizationId, table.policyId],
			foreignColumns: [
				workPolicyVersion.id,
				workPolicyVersion.organizationId,
				workPolicyVersion.policyId,
			],
		}).onDelete("no action"),
	],
);

// ============================================
// LABOR LAW PRESETS
// ============================================

/**
 * Global presets for common labor law configurations.
 * Organizations can import these as starting points.
 */
export const workPolicyPreset = pgTable(
	"work_policy_preset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		name: text("name").notNull(), // "German Labor Law", "EU Working Time Directive"
		description: text("description"),
		countryCode: text("country_code"), // ISO 3166-1 alpha-2 (null = international)

		// Schedule defaults
		scheduleCycle: scheduleCycleEnum("schedule_cycle").default("weekly"),
		workingDaysPreset: workingDaysPresetEnum("working_days_preset").default("weekdays"),
		hoursPerCycle: decimal("hours_per_cycle", { precision: 6, scale: 2 }),

		// Regulation limits
		maxDailyMinutes: integer("max_daily_minutes"),
		maxWeeklyMinutes: integer("max_weekly_minutes"),
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"),

		// JSON blob for break rules (denormalized for simplicity in presets)
		breakRulesJson: text("break_rules_json").$type<TimeRegulationBreakRulesPreset>(),

		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workPolicyPreset_organizationId_idx").on(table.organizationId),
		index("workPolicyPreset_countryCode_idx").on(table.countryCode),
		index("workPolicyPreset_isActive_idx").on(table.isActive),
		uniqueIndex("workPolicyPreset_system_name_idx")
			.on(table.name)
			.where(sql`${table.organizationId} IS NULL`),
		uniqueIndex("workPolicyPreset_org_name_idx")
			.on(table.organizationId, table.name)
			.where(sql`${table.organizationId} IS NOT NULL`),
	],
);
