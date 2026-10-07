import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { project } from "./project";

// Authorized, evidenced project attribution exception (#605). Where captured
// assignment history cannot prove that an employee could use a project on an
// expense date (typically before history capture began), an expense
// administrator other than the employee permits attributing that employee's
// expenses dated `valid_from`..`valid_to` (calendar days, inclusive) to the
// project, with a reason and the evidence it rests on. Append-only: nothing
// updates or deletes a row, and submitted reports freeze what they used.
export const travelExpenseProjectAttributionException = pgTable(
	"travel_expense_project_attribution_exception",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		projectId: uuid("project_id").notNull(),
		validFrom: date("valid_from").notNull(),
		validTo: date("valid_to").notNull(),
		reason: text("reason").notNull(),
		evidence: text("evidence").notNull(),
		/** Kept by value: the authorization outlives the authorizer's profile. */
		authorizedByEmployeeId: uuid("authorized_by_employee_id").notNull(),
		authorizedByUserId: text("authorized_by_user_id").notNull(),
		authorizedAt: timestamp("authorized_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_project_exception_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_project_exception_project_fk",
			columns: [table.projectId, table.organizationId],
			foreignColumns: [project.id, project.organizationId],
		}).onDelete("cascade"),
		index("travelExpenseProjectException_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
			table.projectId,
		),
		check(
			"travel_expense_project_exception_dates_check",
			sql`${table.validTo} >= ${table.validFrom}`,
		),
		check(
			"travel_expense_project_exception_text_check",
			sql`length(btrim(${table.reason})) BETWEEN 1 AND 1000
			AND length(btrim(${table.evidence})) BETWEEN 1 AND 2000`,
		),
		check(
			"travel_expense_project_exception_authorizer_check",
			sql`${table.authorizedByEmployeeId} <> ${table.employeeId}`,
		),
	],
);

// When captured project assignment and team history (#605, migration 0120)
// begins for an organization that existed then (migration 0132). Exceptions
// cover only expense dates before it; an organization without a row was
// created later and has captured history since its creation.
export const travelExpenseProjectHistoryCapture = pgTable(
	"travel_expense_project_history_capture",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		capturedFrom: timestamp("captured_from", { withTimezone: true }).notNull(),
	},
);
