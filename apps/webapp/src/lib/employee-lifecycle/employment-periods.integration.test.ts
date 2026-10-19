/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Employment coverage, windows at departure, and rehire.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadTermsInForceOn } from "@/lib/employment-history/load-terms-in-force";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import {
	confirmEmploymentTerms,
	type EmploymentTermsInput,
	writeEmploymentTerms,
} from "@/lib/employment-history/write-terms";
import { createDepartureCommands } from "./commands";
import { isDateKeyEmployed } from "./employment-coverage";
import { loadEmploymentCoverage, resolveTermsEmploymentPeriod } from "./employment-periods";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor, RehireEmployee } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

describe("employment periods", () => {
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

	it("keeps adding terms to a legacy-inactive employee possible", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false, isActive: false });

		const periodId = await resolveTermsPeriod(target.employeeId, "2026-10-01T00:00:00Z");

		expect(
			await row(`select status from employee_employment_period where id = $1`, [periodId]),
		).toEqual({ status: "legacy_unknown" });
	});

	it("reopens the legacy period in place for an employee reactivated by the old toggle", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false, isActive: false });
		await fixture.pool.query(`select employee_employment_period_backfill_legacy($1, $2::uuid)`, [
			fixture.organizationId,
			target.employeeId,
		]);
		await fixture.pool.query(`update employee set is_active = true where id = $1`, [
			target.employeeId,
		]);

		const result = await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");

		expect(result.status).toBe("effective");
		expect(
			await row(
				`select status, started_at, start_provenance from employee_employment_period
				 where employee_id = $1`,
				[target.employeeId],
			),
		).toEqual({
			status: "closed",
			started_at: new Date("2026-01-01T00:00:00Z"),
			start_provenance: "legacy",
		});
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

	async function rehireInput(input: {
		employeeId: string;
		previousEmploymentPeriodId: string;
		workPolicyId: string;
		overrides?: Partial<RehireEmployee>;
	}): Promise<RehireEmployee> {
		return {
			employeeId: input.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: input.previousEmploymentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: fixture.ownerEmployeeId,
			workPolicyId: input.workPolicyId,
			weeklyContractMinutes: 1200,
			contractType: "fixed",
			workModel: "hybrid",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Returning part-time",
			...input.overrides,
		};
	}

	it("rehires into exactly one new period without touching the old one or the gap", async () => {
		const target = await fixture.seedEmployee();
		await insertTerms({
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			from: "2026-01-01",
			until: null,
		});
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		now = parseInstant("2026-11-02T08:00:00Z");

		const result = await commands().rehireEmployee(
			owner(),
			await rehireInput({
				employeeId: target.employeeId,
				previousEmploymentPeriodId: target.employmentPeriodId,
				workPolicyId: policyId,
			}),
		);

		const rehiredAt = new Date("2026-11-02T08:00:00Z");
		const rehireDay = new Date("2026-11-02T00:00:00Z");
		expect(
			await row(
				`select status, started_at, start_provenance from employee_employment_period where id = $1`,
				[result.employmentPeriodId],
			),
		).toEqual({ status: "open", started_at: rehiredAt, start_provenance: "recorded" });
		expect(
			await row(`select status, ended_at from employee_employment_period where id = $1`, [
				target.employmentPeriodId,
			]),
		).toEqual({ status: "closed", ended_at: new Date("2026-09-14T09:30:00Z") });
		expect(
			await row(
				`select count(*)::int as count from employee_employment_period where employee_id = $1`,
				[target.employeeId],
			),
		).toEqual({ count: 2 });
		expect(
			await row(
				`select valid_from, valid_until, review_state, weekly_contract_minutes, work_policy_id
				 from employee_employment_history where employment_period_id = $1`,
				[result.employmentPeriodId],
			),
		).toEqual({
			valid_from: rehireDay,
			valid_until: null,
			review_state: "confirmed",
			weekly_contract_minutes: 1200,
			work_policy_id: policyId,
		});
		expect(
			await row(
				`select effective_from, effective_until from work_policy_assignment
				 where employee_id = $1 and is_active = true and policy_id = $2`,
				[target.employeeId, policyId],
			),
		).toEqual({ effective_from: rehireDay, effective_until: null });
		expect(
      await row(
        `select count(*)::int as count from work_policy_assignment
         where employee_id = $1 and organization_id = $2 and assignment_type = 'employee' and is_active = true`,
        [target.employeeId, fixture.organizationId],
      ),
    ).toEqual({ count: 1 });
    expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: true,
		});
		expect(
			await row(`select manager_id, is_primary from employee_managers where employee_id = $1`, [
				target.employeeId,
			]),
		).toEqual({ manager_id: fixture.ownerEmployeeId, is_primary: true });
		expect(
			await row(
				`select kind, departure_id from employee_departure_task
				 where employment_period_id = $1 and kind = 'billing_sync'`,
				[result.employmentPeriodId],
			),
		).toEqual({ kind: "billing_sync", departure_id: null });

		const coverage = await coverageOf(target.employeeId);
		const employedOn = (dateKey: string) => isDateKeyEmployed(coverage ?? [], dateKey, "UTC");
		expect([employedOn("2026-09-14"), employedOn("2026-10-10"), employedOn("2026-11-02")]).toEqual([
			true,
			false,
			true,
		]);
	});

	async function withOrganizationTimezone<T>(timezone: string, run: () => Promise<T>) {
		await fixture.pool.query(`update organization set timezone = $1 where id = $2`, [
			timezone,
			fixture.organizationId,
		]);
		try {
			return await run();
		} finally {
			await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
				fixture.organizationId,
			]);
		}
	}

	async function offboardAndRehireAt(at: string) {
		const target = await fixture.seedEmployee();
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		now = parseInstant(at);
		const { employmentPeriodId } = await commands().rehireEmployee(
			owner(),
			await rehireInput({
				employeeId: target.employeeId,
				previousEmploymentPeriodId: target.employmentPeriodId,
				workPolicyId: policyId,
			}),
		);
		// Admins edit terms after the rehire; same-day rows resolve by creation order.
		now = now.add({ minutes: 10 });
		return { employeeId: target.employeeId, employmentPeriodId, policyId };
	}

	// Both rehires fall on org-local 2 November while their UTC date differs.
	const rehiresNearLocalMidnight = [
		{ zone: "Europe/Berlin", rehiredAt: "2026-11-01T23:30:00Z" },
		{ zone: "America/New_York", rehiredAt: "2026-11-03T03:00:00Z" },
	];

	it.each(rehiresNearLocalMidnight)(
		"starts rehire terms on the org-local rehire date and the period at the rehire instant ($zone)",
		async ({ zone, rehiredAt }) => {
			await withOrganizationTimezone(zone, async () => {
				const rehire = await offboardAndRehireAt(rehiredAt);

				expect(
					await row(`select started_at from employee_employment_period where id = $1`, [
						rehire.employmentPeriodId,
					]),
				).toEqual({ started_at: new Date(rehiredAt) });
				expect(
					await row(
						`select valid_from from employee_employment_history where employment_period_id = $1`,
						[rehire.employmentPeriodId],
					),
				).toEqual({ valid_from: new Date("2026-11-02T00:00:00Z") });
			});
		},
	);

	const termsDated = (
		validFrom: string,
		reviewState: EmploymentTermsInput["reviewState"],
	): EmploymentTermsInput => ({
		validFrom: utcMidnight(parsePlainDate(validFrom)),
		status: "active",
		contractType: "fixed",
		weeklyContractMinutes: 2400,
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		reviewState,
	});

	const writeTerms = (employeeId: string, terms: EmploymentTermsInput) =>
		fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				organizationId: fixture.organizationId,
				employeeId,
				actorUserId: fixture.ownerUserId,
				now: new Date(now.toString()),
				terms,
			}),
		);

	const termsInForceOnRehireDay = (employeeId: string) =>
		loadTermsInForceOn(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId,
			date: parsePlainDate("2026-11-02"),
		});

	it.each(rehiresNearLocalMidnight)(
		"lets confirmed terms dated on the rehire day replace the rehire's terms ($zone)",
		async ({ zone, rehiredAt }) => {
			await withOrganizationTimezone(zone, async () => {
				const rehire = await offboardAndRehireAt(rehiredAt);

				const written = await writeTerms(rehire.employeeId, termsDated("2026-11-02", "confirmed"));

				expect(written.employmentPeriodId).toBe(rehire.employmentPeriodId);
				expect((await termsInForceOnRehireDay(rehire.employeeId))?.id).toBe(written.id);
				expect((await termsInForceOnRehireDay(rehire.employeeId))?.weeklyContractMinutes).toBe(
					2400,
				);
			});
		},
	);

	it.each(rehiresNearLocalMidnight)(
		"lets draft terms dated on the rehire day be written and confirmed ($zone)",
		async ({ zone, rehiredAt }) => {
			await withOrganizationTimezone(zone, async () => {
				const rehire = await offboardAndRehireAt(rehiredAt);
				const draft = await writeTerms(rehire.employeeId, termsDated("2026-11-02", "draft"));

				const confirmed = await fixture.db.transaction((tx) =>
					confirmEmploymentTerms(tx, {
						organizationId: fixture.organizationId,
						employeeId: rehire.employeeId,
						actorUserId: fixture.ownerUserId,
						now: new Date(now.toString()),
						termsId: draft.id,
					}),
				);

				expect(confirmed.reviewState).toBe("confirmed");
				expect((await termsInForceOnRehireDay(rehire.employeeId))?.id).toBe(draft.id);
			});
		},
	);

	it.each(rehiresNearLocalMidnight)(
		"still refuses terms dated before the rehire day ($zone)",
		async ({ zone, rehiredAt }) => {
			await withOrganizationTimezone(zone, async () => {
				const rehire = await offboardAndRehireAt(rehiredAt);

				await expect(
					writeTerms(rehire.employeeId, termsDated("2026-11-01", "confirmed")),
				).rejects.toMatchObject({
					message: "Employment terms cannot start before the current employment period.",
				});
			});
		},
	);

	it("keeps the previous stint's work policy cutoff after a same-day rehire", async () => {
		const target = await fixture.seedEmployee();
		const previousPolicyId = await createWorkPolicy();
		const previousAssignment = await insertAssignment({
			employeeId: target.employeeId,
			policyId: previousPolicyId,
			from: "2026-06-01",
		});
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-11-02T09:00:00Z");
		now = parseInstant("2026-11-02T10:00:00Z");

		await commands().rehireEmployee(
			owner(),
			await rehireInput({
				employeeId: target.employeeId,
				previousEmploymentPeriodId: target.employmentPeriodId,
				workPolicyId: policyId,
			}),
		);

		expect(
			await row(`select effective_until, is_active from work_policy_assignment where id = $1`, [
				previousAssignment,
			]),
		).toEqual({ effective_until: new Date("2026-11-02T09:00:00Z"), is_active: true });
	});

	it("replays a repeated rehire request and refuses a second rehire", async () => {
		const target = await fixture.seedEmployee();
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		now = parseInstant("2026-11-02T08:00:00Z");
		const input = await rehireInput({
			employeeId: target.employeeId,
			previousEmploymentPeriodId: target.employmentPeriodId,
			workPolicyId: policyId,
		});

		const first = await commands().rehireEmployee(owner(), input);
		const replay = await commands().rehireEmployee(owner(), input);

		expect(replay).toEqual(first);
		await expect(
			commands().rehireEmployee(owner(), { ...input, requestId: randomUUID() }),
		).rejects.toMatchObject({ code: "employee_already_employed" });
	});

	it("rejects a rehire against a stale previous period", async () => {
		const target = await fixture.seedEmployee();
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		now = parseInstant("2026-11-02T08:00:00Z");

		await expect(
			commands().rehireEmployee(
				owner(),
				await rehireInput({
					employeeId: target.employeeId,
					previousEmploymentPeriodId: randomUUID(),
					workPolicyId: policyId,
				}),
			),
		).rejects.toMatchObject({ code: "rehire_conflict" });
	});

	it("requires approved membership before restoring access", async () => {
		const target = await fixture.seedEmployee();
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		await fixture.pool.query(`delete from member where id = $1`, [target.memberId]);
		now = parseInstant("2026-11-02T08:00:00Z");

		await expect(
			commands().rehireEmployee(
				owner(),
				await rehireInput({
					employeeId: target.employeeId,
					previousEmploymentPeriodId: target.employmentPeriodId,
					workPolicyId: policyId,
				}),
			),
		).rejects.toMatchObject({ code: "membership_required" });
		expect(await row(`select is_active from employee where id = $1`, [target.employeeId])).toEqual({
			is_active: false,
		});
	});

	it("rejects organization-foreign team, manager and work policy choices", async () => {
		const target = await fixture.seedEmployee();
		const policyId = await createWorkPolicy();
		await offboardNowAt(target.employeeId, "2026-09-14T09:30:00Z");
		now = parseInstant("2026-11-02T08:00:00Z");
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignManager = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const base = {
			employeeId: target.employeeId,
			previousEmploymentPeriodId: target.employmentPeriodId,
			workPolicyId: policyId,
		};

		await expect(
			commands().rehireEmployee(
				owner(),
				await rehireInput({ ...base, overrides: { primaryManagerId: foreignManager.employeeId } }),
			),
		).rejects.toMatchObject({ code: "rehire_terms_invalid" });
		await expect(
			commands().rehireEmployee(
				owner(),
				await rehireInput({ ...base, workPolicyId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: "rehire_terms_invalid" });
		await expect(
			commands().rehireEmployee(
				owner(),
				await rehireInput({ ...base, overrides: { teamId: randomUUID() } }),
			),
		).rejects.toMatchObject({ code: "rehire_terms_invalid" });
	});
});
