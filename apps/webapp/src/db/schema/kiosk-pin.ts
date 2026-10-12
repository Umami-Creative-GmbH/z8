import { sql } from "drizzle-orm";
import {
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
import { employee } from "./organization";

/**
 * An employee's kiosk PIN (#857, Time Tracking glossary). It belongs to the
 * employee, so to one organization, never to a user across organizations.
 * Only a slow hash is stored. The lockout lives here, not in the fail-open
 * rate limiter: `failed_attempts` counts consecutive failures across all
 * kiosks; the fifth sets `locked_until` and starts the count again.
 */
export const employeeKioskPin = pgTable(
	"employee_kiosk_pin",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		pinHash: text("pin_hash").notNull(),
		failedAttempts: integer("failed_attempts").default(0).notNull(),
		lockedUntil: timestamp("locked_until", { withTimezone: true }),
		// Who set the current PIN: an owner, admin or direct manager, or the employee.
		setByUserId: text("set_by_user_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "employee_kiosk_pin_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("employeeKioskPin_employee_idx").on(table.employeeId),
		check("employee_kiosk_pin_failed_attempts_check", sql`${table.failedAttempts} >= 0`),
	],
);
