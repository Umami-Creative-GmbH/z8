/**
 * #1127 (spec #807): which work shows "driving details missing", read on PostgreSQL. Work is
 * recorded through the clocking service; vehicle use and the configuration are written directly.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	createClockingService,
	createDatabaseClockingStore,
} from "@/lib/time-tracking/clocking-core";
import {
	countDrivingDetailsMissing,
	listDrivingDetailsMissing,
} from "./driving-details-missing-store";
import { loadTeamDrivingDetails } from "./driving-details-team-store";

vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const at = parseInstant;

describe("driving details missing on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	async function organization() {
		const organizationId = await fixture.createOrganization();
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		return { organizationId, creatorUserId: creator.userId };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	async function switchOn(org: Org, enabled = true, since = "2026-09-01T00:00:00Z") {
		await fixture.pool.query(
			`insert into vehicle_use_setting (organization_id, enabled, updated_at) values ($1, $2, $3)
			 on conflict (organization_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`,
			[org.organizationId, enabled, new Date(since)],
		);
	}

	async function assign(
		org: Org,
		target: { type: "organization" } | { type: "employee"; employeeId: string },
		mode: "off" | "asked" | "expected",
		since = "2026-09-01T00:00:00Z",
	) {
		await fixture.pool.query(
			`insert into vehicle_use_assignment
			 (id, organization_id, assignment_type, employee_id, priority, mode, created_by, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
			[
				randomUUID(),
				org.organizationId,
				target.type,
				target.type === "employee" ? target.employeeId : null,
				target.type === "employee" ? 2 : 0,
				mode,
				org.creatorUserId,
				new Date(since),
			],
		);
	}

	function clocking() {
		return createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
	}
	const action = (instant: string) => ({
		instant: at(instant),
		timezone: "Europe/Berlin",
		utcOffsetMinutes: 120,
		timezoneSource: "user_setting" as const,
	});

	/** Records work through the clocking service and returns its work period id. */
	async function work(org: Org, person: SeededEmployee, start: string, end: string | null) {
		const opened = await clocking().clockIn({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			createdBy: person.userId,
			action: action(start),
			source: { deviceInfo: "test", ipAddress: null },
			workLocationType: "office",
		});
		if (!("period" in opened)) throw new Error("Expected live work");
		if (end) {
			await clocking().clockOut({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				createdBy: person.userId,
				action: action(end),
				source: { deviceInfo: "test", ipAddress: null },
			});
		}
		const { rows } = await fixture.pool.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and start_time = $2",
			[person.employeeId, new Date(start)],
		);
		return rows[0].id;
	}

	async function recordVehicleUse(
		workPeriodId: string,
		use: { startKm: number | null; endKm: number | null; distanceKm: number | null },
	) {
		await fixture.pool.query(
			`update work_period set vehicle_kind = 'own', odometer_start_km = $2, odometer_end_km = $3,
			 driven_distance_km = $4 where id = $1`,
			[workPeriodId, use.startKm, use.endKm, use.distanceKm],
		);
	}

	const flagged = async (org: Org, employeeIds: string[] | null = null) =>
		(
			await listDrivingDetailsMissing(fixture.db, {
				organizationId: org.organizationId,
				employeeIds,
			})
		)
			.map((row) => row.workPeriodId)
			.toSorted();

	it("flags only completed work of employees expected to record vehicle use, and clears it once completed", async () => {
		const org = await organization();
		const driver = await fixture.seedEmployee({ organizationId: org.organizationId });
		const asked = await fixture.seedEmployee({ organizationId: org.organizationId });
		await switchOn(org);
		await assign(org, { type: "organization" }, "expected");
		await assign(org, { type: "employee", employeeId: asked.employeeId }, "asked");

		const noVehicle = await work(org, driver, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		const noEndReading = await work(org, driver, "2026-09-08T06:00:00Z", "2026-09-08T14:00:00Z");
		const complete = await work(org, driver, "2026-09-09T06:00:00Z", "2026-09-09T14:00:00Z");
		const enteredDistance = await work(org, driver, "2026-09-10T06:00:00Z", "2026-09-10T14:00:00Z");
		await work(org, driver, "2026-09-11T06:00:00Z", null);
		await work(org, asked, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await recordVehicleUse(noEndReading, { startKm: 1000, endKm: null, distanceKm: null });
		await recordVehicleUse(complete, { startKm: 1000, endKm: 1080, distanceKm: 80 });
		await recordVehicleUse(enteredDistance, { startKm: null, endKm: null, distanceKm: 35 });

		expect(await flagged(org)).toEqual([noVehicle, noEndReading].toSorted());
		const [row] = await listDrivingDetailsMissing(fixture.db, {
			organizationId: org.organizationId,
			employeeIds: [driver.employeeId],
			workPeriodIds: [noVehicle],
		});
		expect(row).toMatchObject({
			workPeriodId: noVehicle,
			employeeId: driver.employeeId,
			startedAt: "2026-09-07T06:00:00Z",
			endedAt: "2026-09-07T14:00:00Z",
			startOffsetMinutes: 120,
			endOffsetMinutes: 120,
			workDay: "2026-09-07",
			vehicleUse: null,
		});

		await recordVehicleUse(noEndReading, { startKm: 1000, endKm: 1042, distanceKm: 42 });
		expect(await flagged(org)).toEqual([noVehicle]);
	});

	it("flags nothing with the organization switch off, and only work started since the expectation began", async () => {
		const org = await organization();
		const driver = await fixture.seedEmployee({ organizationId: org.organizationId });
		await switchOn(org, true, "2026-09-01T00:00:00Z");
		await assign(
			org,
			{ type: "employee", employeeId: driver.employeeId },
			"expected",
			"2026-09-08T00:00:00Z",
		);
		await work(org, driver, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		const since = await work(org, driver, "2026-09-08T06:00:00Z", "2026-09-08T14:00:00Z");

		expect(await flagged(org)).toEqual([since]);

		await switchOn(org, false);
		expect(await flagged(org)).toEqual([]);
	});

	it("reads only the organization's work of the employees in scope", async () => {
		const org = await organization();
		const other = await organization();
		const managed = await fixture.seedEmployee({ organizationId: org.organizationId });
		const unmanaged = await fixture.seedEmployee({ organizationId: org.organizationId });
		const foreign = await fixture.seedEmployee({ organizationId: other.organizationId });
		for (const tenant of [org, other]) {
			await switchOn(tenant);
			await assign(tenant, { type: "organization" }, "expected");
		}
		const mine = await work(org, managed, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await work(org, unmanaged, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await work(other, foreign, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");

		expect(await flagged(org, [managed.employeeId, foreign.employeeId])).toEqual([mine]);
		expect(await flagged(org, [])).toEqual([]);
	});
	it("lists a manager only their employees' flagged work, filtered by team and employee", async () => {
		const org = await organization();
		const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
		const north = await fixture.seedEmployee({ organizationId: org.organizationId });
		const south = await fixture.seedEmployee({ organizationId: org.organizationId });
		const unmanaged = await fixture.seedEmployee({ organizationId: org.organizationId });
		const [northTeam, southTeam] = [randomUUID(), randomUUID()];
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $3, 'North', now()), ($2, $3, 'South', now())`,
			[northTeam, southTeam, org.organizationId],
		);
		await fixture.pool.query("update employee set team_id = $2 where id = $1", [
			north.employeeId,
			northTeam,
		]);
		await fixture.pool.query("update employee set team_id = $2 where id = $1", [
			south.employeeId,
			southTeam,
		]);
		for (const person of [north, south]) {
			await fixture.pool.query(
				`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, $3, true, $4)`,
				[randomUUID(), person.employeeId, manager.employeeId, org.creatorUserId],
			);
		}
		await switchOn(org);
		await assign(org, { type: "organization" }, "expected");
		const northWork = await work(org, north, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		const southWork = await work(org, south, "2026-09-08T06:00:00Z", "2026-09-08T14:00:00Z");
		await work(org, unmanaged, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await recordVehicleUse(southWork, { startKm: 500, endKm: null, distanceKm: null });

		const load = (filters: { teamId?: string; employeeId?: string } = {}) =>
			loadTeamDrivingDetails(fixture.db, {
				organizationId: org.organizationId,
				scope: { kind: "managed", managerEmployeeId: manager.employeeId },
				filters: { teamId: filters.teamId ?? null, employeeId: filters.employeeId ?? null },
			});

		const all = await load();
		expect(all.rows.map((row) => [row.workPeriodId, row.missing, row.teamName])).toEqual([
			[southWork, "end_reading", "South"],
			[northWork, "vehicle", "North"],
		]);
		expect(all.teams.map((team) => team.name)).toEqual(["North", "South"]);
		expect(all.employees.map((person) => person.id).toSorted()).toEqual(
			[north.employeeId, south.employeeId].toSorted(),
		);
		expect((await load({ teamId: northTeam })).rows.map((row) => row.workPeriodId)).toEqual([
			northWork,
		]);
		expect(
			(await load({ employeeId: south.employeeId })).rows.map((row) => row.workPeriodId),
		).toEqual([southWork]);
		// An employee outside the manager's scope is not a filter they can apply.
		const outside = await load({ employeeId: unmanaged.employeeId });
		expect(outside.filters.employeeId).toBeNull();
		expect(outside.rows).toHaveLength(2);
	});

	it("counts the flagged work of active employees in SQL, matching the list (/today)", async () => {
		const org = await organization();
		const active = await fixture.seedEmployee({ organizationId: org.organizationId });
		const inactive = await fixture.seedEmployee({ organizationId: org.organizationId });
		await switchOn(org);
		await assign(org, { type: "organization" }, "expected");
		await work(org, active, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await work(org, active, "2026-09-08T06:00:00Z", "2026-09-08T14:00:00Z");
		await work(org, inactive, "2026-09-07T06:00:00Z", "2026-09-07T14:00:00Z");
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			inactive.employeeId,
		]);
		const employeeIds = [active.employeeId, inactive.employeeId];

		await expect(
			countDrivingDetailsMissing(fixture.db, { organizationId: org.organizationId, employeeIds }),
		).resolves.toBe(2);
		const listed = await loadTeamDrivingDetails(fixture.db, {
			organizationId: org.organizationId,
			scope: { kind: "all" },
			filters: { teamId: null, employeeId: null },
		});
		expect(listed.rows).toHaveLength(2);
		await expect(
			countDrivingDetailsMissing(fixture.db, {
				organizationId: org.organizationId,
				employeeIds: [],
			}),
		).resolves.toBe(0);
	});
});
