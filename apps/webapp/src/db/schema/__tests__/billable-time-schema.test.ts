import { readFileSync } from "node:fs";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	accountingConnection,
	accountingContactLink,
	billableRate,
	costRate,
	customer,
	customerTaxTreatment,
	employee,
	INVOICE_DRAFT_STATUSES,
	invoiceDraft,
	invoiceDraftLine,
	invoicedWork,
	project,
} from "@/db/schema";
import { ACCOUNTING_PROVIDER_KINDS } from "@/lib/billable-time/accounting/provider";
import { TAX_TREATMENT_KINDS } from "@/lib/billable-time/accounting/tax-treatment";
import { RATE_LEVELS } from "@/lib/billable-time/applicable-rate";

function compositeForeignKeys(table: Parameters<typeof getTableConfig>[0]) {
	return getTableConfig(table).foreignKeys.map((foreignKey) => {
		const reference = foreignKey.reference();
		return {
			columns: reference.columns.map((column) => column.name),
			target: getTableConfig(reference.foreignTable).name,
			foreignColumns: reference.foreignColumns.map((column) => column.name),
		};
	});
}

describe("billable rate schema (#898)", () => {
	it("scopes every rate target to the rate's organization", () => {
		expect(compositeForeignKeys(billableRate)).toEqual(
			expect.arrayContaining([
				{
					columns: ["employee_id", "organization_id"],
					target: "employee",
					foreignColumns: ["id", "organization_id"],
				},
				{
					columns: ["project_id", "organization_id"],
					target: "project",
					foreignColumns: ["id", "organization_id"],
				},
				{
					columns: ["customer_id", "organization_id"],
					target: "customer",
					foreignColumns: ["id", "organization_id"],
				},
			]),
		);
	});

	it("gives every rate target a unique (id, organization) key", () => {
		for (const table of [employee, project, customer]) {
			expect(
				getTableConfig(table).uniqueConstraints.map((constraint) =>
					constraint.columns.map((column) => column.name),
				),
			).toContainEqual(["id", "organization_id"]);
		}
	});

	it("checks the same rate levels as the resolver", () => {
		const levelCheck = getTableConfig(billableRate).checks.find(
			(check) => check.name === "billable_rate_level_check",
		);
		expect(levelCheck).toBeDefined();
		const sql = new PgDialect().sqlToQuery(levelCheck?.value ?? new SQL([])).sql;
		for (const level of RATE_LEVELS) expect(sql).toContain(`'${level}'`);
	});

	it("declares one half-open no-overlap constraint per rate level in migration 0143", () => {
		const migration = readFileSync(
			new URL("../../../../drizzle/0143_billable_rates.sql", import.meta.url),
			"utf8",
		);
		for (const level of RATE_LEVELS) {
			expect(migration).toMatch(
				new RegExp(
					`"billable_rate_${level}_no_overlap" EXCLUDE USING gist \\([^;]*daterange\\("effective_from", "effective_to", '\\[\\)'\\) WITH &&\\) WHERE \\("level" = '${level}'\\)`,
				),
			);
		}
	});
});

describe("cost rate schema (#899)", () => {
	it("scopes the cost rate's employee to the cost rate's organization", () => {
		expect(compositeForeignKeys(costRate)).toContainEqual({
			columns: ["employee_id", "organization_id"],
			target: "employee",
			foreignColumns: ["id", "organization_id"],
		});
		expect(
			getTableConfig(costRate).columns.find((column) => column.name === "employee_id"),
		).toMatchObject({ notNull: true });
	});

	it("keeps cost rates positive and periods half-open", () => {
		const checks = getTableConfig(costRate).checks.map((check) => check.name);
		expect(checks).toEqual(
			expect.arrayContaining(["cost_rate_positive_check", "cost_rate_period_check"]),
		);
	});

	it("declares a half-open no-overlap constraint per employee in migration 0144", () => {
		const migration = readFileSync(
			new URL("../../../../drizzle/0144_cost_rates.sql", import.meta.url),
			"utf8",
		);
		expect(migration).toMatch(
			/"cost_rate_employee_no_overlap" EXCLUDE USING gist \("organization_id" WITH =, "employee_id" WITH =, daterange\("effective_from", "effective_to", '\[\)'\) WITH &&\)/,
		);
	});
});

function checkSql(table: Parameters<typeof getTableConfig>[0], name: string): string {
	const found = getTableConfig(table).checks.find((check) => check.name === name);
	expect(found, name).toBeDefined();
	return new PgDialect().sqlToQuery(found?.value ?? new SQL([])).sql;
}

describe("accounting connection schema (#903)", () => {
	it("scopes contact links and tax overrides to the customer's organization", () => {
		for (const table of [accountingContactLink, customerTaxTreatment]) {
			expect(compositeForeignKeys(table)).toContainEqual({
				columns: ["customer_id", "organization_id"],
				target: "customer",
				foreignColumns: ["id", "organization_id"],
			});
		}
	});

	it("has no column that could hold an API key", () => {
		for (const table of [accountingConnection, accountingContactLink, customerTaxTreatment]) {
			for (const column of getTableConfig(table).columns) {
				expect(column.name).not.toMatch(/key|secret|token|password|credential/);
			}
		}
	});

	it("checks the same provider kinds and tax treatments as the code", () => {
		for (const [table, name] of [
			[accountingConnection, "accounting_connection_provider_kind_check"],
			[accountingContactLink, "accounting_contact_link_provider_kind_check"],
		] as const) {
			const sql = checkSql(table, name);
			for (const kind of ACCOUNTING_PROVIDER_KINDS) expect(sql).toContain(`'${kind}'`);
		}
		for (const [table, name] of [
			[accountingConnection, "accounting_connection_tax_treatment_check"],
			[customerTaxTreatment, "customer_tax_treatment_kind_check"],
		] as const) {
			const sql = checkSql(table, name);
			for (const kind of TAX_TREATMENT_KINDS) expect(sql).toContain(`'${kind}'`);
		}
	});

	it("allows at most one active connection per organization", () => {
		const index = getTableConfig(accountingConnection).indexes.find(
			(candidate) => candidate.config.name === "accounting_connection_one_active_idx",
		);
		expect(index?.config.unique).toBe(true);
		const migration = readFileSync(
			new URL("../../../../drizzle/0146_accounting_connection.sql", import.meta.url),
			"utf8",
		);
		expect(migration).toContain(
			`CREATE UNIQUE INDEX IF NOT EXISTS "accounting_connection_one_active_idx" ON "accounting_connection" USING btree ("organization_id") WHERE "accounting_connection"."status" = 'active'`,
		);
	});
});

describe("hand-off schema (#903)", () => {
	const migration = () =>
		readFileSync(
			new URL("../../../../drizzle/0149_billable_hand_off.sql", import.meta.url),
			"utf8",
		);

	it("scopes drafts, lines and invoiced work to one organization", () => {
		expect(compositeForeignKeys(invoiceDraft)).toEqual(
			expect.arrayContaining([
				{
					columns: ["connection_id", "organization_id"],
					target: "accounting_connection",
					foreignColumns: ["id", "organization_id"],
				},
				{
					columns: ["customer_id", "organization_id"],
					target: "customer",
					foreignColumns: ["id", "organization_id"],
				},
			]),
		);
		for (const table of [invoiceDraftLine, invoicedWork]) {
			expect(compositeForeignKeys(table)).toContainEqual({
				columns: ["invoice_draft_id", "organization_id"],
				target: "invoice_draft",
				foreignColumns: ["id", "organization_id"],
			});
		}
	});

	it("checks the same draft statuses and provider kinds as the code", () => {
		const statuses = checkSql(invoiceDraft, "invoice_draft_status_check");
		for (const status of INVOICE_DRAFT_STATUSES) expect(statuses).toContain(`'${status}'`);
		const kinds = checkSql(invoiceDraft, "invoice_draft_provider_kind_check");
		for (const kind of ACCOUNTING_PROVIDER_KINDS) expect(kinds).toContain(`'${kind}'`);
	});

	it("lets a work period be in at most one unreleased invoice draft", () => {
		const index = getTableConfig(invoicedWork).indexes.find(
			(candidate) => candidate.config.name === "invoiced_work_active_period_idx",
		);
		expect(index?.config.unique).toBe(true);
		expect(migration()).toContain(
			`CREATE UNIQUE INDEX IF NOT EXISTS "invoiced_work_active_period_idx" ON "invoiced_work" USING btree ("organization_id","work_period_id") WHERE "invoiced_work"."released_at" IS NULL`,
		);
	});

	it("marks invoiced work from every writer of times, project, billability or deletion", () => {
		const sql = migration();
		expect(sql).toContain(
			`CREATE TRIGGER "invoiced_work_mark_changed" AFTER UPDATE OF "start_time", "end_time", "duration_minutes", "project_id", "is_billable", "deleted_at" ON "work_period"`,
		);
		expect(sql).toContain('DROP TRIGGER IF EXISTS "invoiced_work_mark_changed" ON "work_period"');
	});
});
