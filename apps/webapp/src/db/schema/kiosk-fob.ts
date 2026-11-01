import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { kiosk } from "./kiosk";
import { employee } from "./organization";

/**
 * An employee's kiosk fob (#1358, Time Tracking ADR 0014, glossary "Kiosk
 * fob"): an NFC card or fob whose chip serial number selects the employee at an
 * online kiosk; their kiosk PIN still proves. The serial number is no secret,
 * so it is stored as the reader types it, canonical (upper-case hex without
 * separators, `fob-serial.ts`). It belongs to the employee, so to one
 * organization, and to the employment period it was registered in: a rehire
 * never revives it.
 *
 * At most one link per employee is active (`ended_at IS NULL`), and a serial
 * number is linked to at most one employee of an organization at a time; the
 * same serial number may be linked in another organization. Ending a link sets
 * `ended_at` once and forever; rows stay as lifecycle history until the
 * employee's or organization's data is deleted.
 */
export const employeeKioskFob = pgTable(
	"employee_kiosk_fob",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		serialNumber: text("serial_number").notNull(),
		registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
		// The kiosk the employee registered it at; kept null once that kiosk is gone.
		registeredKioskId: uuid("registered_kiosk_id").references(() => kiosk.id, {
			onDelete: "set null",
		}),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		// The person who ended it, when someone did (a removal, a departure's initiator).
		endedByUserId: text("ended_by_user_id").references(() => user.id, { onDelete: "set null" }),
		// replaced: the employee registered another fob; removed: removed by them or a
		// manager; departure: the employee's departure took effect.
		endedReason: text("ended_reason", { enum: ["replaced", "removed", "departure"] }),
	},
	(table) => [
		foreignKey({
			name: "employee_kiosk_fob_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employee_kiosk_fob_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		uniqueIndex("employeeKioskFob_active_serial_idx")
			.on(table.organizationId, table.serialNumber)
			.where(sql`${table.endedAt} IS NULL`),
		uniqueIndex("employeeKioskFob_one_active_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`${table.endedAt} IS NULL`),
		index("employeeKioskFob_employee_idx").on(table.employeeId, table.registeredAt),
		check(
			"employee_kiosk_fob_serial_number_check",
			sql`${table.serialNumber} ~ '^([0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$'`,
		),
		check(
			"employee_kiosk_fob_ended_reason_check",
			sql`${table.endedReason} in ('replaced', 'removed', 'departure')`,
		),
		check(
			"employee_kiosk_fob_ending_check",
			sql`(${table.endedAt} IS NULL) = (${table.endedReason} IS NULL)`,
		),
	],
);
