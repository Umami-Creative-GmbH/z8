import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	asHistory,
	withCanonicalRecords,
} from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { readTrackedDailyWorkMinutes } from "./tracked-work";

describe("tracked completed work in employee-local days", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
	let fixture: LifecycleDatabaseFixture;
	let employeeId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const employee = await fixture.seedEmployee({
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		employeeId = employee.employeeId;
		await fixture.pool.query(
			`insert into organization_tracking_settings
			 (organization_id, tracking_start_date, activated_at)
			 values ($1, '2020-01-01', now())`,
			[fixture.organizationId],
		);
		await withCanonicalRecords(fixture.pool, (client) =>
			client.query(
				`with periods as materialized (
					select gen_random_uuid() as clock_in_id, gen_random_uuid() as clock_out_id,
						day + interval '9 hours' as start_time, day + interval '17 hours' as end_time
					from generate_series('2020-01-01T00:00:00Z'::timestamptz,
						'2029-12-31T00:00:00Z'::timestamptz, interval '1 day') day
				), entries as (
					insert into time_entry (id, employee_id, organization_id, type, timestamp,
						utc_offset_minutes, timezone, timezone_source, hash, created_by)
					select clock_in_id, $1::uuid, $2, 'clock_in'::time_entry_type, start_time, 0, 'UTC', 'user_setting',
						clock_in_id::text, $3 from periods
					union all
					select clock_out_id, $1::uuid, $2, 'clock_out'::time_entry_type, end_time, 0, 'UTC', 'user_setting',
						clock_out_id::text, $3 from periods
				)
				insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
					start_time, end_time, duration_minutes, is_active, updated_at)
				select $1::uuid, $2, clock_in_id, clock_out_id, start_time, end_time, 480, false, now()
				from periods`,
				[employeeId, fixture.organizationId, fixture.ownerUserId],
			),
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function localEmployee(timezone = "Europe/Berlin") {
		const employee = await fixture.seedEmployee({
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		await fixture.pool.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, $2, now())`,
			[employee.userId, timezone],
		);
		return employee.employeeId;
	}

	async function completedWork(input: {
		employeeId: string;
		start: string;
		end: string;
		minutes: number;
		startOffset?: number;
		endOffset?: number;
		startTimezone?: string;
		endTimezone?: string;
		deleted?: boolean;
		historical?: boolean;
	}) {
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		await (input.historical ? asHistory : withCanonicalRecords)(
			fixture.pool,
			async (client) => {
				for (const [id, type, timestamp, offset, timezone] of [
					[
						clockIn,
						"clock_in",
						input.start,
						input.startOffset ?? 0,
						input.startTimezone ?? "UTC",
					],
					[
						clockOut,
						"clock_out",
						input.end,
						input.endOffset ?? 0,
						input.endTimezone ?? "UTC",
					],
				]) {
					await client.query(
						`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, $6, $8, 'user_setting', $1::uuid::text, $7)`,
						[
							id,
							input.employeeId,
							fixture.organizationId,
							type,
							timestamp,
							offset,
							fixture.ownerUserId,
							timezone,
						],
					);
				}
				await client.query(
					`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, deleted_at, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, false, case when $8 then now() else null end, now())`,
					[
						input.employeeId,
						fixture.organizationId,
						clockIn,
						clockOut,
						input.start,
						input.end,
						input.minutes,
						input.deleted ?? false,
					],
				);
			},
		);
	}

	it("makes ten years of daily completed work available within its declared CPU budget", async () => {
		// Declared before optimizing: 3,653 local dates/periods, <2s process CPU.
		// The broad budget catches a day × all-period scan without a helper-call assertion.
		const started = performance.now();
		const cpuStarted = process.cpuUsage();
		const result = await readTrackedDailyWorkMinutes(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId,
			startDate: new Date("2020-01-01T00:00:00Z"),
			endDate: new Date("2029-12-31T23:59:59Z"),
		});
		const cpu = process.cpuUsage(cpuStarted);
		const cpuMs = (cpu.user + cpu.system) / 1_000;
		console.info("Daily work fixture", {
			days: 3_653,
			periods: 3_653,
			elapsedMs: Math.round(performance.now() - started),
			cpuMs: Math.round(cpuMs),
		});
		expect(result?.timezone).toBe("UTC");
		expect(Object.keys(result?.minutesByDate ?? {})).toHaveLength(3_653);
		expect(new Set(Object.values(result?.minutesByDate ?? {}))).toEqual(
			new Set([480]),
		);
		expect(cpuMs).toBeLessThan(2_000);
	});

	it("protects rounded minutes across an employee-local year boundary and tracking start", async () => {
		const employeeId = await localEmployee();
		await completedWork({
			employeeId,
			start: "2025-12-31T22:58:20Z",
			end: "2025-12-31T23:01:40Z",
			minutes: 3,
			startOffset: 60,
			endOffset: -300,
			startTimezone: "Europe/Berlin",
			endTimezone: "America/New_York",
		});
		const range = {
			organizationId: fixture.organizationId,
			employeeId,
			startDate: new Date("2025-12-30T23:00:00Z"),
			endDate: new Date("2026-01-01T22:59:59Z"),
		};
		expect(await readTrackedDailyWorkMinutes(fixture.db, range)).toEqual({
			timezone: "Europe/Berlin",
			minutesByDate: { "2025-12-31": 2, "2026-01-01": 1 },
		});
		await fixture.pool.query(
			`insert into employee_tracking_settings (organization_id, employee_id, tracking_start_date)
			 values ($1, $2, '2026-01-01')`,
			[fixture.organizationId, employeeId],
		);
		expect(await readTrackedDailyWorkMinutes(fixture.db, range)).toEqual({
			timezone: "Europe/Berlin",
			minutesByDate: { "2026-01-01": 1 },
		});
	});

	it.each([
		{
			name: "a 23-hour spring day ending at midnight",
			start: "2026-03-28T23:00:00Z",
			end: "2026-03-29T22:00:00Z",
			minutes: 1_380,
			rangeStart: "2026-03-28T23:00:00Z",
			rangeEnd: "2026-03-30T21:59:59Z",
			expected: { "2026-03-29": 1_380, "2026-03-30": 0 },
		},
		{
			name: "a 25-hour autumn day ending at midnight",
			start: "2026-10-24T22:00:00Z",
			end: "2026-10-25T23:00:00Z",
			minutes: 1_500,
			rangeStart: "2026-10-24T22:00:00Z",
			rangeEnd: "2026-10-26T22:59:59Z",
			expected: { "2026-10-25": 1_500, "2026-10-26": 0 },
		},
		{
			name: "a period crossing three local days and the DST gap",
			start: "2026-03-28T22:00:00Z",
			end: "2026-03-30T00:00:00Z",
			minutes: 1_560,
			rangeStart: "2026-03-27T23:00:00Z",
			rangeEnd: "2026-03-30T21:59:59Z",
			expected: { "2026-03-28": 60, "2026-03-29": 1_380, "2026-03-30": 120 },
		},
	])(
		"allocates $name",
		async ({ start, end, minutes, rangeStart, rangeEnd, expected }) => {
			const employeeId = await localEmployee();
			await completedWork({ employeeId, start, end, minutes });
			expect(
				await readTrackedDailyWorkMinutes(fixture.db, {
					organizationId: fixture.organizationId,
					employeeId,
					startDate: new Date(rangeStart),
					endDate: new Date(rangeEnd),
				}),
			).toEqual({ timezone: "Europe/Berlin", minutesByDate: expected });
		},
	);

	it("keeps zero-length recorded minutes on their containing day and preserves the SQL range boundary", async () => {
		const employeeId = await localEmployee();
		await completedWork({
			employeeId,
			start: "2025-12-31T23:00:00Z",
			end: "2025-12-31T23:00:00Z",
			minutes: 1,
		});
		const range = {
			organizationId: fixture.organizationId,
			employeeId,
			startDate: new Date("2025-12-30T23:00:00Z"),
			endDate: new Date("2026-01-01T22:59:59Z"),
		};
		expect(await readTrackedDailyWorkMinutes(fixture.db, range)).toEqual({
			timezone: "Europe/Berlin",
			minutesByDate: { "2025-12-31": 0, "2026-01-01": 1 },
		});
		expect(
			await readTrackedDailyWorkMinutes(fixture.db, {
				...range,
				startDate: new Date("2025-12-31T23:00:00Z"),
			}),
		).toEqual({
			timezone: "Europe/Berlin",
			minutesByDate: { "2026-01-01": 0 },
		});
	});

	it("retains reconciliation failure for reversed historical endpoints inside the requested range", async () => {
		const employeeId = await localEmployee();
		await completedWork({
			employeeId,
			start: "2026-06-03T09:00:00Z",
			end: "2026-06-02T10:00:00Z",
			minutes: 60,
			historical: true,
		});
		await expect(
			readTrackedDailyWorkMinutes(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId,
				startDate: new Date("2026-05-31T22:00:00Z"),
				endDate: new Date("2026-06-03T21:59:59Z"),
			}),
		).rejects.toThrow(
			"Recorded work crossing the tracking boundary needs interval reconciliation.",
		);
	});

	it("refuses to locate an unresolved historical break across a local midnight", async () => {
		const employeeId = await localEmployee();
		await completedWork({
			employeeId,
			start: "2026-06-10T18:00:00Z",
			end: "2026-06-11T02:00:00Z",
			minutes: 450,
		});
		await expect(
			readTrackedDailyWorkMinutes(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId,
				startDate: new Date("2026-06-09T22:00:00Z"),
				endDate: new Date("2026-06-11T21:59:59Z"),
			}),
		).rejects.toThrow(
			"Recorded work crossing the tracking boundary needs interval reconciliation.",
		);
	});

	it("excludes live and deleted work while keeping empty local days", async () => {
		const employeeId = await localEmployee();
		await completedWork({
			employeeId,
			start: "2026-04-01T07:00:00Z",
			end: "2026-04-01T08:00:00Z",
			minutes: 60,
		});
		await completedWork({
			employeeId,
			start: "2026-04-01T09:00:00Z",
			end: "2026-04-01T10:00:00Z",
			minutes: 60,
			deleted: true,
		});
		const clockIn = randomUUID();
		await fixture.pool.query(
			`insert into time_entry (id, employee_id, organization_id, type, timestamp,
			 utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values ($1::uuid, $2, $3, 'clock_in', '2026-04-01T11:00:00Z', 120,
			 'Europe/Berlin', 'user_setting', $1::uuid::text, $4)`,
			[clockIn, employeeId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_period (employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
			 values ($1, $2, $3, '2026-04-01T11:00:00Z', true, now())`,
			[employeeId, fixture.organizationId, clockIn],
		);
		expect(
			await readTrackedDailyWorkMinutes(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId,
				startDate: new Date("2026-03-31T22:00:00Z"),
				endDate: new Date("2026-04-02T21:59:59Z"),
			}),
		).toEqual({
			timezone: "Europe/Berlin",
			minutesByDate: { "2026-04-01": 60, "2026-04-02": 0 },
		});
	});
});
