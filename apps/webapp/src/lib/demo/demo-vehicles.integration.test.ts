/**
 * #1118: demo organizations get a few organization vehicles with the demo
 * locations, and a demo reset removes them again, on PostgreSQL.
 *
 * The real demo server actions run against a disposable database. Only the
 * request/session, billing provisioning and Next cache boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { clearTimeDataAction, generateLocationsStepAction } = await import(
	"@/app/[locale]/(app)/settings/demo/actions"
);

const ids = {
	organization: "t1118-demo-org",
	otherOrganization: "t1118-demo-other-org",
	adminUser: "t1118-demo-admin-user",
	memberUser: "t1118-demo-member-user",
	otherUser: "t1118-demo-other-user",
	admin: "11181000-0000-4000-8000-000000000001",
	member: "11181000-0000-4000-8000-000000000002",
	other: "11181000-0000-4000-8000-000000000003",
	team: "11181000-0000-4000-8000-0000000000a1",
} as const;

describe("demo vehicles on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.memberUser, ids.otherUser],
		]);
	}

	async function vehicles(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			name: string;
			licence_plate: string;
			archived: boolean;
			employee_ids: string[];
			team_ids: string[];
		}>(
			`select v.name, v.licence_plate, v.archived_at is not null as archived,
			        coalesce(array_agg(d.employee_id) filter (where d.employee_id is not null), '{}') as employee_ids,
			        coalesce(array_agg(d.team_id) filter (where d.team_id is not null), '{}') as team_ids
			 from organization_vehicle v
			 left join organization_vehicle_driver d on d.vehicle_id = v.id
			 where v.organization_id = $1
			 group by v.id order by v.name`,
			[organizationId],
		);
		return rows;
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-06-01T00:00:00Z");
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query(
				"insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)",
				[organizationId, timestamp],
			);
		}
		const people = [
			[ids.adminUser, ids.admin, "admin", "admin", ids.organization],
			[ids.memberUser, ids.member, "member", "employee", ids.organization],
			[ids.otherUser, ids.other, "member", "employee", ids.otherOrganization],
		] as const;
		for (const [userId, employeeId, memberRole, employeeRole, organizationId] of people) {
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
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, $4, $5)`,
				[employeeId, userId, organizationId, employeeRole, timestamp],
			);
		}
		await admin.query(
			"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Field', $3)",
			[ids.team, ids.organization, timestamp],
		);
		harness.userId = ids.adminUser;
	});

	afterAll(cleanup);

	it("creates a few vehicles with the demo locations, with drivers of the organization", async () => {
		const result = await generateLocationsStepAction({
			organizationId: ids.organization,
			dateRangeType: "last30",
			locationCount: 1,
			subareasPerLocation: 1,
		});

		expect(result).toMatchObject({ success: true, data: { vehiclesCreated: 3 } });
		const created = await vehicles();
		expect(created.map((v) => [v.name, v.licence_plate, v.archived])).toEqual([
			["Demo - Pool car", "Z8-DEMO 3", false],
			["Demo - Service van 1", "Z8-DEMO 1", false],
			["Demo - Service van 2", "Z8-DEMO 2", false],
		]);
		const drivers = created.flatMap((v) => v.employee_ids);
		expect(drivers).toHaveLength(1);
		expect([ids.admin, ids.member]).toContain(drivers[0]);
		expect(created.flatMap((v) => v.team_ids)).toEqual([ids.team]);
		expect(await vehicles(ids.otherOrganization)).toEqual([]);

		const again = await generateLocationsStepAction({
			organizationId: ids.organization,
			dateRangeType: "last30",
			locationCount: 1,
			subareasPerLocation: 1,
		});
		expect(again).toMatchObject({ success: true, data: { vehiclesCreated: 0 } });
		expect(await vehicles()).toHaveLength(3);
	});

	it("removes the demo vehicles on a demo reset and keeps the organization's own", async () => {
		await generateLocationsStepAction({
			organizationId: ids.organization,
			dateRangeType: "last30",
			locationCount: 1,
			subareasPerLocation: 1,
		});
		await admin.query(
			"insert into organization_vehicle (organization_id, name, licence_plate) values ($1, 'Own van', 'M-OW 1')",
			[ids.organization],
		);

		const result = await clearTimeDataAction(ids.organization);

		expect(result).toMatchObject({ success: true, data: { vehiclesDeleted: 3 } });
		expect((await vehicles()).map((v) => v.name)).toEqual(["Own van"]);
	});
});
