import { readFileSync } from "node:fs";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { billableRate, customer, employee, project } from "@/db/schema";
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
