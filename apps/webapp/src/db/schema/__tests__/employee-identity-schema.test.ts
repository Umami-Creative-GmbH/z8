import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employee } from "../organization";

const indexName = "employee_organizationId_userId_unique_idx";

describe("employee identity schema", () => {
	it("enforces one employee per organization and user in that column order", () => {
		const table = getTableConfig(employee);
		const identityIndex = table.indexes.find(
			(index) => index.config.name === indexName,
		);

		expect(identityIndex?.config.unique).toBe(true);
		expect(identityIndex?.config.columns.map((column) => column.name)).toEqual([
			"organization_id",
			"user_id",
		]);
	});

	it("records the identity index in the unshipped migration snapshot", () => {
		const snapshot = JSON.parse(
			readFileSync("drizzle/meta/0054_snapshot.json", "utf8"),
		) as {
			tables: Record<
				string,
				{
					indexes: Record<
						string,
						{ isUnique: boolean; columns: Array<{ expression: string }> }
					>;
				}
			>;
		};

		expect(snapshot.tables["public.employee"]?.indexes[indexName]).toEqual(
			expect.objectContaining({
				isUnique: true,
				columns: [
					expect.objectContaining({ expression: "organization_id" }),
					expect.objectContaining({ expression: "user_id" }),
				],
			}),
		);
	});
});
