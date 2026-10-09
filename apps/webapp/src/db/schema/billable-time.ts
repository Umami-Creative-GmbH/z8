import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
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

/**
 * Cost rates (#899): an employee's fully loaded internal cost per hour, in the
 * organization's billable currency, for margin. Any contract type may have
 * one. Separate from the wage (`employee_rate_history`, employment terms):
 * neither ever changes the other.
 *
 * Periods are half-open calendar-date ranges `[effective_from, effective_to)`
 * of the employee-local days of work starts (`lib/billable-time/cost-rate.ts`);
 * `effective_to` null is open. One employee's periods never overlap: the
 * EXCLUDE constraint `cost_rate_employee_no_overlap` lives in migration 0144
 * (Drizzle cannot declare it).
 */
export const costRate = pgTable(
	"cost_rate",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
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
		check("cost_rate_positive_check", sql`${table.hourlyRate} > 0`),
		check(
			"cost_rate_period_check",
			sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
		),
		foreignKey({
			name: "cost_rate_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		index("cost_rate_employee_idx").on(table.organizationId, table.employeeId),
	],
);

/**
 * Tax treatment columns (#903): a Z8 kind plus its rate in percent. Domestic
 * treatments have a rate in (0, 100]; reverse charge, third-country service and
 * VAT-free are 0. Keep the kinds in sync with `TAX_TREATMENT_KINDS` in
 * `src/lib/billable-time/accounting/tax-treatment.ts`.
 */
const TAX_TREATMENT_KIND_SQL = sql.raw(
	"'domestic_standard', 'domestic_reduced', 'eu_reverse_charge', 'third_country_service', 'vat_free'",
);

/**
 * Accounting connections (#903): an organization's link to its accounting tool
 * (Lexware Office, sevdesk). At most one per organization is `active` (partial
 * unique index); replacing one marks it `replaced`, removing one `removed`, so
 * invoice drafts created through it keep their connection.
 *
 * The API key is NEVER stored here: it lives in the organization secret store
 * under `accounting/<connection id>/api_key` (`lib/billable-time/accounting/
 * connection-store.ts`). `settings` holds the connector's non-secret settings.
 * `account_ref` identifies the tool account the key belongs to; contact links
 * are valid for that account only.
 *
 * Keep the provider kinds in sync with `ACCOUNTING_PROVIDER_KINDS` in
 * `src/lib/billable-time/accounting/provider.ts`.
 */
export const accountingConnection = pgTable(
	"accounting_connection",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		providerKind: text("provider_kind").notNull(),
		status: text("status").notNull().default("active"),
		accountRef: text("account_ref").notNull(),
		accountLabel: text("account_label"),
		settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
		defaultTaxTreatment: text("default_tax_treatment").notNull(),
		defaultTaxRate: numeric("default_tax_rate", { precision: 5, scale: 2 }).notNull(),
		connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
		connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"accounting_connection_provider_kind_check",
			sql`${table.providerKind} IN ('lexware_office', 'sevdesk')`,
		),
		check(
			"accounting_connection_status_check",
			sql`${table.status} IN ('active', 'replaced', 'removed')`,
		),
		check(
			"accounting_connection_ended_check",
			sql`(${table.status} = 'active') = (${table.endedAt} IS NULL)`,
		),
		check(
			"accounting_connection_tax_treatment_check",
			sql`${table.defaultTaxTreatment} IN (${TAX_TREATMENT_KIND_SQL})`,
		),
		check(
			"accounting_connection_tax_rate_check",
			sql`(${table.defaultTaxTreatment} IN ('domestic_standard', 'domestic_reduced') AND ${table.defaultTaxRate} > 0 AND ${table.defaultTaxRate} <= 100)
			OR (${table.defaultTaxTreatment} NOT IN ('domestic_standard', 'domestic_reduced') AND ${table.defaultTaxRate} = 0)`,
		),
		unique("accounting_connection_id_organization_idx").on(table.id, table.organizationId),
		uniqueIndex("accounting_connection_one_active_idx")
			.on(table.organizationId)
			.where(sql`${table.status} = 'active'`),
	],
);

/**
 * Contact links (#903): a Z8 customer linked to an existing contact in the
 * accounting tool. Z8 never creates contacts there (ADR 0002). A link belongs
 * to one tool account (`provider_kind` + `account_ref`); it applies while the
 * active connection is to that account, so replacing an API key of the same
 * account keeps the links. One link per customer and account.
 * `contact_name`/`contact_number` are the contact's display values when linked.
 */
export const accountingContactLink = pgTable(
	"accounting_contact_link",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id").notNull(),
		providerKind: text("provider_kind").notNull(),
		accountRef: text("account_ref").notNull(),
		contactId: text("contact_id").notNull(),
		contactName: text("contact_name").notNull(),
		contactNumber: text("contact_number"),
		linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
		linkedBy: text("linked_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"accounting_contact_link_provider_kind_check",
			sql`${table.providerKind} IN ('lexware_office', 'sevdesk')`,
		),
		foreignKey({
			name: "accounting_contact_link_customer_fk",
			columns: [table.customerId, table.organizationId],
			foreignColumns: [customer.id, customer.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("accounting_contact_link_customer_account_idx").on(
			table.organizationId,
			table.customerId,
			table.providerKind,
			table.accountRef,
		),
		index("accounting_contact_link_contact_idx").on(
			table.organizationId,
			table.providerKind,
			table.accountRef,
			table.contactId,
		),
	],
);

/**
 * A customer's tax treatment override (#903). Without a row, the customer's
 * hand-offs use the accounting connection's default tax treatment.
 */
export const customerTaxTreatment = pgTable(
	"customer_tax_treatment",
	{
		customerId: uuid("customer_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		taxTreatment: text("tax_treatment").notNull(),
		taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"customer_tax_treatment_kind_check",
			sql`${table.taxTreatment} IN (${TAX_TREATMENT_KIND_SQL})`,
		),
		check(
			"customer_tax_treatment_rate_check",
			sql`(${table.taxTreatment} IN ('domestic_standard', 'domestic_reduced') AND ${table.taxRate} > 0 AND ${table.taxRate} <= 100)
			OR (${table.taxTreatment} NOT IN ('domestic_standard', 'domestic_reduced') AND ${table.taxRate} = 0)`,
		),
		foreignKey({
			name: "customer_tax_treatment_customer_fk",
			columns: [table.customerId, table.organizationId],
			foreignColumns: [customer.id, customer.organizationId],
		}).onDelete("cascade"),
		index("customer_tax_treatment_organization_idx").on(table.organizationId),
	],
);
