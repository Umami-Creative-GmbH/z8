/**
 * #1162: migration 0277 moves the terms a rehire wrote at its instant to UTC
 * midnight of the org-local rehire date, with the work policy assignment they
 * projected. Runs the migration file against minimal tables in a scratch
 * schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1162_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0277_rehire_terms_calendar_date.sql"),
	"utf8",
);

const BERLIN = "t1162-berlin";
const NEW_YORK = "t1162-new-york";
const UNKNOWN_ZONE = "t1162-unknown-zone";
const NO_ZONE = "t1162-no-zone";
const id = (n: number) => `11620000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EMPLOYEE = id(900);
const POLICY = id(901);

type Period = [n: number, organizationId: string, startedAt: string, provenance: string];
type Terms = [n: number, organizationId: string, periodN: number, validFrom: string];
type Assignment = [n: number, organizationId: string, effectiveFrom: string];

async function withScratchTables<T>(
	seed: { periods: Period[]; terms: Terms[]; assignments: Assignment[] },
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await admin.connect();
	try {
		await client.query(`drop schema if exists ${SCHEMA} cascade`);
		await client.query(`create schema ${SCHEMA}`);
		await client.query(`set search_path to ${SCHEMA}`);
		await client.query(`
			create table organization (id text primary key, timezone text);
			insert into organization values
				('${BERLIN}', 'Europe/Berlin'), ('${NEW_YORK}', 'America/New_York'),
				('${UNKNOWN_ZONE}', 'Mars/Olympus'), ('${NO_ZONE}', null);
			create table employee_employment_period (
				id uuid primary key, organization_id text not null, employee_id uuid not null,
				started_at timestamp with time zone, start_provenance text not null);
			create table employee_employment_history (
				id uuid primary key, organization_id text not null, employee_id uuid not null,
				employment_period_id uuid, valid_from timestamp not null, valid_until timestamp,
				work_policy_id uuid);
			create table work_policy_assignment (
				id uuid primary key, organization_id text not null, employee_id uuid,
				policy_id uuid not null, assignment_type text not null, effective_from timestamp);
		`);
		for (const [n, organizationId, startedAt, provenance] of seed.periods) {
			await client.query(`insert into employee_employment_period values ($1, $2, $3, $4, $5)`, [
				id(n),
				organizationId,
				EMPLOYEE,
				startedAt,
				provenance,
			]);
		}
		for (const [n, organizationId, periodN, validFrom] of seed.terms) {
			await client.query(
				`insert into employee_employment_history values ($1, $2, $3, $4, $5, null, $6)`,
				[id(n), organizationId, EMPLOYEE, id(periodN), validFrom, POLICY],
			);
		}
		for (const [n, organizationId, effectiveFrom] of seed.assignments) {
			await client.query(
				`insert into work_policy_assignment values ($1, $2, $3, $4, 'employee', $5)`,
				[id(n), organizationId, EMPLOYEE, POLICY, effectiveFrom],
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

async function validFroms(client: PoolClient) {
	const { rows } = await client.query<{ id: string; valid_from: string }>(
		"select id, valid_from::text from employee_employment_history order by id",
	);
	return Object.fromEntries(rows.map((row) => [row.id, row.valid_from]));
}

async function effectiveFroms(client: PoolClient) {
	const { rows } = await client.query<{ id: string; effective_from: string }>(
		"select id, effective_from::text from work_policy_assignment order by id",
	);
	return Object.fromEntries(rows.map((row) => [row.id, row.effective_from]));
}

describe("0277 rehire terms calendar date migration", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("moves rehire terms and their policy projection to UTC midnight of the org-local rehire date", async () => {
		await withScratchTables(
			{
				periods: [
					// Org-local 2 November in Berlin (ahead of UTC) and New York (behind).
					[1, BERLIN, "2026-11-01T23:30:00Z", "recorded"],
					[2, NEW_YORK, "2026-11-03T03:00:00Z", "recorded"],
					// An unknown or missing zone falls back to UTC.
					[3, UNKNOWN_ZONE, "2026-11-01T23:30:00Z", "recorded"],
					[4, NO_ZONE, "2026-11-01T23:30:00Z", "recorded"],
				],
				terms: [
					[11, BERLIN, 1, "2026-11-01 23:30:00"],
					[12, NEW_YORK, 2, "2026-11-03 03:00:00"],
					[13, UNKNOWN_ZONE, 3, "2026-11-01 23:30:00"],
					[14, NO_ZONE, 4, "2026-11-01 23:30:00"],
				],
				assignments: [
					[21, BERLIN, "2026-11-01 23:30:00"],
					[22, NEW_YORK, "2026-11-03 03:00:00"],
				],
			},
			async (client) => {
				await migrate(client);

				expect(await validFroms(client)).toEqual({
					[id(11)]: "2026-11-02 00:00:00",
					[id(12)]: "2026-11-02 00:00:00",
					[id(13)]: "2026-11-01 00:00:00",
					[id(14)]: "2026-11-01 00:00:00",
				});
				expect(await effectiveFroms(client)).toEqual({
					[id(21)]: "2026-11-02 00:00:00",
					[id(22)]: "2026-11-02 00:00:00",
				});
			},
		);
	});

	it("leaves every other row alone and is idempotent", async () => {
		await withScratchTables(
			{
				periods: [
					[1, BERLIN, "2026-11-01T23:30:00Z", "recorded"],
					// A legacy period start is no rehire.
					[2, BERLIN, "2026-03-04T09:15:00Z", "legacy"],
					// Another terms row already starts on the rehire's local day: skipped.
					[3, BERLIN, "2026-11-01T23:30:00Z", "recorded"],
					// A rehire at UTC midnight is already a calendar date.
					[4, NEW_YORK, "2026-11-02T00:00:00Z", "recorded"],
				],
				terms: [
					[11, BERLIN, 1, "2026-11-01 23:30:00"],
					// Later terms in the rehired period.
					[12, BERLIN, 1, "2026-12-01 00:00:00"],
					[13, BERLIN, 2, "2026-03-04 09:15:00"],
					[14, BERLIN, 3, "2026-11-01 23:30:00"],
					[15, BERLIN, 3, "2026-11-02 00:00:00"],
					[16, NEW_YORK, 4, "2026-11-02 00:00:00"],
					// Terms of another organization never join this period.
					[17, NEW_YORK, 1, "2026-11-01 23:30:00"],
				],
				assignments: [
					[21, BERLIN, "2026-11-01 23:30:00"],
					// Another organization's assignment with the same natural key.
					[22, NEW_YORK, "2026-11-01 23:30:00"],
					[23, BERLIN, "2026-03-04 09:15:00"],
				],
			},
			async (client) => {
				await migrate(client);
				const terms = await validFroms(client);
				const assignments = await effectiveFroms(client);

				expect(terms).toEqual({
					[id(11)]: "2026-11-02 00:00:00",
					[id(12)]: "2026-12-01 00:00:00",
					[id(13)]: "2026-03-04 09:15:00",
					[id(14)]: "2026-11-01 23:30:00",
					[id(15)]: "2026-11-02 00:00:00",
					[id(16)]: "2026-11-02 00:00:00",
					[id(17)]: "2026-11-01 23:30:00",
				});
				expect(assignments).toEqual({
					[id(21)]: "2026-11-02 00:00:00",
					[id(22)]: "2026-11-01 23:30:00",
					[id(23)]: "2026-03-04 09:15:00",
				});

				await migrate(client);

				expect(await validFroms(client)).toEqual(terms);
				expect(await effectiveFroms(client)).toEqual(assignments);
			},
		);
	});
});
