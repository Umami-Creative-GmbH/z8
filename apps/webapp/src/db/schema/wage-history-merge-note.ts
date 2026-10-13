import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

/**
 * The one-time note on an employee's Contract & Work Model card that their wage history was
 * merged from the old rate history (#1176, Organization ADR 0002). Written once by migration
 * 0217 for every affected employee and shown to org admins until one dismisses it. It outlives
 * the operator report table, which #1164 drops.
 */
export const employeeWageHistoryMergeNote = pgTable(
	"employee_wage_history_merge_note",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		employeeId: uuid("employee_id").notNull(),
		/** The organization-local date of the merge. */
		mergedOn: date("merged_on", { mode: "string" }).notNull(),
		/** How many of the employee's rate rows the merge did not take over as written. */
		adjustedCount: integer("adjusted_count").notNull(),
		dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
		dismissedBy: text("dismissed_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("employeeWageHistoryMergeNote_org_employee_idx").on(
			table.organizationId,
			table.employeeId,
		),
		foreignKey({
			name: "employeeWageHistoryMergeNote_organization_fk",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeWageHistoryMergeNote_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeWageHistoryMergeNote_dismissed_by_fk",
			columns: [table.dismissedBy],
			foreignColumns: [user.id],
		}).onDelete("set null"),
		check("employeeWageHistoryMergeNote_adjusted_count_check", sql`${table.adjustedCount} >= 0`),
	],
);

export type EmployeeWageHistoryMergeNote = typeof employeeWageHistoryMergeNote.$inferSelect;
