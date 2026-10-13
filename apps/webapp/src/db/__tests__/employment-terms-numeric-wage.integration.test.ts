/**
 * #1174: migration 0216 turns the terms' text wage into numeric(10,2).
 * Runs the migration file against the pre-0216 column shape in a scratch schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1174_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0216_employment_terms_numeric_wage.sql"),
	"utf8",
);

describe("0216 employment terms numeric wage migration", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("converts existing text wages unchanged and blanks to null", async () => {
		const client = await admin.connect();
		try {
			await client.query(`drop schema if exists ${SCHEMA} cascade`);
			await client.query(`create schema ${SCHEMA}`);
			await client.query(`set search_path to ${SCHEMA}, public`);
			await client.query(
				`create table employee_employment_history (id integer primary key, hourly_rate text)`,
			);
			await client.query(
				`insert into employee_employment_history (id, hourly_rate) values
				 (1, '28.50'), (2, '12'), (3, ' 17.25 '), (4, ''), (5, '   '), (6, null)`,
			);

			for (const statement of migration.split("--> statement-breakpoint")) {
				await client.query(statement);
			}

			const column = await client.query<{ data_type: string; precision: number; scale: number }>(
				`select data_type, numeric_precision as precision, numeric_scale as scale
				 from information_schema.columns
				 where table_schema = $1 and table_name = 'employee_employment_history'
				   and column_name = 'hourly_rate'`,
				[SCHEMA],
			);
			const rows = await client.query<{ id: number; hourly_rate: string | null }>(
				`select id, hourly_rate from employee_employment_history order by id`,
			);

			expect(column.rows[0]).toEqual({ data_type: "numeric", precision: 10, scale: 2 });
			expect(rows.rows.map((row) => row.hourly_rate)).toEqual([
				"28.50",
				"12.00",
				"17.25",
				null,
				null,
				null,
			]);
		} finally {
			await client.query("reset search_path");
			client.release();
		}
	});
});
