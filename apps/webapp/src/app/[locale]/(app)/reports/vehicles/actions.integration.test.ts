/**
 * #1129: the distance per vehicle report on PostgreSQL. Months follow each work
 * period's event-local start day (the offset stored on its clock-in entry);
 * admins see everyone, managers themselves and the employees they manage,
 * employees only themselves. Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: "t1129-admin-user",
	organizationId: "t1129-distance-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: harness.userId, role: "user" },
				session: {
					id: `t1129-session-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
			}),
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { getVehicleDistanceReport } = await import("./actions");

const ids = {
	organization: "t1129-distance-org",
	otherOrganization: "t1129-other-org",
	ownerUser: "t1129-admin-user",
	managerUser: "t1129-manager-user",
	aliceUser: "t1129-alice-user",
	bobUser: "t1129-bob-user",
	strangerUser: "t1129-stranger-user",
	owner: "d1129000-0000-4000-8000-000000000001",
	manager: "d1129000-0000-4000-8000-000000000002",
	alice: "d1129000-0000-4000-8000-000000000003",
	bob: "d1129000-0000-4000-8000-000000000004",
	stranger: "d1129000-0000-4000-8000-000000000005",
	van: "d1129000-0000-4000-8000-0000000000a1",
	poolCar: "d1129000-0000-4000-8000-0000000000a2",
	strangerVan: "d1129000-0000-4000-8000-0000000000a3",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.aliceUser, ids.bobUser, ids.strangerUser];
const organizations = [ids.organization, ids.otherOrganization];

const vanRow = {
	kind: "organization",
	id: ids.van,
	name: "Van",
	licencePlate: "B-VN 1",
	archived: false,
};
const poolCarRow = {
	kind: "organization",
	id: ids.poolCar,
	name: "Pool car",
	licencePlate: "B-PC 2",
	archived: true,
};

describe("distance per vehicle report on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from work_period where organization_id = any($1::text[])", [
			organizations,
		]);
		await admin.query("delete from time_entry where organization_id = any($1::text[])", [
			organizations,
		]);
		await admin.query("delete from organization where id = any($1::text[])", [organizations]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	/**
	 * A work period with vehicle use. `start`/`end` are UTC instants; the clock-in
	 * entry stores `offsetMinutes`, which decides the work's month.
	 */
	async function drive(options: {
		organizationId?: string;
		employeeId: string;
		start: string;
		end?: string;
		offsetMinutes?: number;
		vehicleId?: string | null;
		distanceKm: number | null;
		deleted?: boolean;
	}) {
		const organizationId = options.organizationId ?? ids.organization;
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			...(clockOutId ? [[clockOutId, "clock_out", options.end]] : []),
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, $6, 'Europe/Berlin', 'user_setting', $8, $7)`,
				[
					entryId,
					options.employeeId,
					organizationId,
					type,
					timestamp,
					options.offsetMinutes ?? 60,
					ids.ownerUser,
					entryId,
				],
			);
		}
		const vehicleId = options.vehicleId ?? null;
		await admin.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, deleted_at, deleted_by, vehicle_kind, vehicle_id,
			  driven_distance_km, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
			[
				options.employeeId,
				organizationId,
				clockInId,
				clockOutId,
				options.start,
				options.end ?? null,
				options.end ? 60 : null,
				!options.end,
				options.deleted ? "2026-04-01T00:00:00Z" : null,
				options.deleted ? ids.ownerUser : null,
				vehicleId ? "organization" : "own",
				vehicleId,
				options.distanceKm,
			],
		);
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T1129 distance', $1, 'Europe/Berlin', now()),
			 ($2, 'T1129 other', $2, 'Europe/Berlin', now())`,
			organizations,
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, initcap(split_part(user_id, '-', 2)), user_id || '@example.test', now(), now()
			 from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1129-m-owner', $1, $3, 'owner', 'approved', now()),
			 ('t1129-m-manager', $1, $4, 'member', 'approved', now()),
			 ('t1129-m-alice', $1, $5, 'member', 'approved', now()),
			 ('t1129-m-bob', $1, $6, 'member', 'approved', now()),
			 ('t1129-m-stranger', $2, $7, 'owner', 'approved', now())`,
			[...organizations, ...users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', now()),
			 ($3, $4, $11, 'manager', now()),
			 ($5, $6, $11, 'employee', now()),
			 ($7, $8, $11, 'employee', now()),
			 ($9, $10, $12, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.alice,
				ids.aliceUser,
				ids.bob,
				ids.bobUser,
				ids.stranger,
				ids.strangerUser,
				...organizations,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.alice, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate) values
			 ($1, $4, 'Van', 'B-VN 1'),
			 ($2, $4, 'Pool car', 'B-PC 2'),
			 ($3, $5, 'Stranger van', 'M-ST 3')`,
			[ids.van, ids.poolCar, ids.strangerVan, ...organizations],
		);

		// Alice, van: 23:00 on 31 January at +01:00 counts in January ...
		await drive({
			employeeId: ids.alice,
			start: "2026-01-31T22:00:00Z",
			end: "2026-01-31T23:00:00Z",
			vehicleId: ids.van,
			distanceKm: 10,
		});
		// ... 00:30 on 1 February at +01:00 (still 31 January in UTC) in February.
		await drive({
			employeeId: ids.alice,
			start: "2026-01-31T23:30:00Z",
			end: "2026-02-01T00:30:00Z",
			vehicleId: ids.van,
			distanceKm: 40,
		});
		await drive({
			employeeId: ids.alice,
			start: "2026-02-10T08:00:00Z",
			end: "2026-02-10T09:00:00Z",
			distanceKm: 25,
		});
		// Bob, pool car (archived below) in March, and his own car in February.
		await drive({
			employeeId: ids.bob,
			start: "2026-03-05T08:00:00Z",
			end: "2026-03-05T09:00:00Z",
			vehicleId: ids.poolCar,
			distanceKm: 70,
		});
		await drive({
			employeeId: ids.bob,
			start: "2026-02-11T08:00:00Z",
			end: "2026-02-11T09:00:00Z",
			distanceKm: 15,
		});
		// The manager drove the van in February.
		await drive({
			employeeId: ids.manager,
			start: "2026-02-12T08:00:00Z",
			end: "2026-02-12T09:00:00Z",
			vehicleId: ids.van,
			distanceKm: 5,
		});

		// Never counted: 22:00 on 31 December at -05:00 (1 January in UTC) ...
		await drive({
			employeeId: ids.alice,
			start: "2026-01-01T03:00:00Z",
			end: "2026-01-01T04:00:00Z",
			offsetMinutes: -300,
			vehicleId: ids.van,
			distanceKm: 900,
		});
		// ... work deleted by an approved correction, live work, and work without a distance ...
		await drive({
			employeeId: ids.alice,
			start: "2026-02-13T08:00:00Z",
			end: "2026-02-13T09:00:00Z",
			vehicleId: ids.van,
			distanceKm: 800,
			deleted: true,
		});
		await drive({
			employeeId: ids.bob,
			start: "2026-03-20T08:00:00Z",
			vehicleId: ids.van,
			distanceKm: null,
		});
		await drive({
			employeeId: ids.bob,
			start: "2026-03-21T08:00:00Z",
			end: "2026-03-21T09:00:00Z",
			distanceKm: null,
		});
		// ... and another organization's driving.
		await drive({
			organizationId: ids.otherOrganization,
			employeeId: ids.stranger,
			start: "2026-02-14T08:00:00Z",
			end: "2026-02-14T09:00:00Z",
			vehicleId: ids.strangerVan,
			distanceKm: 700,
		});

		// Archived after it was driven: it still shows in March.
		await admin.query("update organization_vehicle set archived_at = now() where id = $1", [
			ids.poolCar,
		]);
	});
	afterAll(cleanup);

	function as(userId: string) {
		harness.userId = userId;
	}

	async function report(fromDay = "2026-01-01", toDay = "2026-03-31") {
		const result = await getVehicleDistanceReport(fromDay, toDay);
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	it("gives an organization owner every vehicle and employee by event-local month", async () => {
		as(ids.ownerUser);
		const data = await report();

		expect(data.months).toEqual(["2026-01", "2026-02", "2026-03"]);
		expect(data.vehicles).toEqual([
			{
				vehicle: poolCarRow,
				monthlyKm: [0, 0, 70],
				totalKm: 70,
				employees: [
					{ employeeId: ids.bob, employeeName: "Bob", monthlyKm: [0, 0, 70], totalKm: 70 },
				],
			},
			{
				vehicle: vanRow,
				monthlyKm: [10, 45, 0],
				totalKm: 55,
				employees: [
					{ employeeId: ids.alice, employeeName: "Alice", monthlyKm: [10, 40, 0], totalKm: 50 },
					{ employeeId: ids.manager, employeeName: "Manager", monthlyKm: [0, 5, 0], totalKm: 5 },
				],
			},
			{
				vehicle: { kind: "own" },
				monthlyKm: [0, 40, 0],
				totalKm: 40,
				employees: [
					{ employeeId: ids.alice, employeeName: "Alice", monthlyKm: [0, 25, 0], totalKm: 25 },
					{ employeeId: ids.bob, employeeName: "Bob", monthlyKm: [0, 15, 0], totalKm: 15 },
				],
			},
		]);
		expect(data.monthlyKm).toEqual([10, 85, 70]);
		expect(data.totalKm).toBe(165);
	});

	it("counts work at the edge of the period by its event-local day", async () => {
		as(ids.ownerUser);
		const january = await report("2026-01-01", "2026-01-31");
		const february = await report("2026-02-01", "2026-02-28");

		expect(january.totalKm).toBe(10);
		expect(february.totalKm).toBe(85);
	});

	it("gives a manager themselves and the employees they manage", async () => {
		as(ids.managerUser);
		const data = await report();

		expect(data.vehicles.map((group) => group.vehicle)).toEqual([vanRow, { kind: "own" }]);
		expect(
			data.vehicles.flatMap((group) => group.employees.map((row) => row.employeeId)).sort(),
		).toEqual([ids.alice, ids.alice, ids.manager].sort());
		// Alice 10 + 40 (van) + 25 (own), the manager 5 (van); none of Bob's 85.
		expect(data.totalKm).toBe(80);
	});

	it("gives an employee only their own distances", async () => {
		as(ids.bobUser);
		const data = await report();

		expect(data.vehicles).toEqual([
			{
				vehicle: poolCarRow,
				monthlyKm: [0, 0, 70],
				totalKm: 70,
				employees: [
					{ employeeId: ids.bob, employeeName: "Bob", monthlyKm: [0, 0, 70], totalKm: 70 },
				],
			},
			{
				vehicle: { kind: "own" },
				monthlyKm: [0, 15, 0],
				totalKm: 15,
				employees: [
					{ employeeId: ids.bob, employeeName: "Bob", monthlyKm: [0, 15, 0], totalKm: 15 },
				],
			},
		]);
	});

	it("keeps another organization's driving out", async () => {
		as(ids.strangerUser);
		harness.organizationId = ids.otherOrganization;
		try {
			const data = await report();
			expect(data.vehicles.map((group) => group.vehicle)).toEqual([
				{
					kind: "organization",
					id: ids.strangerVan,
					name: "Stranger van",
					licencePlate: "M-ST 3",
					archived: false,
				},
			]);
			expect(data.totalKm).toBe(700);
		} finally {
			harness.organizationId = ids.organization;
		}
	});

	it("refuses a period that ends before it starts", async () => {
		as(ids.ownerUser);
		const result = await getVehicleDistanceReport("2026-03-01", "2026-02-01");

		expect(result.success).toBe(false);
	});
});
