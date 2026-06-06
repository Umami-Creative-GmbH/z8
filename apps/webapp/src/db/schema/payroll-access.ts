import { sql } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization, user } from "../auth-schema";
import { employee, team } from "./organization";

export const payrollAccessGrant = pgTable(
	"payroll_access_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		payrollEmployeeId: uuid("payroll_employee_id").notNull(),
		scope: text("scope").default("specific").notNull(),
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
		index("payrollAccessGrant_organizationId_idx").on(table.organizationId),
		index("payrollAccessGrant_payrollEmployeeId_idx").on(table.payrollEmployeeId),
		unique("payrollAccessGrant_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("payrollAccessGrant_active_employee_idx")
			.on(table.organizationId, table.payrollEmployeeId)
			.where(sql`is_active = true`),
		foreignKey({
			columns: [table.payrollEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

export const payrollAccessTeam = pgTable(
	"payroll_access_team",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id").notNull(),
		teamId: uuid("team_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("payrollAccessTeam_organizationId_idx").on(table.organizationId),
		index("payrollAccessTeam_grantId_idx").on(table.grantId),
		index("payrollAccessTeam_teamId_idx").on(table.teamId),
		uniqueIndex("payrollAccessTeam_grant_team_idx").on(table.grantId, table.teamId),
		foreignKey({
			columns: [table.grantId, table.organizationId],
			foreignColumns: [payrollAccessGrant.id, payrollAccessGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
	],
);

export const payrollAccessEmployee = pgTable(
	"payroll_access_employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		grantId: uuid("grant_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("payrollAccessEmployee_organizationId_idx").on(table.organizationId),
		index("payrollAccessEmployee_grantId_idx").on(table.grantId),
		index("payrollAccessEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("payrollAccessEmployee_grant_employee_idx").on(table.grantId, table.employeeId),
		foreignKey({
			columns: [table.grantId, table.organizationId],
			foreignColumns: [payrollAccessGrant.id, payrollAccessGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
