import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import { organization } from "../auth-schema";
import { employee } from "./organization";

export type PayrollBlockerType =
	| "missing_clock_out"
	| "pending_absence"
	| "pending_time_correction";

export const payrollBlockerDismissal = pgTable(
	"payroll_blocker_dismissal",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		blockerType: text("blocker_type").$type<PayrollBlockerType>().notNull(),
		sourceId: uuid("source_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		dismissedByEmployeeId: uuid("dismissed_by_employee_id").notNull(),
		dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
	},
	(table) => [
		unique("payrollBlockerDismissal_org_type_source_unique_idx").on(
			table.organizationId,
			table.blockerType,
			table.sourceId,
		),
		index("payrollBlockerDismissal_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		index("payrollBlockerDismissal_dismissedByEmployeeId_idx").on(
			table.dismissedByEmployeeId,
		),
		foreignKey({
			name: "payroll_blocker_dismissal_employee_org_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "payroll_blocker_dismissal_dismissed_by_employee_org_fk",
			columns: [table.dismissedByEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"payroll_blocker_dismissal_blocker_type_check",
			sql`${table.blockerType} IN ('missing_clock_out', 'pending_absence', 'pending_time_correction')`,
		),
	],
);
