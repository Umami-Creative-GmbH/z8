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
	workingDaysPresetEnum,
} from "./enums";
import { employee, team } from "./organization";

// ============================================
// WORK SCHEDULE TEMPLATES
// ============================================

// Reusable work schedule templates
export const workScheduleTemplate = pgTable(
	"work_schedule_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Template identification
		name: text("name").notNull(),
		description: text("description"),

		// Schedule configuration
		scheduleCycle: scheduleCycleEnum("schedule_cycle").default("weekly").notNull(),
		scheduleType: scheduleTypeEnum("schedule_type").default("simple").notNull(),

		// Working days configuration
		workingDaysPreset: workingDaysPresetEnum("working_days_preset").default("weekdays").notNull(),

		// Simple mode: total hours per cycle
		hoursPerCycle: decimal("hours_per_cycle", { precision: 6, scale: 2 }),

		// Home office allowance per cycle
		homeOfficeDaysPerCycle: integer("home_office_days_per_cycle").default(0),

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
		index("workScheduleTemplate_organizationId_idx").on(table.organizationId),
		index("workScheduleTemplate_isActive_idx").on(table.isActive),
		uniqueIndex("workScheduleTemplate_org_name_idx").on(table.organizationId, table.name),
	],
);

// Day-by-day configuration for detailed schedules
export const workScheduleTemplateDays = pgTable(
	"work_schedule_template_days",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateId: uuid("template_id")
			.notNull()
			.references(() => workScheduleTemplate.id, { onDelete: "cascade" }),

		// Day configuration
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		hoursPerDay: decimal("hours_per_day", { precision: 4, scale: 2 }).notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),

		// For biweekly cycles: which week (1 or 2)
		cycleWeek: integer("cycle_week").default(1),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workScheduleTemplateDays_templateId_idx").on(table.templateId),
		uniqueIndex("workScheduleTemplateDays_unique_idx").on(
			table.templateId,
			table.dayOfWeek,
			table.cycleWeek,
		),
	],
);

// Hierarchical assignment of templates to organizations, teams, or employees
export const workScheduleAssignment = pgTable(
	"work_schedule_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateId: uuid("template_id")
			.notNull()
			.references(() => workScheduleTemplate.id, { onDelete: "cascade" }),
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

		// Status
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
		index("workScheduleAssignment_templateId_idx").on(table.templateId),
		index("workScheduleAssignment_organizationId_idx").on(table.organizationId),
		index("workScheduleAssignment_teamId_idx").on(table.teamId),
		index("workScheduleAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("workScheduleAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("workScheduleAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("workScheduleAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);
