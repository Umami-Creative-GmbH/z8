import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

export const balanceAdjustmentKindEnum = pgEnum("balance_adjustment_kind", [
	"opening_balance",
	"overtime_payout",
]);

/**
 * Balance adjustments (#804, Time Tracking ADR-0008): opening balances and
 * overtime payouts. Insert-only: a mistaken adjustment is cancelled, never
 * edited or deleted, and a cancelled one stays on record. The work-balance
 * projection reads the uncancelled ones each time it is computed; they are
 * never written into the stored balance rows. A database trigger (migration
 * 0187) refuses every update except the one cancellation, and every delete
 * except the cascade from an erased employee or organization.
 */
export const balanceAdjustment = pgTable(
	"balance_adjustment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		kind: balanceAdjustmentKindEnum("kind").notNull(),
		/** Local date in the employee's effective timezone; counts from the end of it. */
		day: date("day").notNull(),
		/** Signed minutes added to the work balance: an overtime payout is negative. */
		minutes: integer("minutes").notNull(),
		reason: text("reason").notNull(),
		/** Null only once the recording user was deleted. */
		recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		/** Null while uncancelled, or once the cancelling user was deleted. */
		cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
		cancellationReason: text("cancellation_reason"),
	},
	(table) => [
		foreignKey({
			name: "balance_adjustment_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		index("balanceAdjustment_org_employee_day_idx").on(
			table.organizationId,
			table.employeeId,
			table.day,
		),
		// At most one opening balance in effect per employee (#997).
		uniqueIndex("balanceAdjustment_open_opening_balance_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`${table.kind} = 'opening_balance' AND ${table.cancelledAt} IS NULL`),
		check("balance_adjustment_reason_check", sql`length(btrim(${table.reason})) > 0`),
		check(
			"balance_adjustment_payout_minutes_check",
			sql`${table.kind} <> 'overtime_payout' OR ${table.minutes} < 0`,
		),
		check(
			"balance_adjustment_cancellation_check",
			sql`(${table.cancelledAt} IS NULL) = (${table.cancellationReason} IS NULL) AND (${table.cancelledAt} IS NOT NULL OR ${table.cancelledBy} IS NULL) AND (${table.cancellationReason} IS NULL OR length(btrim(${table.cancellationReason})) > 0)`,
		),
	],
);
