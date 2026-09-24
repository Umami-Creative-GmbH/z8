/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Covers the migration-owned legacy employment period backfill.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeedEmployeeInput,
} from "./testing/database";

const JAN = new Date("2025-01-06T00:00:00Z");
const MAR = new Date("2025-03-01T00:00:00Z");
const JUN = new Date("2025-06-30T00:00:00Z");

type PeriodRow = {
	id: string;
	status: string;
	started_at: Date | null;
	ended_at: Date | null;
	start_provenance: string;
	legacy_diagnostic: string | null;
};

describeLifecycleDatabase("legacy employment period backfill", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedLegacyEmployee(input: SeedEmployeeInput) {
		return fixture.seedEmployee({ ...input, withPeriod: false });
	}

	async function backfill(employeeId: string) {
		const result = await fixture.pool.query<{ inserted: number }>(
			`select employee_employment_period_backfill_legacy($1, $2::uuid) as inserted`,
			[fixture.organizationId, employeeId],
		);
		return result.rows[0]?.inserted;
	}

	async function periodsOf(employeeId: string) {
		const result = await fixture.pool.query<PeriodRow>(
			`select id, status, started_at, ended_at, start_provenance, legacy_diagnostic
			 from employee_employment_period where organization_id = $1 and employee_id = $2`,
			[fixture.organizationId, employeeId],
		);
		return result.rows;
	}

	async function insertTerms(
		employeeId: string,
		validFrom: Date,
		reviewState: string,
	) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_history
			 (employee_id, organization_id, valid_from, weekly_contract_minutes, review_state,
			  created_by, updated_at)
			 values ($1, $2, $3, 2400, $4, $5, $3) returning id`,
			[
				employeeId,
				fixture.organizationId,
				validFrom,
				reviewState,
				fixture.ownerUserId,
			],
		);
		return result.rows[0]?.id;
	}

	it("opens a legacy period for an active employee from the recorded start date", async () => {
		const target = await seedLegacyEmployee({ startDate: JAN });

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "open",
				started_at: JAN,
				ended_at: null,
				start_provenance: "legacy",
			}),
		]);
	});

	it("attaches existing terms without changing their dates", async () => {
		const target = await seedLegacyEmployee({ startDate: JAN });
		const termsId = await insertTerms(target.employeeId, MAR, "confirmed");

		await backfill(target.employeeId);

		const [period] = await periodsOf(target.employeeId);
		const terms = await fixture.pool.query(
			`select employment_period_id, valid_from from employee_employment_history where id = $1`,
			[termsId],
		);
		expect(terms.rows[0]).toEqual({
			employment_period_id: period?.id,
			valid_from: MAR,
		});
	});

	it("falls back to the earliest confirmed terms when no start date exists", async () => {
		const target = await seedLegacyEmployee({ startDate: null });
		await insertTerms(target.employeeId, JAN, "draft");
		await insertTerms(target.employeeId, MAR, "confirmed");
		await insertTerms(target.employeeId, JUN, "confirmed");

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "open",
				started_at: MAR,
				start_provenance: "legacy",
			}),
		]);
	});

	it("labels an unknown start instead of inventing one", async () => {
		const target = await seedLegacyEmployee({ startDate: null });

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "open",
				started_at: null,
				start_provenance: "unknown",
			}),
		]);
	});

	it("closes an inactive employee's period at a trustworthy end date", async () => {
		const target = await seedLegacyEmployee({
			isActive: false,
			startDate: JAN,
			endDate: JUN,
		});

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "closed",
				started_at: JAN,
				ended_at: JUN,
			}),
		]);
	});

	it("keeps an inactive employee without an end date as legacy unknown", async () => {
		const target = await seedLegacyEmployee({
			isActive: false,
			startDate: JAN,
		});

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "legacy_unknown",
				started_at: JAN,
				ended_at: null,
			}),
		]);
	});

	it("records a diagnostic instead of a fabricated interval for inverted legacy dates", async () => {
		const target = await seedLegacyEmployee({
			isActive: false,
			startDate: JUN,
			endDate: JAN,
		});

		await backfill(target.employeeId);

		expect(await periodsOf(target.employeeId)).toEqual([
			expect.objectContaining({
				status: "legacy_unknown",
				started_at: JUN,
				ended_at: null,
				legacy_diagnostic: "end_before_start",
			}),
		]);
	});

	it("is idempotent", async () => {
		const target = await seedLegacyEmployee({ startDate: JAN });
		await insertTerms(target.employeeId, MAR, "confirmed");

		expect(await backfill(target.employeeId)).toBe(1);
		const first = await periodsOf(target.employeeId);
		expect(await backfill(target.employeeId)).toBe(0);

		expect(await periodsOf(target.employeeId)).toEqual(first);
	});
});
