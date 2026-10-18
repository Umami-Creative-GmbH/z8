/**
 * #1164: the #814 merge was checked in production, so migration 0278 retires the old rate
 * history (Organization ADR 0002): `employee_rate_history`, the operator-only merge report and
 * the eight `employee_rate_history_merge_*` functions of 0229. The one-time merge note keeps
 * its own table (D6). Asserts the migrated chain, then reruns the migration file against
 * stand-ins in a scratch schema: as on a database that already ran the merge, and again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1164_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0278_drop_employee_rate_history.sql"),
	"utf8",
);

async function relation(schema: string, name: string) {
	const result = await admin.query<{ relation: string | null }>(
		`select to_regclass($1)::text as relation`,
		[`${schema}.${name}`],
	);
	return result.rows[0]?.relation ?? null;
}

async function mergeFunctions(schema: string) {
	const result = await admin.query<{ proname: string }>(
		`select p.proname from pg_proc p
		 join pg_namespace n on n.oid = p.pronamespace
		 where n.nspname = $1 and p.proname like 'employee\\_rate\\_history\\_merge%'
		 order by p.proname`,
		[schema],
	);
	return result.rows.map((row) => row.proname);
}

describe("0278 drop employee rate history", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("leaves no rate history, merge report or merge function after the chain", async () => {
		expect(await relation("public", "employee_rate_history")).toBeNull();
		expect(await relation("public", "employee_rate_history_merge_report")).toBeNull();
		expect(await mergeFunctions("public")).toEqual([]);
	});

	it("keeps the wage history merge note", async () => {
		expect(await relation("public", "employee_wage_history_merge_note")).toBe(
			"employee_wage_history_merge_note",
		);
	});

	it("drops what the merge left behind, keeps the notes, and reruns cleanly", async () => {
		const client = await admin.connect();
		try {
			await client.query(`drop schema if exists ${SCHEMA} cascade`);
			await client.query(`create schema ${SCHEMA}`);
			await client.query(`set search_path to ${SCHEMA}`);
			// Stand-ins with 0229's names and signatures; callers reference their callees.
			await client.query(`
				create table employee_rate_history (id uuid primary key, hourly_rate numeric(10, 2));
				insert into employee_rate_history values ('11640000-0000-4000-8000-000000000001', 21.5);
				create table employee_rate_history_merge_report (id uuid primary key, reason text);
				insert into employee_rate_history_merge_report
					values ('11640000-0000-4000-8000-000000000002', 'rate_wage_applied');
				create table employee_wage_history_merge_note (
					id uuid primary key, organization_id text not null, adjusted_count integer not null);
				insert into employee_wage_history_merge_note
					values ('11640000-0000-4000-8000-000000000003', 't1164-org', 2);
				create function employee_rate_history_merge_calendar_date(
					p_instant timestamp with time zone, p_timezone text)
					returns date language sql stable as $$ select (p_instant at time zone p_timezone)::date $$;
				create function employee_rate_history_merge_period_dates(
					p_started_at timestamp with time zone, p_ended_at timestamp with time zone,
					p_start_provenance text, p_timezone text)
					returns daterange language sql stable as $$
						select daterange(
							employee_rate_history_merge_calendar_date(p_started_at, p_timezone),
							employee_rate_history_merge_calendar_date(p_ended_at, p_timezone)) $$;
				create function employee_rate_history_merge_report_row(
					p_organization_id text, p_employee_id uuid, p_rate_history_id uuid, p_terms_id uuid,
					p_reason text, p_winning_value numeric, p_evidence jsonb)
					returns void language sql as $$
						insert into employee_rate_history_merge_report values (gen_random_uuid(), p_reason) $$;
				create function employee_rate_history_merge_mark_dirty(
					p_organization_id text, p_employee_id uuid, p_from date)
					returns void language plpgsql as $$ begin end $$;
				create function employee_rate_history_merge_note(
					p_organization_id text, p_employee_id uuid, p_timezone text, p_adjusted_count integer)
					returns void language plpgsql as $$ begin end $$;
				create function employee_rate_history_merge_employee(
					p_organization_id text, p_employee_id uuid, p_timezone text)
					returns integer language plpgsql as $$ begin
						perform employee_rate_history_merge_report_row(
							p_organization_id, p_employee_id, null, null, 'superseded', null, '{}');
						return 0;
					end $$;
				create function employee_rate_history_merge_employee_wage(
					p_organization_id text, p_employee_id uuid, p_timezone text)
					returns integer language plpgsql as $$ begin return 0; end $$;
				create function employee_rate_history_merge_into_terms(p_organization_id text default null)
					returns integer language plpgsql as $$ begin
						return (select count(*)::integer from employee_rate_history);
					end $$;
			`);
			expect(await mergeFunctions(SCHEMA)).toHaveLength(8);

			await client.query(migration);
			await client.query(migration);

			expect(await relation(SCHEMA, "employee_rate_history")).toBeNull();
			expect(await relation(SCHEMA, "employee_rate_history_merge_report")).toBeNull();
			expect(await mergeFunctions(SCHEMA)).toEqual([]);
			const notes = await client.query<{ id: string; adjusted_count: number }>(
				`select id, adjusted_count from employee_wage_history_merge_note`,
			);
			expect(notes.rows).toEqual([
				{ id: "11640000-0000-4000-8000-000000000003", adjusted_count: 2 },
			]);
		} finally {
			await client.query(`set search_path to default`).catch(() => undefined);
			client.release();
		}
	});
});
