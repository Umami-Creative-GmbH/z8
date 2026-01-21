import { sql } from "drizzle-orm";
import {
	boolean,
	decimal,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import {
	dayOfWeekEnum,
	holidayPresetAssignmentTypeEnum,
	scheduleCycleEnum,
	scheduleTypeEnum,
	timeRegulationViolationTypeEnum,
	workingDaysPresetEnum,
} from "./enums";
import { employee, team } from "./organization";
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
	],
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
			.unique()
			.references(() => workPolicy.id, { onDelete: "cascade" }),

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
	(table) => [index("workPolicySchedule_policyId_idx").on(table.policyId)],
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

		// Day configuration
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		hoursPerDay: decimal("hours_per_day", { precision: 4, scale: 2 }).notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),

		// For biweekly cycles: which week (1 or 2)
		cycleWeek: integer("cycle_week").default(1),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workPolicyScheduleDay_scheduleId_idx").on(table.scheduleId),
		uniqueIndex("workPolicyScheduleDay_unique_idx").on(
			table.scheduleId,
			table.dayOfWeek,
			table.cycleWeek,
		),
	],
);

// ============================================
// REGULATION CONFIGURATION (1:1 with workPolicy)
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
			.unique()
			.references(() => workPolicy.id, { onDelete: "cascade" }),

		// Maximum working time limits (in minutes)
		maxDailyMinutes: integer("max_daily_minutes"), // e.g., 600 = 10 hours
		maxWeeklyMinutes: integer("max_weekly_minutes"), // e.g., 2880 = 48 hours
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"), // e.g., 360 = 6 hours

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("workPolicyRegulation_policyId_idx").on(table.policyId)],
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

		// null = any number of splits allowed
		splitCount: integer("split_count"), // 1 = no split (take at once), 2 = two parts, 3 = three parts, null = any
		// Minimum duration per split (null if splitCount is 1)
		minimumSplitMinutes: integer("minimum_split_minutes"),
		// For "any number" option, the minimum for the longest split
		minimumLongestSplitMinutes: integer("minimum_longest_split_minutes"),

		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("workPolicyBreakOption_breakRuleId_idx").on(table.breakRuleId)],
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

		// Effective dates
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),

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
		// One org default per organization
		uniqueIndex("workPolicyAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("workPolicyAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("workPolicyAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
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

		name: text("name").notNull().unique(), // "German Labor Law", "EU Working Time Directive"
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
		index("workPolicyPreset_countryCode_idx").on(table.countryCode),
		index("workPolicyPreset_isActive_idx").on(table.isActive),
	],
);
