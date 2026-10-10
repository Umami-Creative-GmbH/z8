/**
 * PostgreSQL contract: pnpm --filter webapp test:integration
 * The departure clock-out closes a real running period at the cutoff through the
 * Clocking module (#485), in both admissions, and stages its durable follow-ups.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";

const harness = vi.hoisted(() => ({
	billing: { canAccess: true } as { canAccess: boolean; reason?: string },
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => harness.billing,
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("@/lib/time-tracking/clocking/clocking");
const { recordingFollowUps } = await import("@/lib/time-tracking/clocking/follow-ups");
const { coordinatedTransactions } = await import("@/lib/time-tracking/clocking/transactions");
const { createDepartureClockOut } = await import("./clock-out");
const { runDepartureTransaction } = await import("./departure-transaction");
const { createLifecycleDatabaseFixture } = await import("./testing/database.test.fixture");
const { executeDepartureInTransaction } = await import("./transition");
type LifecycleDatabaseFixture = import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;

const CUTOFF = "2026-09-14T22:00:00Z";
const EXECUTED_LATE = parseInstant("2026-09-14T22:17:00Z");

describe("departure clock-out", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function clockIn(target: SeededEmployee, at: string, actionId?: string) {
		const clocking = createClockingService({
			transaction: (callback) =>
				fixture.db.transaction((tx) => callback(createDatabaseClockingStore(tx))),
		});
		const result = await clocking.clockIn({
			employeeId: target.employeeId,
			organizationId: fixture.organizationId,
			createdBy: target.userId,
			actionId,
			action: {
				instant: parseInstant(at),
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "user_setting",
			},
			source: { ipAddress: null, deviceInfo: "test" },
			workLocationType: "office",
		});
		return (result as { period: { id: string } }).period.id;
	}

	async function scheduleAt(target: SeededEmployee, cutoff = CUTOFF) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'Europe/Berlin', $4, $5,
			         gen_random_uuid(), 'test', 1, 'pending') returning id`,
			[
				fixture.organizationId,
				target.employeeId,
				target.employmentPeriodId,
				cutoff,
				fixture.ownerUserId,
			],
		);
		return {
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			departureId: result.rows[0]?.id ?? "",
			revision: 1,
		};
	}

	function execute(identity: Awaited<ReturnType<typeof scheduleAt>>, now: Instant = EXECUTED_LATE) {
		return runDepartureTransaction(fixture.db, identity, (scope) =>
			executeDepartureInTransaction(scope, identity, now, createDepartureClockOut()),
		);
	}

	async function row<T>(sql: string, params: unknown[]) {
		const result = await fixture.pool.query(sql, params);
		return result.rows[0] as T;
	}

	it("closes a running period at the cutoff in the target's timezone, once", async () => {
		const target = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())`,
			[target.userId],
		);
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const identity = await scheduleAt(target);

		await execute(identity);
		const replay = await execute(identity);

		expect(replay).toEqual({ status: "obsolete" });
		expect(
			await row(`select end_time, duration_minutes, is_active from work_period where id = $1`, [
				periodId,
			]),
		).toEqual({
			end_time: new Date(CUTOFF),
			duration_minutes: 120,
			is_active: false,
		});
		const entries = await fixture.pool.query(
			`select timestamp, utc_offset_minutes, timezone, timezone_source, created_by
			 from time_entry where employee_id = $1 and type = 'clock_out'`,
			[target.employeeId],
		);
		expect(entries.rows).toEqual([
			{
				timestamp: new Date(CUTOFF),
				utc_offset_minutes: 120,
				timezone: "Europe/Berlin",
				timezone_source: "manager_target_user_setting",
				created_by: fixture.ownerUserId,
			},
		]);
		expect(
			await row(`select kind, subject_id from employee_departure_review where departure_id = $1`, [
				identity.departureId,
			]),
		).toEqual({ kind: "clock_out", subject_id: periodId });
		// #476 decision 10: every legacy close writes the canonical work record.
		expect(
			await row(
				`select tr.start_at, tr.end_at, tr.duration_minutes, tr.created_by
				 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
				 where wp.id = $1`,
				[periodId],
			),
		).toEqual({
			start_at: new Date("2026-09-14T20:00:00Z"),
			end_at: new Date(CUTOFF),
			duration_minutes: 120,
			created_by: fixture.ownerUserId,
		});
		// Legacy closures keep no receipt.
		expect(await receipts(target)).toEqual([]);
		expect(await postprocessTasks(identity.departureId)).toEqual([
			{
				dedupe_key: `clock-postprocess:${await clockOutActionId(identity.departureId)}`,
				payload: {
					workPeriodId: periodId,
					durationMinutes: 120,
					periodStartedAt: "2026-09-14T20:00:00.000Z",
					timezone: "Europe/Berlin",
					createdBy: fixture.ownerUserId,
					projectId: null,
					balanceRefreshCommitted: false,
					surchargeSnapshot: expect.anything(),
				},
			},
		]);
	});

	// #476 decision 8: offboarding is never blocked by a lapsed subscription.
	it("closes running work although billing refuses mutations", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const identity = await scheduleAt(target);
		harness.billing = { canAccess: false, reason: "subscription_required" };
		try {
			await execute(identity);
		} finally {
			harness.billing = { canAccess: true };
		}

		expect(
			await row(`select end_time, is_active from work_period where id = $1`, [periodId]),
		).toEqual({ end_time: new Date(CUTOFF), is_active: false });
		expect(
			await row(`select kind, subject_id from employee_departure_review where departure_id = $1`, [
				identity.departureId,
			]),
		).toEqual({ kind: "clock_out", subject_id: periodId });
	});

	it("reports no running period without writing time entries", async () => {
		const target = await fixture.seedEmployee();
		const identity = await scheduleAt(target);

		await execute(identity);

		expect(
			await row(`select count(*)::int as count from time_entry where employee_id = $1`, [
				target.employeeId,
			]),
		).toEqual({ count: 0 });
		expect(
			await row(
				`select count(*)::int as count from employee_departure_review where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({ count: 0 });
	});

	it("never back-dates a period that started after the cutoff", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T22:05:00Z");
		const identity = await scheduleAt(target);

		await execute(identity);

		expect(
			await row(`select end_time, is_active from work_period where id = $1`, [periodId]),
		).toEqual({ end_time: null, is_active: true });
		expect(
			await row(
				`select kind, subject_id, metadata->>'reason' as reason from employee_departure_review
				 where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({ kind: "clock_repair", subject_id: periodId, reason: "period_starts_after_cutoff" });
	});

	// #476 decision 16 (W24): an organization that adopted appends closes the
	// departing employee's live work through the append writer, with a receipt.
	it("closes adopted work through the append writer", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const identity = await scheduleAt(target);
		await fixture.pool.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[fixture.organizationId],
		);
		try {
			await execute(identity);
			// A second run finds the departure effective and writes nothing more.
			expect(await execute(identity)).toEqual({ status: "obsolete" });
		} finally {
			await fixture.pool.query("delete from time_entry_append_control where organization_id = $1", [
				fixture.organizationId,
			]);
		}

		const actionId = await clockOutActionId(identity.departureId);
		expect(
			await row(
				`select wp.end_time, wp.is_active, wp.clock_out_id, tr.duration_minutes as record_minutes
				 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
				 where wp.id = $1`,
				[periodId],
			),
		).toEqual({
			end_time: new Date(CUTOFF),
			is_active: false,
			clock_out_id: actionId,
			record_minutes: 120,
		});
		const entries = await fixture.pool.query(
			`select id, timestamp, timezone_source, created_by, device_info
			 from time_entry where employee_id = $1 and type = 'clock_out'`,
			[target.employeeId],
		);
		expect(entries.rows).toEqual([
			{
				id: actionId,
				timestamp: new Date(CUTOFF),
				timezone_source: "manager_target_user_setting",
				created_by: fixture.ownerUserId,
				device_info: "employee-offboarding",
			},
		]);
		expect(await receipts(target)).toEqual([
			{
				id: actionId,
				kind: "close_active_work",
				writer: "employee_departure",
				work_period_id: periodId,
				append_admission: "append",
			},
		]);
		expect(
			await row(`select kind, subject_id from employee_departure_review where departure_id = $1`, [
				identity.departureId,
			]),
		).toEqual({ kind: "clock_out", subject_id: periodId });
		expect(await postprocessTasks(identity.departureId)).toEqual([
			{
				dedupe_key: `clock-postprocess:${actionId}`,
				payload: expect.objectContaining({
					workPeriodId: periodId,
					durationMinutes: 120,
					balanceRefreshCommitted: true,
				}),
			},
		]);
	});

	// #861: a break in progress never counts as work, also at a departure.
	it.each([
		["legacy", false],
		["append", true],
	] as const)("ends %s work with a break in progress at the break's start and clears it", async (_admission, adopted) => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const started = await createClocking({
			clock: { nowInstant: () => parseInstant("2026-09-14T21:00:00Z") },
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		}).startBreak({
			organizationId: fixture.organizationId,
			principal: { kind: "user", userId: target.userId },
			subject: { employeeId: target.employeeId },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
		});
		expect(started).toMatchObject({ outcome: "executed" });
		const identity = await scheduleAt(target);
		if (adopted) {
			await fixture.pool.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
				[fixture.organizationId],
			);
		}
		try {
			await execute(identity);
		} finally {
			await fixture.pool.query("delete from time_entry_append_control where organization_id = $1", [
				fixture.organizationId,
			]);
		}

		expect(
			await row(
				`select end_time, duration_minutes, is_active, break_started_at, break_started_zone
				 from work_period where id = $1`,
				[periodId],
			),
		).toEqual({
			end_time: new Date("2026-09-14T21:00:00Z"),
			duration_minutes: 60,
			is_active: false,
			break_started_at: null,
			break_started_zone: null,
		});
		expect(
			await row(`select kind, subject_id from employee_departure_review where departure_id = $1`, [
				identity.departureId,
			]),
		).toEqual({ kind: "clock_out", subject_id: periodId });
	});

	it("rolls back a failed closure and records a timer repair", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const identity = await scheduleAt(target);
		// Another employee's entry already holds the departure's action ID.
		const other = await fixture.seedEmployee();
		await clockIn(other, "2026-09-14T19:00:00Z", await clockOutActionId(identity.departureId));

		await expect(execute(identity)).resolves.toMatchObject({ status: "effective" });

		expect(
			await row(`select end_time, is_active from work_period where id = $1`, [periodId]),
		).toEqual({ end_time: null, is_active: true });
		expect(
			await row(`select count(*)::int as count from time_record where employee_id = $1`, [
				target.employeeId,
			]),
		).toEqual({ count: 0 });
		expect(
			await row(
				`select kind, subject_id, metadata->>'reason' as reason from employee_departure_review
				 where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({ kind: "clock_repair", subject_id: periodId, reason: "clock_out_failed" });
		expect(await postprocessTasks(identity.departureId)).toEqual([]);
	});

	async function clockOutActionId(departureId: string) {
		const { clock_out_action_id } = await row<{ clock_out_action_id: string }>(
			`select clock_out_action_id from employee_departure where id = $1`,
			[departureId],
		);
		return clock_out_action_id;
	}

	async function receipts(target: SeededEmployee) {
		const result = await fixture.pool.query(
			`select id, kind, writer, work_period_id, append_admission
			 from completed_work_operation where employee_id = $1`,
			[target.employeeId],
		);
		return result.rows;
	}

	async function postprocessTasks(departureId: string) {
		const result = await fixture.pool.query(
			`select dedupe_key, payload from employee_departure_task
			 where departure_id = $1 and kind = 'clock_postprocess'`,
			[departureId],
		);
		return result.rows;
	}
});
