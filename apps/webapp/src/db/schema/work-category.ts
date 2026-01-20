import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
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
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";

// ============================================
// WORK CATEGORIES
// ============================================

// Work category sets - Named collections of work categories (like holiday presets)
// e.g., "Standard Categories", "Manufacturing Categories", "Travel Categories"
export const workCategorySet = pgTable(
	"work_category_set",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
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
		index("workCategorySet_organizationId_idx").on(table.organizationId),
		// Unique name per organization
		uniqueIndex("workCategorySet_org_name_idx").on(table.organizationId, table.name),
	],
);

// Individual work categories - now org-level, shared across multiple sets via junction table
// e.g., "Passive Travel" (factor 0.5), "Training" (factor 1.0), "Hazardous Work" (factor 1.5)
export const workCategory = pgTable(
	"work_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		// Factor for calculating effective working time (0.00 to 2.00)
		// e.g., 0.50 = 50% of tracked time counts as working time
		// e.g., 1.00 = 100% (normal work)
		// e.g., 1.50 = 150% (hazardous/demanding work)
		factor: numeric("factor", { precision: 4, scale: 2 }).notNull().default("1.00"),
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
		index("workCategory_organizationId_idx").on(table.organizationId),
		// Unique category name per organization
		uniqueIndex("workCategory_org_name_idx").on(table.organizationId, table.name),
	],
);

// Junction table for many-to-many relationship between sets and categories
// Categories can belong to multiple sets, with per-set ordering
export const workCategorySetCategory = pgTable(
	"work_category_set_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		setId: uuid("set_id")
			.notNull()
			.references(() => workCategorySet.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => workCategory.id, { onDelete: "cascade" }),
		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workCategorySetCategory_setId_idx").on(table.setId),
		index("workCategorySetCategory_categoryId_idx").on(table.categoryId),
		// Unique combination of set and category
		uniqueIndex("workCategorySetCategory_set_category_idx").on(table.setId, table.categoryId),
	],
);

// Assignment of category sets to organizations, teams, or employees
// Uses the same hierarchical pattern as holiday preset assignments:
// - Organization level (priority 0): Default for all employees
// - Team level (priority 1): Override for specific teams
// - Employee level (priority 2): Override for specific employees
export const workCategorySetAssignment = pgTable(
	"work_category_set_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		setId: uuid("set_id")
			.notNull()
			.references(() => workCategorySet.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Reuse the existing assignment type enum from holidays
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
		index("workCategorySetAssignment_setId_idx").on(table.setId),
		index("workCategorySetAssignment_organizationId_idx").on(table.organizationId),
		index("workCategorySetAssignment_teamId_idx").on(table.teamId),
		index("workCategorySetAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("workCategorySetAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("workCategorySetAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("workCategorySetAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);
