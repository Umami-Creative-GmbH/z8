import {
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee, location } from "./organization";

/**
 * Assigned locations (#858, spec #761): the locations an employee works at.
 * An employee has zero, one or several. Distinct from `location_employee`,
 * which records location supervisors.
 *
 * The composite foreign keys tie the employee and the location to the row's
 * organization, so the database refuses a cross-organization assignment.
 * Deactivating a location keeps its assignments; deleting it removes them.
 */
export const employeeAssignedLocation = pgTable(
	"employee_assigned_location",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		locationId: uuid("location_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		uniqueIndex("employeeAssignedLocation_employee_location_idx").on(
			table.employeeId,
			table.locationId,
		),
		index("employeeAssignedLocation_org_location_idx").on(table.organizationId, table.locationId),
		foreignKey({
			name: "employee_assigned_location_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employee_assigned_location_location_fk",
			columns: [table.locationId, table.organizationId],
			foreignColumns: [location.id, location.organizationId],
		}).onDelete("cascade"),
	],
);
