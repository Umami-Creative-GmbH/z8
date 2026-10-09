import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

/**
 * Billable Time module settings (#897). One row per organization, created the
 * first time the module is switched on. The module switch itself is
 * `organization.billable_time_enabled`; switching it off keeps this row, so the
 * billable currency survives an off/on cycle.
 *
 * Keep the currency CHECK in sync with `BILLABLE_CURRENCIES` in
 * `src/lib/billable-time/currency.ts`.
 */
export const billableTimeSettings = pgTable(
	"billable_time_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		billableCurrency: text("billable_currency").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"billable_time_settings_currency_check",
			sql`${table.billableCurrency} IN ('EUR', 'CHF', 'USD', 'GBP')`,
		),
	],
);
