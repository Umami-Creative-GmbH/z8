import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { customer } from "./customer";
import { employee } from "./organization";
import { project } from "./project";

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

/**
 * Billable rates (#898): what an organization charges per hour of work, in its
 * billable currency, effective-dated at one of four rate levels. A level and its
 * target form one rate series:
 *
 * - `employee_project`: `employee_id` + `project_id`
 * - `project`: `project_id`
 * - `customer`: `customer_id`
 * - `employee`: `employee_id`
 *
 * Periods are half-open calendar-date ranges `[effective_from, effective_to)`;
 * `effective_to` null is open. The dates are the employee-local days of work
 * starts (`lib/billable-time/applicable-rate.ts`).
 *
 * Periods of one series never overlap: the EXCLUDE constraints
 * `billable_rate_<level>_no_overlap` live in migration 0143 (Drizzle cannot
 * declare them). Keep the level list in sync with `RATE_LEVELS` in
 * `src/lib/billable-time/applicable-rate.ts`.
 */
export const billableRate = pgTable(
	"billable_rate",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		level: text("level").notNull(),
		employeeId: uuid("employee_id"),
		projectId: uuid("project_id"),
		customerId: uuid("customer_id"),
		/** Per hour, in the organization's billable currency. */
		hourlyRate: numeric("hourly_rate", { precision: 12, scale: 2 }).notNull(),
		effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
		effectiveTo: date("effective_to", { mode: "string" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"billable_rate_level_check",
			sql`${table.level} IN ('employee_project', 'project', 'customer', 'employee')`,
		),
		check(
			"billable_rate_target_check",
			sql`(${table.level} = 'employee_project' AND ${table.employeeId} IS NOT NULL AND ${table.projectId} IS NOT NULL AND ${table.customerId} IS NULL)
			OR (${table.level} = 'project' AND ${table.employeeId} IS NULL AND ${table.projectId} IS NOT NULL AND ${table.customerId} IS NULL)
			OR (${table.level} = 'customer' AND ${table.employeeId} IS NULL AND ${table.projectId} IS NULL AND ${table.customerId} IS NOT NULL)
			OR (${table.level} = 'employee' AND ${table.employeeId} IS NOT NULL AND ${table.projectId} IS NULL AND ${table.customerId} IS NULL)`,
		),
		check("billable_rate_positive_check", sql`${table.hourlyRate} > 0`),
		check(
			"billable_rate_period_check",
			sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
		),
		foreignKey({
			name: "billable_rate_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "billable_rate_project_fk",
			columns: [table.projectId, table.organizationId],
			foreignColumns: [project.id, project.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "billable_rate_customer_fk",
			columns: [table.customerId, table.organizationId],
			foreignColumns: [customer.id, customer.organizationId],
		}).onDelete("cascade"),
		index("billable_rate_organization_level_idx").on(table.organizationId, table.level),
		index("billable_rate_employee_idx").on(table.organizationId, table.employeeId),
		index("billable_rate_project_idx").on(table.organizationId, table.projectId),
		index("billable_rate_customer_idx").on(table.organizationId, table.customerId),
	],
);
