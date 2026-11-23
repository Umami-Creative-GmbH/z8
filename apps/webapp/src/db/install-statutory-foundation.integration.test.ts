/**
 * #1988: `db:push` re-applies migration 0329 for what schema push cannot create (baseline seed,
 * guard triggers, exclusion constraints). Re-applying it to a migrated database changes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
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
				'contract_review_ack_statutory_shape_check'
			 ) ORDER BY conname`,
		);
		const triggers = await pool.query<{ tgname: string }>(
			`SELECT tgname FROM pg_trigger
			 WHERE tgname IN ('statutory_threshold_baseline_guard', 'contract_review_ack_statutory_immutable')
			 ORDER BY tgname`,
		);
		return {
			baselines: Number(baselines.rows[0]?.count),
			constraints: constraints.rows.map((row) => row.conname),
			triggers: triggers.rows.map((row) => row.tgname),
		};
	}

	it("is safe to repeat on a migrated database", async () => {
		const before = await snapshot();
		expect(before.baselines).toBeGreaterThan(30);
		expect(before.constraints).toHaveLength(4);
		expect(before.triggers).toHaveLength(2);

		await installStatutoryFoundation(pool);
		await installStatutoryFoundation(pool);

		expect(await snapshot()).toEqual(before);
	});
});
