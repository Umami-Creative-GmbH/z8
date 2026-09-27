/**
 * #492 (S6 of #477): the departure is a work transaction. It takes the shared
 * adoption gate before any other guard, so an organization activation that
 * holds the exclusive gate and then locks the employee or the organization row
 * cannot deadlock with it. An activation that commits first still turns the
 * departure clock-out into a review (#477 decision 9).
 */
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import {
	adoptionGate,
	employeeCoordinationGuard,
	userConfigurationAccessGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import { createDepartureClockOut } from "./clock-out";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const CUTOFF = "2026-09-14T22:00:00Z";
const EXECUTED = parseInstant("2026-09-14T22:17:00Z");

describe("departure as a work transaction", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => EXECUTED },
			clockOut: createDepartureClockOut(),
		});
	}

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

	async function scheduleAt(target: SeededEmployee) {
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
				CUTOFF,
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

	/** The backend waiting on the advisory key, once one is. */
	async function waiterOn(key: string): Promise<number> {
		for (let poll = 0; poll < 400; poll += 1) {
			const { rows } = await fixture.pool.query<{ pid: number }>(
				`select l.pid from pg_locks l
				  where l.locktype = 'advisory' and not l.granted
				    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended($1, 0)`,
				[key],
			);
			if (rows[0]) return rows[0].pid;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Nothing waited on ${key}`);
	}

	/** The given advisory keys the backend holds. */
	async function heldKeys(pid: number, keys: readonly string[]): Promise<string[]> {
		const { rows } = await fixture.pool.query<{ key: string }>(
			`select key from unnest($2::text[]) as key
			   join pg_locks l
			     on l.locktype = 'advisory' and l.granted and l.pid = $1
			    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(key, 0)`,
			[pid, keys],
		);
		return rows.map(({ key }) => key);
	}

	async function row<T>(sql: string, params: unknown[]) {
		const result = await fixture.pool.query(sql, params);
		return result.rows[0] as T;
	}

	it("waits on the adoption gate holding nothing, so an activation locking its rows does not deadlock", async () => {
		const target = await fixture.seedEmployee();
		const periodId = await clockIn(target, "2026-09-14T20:00:00Z");
		const identity = await scheduleAt(target);
		const gate = adoptionGate(fixture.organizationId).key;
		const departureKeys = [
			userConfigurationAccessGuard(target.userId).key,
			employeeCoordinationGuard(target.employeeId).key,
		];

		const activation: PoolClient = await fixture.pool.connect();
		let departure: Promise<unknown> | null = null;
		try {
			await activation.query("begin");
			await activation.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [gate]);

			departure = commands().executeDeparture(identity);
			const departing = await waiterOn(gate);
			expect(await heldKeys(departing, departureKeys)).toEqual([]);

			// Activation tooling that locks the departure's rows under the exclusive
			// gate. A departure holding them while waiting on the gate would deadlock.
			await activation.query("set local lock_timeout = '10s'");
			await activation.query("select id from organization where id = $1 for update", [
				fixture.organizationId,
			]);
			await activation.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
				target.employeeId,
			]);
			await activation.query(
				`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')
				 on conflict (organization_id) do update set mode = 'active'`,
				[fixture.organizationId],
			);
			await activation.query("commit");

			await expect(departure).resolves.toMatchObject({ status: "effective" });
		} finally {
			await activation.query("rollback").catch(() => undefined);
			activation.release();
			await departure?.catch(() => undefined);
			await fixture.pool.query("delete from time_entry_append_control where organization_id = $1", [
				fixture.organizationId,
			]);
		}

		// The adopted departure records a review instead of writing (#477 decision 9).
		expect(
			await row(`select end_time, is_active from work_period where id = $1`, [periodId]),
		).toEqual({ end_time: null, is_active: true });
		expect(
			await row(
				`select count(*)::int as count from time_entry where employee_id = $1 and type = 'clock_out'`,
				[target.employeeId],
			),
		).toEqual({ count: 0 });
		expect(
			await row(
				`select kind, subject_id, metadata->>'reason' as reason from employee_departure_review
				 where departure_id = $1`,
				[identity.departureId],
			),
		).toEqual({ kind: "clock_repair", subject_id: periodId, reason: "append_adopted" });
	});
});
