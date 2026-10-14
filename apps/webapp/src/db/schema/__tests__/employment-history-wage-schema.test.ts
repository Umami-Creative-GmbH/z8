import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { employeeEmploymentHistory } from "../employment-history";

const TAG = "0222_employment_terms_numeric_wage";

describe("employment terms wage column (#1174)", () => {
	it("stores the hourly wage as numeric(10,2), read as a number", () => {
		const column = getTableConfig(employeeEmploymentHistory).columns.find(
			(candidate) => candidate.name === "hourly_rate",
		);

		expect(column?.getSQLType()).toBe("numeric(10, 2)");
		expect(column?.mapFromDriverValue("28.50")).toBe(28.5);
		expect(column?.notNull).toBe(false);
	});

	it("converts existing text wages in a journaled migration", () => {
		const migration = readFileSync(`drizzle/${TAG}.sql`, "utf8");
		const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
			entries: Array<{ idx: number; tag: string; when: number }>;
		};
		const index = journal.entries.findIndex((entry) => entry.tag === TAG);

		expect(migration).toContain(
			`ALTER TABLE "employee_employment_history" ALTER COLUMN "hourly_rate" SET DATA TYPE numeric(10,2) USING NULLIF(btrim("hourly_rate"), '')::numeric(10,2)`,
		);
		expect(index).toBeGreaterThan(0);
		expect(journal.entries[index]?.idx).toBe(index);
		expect(journal.entries[index]?.when).toBeGreaterThan(
			Math.max(...journal.entries.slice(0, index).map((entry) => entry.when)),
		);
	});
});
