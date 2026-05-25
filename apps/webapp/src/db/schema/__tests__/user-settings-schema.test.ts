import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { userSettings } from "../user-settings";

function columnDefault(columnName: string): unknown {
	return getTableConfig(userSettings).columns.find((column) => column.name === columnName)?.default;
}

function columnNotNull(columnName: string): boolean | undefined {
	return getTableConfig(userSettings).columns.find((column) => column.name === columnName)?.notNull;
}

describe("user settings schema", () => {
	it("stores product improvement consent as enabled by default", () => {
		expect(columnDefault("help_improve_product")).toBe(true);
		expect(columnNotNull("help_improve_product")).toBe(true);

		const migration = readFileSync("drizzle/0033_product_improvement_consent.sql", "utf8");
		expect(migration).toContain(
			'ALTER TABLE "user_settings" ADD COLUMN "help_improve_product" boolean DEFAULT true NOT NULL',
		);
	});
});
