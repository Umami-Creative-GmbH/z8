/**
 * #1132: demo organizations get work periods with vehicle use, some of them with driving details
 * missing, on PostgreSQL.
 *
 * The real demo server actions run against a disposable database. Only the request/session,
 * billing provisioning and Next cache boundaries are replaced. `Math.random` is pinned and only
 * `Date` is faked, so the "last 30 days" of demo work are fixed: 23 weekdays from 2026-06-24 to
 * 2026-07-24, two work periods a day. The organization is adopted, so the canonical work detail
 * must carry the same vehicle use as the work period.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								// Not the active organization: `canUseDemoData` checks the admin membership.
								activeOrganizationId: null,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const {
	assignVehicleUseToPeriodsStepAction,
	clearTimeDataAction,
	generateLocationsStepAction,
	generateTimeEntriesStepAction,
} = await import("@/app/[locale]/(app)/settings/demo/actions");
const { db } = await import("@/db");
const { expectRecordAgreement } = await import(
	"@/lib/time-tracking/work-records/__tests__/expect-record-agreement"
);
const { listDrivingDetailsMissing } = await import(
	"@/lib/time-tracking/vehicle-use/driving-details-missing-store"
);

const ids = {
	organization: "t1132-demo-org",
	otherOrganization: "t1132-demo-other-org",
	adminUser: "t1132-demo-admin-user",
	driverUser: "t1132-demo-driver-user",
	officeUser: "t1132-demo-office-user",
	otherUser: "t1132-demo-other-user",
	admin: "11321000-0000-4000-8000-000000000001",
	driver: "11321000-0000-4000-8000-000000000002",
	office: "11321000-0000-4000-8000-000000000003",
	other: "11321000-0000-4000-8000-000000000004",
	team: "11321000-0000-4000-8000-0000000000a1",
} as const;

const fixedNow = new Date("2026-07-24T12:00:00Z");
const workPeriodsPerEmployee = 23 * 2;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("demo vehicle use on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	const stepInput = {
		organizationId: ids.organization,
		dateRangeType: "last30" as const,
		employeeIds: [ids.driver, ids.office],
		locationCount: 1,
	};

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.driverUser, ids.officeUser, ids.otherUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-06-01T00:00:00Z");
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query(
				"insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)",
				[organizationId, timestamp],
			);
		}
		await admin.query(
			`insert into team (id, organization_id, name, description, updated_at)
			 values ($1, $2, 'Field', 'Demo team - Field service', $3)`,
			[ids.team, ids.organization, timestamp],
		);
		const people = [
			[ids.adminUser, ids.admin, "admin", "admin", ids.organization, null],
			[ids.driverUser, ids.driver, "member", "employee", ids.organization, ids.team],
			[ids.officeUser, ids.office, "member", "employee", ids.organization, null],
			[ids.otherUser, ids.other, "member", "employee", ids.otherOrganization, null],
		] as const;
		for (const [userId, employeeId, memberRole, employeeRole, organizationId, teamId] of people) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)`,
				[userId, `${userId}@example.test`, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`member-${userId}`, organizationId, userId, memberRole, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, team_id, updated_at)
				 values ($1, $2, $3, $4, $5, $6)`,
				[employeeId, userId, organizationId, employeeRole, teamId, timestamp],
			);
		}
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
		);
	}

	async function generateDemo() {
		harness.userId = ids.adminUser;
		expect(await generateLocationsStepAction(stepInput)).toMatchObject({ success: true });
		expect(await generateTimeEntriesStepAction(stepInput)).toMatchObject({
			success: true,
			data: { workPeriodsCreated: workPeriodsPerEmployee * 2 },
		});
		return assignVehicleUseToPeriodsStepAction(stepInput);
	}

	async function vehicleUseByEmployee(employeeId: string) {
		const { rows } = await admin.query<{
			with_vehicle_use: number;
			organization_vehicle: number;
			own_vehicle: number;
		}>(
			`select
			   count(*) filter (where wp.vehicle_kind is not null)::int as with_vehicle_use,
			   count(*) filter (where wp.vehicle_kind = 'organization')::int as organization_vehicle,
			   count(*) filter (where wp.vehicle_kind = 'own')::int as own_vehicle
			 from work_period wp
			 where wp.organization_id = $1 and wp.employee_id = $2`,
			[ids.organization, employeeId],
		);
		return only(rows);
	}

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: fixedNow });
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		await seed();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	afterAll(cleanup);

	it("turns vehicle use on, expects it of the demo driver team and records it on their work", async () => {
		const result = await generateDemo();

		expect(result).toEqual({
			success: true,
			data: { vehicleUseRecorded: workPeriodsPerEmployee, drivingDetailsMissing: 1 },
		});

		// The switch and the team's expectation date from the first demo day, so the demo work
		// counts as expected work.
		const { rows: configuration } = await admin.query<{
			enabled: boolean;
			mode: string;
			setting_since: Date;
			assignment_since: Date;
			first_work: Date;
		}>(
			`select s.enabled, a.mode, s.updated_at as setting_since, a.updated_at as assignment_since,
			        (select min(start_time) from work_period where organization_id = $1) as first_work
			 from vehicle_use_setting s
			 join vehicle_use_assignment a on a.organization_id = s.organization_id
			 where s.organization_id = $1 and a.assignment_type = 'team' and a.team_id = $2`,
			[ids.organization, ids.team],
		);
		const config = only(configuration);
		expect(config).toMatchObject({ enabled: true, mode: "expected" });
		expect(config.setting_since.getTime()).toBeLessThanOrEqual(config.first_work.getTime());
		expect(config.assignment_since.getTime()).toBeLessThanOrEqual(config.first_work.getTime());

		// One driver: the first demo vehicle every day, carried over the lunch break.
		expect(await vehicleUseByEmployee(ids.driver)).toEqual({
			with_vehicle_use: workPeriodsPerEmployee,
			organization_vehicle: workPeriodsPerEmployee,
			own_vehicle: 0,
		});
		// Both records carry the vehicle use (#1223).
		await expectRecordAgreement({ organizationId: ids.organization });
		// Nobody asks the office employee for vehicle use.
		expect(await vehicleUseByEmployee(ids.office)).toMatchObject({ with_vehicle_use: 0 });

		// The latest work period lacks its end reading, so it shows "driving details missing".
		const missing = await listDrivingDetailsMissing(db, {
			organizationId: ids.organization,
			employeeIds: null,
		});
		expect(missing).toHaveLength(1);
		expect(missing[0]).toMatchObject({
			employeeId: ids.driver,
			workDay: "2026-07-24",
			vehicleUse: { endKm: null, distanceKm: null },
		});
		expect(missing[0].vehicleUse?.startKm).not.toBeNull();

		// Readings chain: every start reading is the previous end reading of that vehicle.
		const { rows: gaps } = await admin.query<{ gaps: number }>(
			`select count(*)::int as gaps from (
			   select odometer_start_km,
			          lag(odometer_end_km) over (partition by vehicle_id order by start_time) as previous_end
			   from work_period where organization_id = $1 and vehicle_id is not null
			 ) chained where previous_end is not null and odometer_start_km <> previous_end`,
			[ids.organization],
		);
		expect(only(gaps).gaps).toBe(0);

		const { rows: elsewhere } = await admin.query<{ count: number }>(
			`select count(*)::int as count from work_period
			 where organization_id = $1 and vehicle_kind is not null`,
			[ids.otherOrganization],
		);
		expect(only(elsewhere).count).toBe(0);
	});

	it("records vehicle use on the work periods of a legacy organization", async () => {
		await admin.query("delete from time_entry_append_control where organization_id = $1", [
			ids.organization,
		]);

		const result = await generateDemo();

		expect(result).toEqual({
			success: true,
			data: { vehicleUseRecorded: workPeriodsPerEmployee, drivingDetailsMissing: 1 },
		});
		const { rows } = await admin.query<{ with_vehicle_use: number }>(
			`select count(*)::int as with_vehicle_use from work_period
			 where organization_id = $1 and employee_id = $2 and vehicle_kind = 'organization'`,
			[ids.organization, ids.driver],
		);
		expect(only(rows).with_vehicle_use).toBe(workPeriodsPerEmployee);
		await expectRecordAgreement({ organizationId: ids.organization });
	});

	it("leaves vehicle use alone in an organization that switched it off", async () => {
		await admin.query(
			"insert into vehicle_use_setting (organization_id, enabled) values ($1, false)",
			[ids.organization],
		);
		await admin.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, 'expected', $2)`,
			[ids.organization, ids.adminUser],
		);

		const result = await generateDemo();

		expect(result).toEqual({
			success: true,
			data: { vehicleUseRecorded: 0, drivingDetailsMissing: 0 },
		});
		const { rows } = await admin.query<{ enabled: boolean; assignments: number }>(
			`select s.enabled,
			        (select count(*)::int from vehicle_use_assignment where organization_id = $1) as assignments
			 from vehicle_use_setting s where s.organization_id = $1`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ enabled: false, assignments: 1 });
	});

	it("a demo reset removes the demo vehicle use with the demo work, vehicles and team", async () => {
		await generateDemo();

		expect(await clearTimeDataAction(ids.organization)).toMatchObject({
			success: true,
			data: { vehiclesDeleted: 3, teamsDeleted: 1 },
		});
		const { rows } = await admin.query<{ assignments: number; vehicles: number }>(
			`select (select count(*)::int from vehicle_use_assignment where organization_id = $1) as assignments,
			        (select count(*)::int from organization_vehicle where organization_id = $1) as vehicles`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ assignments: 0, vehicles: 0 });
	});
});
