import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
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
import { employee } from "./organization";

/**
 * An employee's kiosk PIN (#857, Time Tracking glossary). It belongs to the
 * employee, so to one organization, never to a user across organizations.
 * Only a slow hash is stored. The lockout is not stored here: it is replayed
 * from `employee_kiosk_pin_event` (#1288). The row is still the lock that
 * serialises every attempt and change for the employee.
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
	],
);

/**
 * What the kiosk PIN lockout is replayed from (#1288, ADR 0011): every checked
 * PIN attempt (`failure`, `success`), online or arriving late from an offline
 * kiosk, and every unlock, reset or own PIN change (`cleared`), at the instant
 * it happened. Never the PIN. Rows older than the delayed admission window
 * plus the lock can no longer affect a check and are pruned.
 */
export const employeeKioskPinEvent = pgTable(
	"employee_kiosk_pin_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		// Recording order, which breaks ties between events at the same instant.
		sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		kind: text("kind", { enum: ["failure", "success", "cleared"] }).notNull(),
		// The attempt was entered at a kiosk while offline and judged on arrival.
		offline: boolean("offline").default(false).notNull(),
		// The queued command the attempt belongs to: its resend reuses this verdict (#885).
		operationId: uuid("operation_id"),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		// When Z8 judged the attempt: the arrival throttle counts queued failures by it.
		recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "employee_kiosk_pin_event_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		index("employeeKioskPinEvent_employee_occurredAt_idx").on(
			table.employeeId,
			table.occurredAt,
			table.sequence,
		),
		index("employeeKioskPinEvent_occurredAt_idx").on(table.occurredAt),
		uniqueIndex("employeeKioskPinEvent_operation_idx")
			.on(table.organizationId, table.operationId)
			.where(sql`${table.operationId} IS NOT NULL`),
		check(
			"employee_kiosk_pin_event_kind_check",
			sql`${table.kind} in ('failure', 'success', 'cleared')`,
		),
		check(
			"employee_kiosk_pin_event_offline_check",
			sql`${table.kind} <> 'cleared' or not ${table.offline}`,
		),
		check(
			"employee_kiosk_pin_event_operation_check",
			sql`${table.operationId} is null or ${table.offline}`,
		),
	],
);
