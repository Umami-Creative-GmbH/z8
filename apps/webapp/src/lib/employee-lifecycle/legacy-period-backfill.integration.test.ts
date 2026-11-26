/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Covers the migration-owned legacy employment period backfill.
 */
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewCsvLeavingDateImport } from "@/lib/contracts/csv-import";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { previewPastDeparture } from "./queries";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeedEmployeeInput,
} from "./testing/database.test.fixture";

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

describe("legacy employment period backfill", () => {
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
		validUntil: Date | null = null,
	) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_history
			 (employee_id, organization_id, valid_from, valid_until, valid_from_date, valid_until_date, weekly_contract_minutes, review_state,
			  created_by, updated_at)
			 values ($1, $2, $3, $4, $3::timestamp::date, $4::timestamp::date, 2400, $5, $6, $3) returning id`,
			[employeeId, fixture.organizationId, validFrom, validUntil, reviewState, fixture.ownerUserId],
		);
		return result.rows[0]?.id;
	}

	it("repairs missing current periods once and restores departure previews (#2015)", async () => {
		const employee = await seedLegacyEmployee({ startDate: JAN });
		const contractor = await seedLegacyEmployee({ engagementKind: "contractor", startDate: null });
		const inactive = await seedLegacyEmployee({ isActive: false });
		const closed = await fixture.seedEmployee();
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = started_at
			 where organization_id = $1 and id = $2`,
			[fixture.organizationId, closed.employmentPeriodId],
		);
		const repair = await readFile(
			new URL("../../../drizzle/0338_backfill_current_employment_periods.sql", import.meta.url),
			"utf8",
		);
		const scope = { organizationId: fixture.organizationId, actorUserId: fixture.ownerUserId };
		const now = parseInstant("2026-10-10T12:00:00Z");
		const lastWorkingDay = "2026-10-01";
		const employeeIds = [
			employee.employeeId,
			contractor.employeeId,
			inactive.employeeId,
			closed.employeeId,
			fixture.employeeId,
		];

		// Roll back the migration so concurrently running suites keep their fixtures.
		const rollback = new Error("Roll back test migration");
		await fixture.db
			.transaction(async (tx) => {
				await tx.execute(sql.raw(repair));
				const periods = () =>
					tx.execute<{
						id: string;
						employee_id: string;
						status: string;
						engagement_kind: string;
						start_day: string | null;
					}>(sql`
				select id, employee_id, status, engagement_kind,
					to_char(started_at at time zone 'UTC', 'YYYY-MM-DD') as start_day
				from employee_employment_period
				where organization_id = ${scope.organizationId}
					and employee_id in (${sql.join(
						employeeIds.map((id) => sql`${id}`),
						sql`, `,
					)})
				order by employee_id, id
			`);
				const beforeRetry = (await periods()).rows;
				expect(beforeRetry).toHaveLength(4);
				expect(beforeRetry).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							employee_id: employee.employeeId,
							status: "open",
							engagement_kind: "employee",
							start_day: "2025-01-06",
						}),
						expect.objectContaining({
							employee_id: contractor.employeeId,
							status: "open",
							engagement_kind: "contractor",
							start_day: null,
						}),
						expect.objectContaining({ id: fixture.employmentPeriodId, status: "open" }),
						expect.objectContaining({ id: closed.employmentPeriodId, status: "closed" }),
					]),
				);
				await tx.execute(sql.raw(repair));
				expect((await periods()).rows).toEqual(beforeRetry);

				for (const { employeeId } of [employee, contractor]) {
					expect(
						await previewPastDeparture(tx, {
							...scope,
							employeeId,
							lastWorkingDay,
							now,
							replacementEmployeeId: null,
						}),
					).toMatchObject({ kind: "ok" });
				}
				const csv = await previewCsvLeavingDateImport(tx, {
					...scope,
					now,
					csvText: [
						"employee_id,last_working_day",
						`${employee.employeeId},${lastWorkingDay}`,
						`${contractor.employeeId},${lastWorkingDay}`,
					].join("\n"),
				});
				expect(csv.rows.map((row) => row.action)).toEqual([
					"record_past_departure",
					"record_past_departure",
				]);
				throw rollback;
			})
			.catch((error) => {
				if (error !== rollback) throw error;
			});
	});

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
		await insertTerms(target.employeeId, MAR, "confirmed", JUN);
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
