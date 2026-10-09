/**
 * #875 contract: the extension's project list offers each project's open tasks.
 *
 * The real `GET /api/extension/projects` handler reads a label-owned PostgreSQL
 * database. Only the session and the Next runtime are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
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

const route = await import("./route");

const ids = {
	organization: "t875-extension-projects-org",
	otherOrganization: "t875-extension-projects-other-org",
	user: "t875-extension-projects-user",
	employee: "f8751000-0000-4000-8000-000000000001",
	otherEmployee: "f8751000-0000-4000-8000-000000000002",
	projectA: "f8751000-0000-4000-8000-0000000000a1",
	projectB: "f8751000-0000-4000-8000-0000000000b1",
	unassigned: "f8751000-0000-4000-8000-0000000000c1",
	otherOrganizationProject: "f8751000-0000-4000-8000-0000000000d1",
} as const;

describe("extension project tasks on PostgreSQL (#875)", () => {
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
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T875 extension', $1, $3), ($2, 'T875 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Extension user', 't875-extension@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $3, $4, 'employee', $6), ($2, $3, $5, 'employee', $6)`,
			[ids.employee, ids.otherEmployee, ids.user, ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, color, status, is_active, created_by, updated_at) values
			 ($1, $5, 'Alpha', '#112233', 'active', true, $7, $8),
			 ($2, $5, 'Beta', null, 'active', true, $7, $8),
			 ($3, $5, 'Unassigned', null, 'active', true, $7, $8),
			 ($4, $6, 'Foreign', null, 'active', true, $7, $8)`,
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
			 ('f8751000-0000-4000-8000-0000000000a2', $1, $3, 'design', 'open', null, null, $6, now()),
			 ('f8751000-0000-4000-8000-0000000000a3', $1, $3, 'Build', 'open', null, null, $6, now()),
			 ('f8751000-0000-4000-8000-0000000000a4', $1, $3, 'Shipped', 'done', now(), $6, $6, now()),
			 ('f8751000-0000-4000-8000-0000000000c2', $1, $4, 'Hidden', 'open', null, null, $6, now()),
			 ('f8751000-0000-4000-8000-0000000000d2', $2, $5, 'Foreign task', 'open', null, null, $6, now())`,
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

	async function read() {
		const response = await route.GET();
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	}

	beforeEach(async () => {
		harness.userId = ids.user;
		harness.organizationId = ids.organization;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("offers each listed project's open tasks by name, and nothing else", async () => {
		expect(await read()).toEqual({
			status: 200,
			body: {
				projects: [
					{
						id: ids.projectA,
						name: "Alpha",
						color: "#112233",
						icon: null,
						tasks: [
							{ id: "f8751000-0000-4000-8000-0000000000a3", name: "Build" },
							{ id: "f8751000-0000-4000-8000-0000000000a2", name: "design" },
						],
					},
					{ id: ids.projectB, name: "Beta", color: null, icon: null, tasks: [] },
				],
			},
		});
	});

	it("reads only the active organization's projects and tasks", async () => {
		harness.organizationId = ids.otherOrganization;

		expect((await read()).body.projects).toEqual([
			{
				id: ids.otherOrganizationProject,
				name: "Foreign",
				color: null,
				icon: null,
				tasks: [{ id: "f8751000-0000-4000-8000-0000000000d2", name: "Foreign task" }],
			},
		]);
	});
});
