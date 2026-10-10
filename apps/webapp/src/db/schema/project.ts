import { sql } from "drizzle-orm";
import {
	boolean,
	check,
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
import { customer } from "./customer";
import { projectAssignmentTypeEnum, projectStatusEnum, projectTaskStateEnum } from "./enums";
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

		// Billable Time (#900): whether new work on this project starts as billable
		// work. Only a project with a customer can have it on; changing it never
		// changes existing work.
		billableDefault: boolean("billable_default").default(false).notNull(),

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
		// Target of organization-scoped references (#605 expense attribution).
		unique("project_id_organizationId_idx").on(table.id, table.organizationId),
		check(
			"project_billable_default_customer_chk",
			sql`NOT ${table.billableDefault} OR ${table.customerId} IS NOT NULL`,
		),
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

// Project tasks (#872) - named pieces of work inside exactly one project.
// A task never moves between projects: the composite key ties it to its
// project's organization, and later booking references (#873) point at
// (id, project_id, organization_id) so a booking's task always belongs to
// the booking's project.
export const projectTask = pgTable(
	"project_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: uuid("project_id").notNull(),

		// Stored trimmed; unique within the project, case-insensitively.
		name: text("name").notNull(),
		description: text("description"),
		// Task estimate in hours (null = no estimate). Never raises budget alerts.
		estimateHours: decimal("estimate_hours", { precision: 8, scale: 2 }),

		state: projectTaskStateEnum("state").default("open").notNull(),
		doneAt: timestamp("done_at"),
		doneBy: text("done_by").references(() => user.id),

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
		foreignKey({
			name: "project_task_project_fk",
			columns: [table.projectId, table.organizationId],
			foreignColumns: [project.id, project.organizationId],
		}).onDelete("cascade"),
		index("projectTask_organizationId_idx").on(table.organizationId),
		index("projectTask_projectId_state_idx").on(table.projectId, table.state),
		uniqueIndex("projectTask_project_name_unique_idx").on(
			table.projectId,
			sql`lower(btrim(${table.name}))`,
		),
		// Target of booking references that must stay inside one project (#873).
		unique("project_task_id_project_org_idx").on(table.id, table.projectId, table.organizationId),
		check("project_task_name_check", sql`length(btrim(${table.name})) > 0`),
		check(
			"project_task_estimate_check",
			sql`${table.estimateHours} IS NULL OR ${table.estimateHours} > 0`,
		),
		check(
			"project_task_done_check",
			sql`(${table.state} = 'done') = (${table.doneAt} IS NOT NULL AND ${table.doneBy} IS NOT NULL)`,
		),
	],
);

// ============================================
// PROJECT TEMPLATES (#878)
// ============================================

// A reusable blueprint for new projects. Deliberately its own entity, never a
// project row (ADR 0001): nothing can book to it, and no project read
// (eligibility, pickers, reports, budget notifications, APIs) can see it.
export const projectTemplate = pgTable(
	"project_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Stored trimmed; unique within the organization, case-insensitively.
		name: text("name").notNull(),
		description: text("description"),
		icon: text("icon"), // Tabler icon name
		color: text("color"), // Hex color

		// Copied onto the new project (null = unlimited budget).
		budgetHours: decimal("budget_hours", { precision: 8, scale: 2 }),
		// The new project's deadline is its creation date plus this many days
		// (null = no deadline).
		deadlineOffsetDays: integer("deadline_offset_days"),

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
		index("projectTemplate_organizationId_idx").on(table.organizationId),
		uniqueIndex("projectTemplate_org_name_unique_idx").on(
			table.organizationId,
			sql`lower(btrim(${table.name}))`,
		),
		// Target of the template's own rows, which stay in its organization.
		unique("project_template_id_org_idx").on(table.id, table.organizationId),
		check("project_template_name_check", sql`length(btrim(${table.name})) > 0`),
		check(
			"project_template_budget_check",
			sql`${table.budgetHours} IS NULL OR ${table.budgetHours} > 0`,
		),
		check(
			"project_template_deadline_offset_check",
			sql`${table.deadlineOffsetDays} IS NULL OR ${table.deadlineOffsetDays} BETWEEN 0 AND 3650`,
		),
	],
);

// The tasks a project created from the template starts with (all open).
export const projectTemplateTask = pgTable(
	"project_template_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		templateId: uuid("template_id").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		estimateHours: decimal("estimate_hours", { precision: 8, scale: 2 }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "project_template_task_template_fk",
			columns: [table.templateId, table.organizationId],
			foreignColumns: [projectTemplate.id, projectTemplate.organizationId],
		}).onDelete("cascade"),
		index("projectTemplateTask_templateId_idx").on(table.templateId),
		uniqueIndex("projectTemplateTask_template_name_unique_idx").on(
			table.templateId,
			sql`lower(btrim(${table.name}))`,
		),
		check("project_template_task_name_check", sql`length(btrim(${table.name})) > 0`),
		check(
			"project_template_task_estimate_check",
			sql`${table.estimateHours} IS NULL OR ${table.estimateHours} > 0`,
		),
	],
);

// The project managers a project created from the template starts with.
// Deleting the employee keeps the row with a null reference (migration 0157
// uses SET NULL ("employee_id") only, keeping the organization), so creating
// a project can report the skipped manager by its last known name.
export const projectTemplateManager = pgTable(
	"project_template_manager",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		templateId: uuid("template_id").notNull(),
		employeeId: uuid("employee_id"),
		// The employee's name when added; shown once the employee is gone.
		displayName: text("display_name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		foreignKey({
			name: "project_template_manager_template_fk",
			columns: [table.templateId, table.organizationId],
			foreignColumns: [projectTemplate.id, projectTemplate.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "project_template_manager_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("set null"),
		index("projectTemplateManager_templateId_idx").on(table.templateId),
		index("projectTemplateManager_employeeId_idx").on(table.employeeId),
		uniqueIndex("projectTemplateManager_unique_idx")
			.on(table.templateId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
	],
);

// The team and employee assignments a project created from the template
// starts with. Like managers, a deleted team or employee leaves the row with
// a null reference and its last known name (SET NULL on that column only).
export const projectTemplateAssignment = pgTable(
	"project_template_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		templateId: uuid("template_id").notNull(),
		assignmentType: projectAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id"),
		employeeId: uuid("employee_id"),
		// The team's or employee's name when added; shown once it is gone.
		displayName: text("display_name").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		foreignKey({
			name: "project_template_assignment_template_fk",
			columns: [table.templateId, table.organizationId],
			foreignColumns: [projectTemplate.id, projectTemplate.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "project_template_assignment_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("set null"),
		foreignKey({
			name: "project_template_assignment_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("set null"),
		index("projectTemplateAssignment_templateId_idx").on(table.templateId),
		index("projectTemplateAssignment_teamId_idx").on(table.teamId),
		index("projectTemplateAssignment_employeeId_idx").on(table.employeeId),
		uniqueIndex("projectTemplateAssignment_team_unique_idx")
			.on(table.templateId, table.teamId)
			.where(sql`team_id IS NOT NULL`),
		uniqueIndex("projectTemplateAssignment_employee_unique_idx")
			.on(table.templateId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
		check(
			"project_template_assignment_target_check",
			sql`(${table.assignmentType} = 'team' AND ${table.employeeId} IS NULL) OR (${table.assignmentType} = 'employee' AND ${table.teamId} IS NULL)`,
		),
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
