import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
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
import { workPeriod } from "./time-tracking";

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

/**
 * Hand-off attempt and invoice draft states (#903). Keep in sync with the
 * CHECK on `invoice_draft.status`.
 *
 * - `pending`: the hand-off recorded its attempt (draft, lines and invoiced
 *   work) and has not yet learned that the tool created the draft. Retrying
 *   calls the tool with the same idempotency key.
 * - `created`: the draft exists in the accounting tool.
 * - `failed`: the tool certainly did not create it; its work was returned.
 * - `released`: an admin released it; its work is un-invoiced again.
 */
export const INVOICE_DRAFT_STATUSES = ["pending", "created", "failed", "released"] as const;

export type InvoiceDraftStatusValue = (typeof INVOICE_DRAFT_STATUSES)[number];

/**
 * Invoice drafts (#903): one per hand-off of one customer's un-invoiced
 * billable work in a period, created in the accounting tool through the
 * provider port. The row is written BEFORE the tool is called (the recorded
 * attempt) with its idempotency key; retries send the same key and the same
 * lines. The lines freeze project, rate, hours and amount (ADR 0001).
 */
export const invoiceDraft = pgTable(
	"invoice_draft",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		connectionId: uuid("connection_id").notNull(),
		providerKind: text("provider_kind").notNull(),
		customerId: uuid("customer_id").notNull(),
		status: text("status").$type<InvoiceDraftStatusValue>().notNull().default("pending"),
		/** The hand-off's idempotency key: the tool call carries it, retries reuse it. */
		idempotencyKey: text("idempotency_key").notNull(),
		contactId: text("contact_id").notNull(),
		contactName: text("contact_name").notNull(),
		contactNumber: text("contact_number"),
		currency: text("currency").notNull(),
		taxTreatment: text("tax_treatment").notNull(),
		taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
		periodFrom: date("period_from", { mode: "string" }).notNull(),
		periodTo: date("period_to", { mode: "string" }).notNull(),
		/** The projects the admin chose; null = all of the customer's projects. */
		projectIds: uuid("project_ids").array(),
		title: text("title").notNull(),
		introduction: text("introduction"),
		remark: text("remark"),
		includeTimesheet: boolean("include_timesheet").notNull().default(false),
		/** The sum of the work lines' amounts, in `currency`. */
		netTotal: numeric("net_total", { precision: 14, scale: 2 }).notNull(),
		externalId: text("external_id"),
		externalUrl: text("external_url"),
		firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }).defaultNow().notNull(),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		attemptCount: integer("attempt_count").notNull().default(0),
		/** Some call may have reached the tool (timeout): never treat the attempt as failed. */
		outcomeUnknown: boolean("outcome_unknown").notNull().default(false),
		lastFailure: text("last_failure"),
		lastFailureMessage: text("last_failure_message"),
		toolStatus: text("tool_status"),
		toolStatusCheckedAt: timestamp("tool_status_checked_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
		releaseReason: text("release_reason"),
	},
	(table) => [
		check(
			"invoice_draft_status_check",
			sql`${table.status} IN ('pending', 'created', 'failed', 'released')`,
		),
		check(
			"invoice_draft_provider_kind_check",
			sql`${table.providerKind} IN ('lexware_office', 'sevdesk')`,
		),
		check("invoice_draft_currency_check", sql`${table.currency} IN ('EUR', 'CHF', 'USD', 'GBP')`),
		check(
			"invoice_draft_tax_treatment_check",
			sql`${table.taxTreatment} IN (${TAX_TREATMENT_KIND_SQL})`,
		),
		check("invoice_draft_period_check", sql`${table.periodTo} >= ${table.periodFrom}`),
		check(
			"invoice_draft_created_check",
			sql`${table.status} <> 'created' OR ${table.externalId} IS NOT NULL`,
		),
		check(
			"invoice_draft_ended_check",
			sql`(${table.status} IN ('failed', 'released')) = (${table.endedAt} IS NOT NULL)`,
		),
		unique("invoice_draft_id_organization_idx").on(table.id, table.organizationId),
		uniqueIndex("invoice_draft_idempotency_key_idx").on(table.organizationId, table.idempotencyKey),
		foreignKey({
			name: "invoice_draft_connection_fk",
			columns: [table.connectionId, table.organizationId],
			foreignColumns: [accountingConnection.id, accountingConnection.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "invoice_draft_customer_fk",
			columns: [table.customerId, table.organizationId],
			foreignColumns: [customer.id, customer.organizationId],
		}).onDelete("cascade"),
		index("invoice_draft_organization_created_idx").on(table.organizationId, table.createdAt),
		index("invoice_draft_customer_idx").on(table.organizationId, table.customerId),
	],
);

/**
 * The lines of an invoice draft, frozen at hand-off (ADR 0001): a work line per
 * project and applicable rate (exact duration, hours with two decimals, rate,
 * amount), and optional text lines (the timesheet). `project_name` is the name
 * the line was sent with.
 */
export const invoiceDraftLine = pgTable(
	"invoice_draft_line",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceDraftId: uuid("invoice_draft_id").notNull(),
		position: integer("position").notNull(),
		kind: text("kind").$type<"work" | "text">().notNull(),
		projectId: uuid("project_id"),
		projectName: text("project_name"),
		text: text("text").notNull(),
		durationMs: bigint("duration_ms", { mode: "number" }),
		quantityHundredths: integer("quantity_hundredths"),
		unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
		amount: numeric("amount", { precision: 14, scale: 2 }),
	},
	(table) => [
		check(
			"invoice_draft_line_kind_check",
			sql`(${table.kind} = 'work' AND ${table.projectId} IS NOT NULL AND ${table.projectName} IS NOT NULL AND ${table.durationMs} > 0 AND ${table.quantityHundredths} > 0 AND ${table.unitPrice} > 0 AND ${table.amount} IS NOT NULL)
			OR (${table.kind} = 'text' AND ${table.projectId} IS NULL AND ${table.durationMs} IS NULL AND ${table.quantityHundredths} IS NULL AND ${table.unitPrice} IS NULL AND ${table.amount} IS NULL)`,
		),
		foreignKey({
			name: "invoice_draft_line_draft_fk",
			columns: [table.invoiceDraftId, table.organizationId],
			foreignColumns: [invoiceDraft.id, invoiceDraft.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("invoice_draft_line_position_idx").on(table.invoiceDraftId, table.position),
	],
);

/** One work period's share of one work line, frozen at hand-off. */
export interface InvoicedWorkShare {
	/** `invoice_draft_line.position` of the line. */
	line: number;
	durationMs: number;
	/** The frozen hourly rate, two decimals. */
	rate: string;
}

/**
 * Invoiced work (#903): a work period included in an invoice draft that has not
 * been released (`released_at` null). A work period is in at most one
 * unreleased draft (partial unique index).
 *
 * The started/ended/duration/project columns are the work as it was handed off
 * (the timesheet); `shares` freeze its rates per line. Rows with
 * `carried_from_work_period_id` are the split-off half of invoiced work: still
 * invoiced (never handed off twice), not in the timesheet, no shares.
 *
 * Changed after invoicing: the `invoiced_work_mark_changed` trigger on
 * `work_period` (migration 0149) sets `changed_after_invoicing_at` and adds to
 * `changed_fields` whenever ANY writer changes an invoiced period's times,
 * project, billability or deletes it. Writers are never blocked (ADR 0002). An
 * admin clears the mark (`mark_cleared_at`/`mark_cleared_by`, audited).
 */
export const invoicedWork = pgTable(
	"invoiced_work",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		invoiceDraftId: uuid("invoice_draft_id").notNull(),
		workPeriodId: uuid("work_period_id")
			.notNull()
			.references(() => workPeriod.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		projectId: uuid("project_id").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
		startOffsetMinutes: integer("start_offset_minutes").notNull(),
		durationMinutes: integer("duration_minutes").notNull(),
		shares: jsonb("shares").$type<InvoicedWorkShare[]>().notNull().default([]),
		carriedFromWorkPeriodId: uuid("carried_from_work_period_id"),
		releasedAt: timestamp("released_at", { withTimezone: true }),
		changedAfterInvoicingAt: timestamp("changed_after_invoicing_at", { withTimezone: true }),
		changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
		markClearedAt: timestamp("mark_cleared_at", { withTimezone: true }),
		markClearedBy: text("mark_cleared_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "invoiced_work_draft_fk",
			columns: [table.invoiceDraftId, table.organizationId],
			foreignColumns: [invoiceDraft.id, invoiceDraft.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "invoiced_work_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("invoiced_work_active_period_idx")
			.on(table.organizationId, table.workPeriodId)
			.where(sql`${table.releasedAt} IS NULL`),
		index("invoiced_work_draft_idx").on(table.organizationId, table.invoiceDraftId),
		index("invoiced_work_changed_idx")
			.on(table.organizationId)
			.where(sql`${table.changedAfterInvoicingAt} IS NOT NULL AND ${table.releasedAt} IS NULL`),
	],
);
