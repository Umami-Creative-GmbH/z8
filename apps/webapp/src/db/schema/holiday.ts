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
import { holidayCategoryEnum, holidayPresetAssignmentTypeEnum, recurrenceTypeEnum } from "./enums";
import { employee, team } from "./organization";

// ============================================
// HOLIDAY MANAGEMENT
// ============================================

// Holiday categories with organization-specific settings
export const holidayCategory = pgTable(
	"holiday_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: holidayCategoryEnum("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		color: text("color"), // Hex color for calendar display
		blocksTimeEntry: boolean("blocks_time_entry").default(true).notNull(),
		excludeFromCalculations: boolean("exclude_from_calculations").default(true).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("holidayCategory_organizationId_idx").on(table.organizationId)],
);

// Holidays and closing days with recurrence support
export const holiday = pgTable(
	"holiday",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => holidayCategory.id),
		name: text("name").notNull(),
		description: text("description"),
		startDate: timestamp("start_date").notNull(),
		endDate: timestamp("end_date").notNull(),
		recurrenceType: recurrenceTypeEnum("recurrence_type").default("none").notNull(),
		recurrenceRule: text("recurrence_rule"), // JSON: { month: 12, day: 25 }
		recurrenceEndDate: timestamp("recurrence_end_date"),
		isActive: boolean("is_active").default(true).notNull(),
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
		index("holiday_organizationId_idx").on(table.organizationId),
		index("holiday_startDate_idx").on(table.startDate),
		index("holiday_categoryId_idx").on(table.categoryId),
		index("holiday_orgId_isActive_recurrenceType_idx").on(
			table.organizationId,
			table.isActive,
			table.recurrenceType,
		),
	],
);

// ============================================
// HOLIDAY PRESETS
// ============================================

// Holiday presets - Named presets with location metadata for reusable holiday sets
export const holidayPreset = pgTable(
	"holiday_preset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // "Germany - Bavaria"
		description: text("description"),
		countryCode: text("country_code"), // ISO 3166-1 alpha-2 (e.g., "DE")
		stateCode: text("state_code"), // ISO 3166-2 subdivision (e.g., "BY")
		regionCode: text("region_code"), // Further subdivision if applicable
		color: text("color"), // Hex color for UI display
		isActive: boolean("is_active").default(true).notNull(),
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
		index("holidayPreset_organizationId_idx").on(table.organizationId),
		// Unique constraint for same location within organization
		uniqueIndex("holidayPreset_org_location_idx").on(
			table.organizationId,
			table.countryCode,
			table.stateCode,
			table.regionCode,
		),
	],
);

// Individual holidays within a preset
export const holidayPresetHoliday = pgTable(
	"holiday_preset_holiday",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		presetId: uuid("preset_id")
			.notNull()
			.references(() => holidayPreset.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // "Christmas Day"
		description: text("description"),
		month: integer("month").notNull(), // 1-12
		day: integer("day").notNull(), // 1-31
		durationDays: integer("duration_days").default(1).notNull(), // Multi-day holidays
		holidayType: text("holiday_type"), // "public", "bank", "optional", "school", "observance"
		isFloating: boolean("is_floating").default(false).notNull(), // Easter, Thanksgiving
		floatingRule: text("floating_rule"), // JSON for floating calculation
		categoryId: uuid("category_id").references(() => holidayCategory.id),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("holidayPresetHoliday_presetId_idx").on(table.presetId),
		index("holidayPresetHoliday_categoryId_idx").on(table.categoryId),
		// Unique holiday name per preset
		uniqueIndex("holidayPresetHoliday_preset_name_idx").on(table.presetId, table.name),
	],
);

// Assignment of presets to organizations, teams, or employees
export const holidayPresetAssignment = pgTable(
	"holiday_preset_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		presetId: uuid("preset_id")
			.notNull()
			.references(() => holidayPreset.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),
		priority: integer("priority").default(0).notNull(), // 0=org, 1=team, 2=employee
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("holidayPresetAssignment_presetId_idx").on(table.presetId),
		index("holidayPresetAssignment_organizationId_idx").on(table.organizationId),
		index("holidayPresetAssignment_teamId_idx").on(table.teamId),
		index("holidayPresetAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("holidayPresetAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("holidayPresetAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("holidayPresetAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

// Assignment of individual custom holidays to organizations, teams, or employees
// This allows location-specific closing days to affect only certain teams/employees
export const holidayAssignment = pgTable(
	"holiday_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		holidayId: uuid("holiday_id")
			.notNull()
			.references(() => holiday.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("holidayAssignment_holidayId_idx").on(table.holidayId),
		index("holidayAssignment_organizationId_idx").on(table.organizationId),
		index("holidayAssignment_teamId_idx").on(table.teamId),
		index("holidayAssignment_employeeId_idx").on(table.employeeId),
		// Prevent duplicate assignments for the same holiday to the same target
		uniqueIndex("holidayAssignment_holiday_org_idx")
			.on(table.holidayId, table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		uniqueIndex("holidayAssignment_holiday_team_idx")
			.on(table.holidayId, table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		uniqueIndex("holidayAssignment_holiday_employee_idx")
			.on(table.holidayId, table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);
