/**
 * #1575, Organization ADR 0010: migration 0309 makes every employee's primary team one of
 * their team memberships, and gives every employee with memberships a primary team. Runs
 * the migration file against minimal tables in a scratch schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1575_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0310_primary_team_membership_backfill.sql"),
	"utf8",
);

const ORG = "t1575-org";
const OTHER_ORG = "t1575-other-org";
const id = (n: number) => `15750000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUCHHALTUNG = id(1);
const VERTRIEB = id(2);
const LAGER = id(3);
const FOREIGN = id(9);

type Employee = [n: number, organizationId: string, teamId: string | null];
type Membership = [organizationId: string, teamId: string, employeeN: number, createdAt: string];

async function withScratchTables<T>(
	seed: { employees: Employee[]; memberships: Membership[] },
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await admin.connect();
	try {
		await client.query(`drop schema if exists ${SCHEMA} cascade`);
		await client.query(`create schema ${SCHEMA}`);
		await client.query(`set search_path to ${SCHEMA}, public`);
		await client.query(`
			create table team (id uuid primary key, organization_id text not null);
			insert into team values
				('${BUCHHALTUNG}', '${ORG}'), ('${VERTRIEB}', '${ORG}'), ('${LAGER}', '${ORG}'),
				('${FOREIGN}', '${OTHER_ORG}');
			create table employee (
				id uuid primary key, organization_id text not null, team_id uuid);
			create table team_membership (
				id uuid primary key default gen_random_uuid(), organization_id text not null,
				team_id uuid not null, employee_id uuid not null,
				created_at timestamp default now() not null, created_by text,
				unique (team_id, employee_id));
		`);
		for (const [n, organizationId, teamId] of seed.employees) {
			await client.query("insert into employee values ($1, $2, $3)", [id(n), organizationId, teamId]);
		}
		for (const [organizationId, teamId, employeeN, createdAt] of seed.memberships) {
			await client.query(
				"insert into team_membership (organization_id, team_id, employee_id, created_at) values ($1, $2, $3, $4)",
				[organizationId, teamId, id(employeeN), createdAt],
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

async function teams(client: PoolClient) {
	const { rows: employees } = await client.query<{ id: string; team_id: string | null }>(
		"select id, team_id from employee order by id",
	);
	const { rows: memberships } = await client.query<{ employee_id: string; team_id: string }>(
		"select employee_id, team_id from team_membership order by employee_id, team_id",
	);
	return Object.fromEntries(
		employees.map((row) => [
			row.id,
			{
				primary: row.team_id,
				memberships: memberships.flatMap((m) => (m.employee_id === row.id ? [m.team_id] : [])),
			},
		]),
	);
}

describe("0309 primary team membership backfill", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("adds the missing membership of every primary team and keeps existing ones", async () => {
		await withScratchTables(
			{
				employees: [
					// Stefanie Sust's case: primary team Buchhaltung, no Buchhaltung membership.
					[1, ORG, BUCHHALTUNG],
					// Already consistent, with a second membership.
					[2, ORG, VERTRIEB],
					[3, ORG, null],
				],
				memberships: [
					[ORG, VERTRIEB, 2, "2026-01-01 00:00:00"],
					[ORG, LAGER, 2, "2026-02-01 00:00:00"],
				],
			},
			async (client) => {
				await migrate(client);
				expect(await teams(client)).toEqual({
					[id(1)]: { primary: BUCHHALTUNG, memberships: [BUCHHALTUNG] },
					[id(2)]: { primary: VERTRIEB, memberships: [VERTRIEB, LAGER] },
					[id(3)]: { primary: null, memberships: [] },
				});
			},
		);
	});

	it("gives an employee with memberships but no primary team their oldest membership", async () => {
		await withScratchTables(
			{
				employees: [[1, ORG, null]],
				memberships: [
					[ORG, VERTRIEB, 1, "2026-01-01 00:00:00"],
					[ORG, BUCHHALTUNG, 1, "2026-03-01 00:00:00"],
				],
			},
			async (client) => {
				await migrate(client);
				expect(await teams(client)).toEqual({
					[id(1)]: { primary: VERTRIEB, memberships: [BUCHHALTUNG, VERTRIEB] },
				});
			},
		);
	});

	it("never joins another organization's team and is idempotent", async () => {
		await withScratchTables(
			{
				employees: [
					// A primary team of another organization is no team of theirs.
					[1, ORG, FOREIGN],
					[2, ORG, FOREIGN],
				],
				memberships: [[ORG, LAGER, 2, "2026-01-01 00:00:00"]],
			},
			async (client) => {
				await migrate(client);
				const repaired = await teams(client);
				expect(repaired).toEqual({
					[id(1)]: { primary: null, memberships: [] },
					[id(2)]: { primary: LAGER, memberships: [LAGER] },
				});

				await migrate(client);
				expect(await teams(client)).toEqual(repaired);
			},
		);
	});
});
