import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

/*
 * Not re-exported from the schema barrel (`./index.ts`), like the contractor
 * profile: one more table in the relational `db.query` type pushes some
 * transactions past TypeScript's instantiation depth (TS2589). Import it from
 * this module; drizzle.config.ts lists it for `db:push`. Only the personal
 * details module (`lib/organization/personal-details`) reads or writes it.
 */

/**
 * An employee's bank account in one organization as a date-effective history
 * (spec #2068): each row is in force from its valid-from until the next row's.
 * A row without a value ends the bank account from its valid-from. Changing
 * with the valid-from of an existing row replaces that row (a correction).
 */
export const employeeBankAccount = pgTable(
	"employee_bank_account",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		/** The plain calendar day the value is in force from. */
		validFrom: date("valid_from", { mode: "string" }).notNull(),
		/** Null on an ending row, as are the IBAN and BIC. */
		accountHolder: text("account_holder"),
		/** Normalized: upper case, no spaces; a SEPA IBAN with a valid checksum. */
		iban: text("iban"),
		/** Optional, normalized; format-checked only. */
		bic: text("bic"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		unique("employeeBankAccount_org_employee_valid_from_unique").on(
			table.organizationId,
			table.employeeId,
			table.validFrom,
		),
		foreignKey({
			name: "employeeBankAccount_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"employeeBankAccount_value_check",
			sql`(${table.accountHolder} IS NULL AND ${table.iban} IS NULL AND ${table.bic} IS NULL)
				OR (${table.accountHolder} IS NOT NULL AND ${table.iban} IS NOT NULL)`,
		),
		check(
			"employeeBankAccount_account_holder_check",
			sql`${table.accountHolder} IS NULL OR char_length(${table.accountHolder}) BETWEEN 1 AND 70`,
		),
		check(
			"employeeBankAccount_iban_check",
			sql`${table.iban} IS NULL OR ${table.iban} ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'`,
		),
		check(
			"employeeBankAccount_bic_check",
			sql`${table.bic} IS NULL OR ${table.bic} ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'`,
		),
	],
);

export type EmployeeBankAccountRow = typeof employeeBankAccount.$inferSelect;
