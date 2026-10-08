import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee, team } from "./organization";
import { currentTimestamp } from "./timestamp";

/**
 * Expense officer grants (#747, ADR 0001): finance access to approved expense
 * reports for someone who is not an owner or admin. Shaped like payroll access
 * grants; reading is always included, exporting and recording reimbursements
 * are separate capabilities. Scope is matched against the teams a report
 * recorded at approval (ADR 0002). A revoked grant stays inactive; a later
 * grant for the same officer is a new row.
 */
export const expenseOfficerGrant = pgTable(
	"expense_officer_grant",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		officerEmployeeId: uuid("officer_employee_id").notNull(),
		scope: text("scope").$type<"all" | "specific">().default("specific").notNull(),
		canExport: boolean("can_export").default(false).notNull(),
		canRecordReimbursements: boolean("can_record_reimbursements").default(false).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("expenseOfficerGrant_organizationId_idx").on(table.organizationId),
		index("expenseOfficerGrant_officerEmployeeId_idx").on(table.officerEmployeeId),
		unique("expenseOfficerGrant_id_organizationId_idx").on(table.id, table.organizationId),
		uniqueIndex("expenseOfficerGrant_active_officer_idx")
			.on(table.organizationId, table.officerEmployeeId)
			.where(sql`is_active = true`),
		check("expense_officer_grant_scope_check", sql`${table.scope} in ('all', 'specific')`),
		foreignKey({
			name: "expense_officer_grant_officer_fk",
			columns: [table.officerEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);

export const expenseOfficerTeam = pgTable(
	"expense_officer_team",
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
		index("expenseOfficerTeam_organizationId_idx").on(table.organizationId),
		index("expenseOfficerTeam_teamId_idx").on(table.teamId),
		uniqueIndex("expenseOfficerTeam_grant_team_idx").on(table.grantId, table.teamId),
		foreignKey({
			name: "expense_officer_team_grant_fk",
			columns: [table.grantId, table.organizationId],
			foreignColumns: [expenseOfficerGrant.id, expenseOfficerGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "expense_officer_team_team_fk",
			columns: [table.teamId, table.organizationId],
			foreignColumns: [team.id, team.organizationId],
		}).onDelete("cascade"),
	],
);

export const expenseOfficerEmployee = pgTable(
	"expense_officer_employee",
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
		index("expenseOfficerEmployee_organizationId_idx").on(table.organizationId),
		index("expenseOfficerEmployee_employeeId_idx").on(table.employeeId),
		uniqueIndex("expenseOfficerEmployee_grant_employee_idx").on(table.grantId, table.employeeId),
		foreignKey({
			name: "expense_officer_employee_grant_fk",
			columns: [table.grantId, table.organizationId],
			foreignColumns: [expenseOfficerGrant.id, expenseOfficerGrant.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "expense_officer_employee_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
