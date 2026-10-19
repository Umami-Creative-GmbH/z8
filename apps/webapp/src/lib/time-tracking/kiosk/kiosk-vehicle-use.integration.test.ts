/**
 * #1123: vehicle use at the kiosk on PostgreSQL, through the kiosk endpoints'
 * service. After the PIN, the employee-status snapshot tells the kiosk what to
 * ask (mode, vehicles with the assigned one first, last end readings, vehicles
 * on colleagues' live work, the live work's vehicle use); clock-in, clock-out and
 * the resume of a break carry vehicle use beside the action, and the Clocking
 * module records it as for the web clock (#1122). A kiosk action without vehicle
 * use, or with vehicle use that cannot be recorded, still clocks.
 *
 * The work transactions are the real coordinated adapter, in both admissions,
 * and the PIN check is the real one. Only billing and the Next request/cache
 * boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
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

const { createClocking } = await import(
	"@/lib/time-tracking/clocking/clocking"
);
const { recordingFollowUps } = await import(
	"@/lib/time-tracking/clocking/follow-ups"
);
const { coordinatedTransactions } = await import(
	"@/lib/time-tracking/clocking/transactions"
);
const { setOwnKioskPin } = await import("@/lib/time-tracking/kiosk/pin-store");
const { hashKioskSecret } = await import("./credentials");
const { KIOSK_TOKEN_HEADER } = await import("./protocol");
const { createKioskClockService } = await import("./clock-service");

const ids = {
	organization: "t1123-kiosk-org",
	otherOrganization: "t1123-kiosk-other-org",
	driverUser: "t1123-driver-user",
	colleagueUser: "t1123-colleague-user",
	adminUser: "t1123-admin-user",
	driver: "f1123000-0000-4000-8000-000000000001",
	colleague: "f1123000-0000-4000-8000-000000000002",
	adminEmployee: "f1123000-0000-4000-8000-000000000003",
	depot: "f1123000-0000-4000-8000-000000000011",
	kiosk: "f1123000-0000-4000-8000-000000000021",
	van: "f1123000-0000-4000-8000-0000000000a1",
	truck: "f1123000-0000-4000-8000-0000000000a2",
	archived: "f1123000-0000-4000-8000-0000000000a3",
	foreign: "f1123000-0000-4000-8000-0000000000a4",
} as const;
const users = [ids.driverUser, ids.colleagueUser, ids.adminUser];
const TOKEN = "z8k_t1123-depot-kiosk-token";
const PIN = "4711";
const KIOSK_ZONE = "Europe/Berlin";
const startAt = parseInstant("2026-09-21T06:00:00Z");

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

const vanChoice = { kind: "organization", vehicleId: ids.van } as const;

describe("vehicle use at the kiosk on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now: Instant = startAt;

	function newService() {
		const clock = { nowInstant: () => now };
		const clocking = createClocking({
			clock: clock as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
		return createKioskClockService({
			clocking,
			clock,
			limitPinAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			limitBadgeAttempts: async () => ({ allowed: true, retryAfter: 0 }),
			limitOutcomeLookups: async () => ({ allowed: true, retryAfter: 0 }),
		});
	}

	function kioskRequest(path: string, body: unknown) {
		return new Request(`http://localhost/api/kiosk/${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[KIOSK_TOKEN_HEADER]: TOKEN,
			},
			body: JSON.stringify(body),
		});
	}

	async function clock(
		body: Record<string, unknown>,
		employeeId: string = ids.driver,
	) {
		const response = await newService().clock(
			kioskRequest("clock", { employeeId, pin: PIN, ...body }),
		);
		return { status: response.status, body: await response.json() };
	}

	async function status(employeeId: string = ids.driver) {
		const response = await newService().status(
			kioskRequest("employee-status", { employeeId, pin: PIN }),
		);
		return { status: response.status, body: await response.json() };
	}

	/** The driver's work periods' vehicle columns, oldest first, with their canonical records'. */
	async function periods(employeeId: string = ids.driver) {
		const { rows } = await admin.query<
			Columns & { is_active: boolean; record: Columns | null }
		>(
			`select p.is_active, p.vehicle_kind, p.vehicle_id, p.odometer_start_km, p.odometer_end_km,
			        p.driven_distance_km,
			        case when w.record_id is null then null else json_build_object(
			          'vehicle_kind', w.vehicle_kind, 'vehicle_id', w.vehicle_id,
			          'odometer_start_km', w.odometer_start_km, 'odometer_end_km', w.odometer_end_km,
			          'driven_distance_km', w.driven_distance_km) end as record
			   from work_period p
			   left join time_record_work w on w.record_id = p.canonical_record_id
			  where p.organization_id = $1 and p.employee_id = $2 and p.deleted_at is null
			  order by p.start_time`,
			[ids.organization, employeeId],
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
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T1123 depot', $1, 'Europe/Berlin', $3), ($2, 'T1123 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		for (const [user, employee, name, role] of [
			[ids.driverUser, ids.driver, "Dana Driver", "member"],
			[ids.colleagueUser, ids.colleague, "Cleo Colleague", "member"],
			[ids.adminUser, ids.adminEmployee, "Ada Admin", "admin"],
		] as const) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, $2, $3, $4, $4)`,
				[user, name, `${user}@example.test`, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`${user}-member`, ids.organization, user, role, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
				 values ($1, $2, $3, $4, true, $5)`,
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
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Depot', $3, $4)`,
			[ids.depot, ids.organization, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into kiosk (id, organization_id, location_id, name, timezone, token_hash, paired_at,
			                    revoked_at, created_by, updated_at)
			 values ($1, $2, $3, 'Depot kiosk', $4, $5, $6, null, $7, $6)`,
			[
				ids.kiosk,
				ids.organization,
				ids.depot,
				KIOSK_ZONE,
				hashKioskSecret(TOKEN),
				timestamp,
				ids.adminUser,
			],
		);
		await admin.query(
			`insert into employee_assigned_location (organization_id, employee_id, location_id)
			 values ($1, $2, $4), ($1, $3, $4)`,
			[ids.organization, ids.driver, ids.colleague, ids.depot],
		);
		for (const userId of [ids.driverUser, ids.colleagueUser]) {
			await setOwnKioskPin(db, {
				organizationId: ids.organization,
				userId,
				pin: PIN,
			});
		}
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
			 ($1, $5, 'Van', 'M-VW 1', null),
			 ($2, $5, 'Truck', 'M-TR 2', null),
			 ($3, $5, 'Old van', 'M-VW 3', now()),
			 ($4, $6, 'Foreign van', 'B-XX 1', null)`,
			[
				ids.van,
				ids.truck,
				ids.archived,
				ids.foreign,
				ids.organization,
				ids.otherOrganization,
			],
		);
		// The driver is the truck's assigned driver.
		await admin.query(
			`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id)
			 values ($1, $2, $3)`,
			[ids.organization, ids.truck, ids.driver],
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

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, admission) => {
		beforeEach(async () => {
			await setAdmission(admission);
		});

		it.each(["absent", "suspended"] as const)(
			"records clock events and actual vehicle use with %s driving authorization",
			async (drivingState) => {
				if (drivingState === "suspended")
					await seedSuspendedDrivingParticipant(admin, {
						organizationId: ids.organization,
						employeeId: ids.driver,
						userId: ids.driverUser,
						at: new Date(startAt.epochMilliseconds),
					});
				const started = await clock({
					action: "clock_in",
					vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
				});
				expect(started).toMatchObject({
					status: 200,
					body: { outcome: "executed" },
				});
				expect(await periods()).toEqual([
					{ active: true, period: van(12_000), record: null },
				]);

				now = now.add({ hours: 4 });
				const ended = await clock({
					action: "clock_out",
					vehicleUse: { endKm: 12_085 },
				});

				expect(ended).toMatchObject({
					status: 200,
					body: { outcome: "executed" },
				});
				expect(await periods()).toEqual([
					{
						active: false,
						period: van(12_000, 12_085, 85),
						record: van(12_000, 12_085, 85),
					},
				]);
			},
		);

		it("records the reading given on resuming a break as the closed work's end and the resumed work's start", async () => {
			await clock({
				action: "clock_in",
				vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
			});
			now = now.add({ hours: 3 });
			await clock({ action: "start_break" });
			now = now.add({ minutes: 30 });

			const resumed = await clock({
				action: "resume_break",
				vehicleUse: { readingKm: 12_040 },
			});

			expect(resumed).toMatchObject({
				status: 200,
				body: { outcome: "executed" },
			});
			expect(await periods()).toEqual([
				{
					active: false,
					period: van(12_000, 12_040, 40),
					record: van(12_000, 12_040, 40),
				},
				{ active: true, period: van(12_040), record: null },
			]);
		});

		it("records the end reading of a day ended on a break", async () => {
			await clock({
				action: "clock_in",
				vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
			});
			now = now.add({ hours: 3 });
			await clock({ action: "start_break" });
			now = now.add({ minutes: 30 });

			const ended = await clock({
				action: "clock_out",
				vehicleUse: { endKm: 12_050 },
			});

			expect(ended).toMatchObject({
				status: 200,
				body: { outcome: "executed" },
			});
			expect(await periods()).toEqual([
				{
					active: false,
					period: van(12_000, 12_050, 50),
					record: van(12_000, 12_050, 50),
				},
			]);
		});

		it("clocks without vehicle use while vehicle use is expected, and carries the vehicle over a break", async () => {
			await setVehicleUse("expected");
			await expect(clock({ action: "clock_in" })).resolves.toMatchObject({
				status: 200,
			});
			now = now.add({ hours: 1 });
			await expect(clock({ action: "clock_out" })).resolves.toMatchObject({
				status: 200,
			});
			now = now.add({ hours: 1 });
			await clock({
				action: "clock_in",
				vehicleUse: { vehicle: vanChoice, startKm: 100 },
			});
			now = now.add({ hours: 1 });
			await clock({ action: "start_break" });
			now = now.add({ minutes: 15 });
			await expect(clock({ action: "resume_break" })).resolves.toMatchObject({
				status: 200,
			});
			now = now.add({ hours: 1 });
			await expect(clock({ action: "clock_out" })).resolves.toMatchObject({
				status: 200,
			});

			expect((await periods()).map(({ period }) => period)).toEqual([
				none,
				van(100),
				van(null),
			]);
		});
	});

	it("records the whole vehicle use at clock-out when none was given at clock-in", async () => {
		await clock({ action: "clock_in" });
		now = now.add({ hours: 2 });
		await clock({
			action: "clock_out",
			vehicleUse: { vehicle: { kind: "own" }, distanceKm: 37 },
		});

		expect(await periods()).toEqual([
			{
				active: false,
				period: { ...none, vehicle_kind: "own", driven_distance_km: 37 },
				record: { ...none, vehicle_kind: "own", driven_distance_km: 37 },
			},
		]);
	});

	it("clocks but drops vehicle use that cannot be recorded: malformed, foreign or archived vehicles, readings below the start", async () => {
		await expect(
			clock({
				action: "clock_in",
				vehicleUse: { vehicle: { kind: "bicycle" }, startKm: -1 },
			}),
		).resolves.toMatchObject({ status: 200, body: { outcome: "executed" } });
		now = now.add({ hours: 1 });
		await clock({ action: "clock_out", vehicleUse: "nonsense" });
		now = now.add({ hours: 1 });
		await clock({
			action: "clock_in",
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: ids.foreign },
				startKm: 5,
			},
		});
		now = now.add({ hours: 1 });
		await clock({ action: "clock_out" });
		now = now.add({ hours: 1 });
		await clock({
			action: "clock_in",
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: ids.archived },
				startKm: 5,
			},
		});
		now = now.add({ hours: 1 });
		await clock({ action: "clock_out" });
		now = now.add({ hours: 1 });
		await clock({
			action: "clock_in",
			vehicleUse: { vehicle: vanChoice, startKm: 500 },
		});
		now = now.add({ hours: 1 });
		await expect(
			clock({ action: "clock_out", vehicleUse: { endKm: 400 } }),
		).resolves.toMatchObject({ status: 200, body: { outcome: "executed" } });

		expect((await periods()).map(({ period }) => period)).toEqual([
			none,
			none,
			none,
			van(500),
		]);
	});

	it("records nothing and asks nothing while vehicle use is off", async () => {
		await setVehicleUse("off");

		const before = await status();
		expect(before.status).toBe(200);
		expect(before.body).not.toHaveProperty("vehicleUse");

		await clock({
			action: "clock_in",
			vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
		});
		now = now.add({ hours: 1 });
		const ended = await clock({
			action: "clock_out",
			vehicleUse: { endKm: 12_010 },
		});

		expect(ended).toMatchObject({ status: 200, body: { outcome: "executed" } });
		expect(ended.body).not.toHaveProperty("vehicleUse");
		expect((await periods()).map(({ period }) => period)).toEqual([none]);
	});

	it("tells a clocked-out employee what to ask: vehicles with the assigned one first, last end readings and vehicles on colleagues' live work", async () => {
		// Earlier work recorded the van's and the truck's readings.
		await clock({
			action: "clock_in",
			vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
		});
		now = now.add({ hours: 2 });
		await clock({ action: "clock_out", vehicleUse: { endKm: 12_085 } });
		await clock({
			action: "clock_in",
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: ids.truck },
				startKm: 300,
			},
		});
		now = now.add({ hours: 1 });
		await clock({ action: "clock_out", vehicleUse: { endKm: 340 } });
		// A colleague is out with the van now.
		await clock(
			{
				action: "clock_in",
				vehicleUse: { vehicle: vanChoice, startKm: 12_085 },
			},
			ids.colleague,
		);

		const snapshot = await status();

		expect(snapshot.status).toBe(200);
		expect(snapshot.body.vehicleUse).toEqual({
			mode: "asked",
			vehicles: [
				{
					id: ids.truck,
					name: "Truck",
					licencePlate: "M-TR 2",
					archived: false,
				},
				{ id: ids.van, name: "Van", licencePlate: "M-VW 1", archived: false },
			],
			suggestedVehicleIds: [ids.truck],
			lastEndKmByVehicleId: { [ids.van]: 12_085, [ids.truck]: 340 },
			vehiclesOnOtherLiveWork: [ids.van],
			live: null,
		});
	});

	it("tells a clocked-in employee their live work's vehicle use and the readings before it started", async () => {
		await setVehicleUse("expected");
		await clock({
			action: "clock_in",
			vehicleUse: { vehicle: vanChoice, startKm: 12_000 },
		});
		now = now.add({ hours: 2 });
		await clock({ action: "clock_out", vehicleUse: { endKm: 12_085 } });
		await clock({
			action: "clock_in",
			vehicleUse: { vehicle: vanChoice, startKm: 12_085 },
		});
		now = now.add({ hours: 1 });

		const snapshot = await status();

		expect(snapshot.body.vehicleUse).toMatchObject({
			mode: "expected",
			lastEndKmByVehicleId: { [ids.van]: 12_085 },
			vehiclesOnOtherLiveWork: [],
			live: {
				vehicle: vanChoice,
				startKm: 12_085,
				endKm: null,
				distanceKm: null,
			},
		});
	});

	it("never answers another organization's vehicles", async () => {
		const snapshot = await status();

		const vehicleIds = (
			snapshot.body.vehicleUse.vehicles as { id: string }[]
		).map((vehicle) => vehicle.id);
		expect(vehicleIds).not.toContain(ids.foreign);
		expect(vehicleIds).not.toContain(ids.archived);
	});
});
