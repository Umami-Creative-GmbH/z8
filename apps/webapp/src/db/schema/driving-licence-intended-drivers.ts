import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";

/**
 * Intended-driver assignments (#1423, spec #1418, Organization ADR 0005): who driving
 * licence control applies to, in the assignment shape of `vehicle_use_assignment`
 * (priority 0 = organization, 1 = team, 2 = employee; one row per target). `required`
 * false ("Not required") excludes a team or employee from a broader assignment. The
 * employee's own row counts first, then their primary team's, then the organization's;
 * with no row they are not an intended driver. No effective dates: a save applies at once.
 *
 * Writes serialize on the driving licence organization lock.
 */
export const drivingLicenceIntendedDriverAssignment = pgTable(
	"driving_licence_intended_driver_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id"),
		employeeId: uuid("employee_id"),
		priority: integer("priority").default(0).notNull(),
		required: boolean("required").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
	},
	(t) => [
		uniqueIndex("driving_intended_driver_org_idx")
			.on(t.organizationId)
			.where(sql`assignment_type = 'organization'`),
		uniqueIndex("driving_intended_driver_team_idx")
			.on(t.organizationId, t.teamId)
			.where(sql`team_id IS NOT NULL`),
		uniqueIndex("driving_intended_driver_employee_idx")
			.on(t.organizationId, t.employeeId)
			.where(sql`employee_id IS NOT NULL`),
		check(
			"driving_intended_driver_target_check",
			sql`(${t.assignmentType} = 'organization' and ${t.teamId} is null and ${t.employeeId} is null and ${t.priority} = 0)
			or (${t.assignmentType} = 'team' and ${t.teamId} is not null and ${t.employeeId} is null and ${t.priority} = 1)
			or (${t.assignmentType} = 'employee' and ${t.employeeId} is not null and ${t.teamId} is null and ${t.priority} = 2)`,
		),
		foreignKey({
			name: "driving_intended_driver_team_fk",
			columns: [t.teamId, t.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "driving_intended_driver_employee_fk",
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
