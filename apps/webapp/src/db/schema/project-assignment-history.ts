import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { project } from "./project";

export const PROJECT_ASSIGNMENT_HISTORY_TYPES = ["employee", "team"] as const;
export type ProjectAssignmentHistoryType = (typeof PROJECT_ASSIGNMENT_HISTORY_TYPES)[number];

// Effective intervals of project assignments (#605). Database triggers
// (migration 0116) record every insert, change and removal of a
// `project_assignment` row, cascades included, so no writer can skip them.
// The migration opened one interval per assignment that existed then, at the
// migration time: history starts there, and nothing before it is ever
// inferred from a current assignment. Intervals are half-open
// `[effective_from, effective_to)`; the team is kept by value so a deleted
// team's past assignments stay provable.
export const projectAssignmentHistory = pgTable(
	"project_assignment_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: uuid("project_id").notNull(),
		/** The `project_assignment` row this interval belongs to, by value. */
		sourceAssignmentId: uuid("source_assignment_id").notNull(),
		assignmentType: text("assignment_type").$type<ProjectAssignmentHistoryType>().notNull(),
		employeeId: uuid("employee_id"),
		teamId: uuid("team_id"),
		effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
		effectiveTo: timestamp("effective_to", { withTimezone: true }),
		createdBy: text("created_by"),
	},
	(table) => [
		foreignKey({
			name: "project_assignment_history_project_fk",
			columns: [table.projectId, table.organizationId],
			foreignColumns: [project.id, project.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "project_assignment_history_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("projectAssignmentHistory_open_idx")
			.on(table.sourceAssignmentId)
			.where(sql`effective_to IS NULL`),
		index("projectAssignmentHistory_org_employee_idx").on(table.organizationId, table.employeeId),
		index("projectAssignmentHistory_org_team_idx").on(table.organizationId, table.teamId),
		check(
			"project_assignment_history_target_check",
			sql`(${table.assignmentType} = 'employee' AND ${table.employeeId} IS NOT NULL AND ${table.teamId} IS NULL)
			OR (${table.assignmentType} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.employeeId} IS NULL)`,
		),
		check(
			"project_assignment_history_interval_check",
			sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
		),
	],
);

// Effective intervals of an employee's team (`employee.team_id`), the team
// project eligibility reads (#605). Recorded by a trigger on `employee` for
// every writer (team actions, employee edits, SCIM, invitations, lifecycle,
// demo data, team deletion), seeded at the migration time like
// `project_assignment_history`.
export const employeeTeamHistory = pgTable(
	"employee_team_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		teamId: uuid("team_id").notNull(),
		effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
		effectiveTo: timestamp("effective_to", { withTimezone: true }),
	},
	(table) => [
		foreignKey({
			name: "employee_team_history_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("employeeTeamHistory_open_idx")
			.on(table.employeeId)
			.where(sql`effective_to IS NULL`),
		index("employeeTeamHistory_org_employee_idx").on(table.organizationId, table.employeeId),
		check(
			"employee_team_history_interval_check",
			sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
		),
	],
);
