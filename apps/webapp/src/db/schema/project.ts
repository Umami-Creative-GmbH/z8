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
import { customer } from "./customer";
import { projectAssignmentTypeEnum, projectStatusEnum } from "./enums";
import { employee, team } from "./organization";

// ============================================
// PROJECTS
// ============================================

// Project entity for time tracking assignments
export const project = pgTable(
	"project",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Core fields
		name: text("name").notNull(),
		description: text("description"),
		status: projectStatusEnum("status").default("planned").notNull(),

		// Visual customization
		icon: text("icon"), // Tabler icon name
		color: text("color"), // Hex color

		// Customer assignment (optional)
		customerId: uuid("customer_id").references(() => customer.id, { onDelete: "set null" }),

		// Budget tracking (optional)
		budgetHours: decimal("budget_hours", { precision: 8, scale: 2 }), // null = unlimited

		// Deadline tracking (optional)
		deadline: timestamp("deadline"),

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
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("project_organizationId_idx").on(table.organizationId),
		index("project_status_idx").on(table.status),
		index("project_deadline_idx").on(table.deadline),
		index("project_isActive_idx").on(table.isActive),
		index("project_customerId_idx").on(table.customerId),
		uniqueIndex("project_org_name_idx").on(table.organizationId, table.name),
	],
);

// Project managers (many-to-many) - receive budget/deadline notifications
export const projectManager = pgTable(
	"project_manager",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		assignedBy: text("assigned_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("projectManager_projectId_idx").on(table.projectId),
		index("projectManager_employeeId_idx").on(table.employeeId),
		uniqueIndex("projectManager_unique_idx").on(table.projectId, table.employeeId),
	],
);

// Project assignments - determines who can book time to a project
export const projectAssignment = pgTable(
	"project_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Assignment target (either team OR employee)
		assignmentType: projectAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("projectAssignment_projectId_idx").on(table.projectId),
		index("projectAssignment_organizationId_idx").on(table.organizationId),
		index("projectAssignment_teamId_idx").on(table.teamId),
		index("projectAssignment_employeeId_idx").on(table.employeeId),
		// Prevent duplicate team assignments
		uniqueIndex("projectAssignment_team_unique_idx")
			.on(table.projectId, table.teamId)
			.where(sql`team_id IS NOT NULL`),
		// Prevent duplicate employee assignments
		uniqueIndex("projectAssignment_employee_unique_idx")
			.on(table.projectId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
	],
);

// Project notification state - tracks which thresholds have been notified (anti-spam)
export const projectNotificationState = pgTable(
	"project_notification_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),

		// Budget threshold notifications sent (as percentage integers: 70, 90, 100)
		budgetThresholdsNotified: integer("budget_thresholds_notified").array().default([]),
		// Deadline threshold notifications sent (days remaining: 14, 7, 1, 0, -1 for overdue)
		deadlineThresholdsNotified: integer("deadline_thresholds_notified").array().default([]),

		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [uniqueIndex("projectNotificationState_project_unique_idx").on(table.projectId)],
);
