/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Employment coverage, windows at departure, and rehire.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import { loadEmploymentCoverage, resolveTermsEmploymentPeriod } from "./employment-periods";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
} from "./testing/database";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

describeLifecycleDatabase("employment periods", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T08:00:00Z");

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut,
		});
	}

	function owner(): LifecycleActor {
		return {
			userId: fixture.ownerUserId,
			organizationId: fixture.organizationId,
		};
	}

	async function offboardNowAt(employeeId: string, at: string) {
		now = parseInstant(at);
		return commands().offboardNow(owner(), {
			employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	}

	const coverageOf = (employeeId: string) =>
		loadEmploymentCoverage(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId,
		});

	it("reports no lifecycle coverage for legacy-only history", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		await fixture.pool.query(`select employee_employment_period_backfill_legacy($1, $2::uuid)`, [
			fixture.organizationId,
			target.employeeId,
		]);

		expect(await coverageOf(target.employeeId)).toBeNull();
	});

	async function createWorkPolicy() {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);
		return result.rows[0]?.id ?? "";
	}

	async function insertAssignment(input: {
		employeeId: string;
		policyId: string;
		from: string;
		until?: string | null;
	}) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, employee_id, priority, effective_from,
			  effective_until, is_active, created_by, updated_at)
			 values ($1, $2, 'employee', $3, 2, $4, $5, true, $6, now()) returning id`,
			[
				input.policyId,
				fixture.organizationId,
				input.employeeId,
				input.from,
				input.until ?? null,
				fixture.ownerUserId,
			],
		);
		return result.rows[0]?.id ?? "";
	}

	async function insertTerms(input: {
		employeeId: string;
		employmentPeriodId: string;
		from: string;
		until: string | null;
	}) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, valid_until,
			  weekly_contract_minutes, review_state, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, 2400, 'confirmed', $6, now()) returning id`,
			[
				input.employeeId,
				fixture.organizationId,
				input.employmentPeriodId,
				input.from,
				input.until,
				fixture.ownerUserId,
			],
		);
		return result.rows[0]?.id ?? "";
	}

	async function row<T>(sql: string, params: unknown[]) {
		const result = await fixture.pool.query(sql, params);
		return result.rows[0] as T;
	}

	it("closes current windows at departure and keeps future intent non-effective for review", async () => {
		const target = await fixture.seedEmployee();
		const scope = {
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
		};
		const earlier = await insertTerms({
			...scope,
			from: "2026-01-01",
			until: "2026-06-01",
		});
		const current = await insertTerms({
			...scope,
			from: "2026-06-01",
			until: "2026-12-01",
		});
		const future = await insertTerms({
			...scope,
			from: "2026-12-01",
			until: null,
		});
		const policyId = await createWorkPolicy();
		const currentAssignment = await insertAssignment({
			...scope,
			policyId,
			from: "2026-06-01",
		});
		const futureAssignment = await insertAssignment({
			...scope,
			policyId,
			from: "2026-12-01",
		});

		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");

		const cutoff = new Date("2026-09-14T09:30:00Z");
		expect(
			await row(`select valid_until from employee_employment_history where id = $1`, [earlier]),
		).toEqual({ valid_until: new Date("2026-06-01T00:00:00Z") });
		expect(
			await row(`select valid_until from employee_employment_history where id = $1`, [current]),
		).toEqual({ valid_until: cutoff });
		expect(
			await row(`select valid_from, valid_until from employee_employment_history where id = $1`, [
				future,
			]),
		).toEqual({
			valid_from: new Date("2026-12-01T00:00:00Z"),
			valid_until: null,
		});
		expect(
			await row(
				`select status from employee_departure_review
				 where employee_id = $1 and kind = 'employment_terms' and subject_id = $2`,
				[target.employeeId, future],
			),
		).toEqual({ status: "open" });
		expect(
			await row(`select effective_until, is_active from work_policy_assignment where id = $1`, [
				currentAssignment,
			]),
		).toEqual({ effective_until: cutoff, is_active: true });
		expect(
			await row(`select is_active from work_policy_assignment where id = $1`, [futureAssignment]),
		).toEqual({ is_active: false });
	});

	const resolveTermsPeriod = (employeeId: string, validFrom: string) =>
		fixture.db.transaction((tx) =>
			resolveTermsEmploymentPeriod(tx, {
				organizationId: fixture.organizationId,
				employeeId,
				validFrom: new Date(validFrom),
			}),
		);

	it("attaches new terms to the open period, backfilling a legacy one on demand", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });

		const periodId = await resolveTermsPeriod(target.employeeId, "2026-10-01T00:00:00Z");

		expect(
			await row(`select status, start_provenance from employee_employment_period where id = $1`, [
				periodId,
			]),
		).toEqual({ status: "open", start_provenance: "legacy" });
	});

	it("refuses terms once the employment period has ended", async () => {
		const target = await fixture.seedEmployee();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");

		await expect(
			resolveTermsPeriod(target.employeeId, "2026-10-01T00:00:00Z"),
		).rejects.toMatchObject({ code: "employment_period_closed" });
	});

	it("bounds coverage at an effective departure without trusting legacy starts", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");

		const coverage = await coverageOf(target.employeeId);

		expect(coverage).toHaveLength(1);
		expect(coverage?.[0]?.startedAt).toBeNull();
		expect(coverage?.[0]?.endedAt?.toString()).toBe("2026-09-14T09:30:00Z");
	});
});
