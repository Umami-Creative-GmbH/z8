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
import { employee } from "./organization";

/**
 * An employee's kiosk badge (#889, ADR 0012, Time Tracking glossary): the
 * credential in a printed QR code that proves at an online kiosk which employee
 * is clocking, instead of their kiosk PIN. It belongs to the employee, so to
 * one organization, and to the employment period it was issued in: a rehire
 * never revives it. Only the SHA-256 of the credential is stored (a 260-bit
 * random secret, like the kiosk device token), so the badge cannot be shown or
 * downloaded again. Rows are kept after revocation as lifecycle history.
 *
 * At most one badge per employee is active (`revoked_at IS NULL`); a badge has
 * no expiry. Replacement and revocation set `revoked_at` once and forever.
 */
export const employeeKioskBadge = pgTable(
	"employee_kiosk_badge",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		credentialHash: text("credential_hash").notNull(),
		issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
		// The owner, admin or direct manager who issued it.
		issuedByUserId: text("issued_by_user_id").references(() => user.id, { onDelete: "set null" }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		// replaced: a new badge took its place; revoked: revoked without one;
		// employee_departure: the employee's departure took effect.
		revokedReason: text("revoked_reason", {
			enum: ["replaced", "revoked", "employee_departure"],
		}),
	},
	(table) => [
		foreignKey({
			name: "employee_kiosk_badge_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employee_kiosk_badge_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		uniqueIndex("employeeKioskBadge_credentialHash_idx").on(table.credentialHash),
		uniqueIndex("employeeKioskBadge_one_active_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`${table.revokedAt} IS NULL`),
		index("employeeKioskBadge_employee_idx").on(table.employeeId, table.issuedAt),
		check(
			"employee_kiosk_badge_revoked_reason_check",
			sql`${table.revokedReason} in ('replaced', 'revoked', 'employee_departure')`,
		),
		check(
			"employee_kiosk_badge_revocation_check",
			sql`(${table.revokedAt} IS NULL) = (${table.revokedReason} IS NULL)`,
		),
	],
);
