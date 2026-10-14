import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";
import { currentTimestamp } from "./timestamp";

/**
 * Vehicle use enablement (#1119, spec #807; Time Tracking glossary "Driving"):
 * one row per organization. The switch is off by default; with it off nobody is
 * asked for vehicle use and no work is flagged as driving details missing. With
 * it on, `vehicle_use_assignment` decides who is asked and who is expected.
 *
 * Every configuration write (switch or assignments) locks this row inside its
 * transaction, so a reader that takes it `FOR SHARE` sees either the
 * configuration before or after the write, never a mix.
 */
export const vehicleUseSetting = pgTable("vehicle_use_setting", {
	id: uuid("id").defaultRandom().primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.unique("vehicleUseSetting_organizationId_idx")
		.references(() => organization.id, { onDelete: "cascade" }),
	enabled: boolean("enabled").default(false).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => currentTimestamp())
		.notNull(),
	updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

/**
 * Vehicle use assignments in the assignment-table shape of
 * `change_policy_assignment` (priority 0 = organization, 1 = team, 2 = employee;
 * the most specific wins). Mode `asked` offers the vehicle use inputs, `expected`
 * asks every time and flags missing details, `off` excludes a team or employee
 * from a broader assignment. No mode ever refuses or delays a clock command.
 */
export const vehicleUseAssignment = pgTable(
	"vehicle_use_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id"),
		employeeId: uuid("employee_id"),
		priority: integer("priority").default(0).notNull(),
		mode: text("mode").$type<VehicleUseMode>().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("vehicleUseAssignment_organizationId_idx").on(table.organizationId),
		index("vehicleUseAssignment_teamId_idx").on(table.teamId),
		index("vehicleUseAssignment_employeeId_idx").on(table.employeeId),
		uniqueIndex("vehicleUseAssignment_org_idx")
			.on(table.organizationId)
			.where(sql`assignment_type = 'organization'`),
		uniqueIndex("vehicleUseAssignment_team_idx")
			.on(table.organizationId, table.teamId)
			.where(sql`team_id IS NOT NULL`),
		uniqueIndex("vehicleUseAssignment_employee_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`employee_id IS NOT NULL`),
		check("vehicle_use_assignment_mode_check", sql`${table.mode} in ('off', 'asked', 'expected')`),
		check(
			"vehicle_use_assignment_target_check",
			sql`(${table.assignmentType} = 'organization' and ${table.teamId} is null and ${table.employeeId} is null and ${table.priority} = 0)
			or (${table.assignmentType} = 'team' and ${table.teamId} is not null and ${table.employeeId} is null and ${table.priority} = 1)
			or (${table.assignmentType} = 'employee' and ${table.employeeId} is not null and ${table.teamId} is null and ${table.priority} = 2)`,
		),
		foreignKey({
			name: "vehicle_use_assignment_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "vehicle_use_assignment_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
