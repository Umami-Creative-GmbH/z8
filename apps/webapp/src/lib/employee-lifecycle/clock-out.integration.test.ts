/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The canonical departure clock-out closes a real running period at the cutoff.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { createDepartureClockOut } from "./clock-out";
import { executeDepartureInTransaction } from "./transition";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const CUTOFF = "2026-09-14T22:00:00Z";
const EXECUTED_LATE = parseInstant("2026-09-14T22:17:00Z");

describeLifecycleDatabase("departure clock-out", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function clockIn(target: SeededEmployee, at: string) {
		const clocking = createClockingService({
			transaction: (callback) =>
				fixture.db.transaction((tx) => callback(createDatabaseClockingStore(tx))),
		});
		const result = await clocking.clockIn({
			employeeId: target.employeeId,
			organizationId: fixture.organizationId,
			createdBy: target.userId,
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
		return fixture.db.transaction((tx) =>
			executeDepartureInTransaction(tx, identity, now, createDepartureClockOut()),
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
});
