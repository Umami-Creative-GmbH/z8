/**
 * #1118: org admins manage organization vehicles and their assigned drivers, on
 * PostgreSQL.
 *
 * The real server actions, vehicle store, constraints and audit trail run against
 * a disposable database. Only the request/session, SSO session store, Next cache
 * and logger are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

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
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock(
	"@/lib/organization-mfa/organization-access",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/organization-mfa/organization-access")
		>()),
		canAccessOrganization: async () => true,
	}),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		}),
	}),
}));

const { changeVehicles, getVehicleSettings } = await import("./actions");

const ids = {
	organization: "t1118-org",
	otherOrganization: "t1118-other-org",
	ownerUser: "t1118-owner-user",
	adminUser: "t1118-admin-user",
	managerUser: "t1118-manager-user",
	employeeAdminUser: "t1118-employee-admin-user",
	memberUser: "t1118-member-user",
	otherOwnerUser: "t1118-other-owner-user",
	otherMemberUser: "t1118-other-member-user",
	managerEmployee: "11180000-0000-4000-8000-000000000001",
	memberEmployee: "11180000-0000-4000-8000-000000000002",
	employeeAdminEmployee: "11180000-0000-4000-8000-000000000003",
	otherEmployee: "11180000-0000-4000-8000-000000000004",
	fieldTeam: "11180000-0000-4000-8000-0000000000a1",
	officeTeam: "11180000-0000-4000-8000-0000000000a2",
	otherTeam: "11180000-0000-4000-8000-0000000000a3",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.employeeAdminUser,
	ids.memberUser,
	ids.otherOwnerUser,
	ids.otherMemberUser,
];

type Change = Parameters<typeof changeVehicles>[0];
type Settings = Awaited<ReturnType<typeof getVehicleSettings>> & {
	success: true;
};
type Vehicle = Settings["data"]["vehicles"][number];

const noDrivers = { employeeIds: [], teamIds: [] };

describe("organization vehicles on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("drop table if exists t1118_vehicle_use_probe");
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	/** Applies a change that must succeed, returning every vehicle of the org. */
	async function apply(change: Change): Promise<Vehicle[]> {
		const result = await changeVehicles(change);
		if (!result.success) throw new Error(`action failed: ${result.error}`);
		if (!result.data.ok)
			throw new Error(`change refused: ${result.data.reason}`);
		return result.data.vehicles;
	}

	async function refusal(change: Change) {
		const result = await changeVehicles(change);
		if (!result.success) throw new Error(`action failed: ${result.error}`);
		return result.data.ok ? "accepted" : result.data.reason;
	}

	async function create(
		name: string,
		licencePlate: string,
		drivers: { employeeIds: string[]; teamIds: string[] } = noDrivers,
	): Promise<Vehicle> {
		const vehicles = await apply({
			kind: "create",
			name,
			licencePlate,
			drivers,
		});
		const created = vehicles.find((vehicle) => vehicle.name === name);
		if (!created) throw new Error("created vehicle missing");
		return created;
	}

	async function listed(): Promise<Vehicle[]> {
		const result = await getVehicleSettings();
		if (!result.success) throw new Error(`action failed: ${result.error}`);
		return result.data.vehicles;
	}

	async function auditEntries(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			changes: string | null;
		}>(
			`select action, entity_type, entity_id, performed_by, changes from audit_log
			 where organization_id = $1 and entity_type = 'vehicle'
			 order by timestamp, action, entity_id`,
			[organizationId],
		);
		return rows.map((row) => ({
			...row,
			changes: row.changes ? JSON.parse(row.changes) : null,
		}));
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T1118', $1, $3), ($2, 'T1118 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, initcap(replace(user_id, '-', ' ')), user_id || '@example.test', $2, $2
			 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1118-m-owner', $1, $3, 'owner', 'approved', $10),
			 ('t1118-m-admin', $1, $4, 'admin', 'approved', $10),
			 ('t1118-m-manager', $1, $5, 'member', 'approved', $10),
			 ('t1118-m-employee-admin', $1, $6, 'member', 'approved', $10),
			 ('t1118-m-member', $1, $7, 'member', 'approved', $10),
			 ('t1118-m-other-owner', $2, $8, 'owner', 'approved', $10),
			 ('t1118-m-other-member', $2, $9, 'member', 'approved', $10),
			 ('t1118-m-admin-in-other', $2, $4, 'member', 'approved', $10)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.employeeAdminUser,
				ids.memberUser,
				ids.otherOwnerUser,
				ids.otherMemberUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, first_name, last_name, role, updated_at) values
			 ($1, $5, $9, 'Mia', 'Manager', 'manager', $11),
			 ($2, $6, $9, 'Max', 'Member', 'employee', $11),
			 ($3, $7, $9, 'Eve', 'EmployeeAdmin', 'admin', $11),
			 ($4, $8, $10, 'Olga', 'Other', 'employee', $11)`,
			[
				ids.managerEmployee,
				ids.memberEmployee,
				ids.employeeAdminEmployee,
				ids.otherEmployee,
				ids.managerUser,
				ids.memberUser,
				ids.employeeAdminUser,
				ids.otherMemberUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $4, 'Field service', $5), ($2, $4, 'Office', $5), ($3, $6, 'Other team', $5)`,
			[
				ids.fieldTeam,
				ids.officeTeam,
				ids.otherTeam,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	describe("managing vehicles", () => {
		it("creates a vehicle with assigned employees and teams, and audits it", async () => {
			const van = await create("Van 1", " m-ab 1234 ", {
				employeeIds: [ids.memberEmployee],
				teamIds: [ids.fieldTeam],
			});

			expect(van).toMatchObject({
				name: "Van 1",
				licencePlate: "M-AB 1234",
				archived: false,
				drivers: {
					employees: [{ id: ids.memberEmployee, name: "T1118 Member User" }],
					teams: [{ id: ids.fieldTeam, name: "Field service" }],
				},
			});
			const settings = (await getVehicleSettings()) as Settings;
			expect(settings.data.teams.map((t) => t.name)).toEqual([
				"Field service",
				"Office",
			]);
			expect(settings.data.employees.map((e) => e.id).toSorted()).toEqual(
				[
					ids.managerEmployee,
					ids.memberEmployee,
					ids.employeeAdminEmployee,
				].toSorted(),
			);
			expect(await auditEntries()).toEqual([
				{
					action: "vehicle.created",
					entity_type: "vehicle",
					entity_id: van.id,
					performed_by: ids.adminUser,
					changes: {
						after: {
							name: "Van 1",
							licencePlate: "M-AB 1234",
							drivers: {
								employeeIds: [ids.memberEmployee],
								teamIds: [ids.fieldTeam],
							},
						},
					},
				},
			]);
		});

		it("edits name, plate and drivers, auditing only what changed", async () => {
			const van = await create("Van 1", "M-AB 1234", {
				employeeIds: [ids.memberEmployee],
				teamIds: [ids.fieldTeam],
			});

			const vehicles = await apply({
				kind: "update",
				vehicleId: van.id,
				name: "Van 1",
				licencePlate: "M-XY 9",
				drivers: {
					employeeIds: [ids.managerEmployee],
					teamIds: [ids.fieldTeam],
				},
			});

			expect(vehicles.find((v) => v.id === van.id)).toMatchObject({
				licencePlate: "M-XY 9",
				drivers: {
					employees: [{ id: ids.managerEmployee }],
					teams: [{ id: ids.fieldTeam }],
				},
			});
			const entries = await auditEntries();
			expect(entries.map((e) => e.action)).toEqual([
				"vehicle.created",
				"vehicle.updated",
			]);
			expect(entries[1].changes).toEqual({
				before: {
					licencePlate: "M-AB 1234",
					drivers: {
						employeeIds: [ids.memberEmployee],
						teamIds: [ids.fieldTeam],
					},
				},
				after: {
					licencePlate: "M-XY 9",
					drivers: {
						employeeIds: [ids.managerEmployee],
						teamIds: [ids.fieldTeam],
					},
				},
			});

			await apply({
				kind: "update",
				vehicleId: van.id,
				name: "Van 1",
				licencePlate: "m-xy 9",
				drivers: {
					employeeIds: [ids.managerEmployee],
					teamIds: [ids.fieldTeam],
				},
			});
			expect(await auditEntries()).toHaveLength(2);
		});

		it("keeps licence plates unique per organization, archived vehicles included", async () => {
			const van = await create("Van 1", "M-AB 1234");
			const car = await create("Car", "B-C 1");

			expect(
				await refusal({
					kind: "create",
					name: "Twin",
					licencePlate: "m ab-1234",
				}),
			).toBe("licence_plate_taken");
			expect(
				await refusal({
					kind: "update",
					vehicleId: car.id,
					name: "Car",
					licencePlate: "MAB 1234",
					drivers: noDrivers,
				}),
			).toBe("licence_plate_taken");
			await apply({ kind: "archive", vehicleId: van.id });
			expect(
				await refusal({
					kind: "create",
					name: "Twin",
					licencePlate: "M-AB-1234",
				}),
			).toBe("licence_plate_taken");

			actAs(ids.otherOwnerUser, ids.otherOrganization);
			expect((await create("Their van", "M-AB 1234")).licencePlate).toBe(
				"M-AB 1234",
			);
		});

		it("archives and restores a vehicle; an archived vehicle is listed last and not edited", async () => {
			const van = await create("Van", "M-AB 1");
			await create("Bus", "M-AB 2");

			const archived = await apply({ kind: "archive", vehicleId: van.id });
			expect(archived.map((v) => [v.name, v.archived])).toEqual([
				["Bus", false],
				["Van", true],
			]);
			expect(
				await refusal({
					kind: "update",
					vehicleId: van.id,
					name: "Van 2",
					licencePlate: "M-AB 1",
					drivers: noDrivers,
				}),
			).toBe("vehicle_archived");

			const restored = await apply({ kind: "restore", vehicleId: van.id });
			expect(restored.find((v) => v.id === van.id)?.archived).toBe(false);
			expect(
				(await auditEntries())
					.filter((e) => e.entity_id === van.id)
					.map((e) => e.action),
			).toEqual(["vehicle.created", "vehicle.archived", "vehicle.restored"]);
		});

		it("deletes a vehicle that was never recorded on work, with its drivers", async () => {
			const van = await create("Van", "M-AB 1", {
				employeeIds: [ids.memberEmployee],
				teamIds: [ids.fieldTeam],
			});

			expect(await apply({ kind: "delete", vehicleId: van.id })).toEqual([]);
			const { rows } = await admin.query(
				"select count(*)::int as count from organization_vehicle_driver where vehicle_id = $1",
				[van.id],
			);
			expect(rows[0].count).toBe(0);
			expect((await auditEntries()).at(-1)).toMatchObject({
				action: "vehicle.deleted",
				entity_id: van.id,
				changes: { before: { name: "Van", licencePlate: "M-AB 1" } },
			});
		});

		it("refuses to delete a vehicle recorded on work, which can still be archived", async () => {
			const van = await create("Van", "M-AB 1");
			// Any table recording vehicle use references the vehicle without a cascade.
			await admin.query(
				`create table t1118_vehicle_use_probe (
					vehicle_id uuid not null,
					organization_id text not null,
					foreign key (vehicle_id, organization_id)
						references organization_vehicle (id, organization_id)
				)`,
			);
			await admin.query(
				"insert into t1118_vehicle_use_probe (vehicle_id, organization_id) values ($1, $2)",
				[van.id, ids.organization],
			);

			expect(await refusal({ kind: "delete", vehicleId: van.id })).toBe(
				"vehicle_used",
			);
			expect((await listed()).map((v) => v.id)).toEqual([van.id]);
			expect((await auditEntries()).map((e) => e.action)).toEqual([
				"vehicle.created",
			]);
			expect(
				(await apply({ kind: "archive", vehicleId: van.id }))[0].archived,
			).toBe(true);
		});

		it("drops a team's driver assignment when the team is deleted", async () => {
			const van = await create("Van", "M-AB 1", {
				employeeIds: [ids.memberEmployee],
				teamIds: [ids.officeTeam],
			});
			await admin.query("delete from team where id = $1", [ids.officeTeam]);

			expect((await listed()).find((v) => v.id === van.id)?.drivers).toEqual({
				employees: [{ id: ids.memberEmployee, name: "T1118 Member User" }],
				teams: [],
			});
		});
	});

	describe("permissions", () => {
		it("lets owners and admins manage vehicles", async () => {
			actAs(ids.ownerUser);
			expect(
				await refusal({ kind: "create", name: "Van", licencePlate: "M-AB 1" }),
			).toBe("accepted");
			expect((await getVehicleSettings()).success).toBe(true);
		});

		it("refuses managers, employee-role admins and employees", async () => {
			for (const user of [
				ids.managerUser,
				ids.employeeAdminUser,
				ids.memberUser,
			]) {
				actAs(user);
				expect(await getVehicleSettings()).toMatchObject({
					success: false,
					code: "AuthorizationError",
				});
				expect(
					await changeVehicles({
						kind: "create",
						name: "Van",
						licencePlate: "M-AB 1",
					}),
				).toMatchObject({ success: false, code: "AuthorizationError" });
			}
			const { rows } = await admin.query(
				"select count(*)::int as count from organization_vehicle",
			);
			expect(rows[0].count).toBe(0);
		});

		it("refuses an admin acting in an organization where they are only a member", async () => {
			actAs(ids.adminUser, ids.otherOrganization);
			expect(
				await changeVehicles({
					kind: "create",
					name: "Van",
					licencePlate: "M-AB 1",
				}),
			).toMatchObject({ success: false, code: "AuthorizationError" });
		});
	});

	describe("organization scoping", () => {
		it("never reads or changes another organization's vehicles", async () => {
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			const foreign = await create("Foreign", "F-X 1", {
				employeeIds: [ids.otherEmployee],
				teamIds: [ids.otherTeam],
			});

			actAs(ids.adminUser);
			await create("Own", "O-X 1");
			const settings = (await getVehicleSettings()) as Settings;
			expect(settings.data.vehicles.map((v) => v.name)).toEqual(["Own"]);
			expect(settings.data.employees.map((e) => e.id)).not.toContain(
				ids.otherEmployee,
			);
			expect(settings.data.teams.map((t) => t.id)).not.toContain(ids.otherTeam);

			const update = {
				kind: "update",
				vehicleId: foreign.id,
				name: "Hijacked",
				licencePlate: "F-X 1",
				drivers: noDrivers,
			} as const;
			expect(await refusal(update)).toBe("vehicle_not_found");
			expect(await refusal({ kind: "archive", vehicleId: foreign.id })).toBe(
				"vehicle_not_found",
			);
			expect(await refusal({ kind: "restore", vehicleId: foreign.id })).toBe(
				"vehicle_not_found",
			);
			expect(await refusal({ kind: "delete", vehicleId: foreign.id })).toBe(
				"vehicle_not_found",
			);

			actAs(ids.otherOwnerUser, ids.otherOrganization);
			expect(await listed()).toEqual([foreign]);
			expect(await auditEntries(ids.organization)).toHaveLength(1);
		});

		it("refuses assigned drivers of another organization", async () => {
			expect(
				await refusal({
					kind: "create",
					name: "Van",
					licencePlate: "M-AB 1",
					drivers: { employeeIds: [ids.otherEmployee], teamIds: [] },
				}),
			).toBe("driver_not_found");
			expect(
				await refusal({
					kind: "create",
					name: "Van",
					licencePlate: "M-AB 1",
					drivers: { employeeIds: [], teamIds: [ids.otherTeam] },
				}),
			).toBe("driver_not_found");
			expect(await listed()).toEqual([]);
		});

		it("refuses a driver row that points at another organization's employee in the database", async () => {
			const van = await create("Van", "M-AB 1");
			await expect(
				admin.query(
					`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id)
					 values ($1, $2, $3)`,
					[ids.organization, van.id, ids.otherEmployee],
				),
			).rejects.toThrow(/organization_vehicle_driver_employee_fk/);
		});
	});
});
