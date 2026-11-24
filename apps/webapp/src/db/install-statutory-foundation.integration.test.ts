/**
 * #1988: `db:push` re-applies migration 0333 for what schema push cannot create (baseline seed,
 * guard triggers, exclusion constraints). Re-applying it to a migrated database changes nothing.
 * #1993: migration 0335 re-applies over a pushed or migrated database without error.
 */
import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import {
	employeeApprenticeRelease,
	employeeStatutoryOffset,
	employeeStudyPeriod,
	organizationStatutoryPreference,
} from "./schema/statutory";
import { installStatutoryFoundation } from "./install-statutory-foundation";

describe("installStatutoryFoundation (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000 });
	const pool = integrationAdminPool();

	async function snapshot() {
		const baselines = await pool.query<{ count: string }>(
			`SELECT count(*) FROM statutory_threshold WHERE organization_id IS NULL AND country_code = 'DE'`,
		);
		const constraints = await pool.query<{ conname: string }>(
			`SELECT conname FROM pg_constraint
			 WHERE conname IN (
				'statutory_threshold_system_no_overlap',
				'employee_study_period_no_overlap',
				'employee_apprentice_release_no_overlap',
				'employee_apprentice_release_pre_exam_no_overlap',
				'contract_review_ack_statutory_shape_check'
			 ) ORDER BY conname`,
		);
		const releaseOverlap = await pool.query<{ definition: string }>(
			`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
			 WHERE conname = 'employee_apprentice_release_no_overlap'`,
		);
		const triggers = await pool.query<{ tgname: string }>(
			`SELECT tgname FROM pg_trigger
			 WHERE tgname IN ('statutory_threshold_baseline_guard', 'contract_review_ack_statutory_immutable')
			 ORDER BY tgname`,
		);
		return {
			baselines: Number(baselines.rows[0]?.count),
			constraints: constraints.rows.map((row) => row.conname),
			releaseOverlap: releaseOverlap.rows[0]?.definition,
			triggers: triggers.rows.map((row) => row.tgname),
		};
	}

	it("is safe to repeat on a migrated database", async () => {
		const before = await snapshot();
		expect(before.baselines).toBeGreaterThan(30);
		expect(before.constraints).toHaveLength(5);
		expect(before.releaseOverlap).toContain("pre_exam_day");
		expect(before.triggers).toHaveLength(2);

		await installStatutoryFoundation(pool);
		await installStatutoryFoundation(pool);

		expect(await snapshot()).toEqual(before);
	});

	it("upgrades a pushed release overlap constraint that predates the pre-exam day exception", async () => {
		await pool.query(`ALTER TABLE "employee_apprentice_release"
			DROP CONSTRAINT "employee_apprentice_release_no_overlap",
			DROP CONSTRAINT "employee_apprentice_release_pre_exam_no_overlap",
			ADD CONSTRAINT "employee_apprentice_release_no_overlap" EXCLUDE USING gist (
				"organization_id" WITH =, "employee_id" WITH =, daterange("starts_on", "ends_on", '[]') WITH &&
			) WHERE ("voided_at" IS NULL)`);
		const strict = await snapshot();
		expect(strict.releaseOverlap).not.toContain("pre_exam_day");

		await installStatutoryFoundation(pool);

		const upgraded = await snapshot();
		expect(upgraded.constraints).toHaveLength(5);
		expect(upgraded.releaseOverlap).toContain("pre_exam_day");
	});

	describe("migration 0335 (#1993)", () => {
		const RELEASE_CONSTRAINTS = [
			"employee_apprentice_release_exam_link_check",
			"employee_apprentice_release_exam_release_fk",
			"employee_apprentice_release_exam_time_check",
			"employee_apprentice_release_school_time_check",
			"employee_apprentice_release_superseded_by_fk",
			"employee_apprentice_release_superseded_check",
		];

		async function apply0331() {
			const migration = await readFile(
				new URL("../../drizzle/0335_jarbschg_violation_types.sql", import.meta.url),
				"utf8",
			);
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query("SET LOCAL search_path TO public");
				await client.query(migration);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		}

		async function releaseConstraints() {
			const { rows } = await pool.query<{ conname: string; definition: string }>(
				`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
				 WHERE conname = ANY($1::text[]) ORDER BY conname`,
				[RELEASE_CONSTRAINTS],
			);
			return rows;
		}

		it("re-applies over a database that already has its constraints, twice", async () => {
			// The migrated test database has them, as does one `drizzle-kit push` built.
			const before = await releaseConstraints();
			expect(before.map((row) => row.conname)).toEqual(RELEASE_CONSTRAINTS);

			await apply0331();
			await apply0331();

			expect(await releaseConstraints()).toEqual(before);
			expect((await snapshot()).releaseOverlap).toContain("pre_exam_day");
		});

		it("creates the constraints a database is missing", async () => {
			const before = await releaseConstraints();
			await pool.query(
				`ALTER TABLE "employee_apprentice_release"
				 ${RELEASE_CONSTRAINTS.map((name) => `DROP CONSTRAINT "${name}"`).join(", ")}`,
			);
			expect(await releaseConstraints()).toEqual([]);

			await apply0331();

			expect(await releaseConstraints()).toEqual(before);
		});
	});

	it("declares in Drizzle every CHECK and foreign key the migration creates on statutory tables", async () => {
		// `drizzle-kit push` builds these tables from Drizzle, and re-applying 0333 then skips its
		// CREATE TABLE blocks: a constraint only in SQL would silently be missing on pushed databases.
		for (const table of [
			organizationStatutoryPreference,
			employeeStatutoryOffset,
			employeeStudyPeriod,
			employeeApprenticeRelease,
		]) {
			const config = getTableConfig(table);
			const { rows } = await pool.query<{ conname: string }>(
				`SELECT conname FROM pg_constraint
				 WHERE conrelid = to_regclass($1) AND contype IN ('c', 'f')
				 ORDER BY conname`,
				[`public.${config.name}`],
			);
			const declared = [
				...config.checks.map((check) => check.name),
				...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
			].sort();
			expect({ table: config.name, constraints: declared }).toEqual({
				table: config.name,
				constraints: rows.map((row) => row.conname),
			});
		}
	});

	it("declares in Drizzle every column the migrations add to statutory tables", async () => {
		for (const table of [
			organizationStatutoryPreference,
			employeeStatutoryOffset,
			employeeStudyPeriod,
			employeeApprenticeRelease,
		]) {
			const config = getTableConfig(table);
			const { rows } = await pool.query<{ column_name: string }>(
				`SELECT column_name FROM information_schema.columns
				 WHERE table_schema = 'public' AND table_name = $1
				 ORDER BY column_name`,
				[config.name],
			);
			expect({
				table: config.name,
				columns: config.columns.map((column) => column.name).sort(),
			}).toEqual({ table: config.name, columns: rows.map((row) => row.column_name) });
		}
		expect(getTableConfig(employeeApprenticeRelease).columns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"exam_release_id",
				"school_start_time",
				"school_end_time",
				"superseded_by_release_id",
			]),
		);
	});
});
