import { sql } from "drizzle-orm";
import {
	boolean,
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
import { holidayPresetAssignmentTypeEnum, timeRegulationViolationTypeEnum } from "./enums";
import { employee, team } from "./organization";
import { workPeriod } from "./time-tracking";
import type { TimeRegulationBreakRulesPreset, TimeRegulationViolationDetails } from "./types";

// ============================================
// TIME REGULATIONS
// ============================================

// Main regulation template
export const timeRegulation = pgTable(
	"time_regulation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		description: text("description"),

		// Maximum working time limits (in minutes)
		maxDailyMinutes: integer("max_daily_minutes"), // e.g., 600 = 10 hours
		maxWeeklyMinutes: integer("max_weekly_minutes"), // e.g., 2880 = 48 hours
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"), // e.g., 360 = 6 hours

		isActive: boolean("is_active").default(true).notNull(),

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
		index("timeRegulation_organizationId_idx").on(table.organizationId),
		index("timeRegulation_isActive_idx").on(table.isActive),
		uniqueIndex("timeRegulation_org_name_idx").on(table.organizationId, table.name),
	],
);

// Break rules (1:N with regulation)
export const timeRegulationBreakRule = pgTable(
	"time_regulation_break_rule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		regulationId: uuid("regulation_id")
			.notNull()
			.references(() => timeRegulation.id, { onDelete: "cascade" }),

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
		index("timeRegulationBreakRule_regulationId_idx").on(table.regulationId),
		index("timeRegulationBreakRule_sortOrder_idx").on(table.regulationId, table.sortOrder),
	],
);

// Split options (1:N with break rule)
export const timeRegulationBreakOption = pgTable(
	"time_regulation_break_option",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		breakRuleId: uuid("break_rule_id")
			.notNull()
			.references(() => timeRegulationBreakRule.id, { onDelete: "cascade" }),

		// null = any number of splits allowed
		splitCount: integer("split_count"), // 1 = no split (take at once), 2 = two parts, 3 = three parts, null = any
		// Minimum duration per split (null if splitCount is 1)
		minimumSplitMinutes: integer("minimum_split_minutes"),
		// For "any number" option, the minimum for the longest split
		minimumLongestSplitMinutes: integer("minimum_longest_split_minutes"),

		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("timeRegulationBreakOption_breakRuleId_idx").on(table.breakRuleId)],
);

// Hierarchical assignment (reuses pattern from work schedules and holidays)
export const timeRegulationAssignment = pgTable(
	"time_regulation_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		regulationId: uuid("regulation_id")
			.notNull()
			.references(() => timeRegulation.id, { onDelete: "cascade" }),
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
		index("timeRegulationAssignment_regulationId_idx").on(table.regulationId),
		index("timeRegulationAssignment_organizationId_idx").on(table.organizationId),
		index("timeRegulationAssignment_teamId_idx").on(table.teamId),
		index("timeRegulationAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("timeRegulationAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("timeRegulationAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("timeRegulationAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

// Global presets (not org-specific) - for importable templates
export const timeRegulationPreset = pgTable(
	"time_regulation_preset",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		name: text("name").notNull().unique(), // "German Labor Law", "EU Working Time Directive"
		description: text("description"),
		countryCode: text("country_code"), // ISO 3166-1 alpha-2 (null = international)

		// Same fields as timeRegulation
		maxDailyMinutes: integer("max_daily_minutes"),
		maxWeeklyMinutes: integer("max_weekly_minutes"),
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes"),

		// JSON blob for break rules (denormalized for simplicity in presets)
		breakRulesJson: text("break_rules_json").$type<TimeRegulationBreakRulesPreset>(),

		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("timeRegulationPreset_countryCode_idx").on(table.countryCode),
		index("timeRegulationPreset_isActive_idx").on(table.isActive),
	],
);

// Compliance violations log
export const timeRegulationViolation = pgTable(
	"time_regulation_violation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		regulationId: uuid("regulation_id").references(() => timeRegulation.id, {
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
		index("timeRegulationViolation_employeeId_idx").on(table.employeeId),
		index("timeRegulationViolation_organizationId_idx").on(table.organizationId),
		index("timeRegulationViolation_regulationId_idx").on(table.regulationId),
		index("timeRegulationViolation_violationDate_idx").on(table.violationDate),
		index("timeRegulationViolation_violationType_idx").on(table.violationType),
		index("timeRegulationViolation_org_date_idx").on(table.organizationId, table.violationDate),
		index("timeRegulationViolation_emp_date_idx").on(table.employeeId, table.violationDate),
	],
);
