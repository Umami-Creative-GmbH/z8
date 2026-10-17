/**
 * Vehicle use on clock commands (#1122, spec #807, Time Tracking ADR 0009),
 * through the Clocking module's `run` only: a clock-in records the vehicle and
 * start reading, a clock-out the end reading or distance, and a break carries
 * the vehicle over with one reading as the closed work's end and the resumed
 * work's start. Vehicle use never refuses or changes the clock event itself:
 * what cannot be recorded is dropped.
 *
 * The work transactions are the real coordinated adapter, in both admissions.
 * Only billing and the Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { seedSuspendedDrivingParticipant } from "@/lib/organization/driving-licence/testing/recording.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: async () => null } },
}));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) =>
		access.canAccess,
}));

const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
const { changeLiveWorkVehicleUse: changeLive } = await import(
	"../vehicle-use/live-vehicle-use"
);
type ClockCommand = import("./types").ClockCommand;
type ClockVehicleUse =
	import("../vehicle-use/clock-vehicle-use").ClockVehicleUse;
type BreakVehicleUse =
	import("../vehicle-use/clock-vehicle-use").BreakVehicleUse;

const ids = {
	organization: "t1122-clock-org",
	otherOrganization: "t1122-other-org",
	user: "t1122-employee-user",
	adminUser: "t1122-admin-user",
	employee: "f1122000-0000-4000-8000-000000000001",
	adminEmployee: "f1122000-0000-4000-8000-000000000002",
	van: "f1122000-0000-4000-8000-0000000000a1",
	archived: "f1122000-0000-4000-8000-0000000000a2",
	foreign: "f1122000-0000-4000-8000-0000000000a3",
} as const;
const startAt = parseInstant("2026-09-21T07:00:00Z");

type Columns = {
	vehicle_kind: string | null;
	vehicle_id: string | null;
	odometer_start_km: number | null;
	odometer_end_km: number | null;
	driven_distance_km: number | null;
};

const none: Columns = {
	vehicle_kind: null,
	vehicle_id: null,
	odometer_start_km: null,
	odometer_end_km: null,
	driven_distance_km: null,
};

function van(
	start: number | null,
	end: number | null = null,
	distance: number | null = null,
) {
	return {
		vehicle_kind: "organization",
		vehicle_id: ids.van,
		odometer_start_km: start,
		odometer_end_km: end,
		driven_distance_km: distance,
	};
}

describe("vehicle use on clock commands on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now = startAt;

	function newClocking() {
		return createClocking({
			clock: { nowInstant: () => now } as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
	}

	function common() {
		return {
			organizationId: ids.organization,
			principal: { kind: "user" as const, userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client" as const, id: randomUUID() },
			channel: "web" as const,
			at: { kind: "now" as const },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
		};
	}

	function clockIn(vehicleUse?: ClockVehicleUse): ClockCommand {
		return {
			...common(),
			...(vehicleUse ? { vehicleUse } : {}),
			body: { kind: "clock_in", workLocationType: "office" },
		};
	}

	function clockOut(vehicleUse?: ClockVehicleUse): ClockCommand {
		return {
			...common(),
			...(vehicleUse ? { vehicleUse } : {}),
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
		};
	}

	function takeBreak(
		breakMinutes: number,
		vehicleUse?: BreakVehicleUse,
	): ClockCommand {
		return {
			...common(),
			...(vehicleUse ? { vehicleUse } : {}),
			body: { kind: "break", breakMinutes },
		};
	}

	/** A version 4 frozen clock-in with vehicle use, as the commands route sends it. */
	function frozenClockIn(
		at: Instant,
		vehicleUse: ClockVehicleUse,
	): ClockCommand {
		const base = common();
		return {
			...base,
			channel: "api",
			at: { kind: "occurred", instant: at },
			freshness: {
				earliest: now.subtract({ hours: 7 * 24 }),
				latest: now.add({ minutes: 5 }),
			},
			payload: {
				version: 4,
				operationId: base.identity.id,
				kind: "clock_in",
				occurredAt: at.toString(),
				workLocationType: "office",
				vehicleUse,
			},
			vehicleUse,
			body: { kind: "clock_in", workLocationType: "office" },
		};
	}

	/** Each work period's vehicle columns, oldest first, with its canonical record's. */
	async function periods() {
		const { rows } = await admin.query<
			Columns & {
				is_active: boolean;
				record: Columns | null;
			}
		>(
			`select p.is_active, p.vehicle_kind, p.vehicle_id, p.odometer_start_km, p.odometer_end_km,
			        p.driven_distance_km,
			        case when w.record_id is null then null else json_build_object(
			          'vehicle_kind', w.vehicle_kind, 'vehicle_id', w.vehicle_id,
			          'odometer_start_km', w.odometer_start_km, 'odometer_end_km', w.odometer_end_km,
			          'driven_distance_km', w.driven_distance_km) end as record
			   from work_period p
			   left join time_record_work w on w.record_id = p.canonical_record_id
			  where p.organization_id = $1 and p.deleted_at is null
			  order by p.start_time`,
			[ids.organization],
		);
		return rows.map(({ is_active, record, ...columns }) => ({
			active: is_active,
			period: columns,
			record,
		}));
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function setVehicleUse(
		mode: "off" | "asked" | "expected",
		enabled = true,
	) {
		await admin.query(
			`insert into vehicle_use_setting (organization_id, enabled) values ($1, $2)
			 on conflict (organization_id) do update set enabled = excluded.enabled`,
			[ids.organization, enabled],
		);
		await admin.query(
			"delete from vehicle_use_assignment where organization_id = $1",
			[ids.organization],
		);
		await admin.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, $2, $3)`,
			[ids.organization, mode, ids.adminUser],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.user, ids.adminUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		for (const organization of [ids.organization, ids.otherOrganization]) {
			await admin.query(
				`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)`,
				[organization, timestamp],
			);
		}
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		for (const [user, employee, role] of [
			[ids.user, ids.employee, "member"],
			[ids.adminUser, ids.adminEmployee, "admin"],
		] as const) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, $1, $2, $3, $3)`,
				[user, `${user}@example.test`, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`${user}-member`, ids.organization, user, role, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, $4, $5)`,
				[
					employee,
					user,
					ids.organization,
					role === "admin" ? "admin" : "employee",
					timestamp,
				],
			);
			await admin.query(
				`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
				[user, timestamp],
			);
		}
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
			 ($1, $4, 'Van', 'M-VW 1', null),
			 ($2, $4, 'Old van', 'M-VW 2', now()),
			 ($3, $5, 'Foreign van', 'B-XX 1', null)`,
			[
				ids.van,
				ids.archived,
				ids.foreign,
				ids.organization,
				ids.otherOrganization,
			],
		);
		await setVehicleUse("asked");
		await setAdmission("active");
	}

	beforeEach(async () => {
		now = startAt;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	const vanChoice = { kind: "organization" as const, vehicleId: ids.van };
	it.each(["absent", "suspended"] as const)(
		"records clock-in/out and actual vehicle use with %s driving authorization, without granting authorization",
		async (drivingState) => {
			if (drivingState === "suspended")
				await seedSuspendedDrivingParticipant(admin, {
					organizationId: ids.organization,
					employeeId: ids.employee,
					userId: ids.user,
					at: new Date(startAt.epochMilliseconds),
				});
			const clocking = newClocking();
			expect(
				await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12000 })),
			).toMatchObject({ outcome: "executed" });
			now = now.add({ hours: 1 });
			expect(await clocking.run(clockOut({ endKm: 12085 }))).toMatchObject({
				outcome: "executed",
			});
			expect(await periods()).toEqual([
				{
					active: false,
					period: van(12000, 12085, 85),
					record: van(12000, 12085, 85),
				},
			]);
			expect(
				(
					await admin.query(
						`select class_code from driving_authorization where organization_id=$1 and employee_id=$2 and state='active'`,
						[ids.organization, ids.employee],
					)
				).rows,
			).toEqual([]);
		},
	);

	it.each(["active", "inactive"] as const)(
		"records the clock-in's vehicle and start reading and the clock-out's end reading (admission %s)",
		async (admission) => {
			await setAdmission(admission);
			const clocking = newClocking();
			const started = await clocking.run(
				clockIn({ vehicle: vanChoice, startKm: 12_000 }),
			);
			expect(started.outcome).toBe("executed");
			expect(await periods()).toEqual([
				{ active: true, period: van(12_000), record: null },
			]);

			now = now.add({ hours: 4 });
			const ended = await clocking.run(clockOut({ endKm: 12_085 }));

			expect(ended.outcome).toBe("executed");
			expect(await periods()).toEqual([
				{
					active: false,
					period: van(12_000, 12_085, 85),
					record: van(12_000, 12_085, 85),
				},
			]);
		},
	);

	it.each(["active", "inactive"] as const)(
		"records one break reading as the closed work's end and the resumed work's start (admission %s)",
		async (admission) => {
			await setAdmission(admission);
			const clocking = newClocking();
			await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
			now = now.add({ hours: 3 });

			const taken = await clocking.run(takeBreak(30, { readingKm: 12_040 }));

			expect(taken.outcome).toBe("executed");
			expect(await periods()).toEqual([
				{
					active: false,
					period: van(12_000, 12_040, 40),
					record: van(12_000, 12_040, 40),
				},
				{ active: true, period: van(12_040), record: null },
			]);
		},
	);

	it("carries the vehicle over a break without a reading and leaves both readings empty", async () => {
		const clocking = newClocking();
		await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
		now = now.add({ hours: 3 });

		await clocking.run(takeBreak(30));
		now = now.add({ hours: 1 });
		await clocking.run(clockOut());

		expect(await periods()).toEqual([
			{ active: false, period: van(12_000), record: van(12_000) },
			{ active: false, period: van(null), record: van(null) },
		]);
	});

	it("records the whole vehicle use at clock-out, or a direct distance without a start reading", async () => {
		const clocking = newClocking();
		await clocking.run(clockIn());
		now = now.add({ hours: 2 });
		await clocking.run(clockOut({ vehicle: { kind: "own" }, distanceKm: 37 }));

		expect(await periods()).toEqual([
			{
				active: false,
				period: { ...none, vehicle_kind: "own", driven_distance_km: 37 },
				record: { ...none, vehicle_kind: "own", driven_distance_km: 37 },
			},
		]);
	});

	it("runs clock commands without vehicle use when vehicle use is expected", async () => {
		await setVehicleUse("expected");
		const clocking = newClocking();

		await expect(clocking.run(clockIn())).resolves.toMatchObject({
			outcome: "executed",
		});
		now = now.add({ hours: 1 });
		await expect(clocking.run(takeBreak(15))).resolves.toMatchObject({
			outcome: "executed",
		});
		now = now.add({ hours: 1 });
		await expect(clocking.run(clockOut())).resolves.toMatchObject({
			outcome: "executed",
		});
		expect((await periods()).map(({ period }) => period)).toEqual([none, none]);
	});

	it("drops vehicle use, but commits the clock events, while vehicle use is off", async () => {
		await setVehicleUse("asked", false);
		const clocking = newClocking();

		await expect(
			clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 })),
		).resolves.toMatchObject({ outcome: "executed" });
		now = now.add({ hours: 1 });
		await expect(
			clocking.run(clockOut({ endKm: 12_010 })),
		).resolves.toMatchObject({
			outcome: "executed",
		});
		expect(await periods()).toEqual([
			{ active: false, period: none, record: none },
		]);
	});

	it("drops an end reading below the start reading but still clocks out", async () => {
		const clocking = newClocking();
		await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
		now = now.add({ hours: 1 });

		await expect(
			clocking.run(clockOut({ endKm: 11_000 })),
		).resolves.toMatchObject({
			outcome: "executed",
		});
		expect(await periods()).toEqual([
			{ active: false, period: van(12_000), record: van(12_000) },
		]);
	});

	it("never newly records an archived vehicle or another organization's vehicle", async () => {
		const clocking = newClocking();
		await clocking.run(
			clockIn({ vehicle: { kind: "organization", vehicleId: ids.archived } }),
		);
		now = now.add({ hours: 1 });
		await clocking.run(
			clockOut({
				vehicle: { kind: "organization", vehicleId: ids.foreign },
				distanceKm: 5,
			}),
		);

		expect(await periods()).toEqual([
			{ active: false, period: none, record: none },
		]);
	});

	it.each(["absent", "suspended"] as const)(
		"leaves the end reading empty on an on-behalf clock-out with %s driving authorization, keeping the vehicle",
		async (drivingState) => {
			if (drivingState === "suspended")
				await seedSuspendedDrivingParticipant(admin, {
					organizationId: ids.organization,
					employeeId: ids.employee,
					userId: ids.user,
					at: new Date(startAt.epochMilliseconds),
				});
			const clocking = newClocking();
			await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
			const [{ id: workPeriodId }] = (
				await admin.query<{ id: string }>(
					"select id from work_period where organization_id = $1 and is_active",
					[ids.organization],
				)
			).rows;
			now = now.add({ hours: 2 });

			const ended = await clocking.run({
				...common(),
				principal: { kind: "user", userId: ids.adminUser },
				subject: { employeeId: ids.employee, onBehalf: true },
				// A caller cannot record the employee's end reading on their behalf.
				vehicleUse: { endKm: 12_100 },
				body: {
					kind: "clock_out",
					target: { kind: "period", workPeriodId },
					project: { kind: "preserve" },
					workCategory: { kind: "preserve" },
				},
			});

			expect(ended.outcome).toBe("executed");
			expect(await periods()).toEqual([
				{ active: false, period: van(12_000), record: van(12_000) },
			]);
		},
	);

	describe("live amendment while clocked in", () => {
		async function livePeriodId() {
			const { rows } = await admin.query<{ id: string }>(
				"select id from work_period where organization_id = $1 and is_active",
				[ids.organization],
			);
			const [row] = rows;
			if (!row) throw new Error("No live work");
			return row.id;
		}

		function amend(
			workPeriodId: string,
			vehicleUse: Parameters<typeof changeLive>[0]["vehicleUse"],
		) {
			return changeLive({
				organizationId: ids.organization,
				employeeId: ids.employee,
				actorUserId: ids.user,
				workPeriodId,
				vehicleUse,
			});
		}

		it.each(["active", "inactive"] as const)(
			"changes the live work's vehicle and start reading, which the clock-out then ends (admission %s)",
			async (admission) => {
				await setAdmission(admission);
				const clocking = newClocking();
				await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));

				await amend(await livePeriodId(), {
					vehicle: { kind: "own" },
					startKm: 50,
					endKm: null,
					distanceKm: null,
				});
				expect((await periods())[0]?.period).toEqual({
					...none,
					vehicle_kind: "own",
					odometer_start_km: 50,
				});

				now = now.add({ hours: 1 });
				await clocking.run(clockOut({ endKm: 80 }));
				const closed = {
					...none,
					vehicle_kind: "own",
					odometer_start_km: 50,
					odometer_end_km: 80,
					driven_distance_km: 30,
				};
				expect(await periods()).toEqual([
					{ active: false, period: closed, record: closed },
				]);
			},
		);

		it("refuses a live change while vehicle use is off, or to an archived vehicle", async () => {
			const clocking = newClocking();
			await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
			const workPeriodId = await livePeriodId();

			await expect(
				amend(workPeriodId, {
					vehicle: { kind: "organization", vehicleId: ids.archived },
					startKm: null,
					endKm: null,
					distanceKm: null,
				}),
			).rejects.toMatchObject({ refusal: "vehicle_archived" });
			await setVehicleUse("asked", false);
			await expect(amend(workPeriodId, null)).rejects.toMatchObject({
				refusal: "vehicle_use_off",
			});
			expect((await periods())[0]?.period).toEqual(van(12_000));
		});

		it("never changes completed work or another organization's work", async () => {
			const clocking = newClocking();
			await clocking.run(clockIn({ vehicle: vanChoice, startKm: 12_000 }));
			const workPeriodId = await livePeriodId();
			now = now.add({ hours: 1 });
			await clocking.run(clockOut());

			await expect(amend(workPeriodId, null)).rejects.toThrow();
			await expect(
				changeLive({
					organizationId: ids.otherOrganization,
					employeeId: ids.employee,
					actorUserId: ids.user,
					workPeriodId,
					vehicleUse: null,
				}),
			).rejects.toThrow();
			expect((await periods())[0]?.period).toEqual(van(12_000));
		});
	});

	it("records a frozen version 4 clock-in's vehicle use once and replays an identical resubmission", async () => {
		const clocking = newClocking();
		const command = frozenClockIn(startAt.subtract({ hours: 1 }), {
			vehicle: vanChoice,
			startKm: 12_000,
		});

		const executed = await clocking.run(command);
		await admin.query(
			"update work_period set odometer_start_km = 12_001 where organization_id = $1",
			[ids.organization],
		);
		const replayed = await clocking.run(command);

		expect(executed.outcome).toBe("executed");
		expect(replayed).toEqual({ ...executed, outcome: "replayed" });
		// Replay writes nothing: the later change stands.
		expect(await periods()).toEqual([
			{ active: true, period: van(12_001), record: null },
		]);
	});
});
