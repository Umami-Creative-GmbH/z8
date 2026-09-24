/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Clock actions serialize with departures and never start work past a cutoff.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	ClockingAccessError,
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import { createDepartureClockOut } from "./clock-out";
import { assertEmployeeMayClock } from "./clocking-gate";
import { preserveLateClockEvidence } from "./late-clock-evidence";
import { findOpenDepartureClockRepairs } from "./reviews";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import { executeDepartureInTransaction } from "./transition";
import type { DepartureClockOutPort } from "./types";

describeLifecycleDatabase("clocking against departures", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function clocking() {
		return createClockingService({
			transaction: (callback) =>
				fixture.db.transaction((tx) => callback(createDatabaseClockingStore(tx))),
			assertEmployeeMayClock,
		});
	}

	function clockIn(target: SeededEmployee, at = new Date(), actionId?: string) {
		return clocking().clockIn({
			employeeId: target.employeeId,
			organizationId: fixture.organizationId,
			createdBy: target.userId,
			actionId,
			action: {
				instant: parseInstant(at.toISOString()),
				utcOffsetMinutes: 0,
				timezone: "UTC",
				timezoneSource: "user_setting",
			},
			source: { ipAddress: null, deviceInfo: "test" },
			workLocationType: "office",
		});
	}

	async function schedule(target: SeededEmployee, cutoff: Date) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'immediate', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')
			 returning id`,
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

	async function activePeriods(target: SeededEmployee) {
		const result = await fixture.pool.query<{ count: number }>(
			`select count(*)::int as count from work_period where employee_id = $1 and end_time is null`,
			[target.employeeId],
		);
		return result.rows[0]?.count;
	}

	it("allows clocking before the cutoff and refuses it once a valid departure is due", async () => {
		const early = await fixture.seedEmployee();
		await schedule(early, new Date(Date.now() + 60 * 60 * 1000));
		await expect(clockIn(early)).resolves.toBeDefined();

		const late = await fixture.seedEmployee();
		await schedule(late, new Date(Date.now() - 60 * 1000));
		await expect(clockIn(late)).rejects.toBeInstanceOf(ClockingAccessError);
		expect(await activePeriods(late)).toBe(0);
	});

	it("waits for an in-flight departure and then refuses to start work after it", async () => {
		const target = await fixture.seedEmployee();
		const identity = await schedule(target, new Date(Date.now() - 1000));
		let releaseDeparture = () => {};
		const departureHeld = new Promise<void>((resolve) => {
			releaseDeparture = resolve;
		});
		let departureHasLocks = () => {};
		const locksTaken = new Promise<void>((resolve) => {
			departureHasLocks = resolve;
		});
		const holdingClockOut: DepartureClockOutPort = {
			async close() {
				departureHasLocks();
				await departureHeld;
				return { kind: "not_running" };
			},
		};
		const now: Instant = parseInstant(new Date().toISOString());

		const departure = fixture.db.transaction((tx) =>
			executeDepartureInTransaction(tx, identity, now, holdingClockOut),
		);
		await locksTaken;
		const racingClockIn = clockIn(target).then(
			() => "started",
			(error: unknown) => (error instanceof ClockingAccessError ? "refused" : String(error)),
		);
		await waitForLockWaiter();
		releaseDeparture();

		await expect(departure).resolves.toMatchObject({ status: "effective" });
		await expect(racingClockIn).resolves.toBe("refused");
		expect(await activePeriods(target)).toBe(0);
	});

	async function depart(target: SeededEmployee, cutoff: Date) {
		const identity = await schedule(target, cutoff);
		const now = parseInstant(new Date().toISOString());
		await fixture.db.transaction((tx) =>
			executeDepartureInTransaction(tx, identity, now, createDepartureClockOut()),
		);
		return identity;
	}

	it("refuses a manager's on-behalf clock-out past the cutoff and leaves the close to the departure", async () => {
		const target = await fixture.seedEmployee();
		const clockedIn = new Date(Date.now() - 2 * 60 * 60 * 1000);
		await clockIn(target, clockedIn);
		const cutoff = new Date(Date.now() - 60 * 1000);
		const identity = await schedule(target, cutoff);
		const actionAt = parseInstant(new Date().toISOString());

		await expect(
			clocking().clockOut({
				employeeId: target.employeeId,
				organizationId: fixture.organizationId,
				createdBy: fixture.ownerUserId,
				action: {
					instant: actionAt,
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "user_setting",
				},
				source: { ipAddress: null, deviceInfo: "manager" },
			}),
		).rejects.toBeInstanceOf(ClockingAccessError);
		expect(await activePeriods(target)).toBe(1);

		await fixture.db.transaction((tx) =>
			executeDepartureInTransaction(tx, identity, actionAt, createDepartureClockOut()),
		);
		const closed = await fixture.pool.query<{ end_time: Date }>(
			`select end_time from work_period where employee_id = $1`,
			[target.employeeId],
		);
		expect(closed.rows.map((row) => row.end_time.getTime())).toEqual([cutoff.getTime()]);
	});

	it("applies the same gate to clocking inside a caller-owned transaction", async () => {
		const target = await fixture.seedEmployee();
		await schedule(target, new Date(Date.now() - 60 * 1000));
		const callerOwned = createClockingService({
			transaction: () => {
				throw new Error("caller owns the transaction");
			},
			storeForTransaction: (transaction) =>
				createDatabaseClockingStore(
					transaction as Parameters<typeof createDatabaseClockingStore>[0],
				),
			assertEmployeeMayClock,
		});

		await expect(
			fixture.db.transaction((tx) =>
				callerOwned.clockIn({
					employeeId: target.employeeId,
					organizationId: fixture.organizationId,
					createdBy: target.userId,
					transaction: tx,
					action: {
						instant: parseInstant(new Date().toISOString()),
						utcOffsetMinutes: 0,
						timezone: "UTC",
						timezoneSource: "user_setting",
					},
					source: { ipAddress: null, deviceInfo: "test" },
					workLocationType: "office",
				}),
			),
		).rejects.toBeInstanceOf(ClockingAccessError);
		expect(await activePeriods(target)).toBe(0);
	});

	it("replays an already-recorded pre-cutoff action without reopening access", async () => {
		const target = await fixture.seedEmployee();
		const actionId = randomUUID();
		const clockedIn = new Date(Date.now() - 2 * 60 * 60 * 1000);
		const first = await clockIn(target, clockedIn, actionId);
		await depart(target, new Date(Date.now() - 60 * 1000));

		await expect(clockIn(target, clockedIn, actionId)).resolves.toEqual({ entry: first.entry });
		await expect(clockIn(target, new Date(), randomUUID())).rejects.toBeInstanceOf(
			ClockingAccessError,
		);
		expect(await activePeriods(target)).toBe(0);
	});

	it("keeps refused pre-cutoff evidence as an open repair review instead of a time entry", async () => {
		const target = await fixture.seedEmployee();
		const cutoff = new Date(Date.now() - 60 * 1000);
		await depart(target, cutoff);
		const actionId = randomUUID();
		const evidence = {
			organizationId: fixture.organizationId,
			userId: target.userId,
			actionId,
			type: "clock_out" as const,
			instant: parseInstant(new Date(cutoff.getTime() - 30 * 60 * 1000).toISOString()),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			receivedAt: parseInstant(new Date().toISOString()),
		};

		const preserved = await preserveLateClockEvidence(fixture.db, evidence);
		expect(preserved).toMatchObject({ kind: "preserved" });
		await expect(preserveLateClockEvidence(fixture.db, evidence)).resolves.toEqual(preserved);
		await expect(
			preserveLateClockEvidence(fixture.db, {
				...evidence,
				actionId: randomUUID(),
				instant: parseInstant(new Date(cutoff.getTime() + 1000).toISOString()),
			}),
		).resolves.toEqual({ kind: "not_applicable" });

		const repairs = await findOpenDepartureClockRepairs(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [target.employeeId],
			rangeStart: new Date(cutoff.getTime() - 24 * 60 * 60 * 1000),
			rangeEndExclusive: new Date(cutoff.getTime() + 24 * 60 * 60 * 1000),
		});
		expect(repairs).toHaveLength(1);
		const entries = await fixture.pool.query(`select 1 from time_entry where id = $1`, [actionId]);
		expect(entries.rows).toHaveLength(0);
		await expect(clockIn(target)).rejects.toBeInstanceOf(ClockingAccessError);
	});

	it("does not preserve evidence for an employee whose access continues", async () => {
		const target = await fixture.seedEmployee();
		await expect(
			preserveLateClockEvidence(fixture.db, {
				organizationId: fixture.organizationId,
				userId: target.userId,
				actionId: randomUUID(),
				type: "clock_in",
				instant: parseInstant(new Date(Date.now() - 60 * 1000).toISOString()),
				utcOffsetMinutes: 0,
				timezone: "UTC",
				receivedAt: parseInstant(new Date().toISOString()),
			}),
		).resolves.toEqual({ kind: "not_applicable" });
	});

	async function waitForLockWaiter() {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const waiting = await fixture.pool.query<{ count: number }>(
				`select count(*)::int as count from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'`,
			);
			if ((waiting.rows[0]?.count ?? 0) > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("expected the clock action to wait on the employee lock");
	}
});
