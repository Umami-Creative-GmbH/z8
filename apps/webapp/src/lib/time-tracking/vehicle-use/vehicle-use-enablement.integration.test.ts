/**
 * #1119 (spec #807): the vehicle use organization switch and its asked/expected
 * assignments, through the settings server actions and the vehicle use resolver
 * on PostgreSQL. Only the session is mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1119-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const admin = await import("@/app/[locale]/(app)/settings/vehicle-use/actions");
const { resolveVehicleUseMode } = await import("./resolver");

const ids = {
	organization: "t1119-vehicle-org",
	otherOrganization: "t1119-other-org",
	ownerUser: "t1119-owner-user",
	adminUser: "t1119-admin-user",
	managerUser: "t1119-manager-user",
	driverUser: "t1119-driver-user",
	officeUser: "t1119-office-user",
	foreignUser: "t1119-foreign-user",
	owner: "d1119000-0000-4000-8000-000000000001",
	adminEmployee: "d1119000-0000-4000-8000-000000000002",
	manager: "d1119000-0000-4000-8000-000000000003",
	driver: "d1119000-0000-4000-8000-000000000004",
	office: "d1119000-0000-4000-8000-000000000005",
	foreign: "d1119000-0000-4000-8000-000000000006",
	driverTeam: "d1119000-0000-4000-8000-0000000000a1",
	officeTeam: "d1119000-0000-4000-8000-0000000000a2",
	foreignTeam: "d1119000-0000-4000-8000-0000000000a3",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.driverUser,
	ids.officeUser,
	ids.foreignUser,
];

describe("vehicle use enablement on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await pool.query("delete from audit_log where organization_id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T1119 vehicles', $1, 'Europe/Berlin', $3), ($2, 'T1119 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1119-m-owner', $1, $2, 'owner', 'approved', $8),
			 ('t1119-m-admin', $1, $3, 'admin', 'approved', $8),
			 ('t1119-m-manager', $1, $4, 'member', 'approved', $8),
			 ('t1119-m-driver', $1, $5, 'member', 'approved', $8),
			 ('t1119-m-office', $1, $6, 'member', 'approved', $8),
			 ('t1119-m-foreign', $7, $9, 'owner', 'approved', $8)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.driverUser,
				ids.officeUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await pool.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $2, 'Drivers', now()), ($3, $2, 'Office', now()), ($4, $5, 'Foreign', now())`,
			[ids.driverTeam, ids.organization, ids.officeTeam, ids.foreignTeam, ids.otherOrganization],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, team_id, updated_at) values
			 ($1, $2, $13, 'admin', 'OWN-1', null, $14),
			 ($3, $4, $13, 'admin', 'ADM-1', null, $14),
			 ($5, $6, $13, 'manager', 'MGR-1', $16, $14),
			 ($7, $8, $13, 'employee', 'DRV-1', $16, $14),
			 ($9, $10, $13, 'employee', 'OFF-1', $17, $14),
			 ($11, $12, $15, 'admin', 'FOR-1', $18, $14)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.adminEmployee,
				ids.adminUser,
				ids.manager,
				ids.managerUser,
				ids.driver,
				ids.driverUser,
				ids.office,
				ids.officeUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
				ids.driverTeam,
				ids.officeTeam,
				ids.foreignTeam,
			],
		);
	}

	async function resolve(employeeId: string, organizationId: string = ids.organization) {
		return resolveVehicleUseMode(db, { organizationId, employeeId });
	}

	async function switchOn(enabled = true) {
		actAs(ids.ownerUser);
		return admin.saveVehicleUseSettingsAction({ enabled });
	}

	async function assign(
		target:
			| { type: "organization" }
			| { type: "team"; teamId: string }
			| { type: "employee"; employeeId: string },
		mode: "off" | "asked" | "expected",
	) {
		actAs(ids.ownerUser);
		const result = await admin.setVehicleUseAssignmentAction({ target, mode });
		expect(result).toMatchObject({ success: true });
		return result.success ? result.data.assignmentId : "";
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("starts switched off, and off resolves to off for everyone whatever is assigned", async () => {
		actAs(ids.ownerUser);
		const data = await admin.getVehicleUseAdminDataAction();
		expect(data.success && data.data.settings).toEqual({ enabled: false });
		expect(data.success && data.data.assignments).toEqual([]);

		await assign({ type: "organization" }, "expected");
		await assign({ type: "employee", employeeId: ids.driver }, "expected");
		for (const employeeId of [ids.owner, ids.manager, ids.driver, ids.office]) {
			expect(await resolve(employeeId)).toBe("off");
		}

		expect(await switchOn()).toMatchObject({ success: true });
		expect(await resolve(ids.driver)).toBe("expected");
		expect(await switchOn(false)).toMatchObject({ success: true });
		expect(await resolve(ids.driver)).toBe("off");
	});

	it("resolves organization, team and employee assignments most specific first", async () => {
		await switchOn();
		expect(await resolve(ids.driver)).toBe("off");

		await assign({ type: "organization" }, "asked");
		expect(await resolve(ids.owner)).toBe("asked");
		expect(await resolve(ids.driver)).toBe("asked");

		await assign({ type: "team", teamId: ids.driverTeam }, "expected");
		expect(await resolve(ids.driver)).toBe("expected");
		expect(await resolve(ids.manager)).toBe("expected");
		expect(await resolve(ids.office)).toBe("asked");

		await assign({ type: "employee", employeeId: ids.manager }, "off");
		expect(await resolve(ids.manager)).toBe("off");
		expect(await resolve(ids.driver)).toBe("expected");

		// Changing an assignment's mode replaces it; removing it falls back to the broader one.
		const officeTeamAssignment = await assign({ type: "team", teamId: ids.officeTeam }, "asked");
		expect(await assign({ type: "team", teamId: ids.officeTeam }, "expected")).toBe(
			officeTeamAssignment,
		);
		expect(await resolve(ids.office)).toBe("expected");
		actAs(ids.ownerUser);
		expect(
			await admin.removeVehicleUseAssignmentAction({ assignmentId: officeTeamAssignment }),
		).toMatchObject({ success: true });
		expect(await resolve(ids.office)).toBe("asked");

		actAs(ids.ownerUser);
		const data = await admin.getVehicleUseAdminDataAction();
		expect(data.success && data.data.assignments).toEqual([
			expect.objectContaining({ assignmentType: "organization", mode: "asked" }),
			expect.objectContaining({ assignmentType: "team", teamId: ids.driverTeam, mode: "expected" }),
			expect.objectContaining({ assignmentType: "employee", employeeId: ids.manager, mode: "off" }),
		]);
	});

	it("lets only owners and admins read or change the configuration", async () => {
		for (const userId of [ids.managerUser, ids.driverUser]) {
			actAs(userId);
			expect(await admin.saveVehicleUseSettingsAction({ enabled: true })).toMatchObject({
				success: false,
				code: "admin_only",
			});
			expect(
				await admin.setVehicleUseAssignmentAction({
					target: { type: "organization" },
					mode: "asked",
				}),
			).toMatchObject({ success: false, code: "admin_only" });
			expect(await admin.getVehicleUseAdminDataAction()).toMatchObject({
				success: false,
				code: "admin_only",
			});
		}

		actAs(ids.adminUser);
		expect(await admin.saveVehicleUseSettingsAction({ enabled: true })).toMatchObject({
			success: true,
		});
		expect(
			await admin.setVehicleUseAssignmentAction({
				target: { type: "organization" },
				mode: "asked",
			}),
		).toMatchObject({ success: true });
		expect(await resolve(ids.driver)).toBe("asked");
	});

	it("keeps configuration inside the active organization", async () => {
		await switchOn();
		actAs(ids.ownerUser);
		expect(
			await admin.setVehicleUseAssignmentAction({
				target: { type: "team", teamId: ids.foreignTeam },
				mode: "expected",
			}),
		).toMatchObject({ success: false, code: "team_not_found" });
		expect(
			await admin.setVehicleUseAssignmentAction({
				target: { type: "employee", employeeId: ids.foreign },
				mode: "expected",
			}),
		).toMatchObject({ success: false, code: "employee_not_found" });
		expect(
			await admin.setVehicleUseAssignmentAction({
				target: { type: "organization" },
				mode: "sometimes" as never,
			}),
		).toMatchObject({ success: false, code: "invalid_mode" });

		const ownAssignment = await assign({ type: "organization" }, "expected");
		// The other organization's owner neither sees nor removes it, and its employees stay off.
		actAs(ids.foreignUser, ids.otherOrganization);
		const foreignData = await admin.getVehicleUseAdminDataAction();
		expect(foreignData.success && foreignData.data).toMatchObject({
			settings: { enabled: false },
			assignments: [],
		});
		expect(
			await admin.removeVehicleUseAssignmentAction({ assignmentId: ownAssignment }),
		).toMatchObject({ success: false, code: "assignment_not_found" });
		expect(await resolve(ids.foreign, ids.otherOrganization)).toBe("off");
		// An employee of another organization resolves to off here, too.
		expect(await resolve(ids.foreign)).toBe("off");
		expect(await resolve(ids.driver)).toBe("expected");
	});

	it("audits the switch and every assignment change", async () => {
		await switchOn();
		await switchOn(); // unchanged: no second entry
		const assignmentId = await assign({ type: "employee", employeeId: ids.driver }, "asked");
		await assign({ type: "employee", employeeId: ids.driver }, "expected");
		actAs(ids.ownerUser);
		await admin.removeVehicleUseAssignmentAction({ assignmentId });

		const { rows } = await pool.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			performed_by: string;
			employee_id: string | null;
			changes: string;
		}>(
			`select action, entity_type, entity_id, performed_by, employee_id, changes
			 from audit_log where organization_id = $1 order by timestamp asc, id asc`,
			[ids.organization],
		);
		expect(rows.map((row) => row.action)).toEqual([
			"vehicle_use.settings_changed",
			"vehicle_use.assignment_set",
			"vehicle_use.assignment_set",
			"vehicle_use.assignment_removed",
		]);
		expect(rows.every((row) => row.performed_by === ids.ownerUser)).toBe(true);
		expect(JSON.parse(rows[0].changes)).toEqual({
			from: { enabled: false },
			to: { enabled: true },
		});
		expect(rows[2]).toMatchObject({
			entity_type: "vehicle_use_assignment",
			entity_id: assignmentId,
			employee_id: ids.driver,
		});
		expect(JSON.parse(rows[2].changes)).toMatchObject({
			from: { mode: "asked" },
			to: { mode: "expected" },
		});
		expect(JSON.parse(rows[3].changes)).toMatchObject({
			from: { assignmentType: "employee", employeeId: ids.driver, mode: "expected" },
			to: null,
		});
	});
});
