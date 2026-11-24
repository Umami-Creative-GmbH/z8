/**
 * #1988: `db:push` re-applies migration 0333 for what schema push cannot create (baseline seed,
 * guard triggers, exclusion constraints). Re-applying it to a migrated database changes nothing.
 * #1993: migration 0335 re-applies over a pushed or migrated database without error.
 * #2017: migration 0336 (working-student daytime band) too; Drizzle declares its columns and check,
 * so `drizzle-kit push` builds them and the installer needs nothing more.
 * #2022: migration 0337 (minor contractors under JArbSchG) likewise.
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

	describe("migration 0336 (#2017)", () => {
		async function apply0336() {
			const migration = await readFile(
				new URL("../../drizzle/0336_working_student_daytime_band.sql", import.meta.url),
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

		async function band() {
			const columns = await pool.query<{ column_name: string; column_default: string }>(
				`SELECT column_name, column_default FROM information_schema.columns
				 WHERE table_schema = 'public' AND table_name = 'organization_statutory_preference'
					AND column_name LIKE 'working_student_daytime_%'
				 ORDER BY column_name`,
			);
			const check = await pool.query<{ definition: string }>(
				`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
				 WHERE conname = 'organization_statutory_preference_daytime_band_check'`,
			);
			return { columns: columns.rows, check: check.rows.map((row) => row.definition) };
		}

		it("re-applies over a database that already has the band, twice", async () => {
			const before = await band();
			expect(before.columns).toEqual([
				{ column_name: "working_student_daytime_end_minute", column_default: "1080" },
				{ column_name: "working_student_daytime_start_minute", column_default: "360" },
			]);
			expect(before.check).toHaveLength(1);

			await apply0336();
			await apply0336();

			expect(await band()).toEqual(before);
		});

		it("gives an organization's existing preferences the 06:00–18:00 band", async () => {
			const before = await band();
			const organizationId = `t2017-band-${crypto.randomUUID()}`;
			await pool.query(
				`ALTER TABLE "organization_statutory_preference"
				 DROP COLUMN "working_student_daytime_start_minute",
				 DROP COLUMN "working_student_daytime_end_minute"`,
			);
			try {
				await pool.query(
					`INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $1, $1, now())`,
					[organizationId],
				);
				await pool.query(
					`INSERT INTO organization_statutory_preference (organization_id, warning_threshold_percent)
					 VALUES ($1, 70)`,
					[organizationId],
				);

				await apply0336();

				expect(await band()).toEqual(before);
				const { rows } = await pool.query(
					`SELECT warning_threshold_percent, working_student_daytime_start_minute,
						working_student_daytime_end_minute
					 FROM organization_statutory_preference WHERE organization_id = $1`,
					[organizationId],
				);
				expect(rows).toEqual([
					{
						warning_threshold_percent: 70,
						working_student_daytime_start_minute: 360,
						working_student_daytime_end_minute: 1080,
					},
				]);
			} finally {
				await apply0336();
				await pool.query(`DELETE FROM organization WHERE id = $1`, [organizationId]);
			}
		});
	});

	describe("migration 0337 (#2022)", () => {
		async function apply0337() {
			const migration = await readFile(
				new URL("../../drizzle/0337_jarbschg_minor_contractors.sql", import.meta.url),
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

		async function column() {
			const { rows } = await pool.query<{
				column_default: string;
				is_nullable: string;
				data_type: string;
			}>(
				`SELECT column_default, is_nullable, data_type FROM information_schema.columns
				 WHERE table_schema = 'public' AND table_name = 'organization_statutory_preference'
					AND column_name = 'apply_jarbschg_to_minor_contractors'`,
			);
			return rows;
		}

		it("re-applies over a database that already has the column, twice", async () => {
			const before = await column();
			expect(before).toEqual([
				{ column_default: "false", is_nullable: "NO", data_type: "boolean" },
			]);

			await apply0337();
			await apply0337();

			expect(await column()).toEqual(before);
		});

		it("keeps flagging minor contractors for review in an organization's existing preferences", async () => {
			const before = await column();
			const organizationId = `t2022-minor-${crypto.randomUUID()}`;
			await pool.query(
				`ALTER TABLE "organization_statutory_preference" DROP COLUMN "apply_jarbschg_to_minor_contractors"`,
			);
			try {
				await pool.query(
					`INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $1, $1, now())`,
					[organizationId],
				);
				await pool.query(
					`INSERT INTO organization_statutory_preference (organization_id, block_jarbschg_shift_publish)
					 VALUES ($1, true)`,
					[organizationId],
				);

				await apply0337();

				expect(await column()).toEqual(before);
				const { rows } = await pool.query(
					`SELECT block_jarbschg_shift_publish, apply_jarbschg_to_minor_contractors
					 FROM organization_statutory_preference WHERE organization_id = $1`,
					[organizationId],
				);
				expect(rows).toEqual([
					{ block_jarbschg_shift_publish: true, apply_jarbschg_to_minor_contractors: false },
				]);
			} finally {
				await apply0337();
				await pool.query(`DELETE FROM organization WHERE id = $1`, [organizationId]);
			}
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
