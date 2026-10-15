import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

/** A nullable exception retains the review revision when an employee returns to inheritance. */
export const employeeTrackingSettings = pgTable(
	"employee_tracking_settings",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		trackingStartDate: date("tracking_start_date", { mode: "string" }),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.employeeId] }),
		foreignKey({
			name: "employee_tracking_settings_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("employee_tracking_settings_revision_check", sql`${table.revision} >= 1`),
	],
);
