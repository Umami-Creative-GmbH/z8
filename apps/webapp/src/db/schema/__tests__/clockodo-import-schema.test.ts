import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { clockodoProjectMapping } from "@/db/schema";

describe("Clockodo project mapping schema (#907)", () => {
	it("maps to a project of the mapping's own organization", () => {
		const references = getTableConfig(clockodoProjectMapping).foreignKeys.map((foreignKey) => {
			const reference = foreignKey.reference();
			return {
				columns: reference.columns.map((column) => column.name),
				target: getTableConfig(reference.foreignTable).name,
				foreignColumns: reference.foreignColumns.map((column) => column.name),
				onDelete: foreignKey.onDelete,
			};
		});
		expect(references).toContainEqual({
			columns: ["project_id", "organization_id"],
			target: "project",
			foreignColumns: ["id", "organization_id"],
			onDelete: "cascade",
		});
	});

	it("keeps one mapping per Clockodo project and organization", () => {
		expect(
			getTableConfig(clockodoProjectMapping)
				.indexes.filter((index) => index.config.unique)
				.map((index) =>
					index.config.columns.map((column) => ("name" in column ? column.name : null)),
				),
		).toContainEqual(["organization_id", "clockodo_project_id"]);
	});

	it("declares the organization-scoped project reference in migration 0164", () => {
		const migration = readFileSync(
			new URL("../../../../drizzle/0164_clockodo_project_mapping.sql", import.meta.url),
			"utf8",
		);
		expect(migration).toContain(
			'FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade',
		);
	});
});
