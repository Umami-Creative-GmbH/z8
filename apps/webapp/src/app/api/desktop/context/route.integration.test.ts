/**
 * #875 contract: the desktop context offers each listed project's open tasks.
 *
 * The real `GET /api/desktop/context` handler reads a label-owned PostgreSQL
 * database. Only the session, the SSO session check and the Next runtime are
 * replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

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
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: async () => true,
}));

const route = await import("./route");

const ids = {
	organization: "t875-desktop-context-org",
	otherOrganization: "t875-desktop-context-other-org",
	user: "t875-desktop-context-user",
	employee: "f8750000-0000-4000-8000-000000000001",
	otherEmployee: "f8750000-0000-4000-8000-000000000002",
	projectA: "f8750000-0000-4000-8000-0000000000a1",
	projectB: "f8750000-0000-4000-8000-0000000000b1",
	unassigned: "f8750000-0000-4000-8000-0000000000c1",
	otherOrganizationProject: "f8750000-0000-4000-8000-0000000000d1",
} as const;

describe("desktop context project tasks on PostgreSQL (#875)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			// The context lists projects only where the organization has them enabled.
			`insert into organization (id, name, slug, created_at, projects_enabled) values
			 ($1, 'T875 desktop', $1, $3, true), ($2, 'T875 other', $2, $3, true)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Desktop user', 't875-desktop@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t875-member', $1, $3, 'member', 'approved', $4),
			 ('t875-member-other', $2, $3, 'member', 'approved', $4)`,
			[ids.organization, ids.otherOrganization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $3, $4, 'employee', $6), ($2, $3, $5, 'employee', $6)`,
			[
				ids.employee,
				ids.otherEmployee,
				ids.user,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $5, 'Alpha', 'active', true, $7, $8),
			 ($2, $5, 'Beta', 'active', true, $7, $8),
			 ($3, $5, 'Unassigned', 'active', true, $7, $8),
			 ($4, $6, 'Foreign', 'active', true, $7, $8)`,
			[
				ids.projectA,
				ids.projectB,
				ids.unassigned,
				ids.otherOrganizationProject,
				ids.organization,
				ids.otherOrganization,
				ids.user,
				timestamp,
			],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values (gen_random_uuid(), $1, $4, 'employee', $5, $7),
			        (gen_random_uuid(), $2, $4, 'employee', $5, $7),
			        (gen_random_uuid(), $3, $6, 'employee', $8, $7)`,
			[
				ids.projectA,
				ids.projectB,
				ids.otherOrganizationProject,
				ids.organization,
				ids.employee,
				ids.otherOrganization,
				ids.user,
				ids.otherEmployee,
			],
		);
		await admin.query(
			`insert into project_task
			 (id, organization_id, project_id, name, state, done_at, done_by, created_by, updated_at) values
			 ('f8750000-0000-4000-8000-0000000000a2', $1, $3, 'design', 'open', null, null, $6, now()),
			 ('f8750000-0000-4000-8000-0000000000a3', $1, $3, 'Build', 'open', null, null, $6, now()),
			 ('f8750000-0000-4000-8000-0000000000a4', $1, $3, 'Shipped', 'done', now(), $6, $6, now()),
			 ('f8750000-0000-4000-8000-0000000000c2', $1, $4, 'Hidden', 'open', null, null, $6, now()),
			 ('f8750000-0000-4000-8000-0000000000d2', $2, $5, 'Foreign task', 'open', null, null, $6, now())`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.projectA,
				ids.unassigned,
				ids.otherOrganizationProject,
				ids.user,
			],
		);
	}

	async function startWork(taskId: string | null, otherOrganization = false) {
		const organizationId = otherOrganization
			? ids.otherOrganization
			: ids.organization;
		const employeeId = otherOrganization ? ids.otherEmployee : ids.employee;
		const projectId = otherOrganization
			? ids.otherOrganizationProject
			: ids.projectA;
		const [entry] = (
			await admin.query(
				`insert into time_entry
			 (employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values ($1, $2, 'clock_in', now(), 0, 'UTC', 'user_setting', 't930-context', $3) returning id`,
				[employeeId, organizationId, ids.user],
			)
		).rows;
		await admin.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, project_id, task_id, start_time, updated_at)
			 values ($1, $2, $3, $4, $5, now(), now())`,
			[employeeId, organizationId, entry.id, projectId, taskId],
		);
	}

	it("reports the task already on live work even after it is done (#930)", async () => {
		await startWork("f8750000-0000-4000-8000-0000000000a4");

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.liveWork.currentTask).toEqual({
			id: "f8750000-0000-4000-8000-0000000000a4",
			name: "Shipped",
		});
	});
	it("reports an open task on live work (#930)", async () => {
		await startWork("f8750000-0000-4000-8000-0000000000a3");
		const context = await read();
		expect(context.status).toBe(200);
		expect(context.body.liveWork.currentTask).toEqual({
			id: "f8750000-0000-4000-8000-0000000000a3",
			name: "Build",
		});
	});

	it("reports no current task for taskless live work (#930)", async () => {
		await startWork(null);
		const context = await read();
		expect(context.status).toBe(200);
		expect(context.body.liveWork.currentTask).toBeNull();
	});

	it("reads only the active organization's live work and task (#930)", async () => {
		await startWork("f8750000-0000-4000-8000-0000000000a3");
		await startWork("f8750000-0000-4000-8000-0000000000d2", true);
		harness.organizationId = ids.otherOrganization;
		const context = await read();
		expect(context.status).toBe(200);
		expect(context.body.liveWork.currentTask).toEqual({
			id: "f8750000-0000-4000-8000-0000000000d2",
			name: "Foreign task",
		});
	});
	async function read() {
		const response = await route.GET();
		return {
			status: response.status,
			body: (await response.json()) as Record<string, any>,
		};
	}

	beforeEach(async () => {
		harness.userId = ids.user;
		harness.organizationId = ids.organization;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it.each(["planned", "active", "paused"])(
		"offers each assigned %s project's open tasks by name, and nothing else",
		async (status) => {
			await admin.query("update project set status = $1 where id = $2", [status, ids.projectA]);
			const context = await read();

			expect(context.status).toBe(200);
			expect(context.body.liveWork).toBeNull();
			expect(context.body.projects).toEqual([
				{
					id: ids.projectA,
					name: "Alpha",
					tasks: [
						{ id: "f8750000-0000-4000-8000-0000000000a3", name: "Build" },
						{ id: "f8750000-0000-4000-8000-0000000000a2", name: "design" },
					],
				},
				{ id: ids.projectB, name: "Beta", tasks: [] },
			]);
		},
	);

	it.each(["completed", "archived"])(
		"does not offer an assigned %s project or its open tasks (#929)",
		async (status) => {
			await admin.query("update project set status = $1 where id = $2", [status, ids.projectA]);

			const context = await read();

			expect(context.status).toBe(200);
			expect(context.body.projects).toEqual([{ id: ids.projectB, name: "Beta", tasks: [] }]);
		},
	);

	it("does not offer an inactive assigned project (#929)", async () => {
		await admin.query("update project set is_active = false where id = $1", [ids.projectA]);

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.projects).toEqual([{ id: ids.projectB, name: "Beta", tasks: [] }]);
	});

	it("offers no projects when the organization has projects disabled (#929)", async () => {
		await admin.query("update organization set projects_enabled = false where id = $1", [
			ids.organization,
		]);

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.projectsEnabled).toBe(false);
		expect(context.body.projects).toEqual([]);
	});

	it("offers team assignments once, with open tasks and projects by name (#929)", async () => {
		const teamId = "f9290000-0000-4000-8000-000000000001";
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Desktop team', now())",
			[teamId, ids.organization],
		);
		await admin.query("update employee set team_id = $1 where id = $2", [teamId, ids.employee]);
		await admin.query(
			`insert into project_assignment (project_id, organization_id, assignment_type, team_id, created_by)
			 values ($1, $3, 'team', $4, $5), ($2, $3, 'team', $4, $5)`,
			[ids.projectA, ids.unassigned, ids.organization, teamId, ids.user],
		);
		await admin.query("update project set name = 'Zulu' where id = $1", [ids.projectA]);

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.projects.map((project: { id: string }) => project.id)).toEqual([
			ids.projectB,
			ids.unassigned,
			ids.projectA,
		]);
		expect(context.body.projects[1].tasks).toEqual([
			{ id: "f8750000-0000-4000-8000-0000000000c2", name: "Hidden" },
		]);
	});

	it("reads only the active organization's projects and tasks", async () => {
		harness.organizationId = ids.otherOrganization;

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.liveWork).toBeNull();
		expect(context.body.projects).toEqual([
			{
				id: ids.otherOrganizationProject,
				name: "Foreign",
				tasks: [
					{ id: "f8750000-0000-4000-8000-0000000000d2", name: "Foreign task" },
				],
			},
		]);
	});
});

describe("desktop context vehicle use on PostgreSQL (#1124)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const vehicles = {
		alpha: "f1124000-0000-4000-8000-0000000000a1",
		zulu: "f1124000-0000-4000-8000-0000000000a2",
		archived: "f1124000-0000-4000-8000-0000000000a3",
		foreign: "f1124000-0000-4000-8000-0000000000a4",
	} as const;

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T1124 desktop', $1, $3), ($2, 'T1124 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Desktop user', 't1124-desktop@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1124-member', $1, $3, 'member', 'approved', $4),
			 ('t1124-member-other', $2, $3, 'member', 'approved', $4)`,
			[ids.organization, ids.otherOrganization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $3, $4, 'employee', $6), ($2, $3, $5, 'employee', $6)`,
			[
				ids.employee,
				ids.otherEmployee,
				ids.user,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
	}

	async function enable(organizationId: string, mode: "asked" | "expected") {
		await admin.query(
			"insert into vehicle_use_setting (organization_id, enabled) values ($1, true)",
			[organizationId],
		);
		await admin.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, $2, $3)`,
			[organizationId, mode, ids.user],
		);
	}

	async function addVehicles() {
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
			 ($1, $5, 'Alpha van', 'M-AV 1', null),
			 ($2, $5, 'Zulu van', 'M-ZV 2', null),
			 ($3, $5, 'Old van', 'M-OV 3', now()),
			 ($4, $6, 'Foreign van', 'B-FV 4', null)`,
			[
				vehicles.alpha,
				vehicles.zulu,
				vehicles.archived,
				vehicles.foreign,
				ids.organization,
				ids.otherOrganization,
			],
		);
		// The employee is the assigned driver of the Zulu van.
		await admin.query(
			`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id)
			 values ($1, $2, $3)`,
			[ids.organization, vehicles.zulu, ids.employee],
		);
	}

	/** Work of the employee in the active organization, completed or live. */
	async function work(
		vehicleId: string,
		readings: { startKm: number; endKm: number | null },
		live: boolean,
	) {
		const [entry] = (
			await admin.query(
				`insert into time_entry
				 (employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, 'clock_in', now() - interval '3 hours', 0, 'UTC', 'user_setting', 't1124-context', $3)
				 returning id`,
				[ids.employee, ids.organization, ids.user],
			)
		).rows;
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`insert into work_period
				 (employee_id, organization_id, clock_in_id, start_time, end_time, duration_minutes, is_active,
				  vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km, driven_distance_km, updated_at)
				 values ($1, $2, $3, now() - interval '3 hours', $4, $5, $6, 'organization', $7, $8, $9, $10, now())`,
				[
					ids.employee,
					ids.organization,
					entry.id,
					live ? null : new Date(Date.now() - 2 * 60 * 60_000),
					live ? null : 60,
					live,
					vehicleId,
					readings.startKm,
					readings.endKm,
					readings.endKm === null ? null : readings.endKm - readings.startKm,
				],
			),
		);
	}

	async function read() {
		const response = await route.GET();
		return {
			status: response.status,
			body: (await response.json()) as Record<string, any>,
		};
	}

	beforeEach(async () => {
		harness.userId = ids.user;
		harness.organizationId = ids.organization;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("asks nothing and lists no vehicles while vehicle use is off", async () => {
		await addVehicles();

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.vehicleUse).toEqual({
			mode: "off",
			vehicles: [],
			suggestedVehicleIds: [],
			lastEndKmByVehicleId: {},
			live: null,
		});
	});

	it("gives the mode, only the organization's active vehicles with the assigned one first, and the pre-fill reading", async () => {
		await enable(ids.organization, "expected");
		await enable(ids.otherOrganization, "asked");
		await addVehicles();
		await work(vehicles.zulu, { startKm: 12_000, endKm: 12_040 }, false);

		const context = await read();

		expect(context.status).toBe(200);
		expect(context.body.vehicleUse).toEqual({
			mode: "expected",
			vehicles: [
				{ id: vehicles.zulu, name: "Zulu van", licencePlate: "M-ZV 2" },
				{ id: vehicles.alpha, name: "Alpha van", licencePlate: "M-AV 1" },
			],
			suggestedVehicleIds: [vehicles.zulu],
			lastEndKmByVehicleId: { [vehicles.zulu]: 12_040 },
			live: null,
		});
	});

	it("gives the live work's vehicle use while clocked in", async () => {
		await enable(ids.organization, "asked");
		await addVehicles();
		await work(vehicles.alpha, { startKm: 500, endKm: null }, true);

		const context = await read();

		expect(context.body.vehicleUse.live).toEqual({
			vehicle: { kind: "organization", vehicleId: vehicles.alpha },
			startKm: 500,
			endKm: null,
			distanceKm: null,
		});
	});

	it("reads only the active organization's vehicles", async () => {
		await enable(ids.otherOrganization, "asked");
		await addVehicles();
		harness.organizationId = ids.otherOrganization;

		const context = await read();

		expect(context.body.vehicleUse).toMatchObject({
			mode: "asked",
			vehicles: [{ id: vehicles.foreign, name: "Foreign van", licencePlate: "B-FV 4" }],
			suggestedVehicleIds: [],
		});
	});
});