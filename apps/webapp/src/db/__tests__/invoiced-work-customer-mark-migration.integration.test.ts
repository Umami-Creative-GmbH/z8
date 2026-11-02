/**
 * #1500: migration 0289 marks invoiced work in unreleased drafts with
 * `customer` when its project moves to another customer (or to none), through a
 * trigger on project.customer_id, and backfills existing mismatches once. Runs
 * the migration file against minimal tables in a scratch schema, so the backfill
 * never touches other suites' rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1500_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0289_invoiced_work_customer_mark.sql"),
	"utf8",
);

const ORG = "t1500-org";
const OTHER_ORG = "t1500-other-org";
const id = (n: number) => `15000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACME = id(1);
const BETA = id(2);
const PROJECT = id(10);
const OTHER_PROJECT = id(11);
const DRAFT = id(20);
const RELEASED_DRAFT = id(21);

type Work = {
	n: number;
	organizationId?: string;
	projectId: string;
	/** The invoiced work row: in which draft, released or not, already marked. */
	invoiced?: { draftId: string; released?: boolean; changedFields?: string[] };
};

async function withScratchTables<T>(
	seed: { projects: [n: number, customerId: string | null][]; work: Work[] },
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await admin.connect();
	try {
		await client.query(`drop schema if exists ${SCHEMA} cascade`);
		await client.query(`create schema ${SCHEMA}`);
		await client.query(`set search_path to ${SCHEMA}`);
		await client.query(`
			create table project (id uuid primary key, organization_id text not null, customer_id uuid);
			create table work_period (id uuid primary key, organization_id text not null, project_id uuid);
			create table invoice_draft (id uuid primary key, organization_id text not null, customer_id uuid not null);
			create table invoiced_work (
				id uuid primary key, organization_id text not null, invoice_draft_id uuid not null,
				work_period_id uuid not null, released_at timestamp with time zone,
				changed_after_invoicing_at timestamp with time zone,
				changed_fields text[] default '{}'::text[] not null);
			insert into invoice_draft values
				('${DRAFT}', '${ORG}', '${ACME}'), ('${RELEASED_DRAFT}', '${ORG}', '${ACME}');
		`);
		for (const [n, customerId] of seed.projects) {
			await client.query("insert into project values ($1, $2, $3)", [id(n), ORG, customerId]);
		}
		for (const work of seed.work) {
			const organizationId = work.organizationId ?? ORG;
			await client.query("insert into work_period values ($1, $2, $3)", [
				id(100 + work.n),
				organizationId,
				work.projectId,
			]);
			if (!work.invoiced) continue;
			await client.query(
				`insert into invoiced_work (id, organization_id, invoice_draft_id, work_period_id, released_at,
				   changed_after_invoicing_at, changed_fields)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					id(200 + work.n),
					organizationId,
					work.invoiced.draftId,
					id(100 + work.n),
					work.invoiced.released ? "2026-10-01T00:00:00Z" : null,
					work.invoiced.changedFields?.length ? "2026-10-02T00:00:00Z" : null,
					work.invoiced.changedFields ?? [],
				],
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

/** Changed fields per work number; null when the work is not marked. */
async function marks(client: PoolClient) {
	const { rows } = await client.query<{
		id: string;
		changed_fields: string[];
		changed_after_invoicing_at: string | null;
	}>("select id, changed_fields, changed_after_invoicing_at::text from invoiced_work order by id");
	return Object.fromEntries(
		rows.map((row) => [
			Number(row.id.slice(-12)) - 200,
			row.changed_after_invoicing_at === null ? null : row.changed_fields,
		]),
	);
}

async function rawRows(client: PoolClient) {
	const { rows } = await client.query(
		"select id, changed_fields, changed_after_invoicing_at::text from invoiced_work order by id",
	);
	return rows;
}

describe("0289 invoiced work customer mark migration", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("backfills invoiced work in unreleased drafts whose project's customer is not the draft's, once", async () => {
		await withScratchTables(
			{
				projects: [
					[10, BETA],
					[11, ACME],
					[12, null],
				],
				work: [
					// Moved to another customer before the migration: marked.
					{ n: 1, projectId: PROJECT, invoiced: { draftId: DRAFT } },
					// Already marked for its times: customer is added, sorted.
					{ n: 2, projectId: PROJECT, invoiced: { draftId: DRAFT, changedFields: ["times"] } },
					// The project now has no customer: marked.
					{ n: 3, projectId: id(12), invoiced: { draftId: DRAFT } },
					// Still the draft's customer: untouched.
					{ n: 4, projectId: OTHER_PROJECT, invoiced: { draftId: DRAFT } },
					// A released draft is never marked.
					{ n: 5, projectId: PROJECT, invoiced: { draftId: RELEASED_DRAFT, released: true } },
					// Un-invoiced work has no row to mark.
					{ n: 6, projectId: PROJECT },
				],
			},
			async (client) => {
				await migrate(client);

				expect(await marks(client)).toEqual({
					1: ["customer"],
					2: ["customer", "times"],
					3: ["customer"],
					4: null,
					5: null,
				});

				const once = await rawRows(client);
				await migrate(client);
				expect(await rawRows(client)).toEqual(once);
			},
		);
	});

	it("marks a project's invoiced work in unreleased drafts when its customer changes or is removed", async () => {
		await withScratchTables(
			{
				projects: [
					[10, ACME],
					[11, ACME],
				],
				work: [
					{ n: 1, projectId: PROJECT, invoiced: { draftId: DRAFT } },
					{ n: 2, projectId: PROJECT, invoiced: { draftId: DRAFT, changedFields: ["times"] } },
					{ n: 3, projectId: PROJECT, invoiced: { draftId: RELEASED_DRAFT, released: true } },
					{ n: 4, projectId: PROJECT },
					// Another project of the same customer.
					{ n: 5, projectId: OTHER_PROJECT, invoiced: { draftId: DRAFT } },
					// Another organization's row on the same project id is never touched.
					{
						n: 6,
						organizationId: OTHER_ORG,
						projectId: PROJECT,
						invoiced: { draftId: DRAFT },
					},
				],
			},
			async (client) => {
				await migrate(client);
				expect(await marks(client)).toEqual({ 1: null, 2: ["times"], 3: null, 5: null, 6: null });

				await client.query("update project set customer_id = $1 where id = $2", [BETA, PROJECT]);
				expect(await marks(client)).toEqual({
					1: ["customer"],
					2: ["customer", "times"],
					3: null,
					5: null,
					6: null,
				});

				// Removing the customer marks the same way.
				await client.query(
					"update invoiced_work set changed_fields = '{}', changed_after_invoicing_at = null",
				);
				await client.query("update project set customer_id = null where id = $1", [PROJECT]);
				expect(await marks(client)).toEqual({
					1: ["customer"],
					2: ["customer"],
					3: null,
					5: null,
					6: null,
				});
			},
		);
	});

	it("keeps the mark when the customer is set back, and ignores writes that keep the customer", async () => {
		await withScratchTables(
			{
				projects: [[10, ACME]],
				work: [{ n: 1, projectId: PROJECT, invoiced: { draftId: DRAFT } }],
			},
			async (client) => {
				await migrate(client);

				// Same customer: no change, no mark.
				await client.query("update project set customer_id = $1 where id = $2", [ACME, PROJECT]);
				expect(await marks(client)).toEqual({ 1: null });

				await client.query("update project set customer_id = $1 where id = $2", [BETA, PROJECT]);
				await client.query("update project set customer_id = $1 where id = $2", [ACME, PROJECT]);
				expect(await marks(client)).toEqual({ 1: ["customer"] });
			},
		);
	});
});
