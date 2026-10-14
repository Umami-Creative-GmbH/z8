/**
 * #1196: migration 0232 normalizes stored personnel numbers and makes them
 * unique per organization, or fails and names every clash without changing a
 * row. Runs the migration file against a minimal employee table in a scratch
 * schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1196_migration";
const INDEX = "employee_organization_personnel_number_unique_idx";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0232_employee_personnel_number_unique.sql"),
	"utf8",
);
/** The read-only clash check the docs note gives operators before deploying 0232. */
const operatorClashQuery = (() => {
	const note = readFileSync(
		join(process.cwd(), "../../docs/personnel-number-uniqueness-881.md"),
		"utf8",
	);
	const query = note.match(/```sql\r?\n([\s\S]*?)```/)?.[1];
	if (!query) throw new Error("The docs note no longer holds the clash check");
	return query;
})();

const ORG_A = "t1196-org-a";
const ORG_B = "t1196-org-b";
const id = (n: number) => `11960000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function withScratchEmployees<T>(
	rows: Array<[number, string, string | null]>,
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await admin.connect();
	try {
		await client.query(`drop schema if exists ${SCHEMA} cascade`);
		await client.query(`create schema ${SCHEMA}`);
		await client.query(`set search_path to ${SCHEMA}`);
		await client.query(
			`create table employee (id uuid primary key, organization_id text not null,
			 employee_number text, is_active boolean not null default true)`,
		);
		await client.query(
			`create table organization (id text primary key, name text not null);
			 insert into organization values ('${ORG_A}', 'A'), ('${ORG_B}', 'B')`,
		);
		for (const [n, organizationId, employeeNumber] of rows) {
			await client.query(
				"insert into employee (id, organization_id, employee_number) values ($1, $2, $3)",
				[id(n), organizationId, employeeNumber],
			);
		}
		return await run(client);
	} finally {
		await client.query("reset search_path");
		client.release();
	}
}

async function migrate(client: PoolClient) {
	for (const statement of migration.split("--> statement-breakpoint")) {
		await client.query(statement);
	}
}

async function numbers(client: PoolClient) {
	const { rows } = await client.query<{ id: string; employee_number: string | null }>(
		"select id, employee_number from employee order by id",
	);
	return rows.map((row) => row.employee_number);
}

async function indexExists(client: PoolClient) {
	const { rows } = await client.query(
		"select 1 from pg_indexes where schemaname = $1 and indexname = $2",
		[SCHEMA, INDEX],
	);
	return rows.length === 1;
}

describe("0232 personnel number uniqueness migration", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("stores blank numbers as none, trims the rest and creates the unique index", async () => {
		await withScratchEmployees(
			[
				[1, ORG_A, ""],
				[2, ORG_A, "  "],
				[3, ORG_A, " E-42 "],
				[4, ORG_A, "\u00a0E-7\t"],
				[5, ORG_A, null],
				[6, ORG_A, "0042"],
				[7, ORG_A, "42"],
				// The same number in another organization is no clash.
				[8, ORG_B, "e-42"],
			],
			async (client) => {
				await migrate(client);

				expect(await numbers(client)).toEqual([
					null,
					null,
					"E-42",
					"E-7",
					null,
					"0042",
					"42",
					"e-42",
				]);
				expect(await indexExists(client)).toBe(true);

				// The index compares ignoring case and surrounding spaces, per organization.
				await expect(
					client.query(
						"insert into employee (id, organization_id, employee_number) values ($1, $2, ' e-42')",
						[id(20), ORG_A],
					),
				).rejects.toMatchObject({ code: "23505", constraint: INDEX });
				// Several employees can have no number.
				await expect(
					client.query(
						"insert into employee (id, organization_id, employee_number) values ($1, $2, null), ($3, $2, null)",
						[id(21), ORG_A, id(22)],
					),
				).resolves.toMatchObject({ rowCount: 2 });
			},
		);
	});

	it("fails, names every clash and changes no row when numbers are shared in an organization", async () => {
		await withScratchEmployees(
			[
				[1, ORG_A, "E-42"],
				[2, ORG_A, "e-42 "],
				[3, ORG_A, " X-1"],
				[4, ORG_A, "  "],
				[5, ORG_B, "Z-9"],
				[6, ORG_B, "z-9"],
				[7, ORG_B, "E-42"],
			],
			async (client) => {
				// The operator's read-only check lists the same clashes beforehand.
				const check = await client.query<{
					organization_id: string;
					personnel_number_key: string;
					employee_ids: string[];
				}>(operatorClashQuery);
				expect(
					check.rows.map((row) => [
						row.organization_id,
						row.personnel_number_key,
						row.employee_ids,
					]),
				).toEqual([
					[ORG_A, "e-42", [id(1), id(2)]],
					[ORG_B, "z-9", [id(5), id(6)]],
				]);

				const failure = await migrate(client).then(
					() => null,
					(error: { code?: string; message?: string; detail?: string }) => error,
				);

				expect(failure).toMatchObject({
					code: "23505",
					message: "Personnel number uniqueness preflight failed",
				});
				const detail = failure?.detail ?? "";
				expect(detail).toContain(`organization ${ORG_A}: personnel number "e-42"`);
				expect(detail).toContain(id(1));
				expect(detail).toContain(id(2));
				expect(detail).toContain(`organization ${ORG_B}: personnel number "z-9"`);
				expect(detail).toContain(id(5));
				expect(detail).toContain(id(6));
				expect(detail).not.toContain(id(7));
				expect(detail).toContain("No employee rows were changed.");

				expect(await numbers(client)).toEqual([
					"E-42",
					"e-42 ",
					" X-1",
					"  ",
					"Z-9",
					"z-9",
					"E-42",
				]);
				expect(await indexExists(client)).toBe(false);
			},
		);
	});
});
