/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Open timer repairs block payroll for the affected employee and range only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	findOpenDepartureClockRepairs,
	resolveDepartureReview,
	retryDepartureTask,
} from "./reviews";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const SEPTEMBER = {
	rangeStart: new Date("2026-09-01T00:00:00Z"),
	rangeEndExclusive: new Date("2026-10-01T00:00:00Z"),
};

describeLifecycleDatabase("departure clock repairs", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function review(
		target: SeededEmployee,
		input: {
			kind?: "clock_repair" | "clock_out";
			status?: "open" | "resolved";
			start: string | null;
			end: string;
			organizationId?: string;
		},
	) {
		const organizationId = input.organizationId ?? fixture.organizationId;
		const departure = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', 'UTC', $4, $5, gen_random_uuid(), 'test', 1,
			         'effective', $4) returning id`,
			[
				organizationId,
				target.employeeId,
				target.employmentPeriodId,
				input.end,
				fixture.ownerUserId,
			],
		);
		const resolved = input.status === "resolved";
		await fixture.pool.query(
			`insert into employee_departure_review
			 (organization_id, employee_id, employment_period_id, departure_id, kind, subject_id, status,
			  affected_start_at, affected_end_at, resolved_at, resolution)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			[
				organizationId,
				target.employeeId,
				target.employmentPeriodId,
				departure.rows[0]?.id,
				input.kind ?? "clock_repair",
				randomUUID(),
				input.status ?? "open",
				input.start,
				input.end,
				resolved ? new Date() : null,
				resolved ? "fixed" : null,
			],
		);
	}

	const repairsFor = (employeeIds: string[], organizationId = fixture.organizationId) =>
		findOpenDepartureClockRepairs(fixture.db, { organizationId, employeeIds, ...SEPTEMBER });

	it("reports an open repair overlapping the range", async () => {
		const target = await fixture.seedEmployee();
		await review(target, { start: "2026-09-14T20:00:00Z", end: "2026-09-14T22:00:00Z" });

		expect(await repairsFor([target.employeeId])).toEqual([
			expect.objectContaining({ employeeId: target.employeeId }),
		]);
	});

	it("ignores resolved repairs and automatic clock-out reviews", async () => {
		const target = await fixture.seedEmployee();
		await review(target, {
			status: "resolved",
			start: "2026-09-14T20:00:00Z",
			end: "2026-09-14T22:00:00Z",
		});
		await review(target, {
			kind: "clock_out",
			start: "2026-09-15T20:00:00Z",
			end: "2026-09-15T22:00:00Z",
		});

		expect(await repairsFor([target.employeeId])).toEqual([]);
	});

	it("treats an unknown start as unbounded and keeps repairs ending exactly at the range start", async () => {
		const unknownStart = await fixture.seedEmployee();
		const atBoundary = await fixture.seedEmployee();
		await review(unknownStart, { start: null, end: "2026-10-20T00:00:00Z" });
		await review(atBoundary, { start: "2026-08-31T20:00:00Z", end: "2026-09-01T00:00:00Z" });

		const repairs = await repairsFor([unknownStart.employeeId, atBoundary.employeeId]);

		expect(repairs.map((repair) => repair.employeeId).sort()).toEqual(
			[unknownStart.employeeId, atBoundary.employeeId].sort(),
		);
	});

	async function openReview(
		target: SeededEmployee,
		kind: "clock_repair" | "clock_out",
		subjectId: string | null,
	) {
		const departure = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', 'UTC', '2026-09-14T22:00:00Z', $4, gen_random_uuid(),
			         'test', 1, 'effective', '2026-09-14T22:00:00Z') returning id`,
			[fixture.organizationId, target.employeeId, target.employmentPeriodId, fixture.ownerUserId],
		);
		const created = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_review
			 (organization_id, employee_id, employment_period_id, departure_id, kind, subject_id,
			  affected_start_at, affected_end_at)
			 values ($1, $2, $3, $4, $5, $6, '2026-09-14T20:00:00Z', '2026-09-14T22:00:00Z')
			 returning id`,
			[
				fixture.organizationId,
				target.employeeId,
				target.employmentPeriodId,
				departure.rows[0]?.id,
				kind,
				subjectId,
			],
		);
		return created.rows[0]?.id ?? "";
	}

	async function runningPeriod(target: SeededEmployee) {
		const entry = await fixture.pool.query<{ id: string }>(
			`insert into time_entry (employee_id, organization_id, type, timestamp, hash, created_by,
			  utc_offset_minutes, timezone, timezone_source)
			 values ($1, $2, 'clock_in', '2026-09-14T20:00:00Z', 'hash', $3, 0, 'UTC', 'user_setting')
			 returning id`,
			[target.employeeId, fixture.organizationId, target.userId],
		);
		const period = await fixture.pool.query<{ id: string }>(
			`insert into work_period (employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
			 values ($1, $2, $3, '2026-09-14T20:00:00Z', true, now()) returning id`,
			[target.employeeId, fixture.organizationId, entry.rows[0]?.id],
		);
		return period.rows[0]?.id ?? "";
	}

	const resolve = (reviewId: string, resolution: string, actorUserId = fixture.ownerUserId) =>
		resolveDepartureReview(fixture.db, {
			organizationId: fixture.organizationId,
			reviewId,
			actorUserId,
			resolution,
			now: parseInstant("2026-09-20T10:00:00Z"),
		});

	it("resolves an automatic clock-out review with a note and records who did it", async () => {
		const target = await fixture.seedEmployee();
		const reviewId = await openReview(target, "clock_out", randomUUID());

		await expect(resolve(reviewId, "   ")).rejects.toMatchObject({ code: "resolution_required" });
		await resolve(reviewId, "Checked with the team lead");

		const stored = await fixture.pool.query(
			`select status, resolved_by, resolution from employee_departure_review where id = $1`,
			[reviewId],
		);
		expect(stored.rows[0]).toEqual({
			status: "resolved",
			resolved_by: fixture.ownerUserId,
			resolution: "Checked with the team lead",
		});
		await expect(resolve(reviewId, "again")).rejects.toMatchObject({
			code: "review_already_resolved",
		});
	});

	it("keeps a timer repair open until the period is actually completed", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await runningPeriod(target);
		const reviewId = await openReview(target, "clock_repair", periodId);

		await expect(resolve(reviewId, "Looks fine")).rejects.toMatchObject({
			code: "repair_incomplete",
		});
		await fixture.pool.query(
			`update work_period set end_time = '2026-09-14T22:00:00Z', duration_minutes = 120,
			 is_active = false where id = $1`,
			[periodId],
		);

		await expect(resolve(reviewId, "Corrected to 22:00")).resolves.toBeUndefined();
	});

	it("refuses members without admin authority and reviews of another tenant", async () => {
		const target = await fixture.seedEmployee();
		const member = await fixture.seedEmployee();
		const reviewId = await openReview(target, "clock_out", randomUUID());

		await expect(resolve(reviewId, "ok", member.userId)).rejects.toMatchObject({
			code: "actor_not_authorized",
		});
		const otherOrganizationId = await fixture.createOrganization();
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		await expect(
			resolveDepartureReview(fixture.db, {
				organizationId: otherOrganizationId,
				reviewId,
				actorUserId: otherOwner.userId,
				resolution: "ok",
				now: parseInstant("2026-09-20T10:00:00Z"),
			}),
		).rejects.toMatchObject({ code: "review_not_found" });
	});

	it("ignores other ranges, other employees and other tenants", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		await review(target, { start: "2026-10-05T08:00:00Z", end: "2026-10-05T10:00:00Z" });
		const foreignOrganizationId = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		await review(foreign, {
			organizationId: foreignOrganizationId,
			start: "2026-09-14T20:00:00Z",
			end: "2026-09-14T22:00:00Z",
		});

		expect(await repairsFor([target.employeeId, colleague.employeeId, foreign.employeeId])).toEqual(
			[],
		);
	});

	it("retries only a failed task of this organization and only for admins", async () => {
		const target = await fixture.seedEmployee();
		const member = await fixture.seedEmployee();
		await review(target, { kind: "clock_out", start: null, end: "2026-09-15T00:00:00Z" });
		const task = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_task
				(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key,
				 payload, status, attempt_count, last_error)
			 select organization_id, employee_id, employment_period_id, id, 'notify_review',
				'retry-' || id, '{"attemptedAt": "2026-09-15T00:00:00Z"}'::jsonb, 'failed', 8,
				'needs_admin_resolution:delivery_ambiguous'
			 from employee_departure where organization_id = $1 and employee_id = $2
			 returning id`,
			[fixture.organizationId, target.employeeId],
		);
		const taskId = task.rows[0]?.id ?? "";
		const retry = (actorUserId: string, organizationId = fixture.organizationId) =>
			retryDepartureTask(fixture.db, {
				organizationId,
				taskId,
				actorUserId,
				now: systemClock.nowInstant(),
			});

		await expect(retry(member.userId)).rejects.toMatchObject({ code: "actor_not_authorized" });
		const foreignOrganizationId = await fixture.createOrganization();
		await expect(retry(fixture.ownerUserId, foreignOrganizationId)).rejects.toMatchObject({
			code: "actor_not_authorized",
		});
		await retry(fixture.ownerUserId);
		const after = await fixture.pool.query(
			`select status, attempt_count, last_error, payload from employee_departure_task where id = $1`,
			[taskId],
		);
		expect(after.rows).toEqual([
			{ status: "pending", attempt_count: 0, last_error: null, payload: {} },
		]);
		await expect(retry(fixture.ownerUserId)).rejects.toMatchObject({
			code: "task_not_retryable",
		});
	});
});
