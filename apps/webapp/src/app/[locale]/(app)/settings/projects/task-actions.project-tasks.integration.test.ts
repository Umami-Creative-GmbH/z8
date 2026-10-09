/**
 * #872 runtime evidence: project task management.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real project task server actions and the task read run against PostgreSQL.
 * Only the request/session, SSO proof, audit sink, logger and Next cache
 * boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
	};
});

const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));

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
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t872-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: audit.logAudit,
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const tasks = await import("./task-actions");

const ids = {
	organization: "t872-task-org",
	otherOrganization: "t872-other-org",
	ownerUser: "t872-owner-user",
	projectManagerUser: "t872-pm-user",
	employeeUser: "t872-employee-user",
	otherUser: "t872-other-user",
	owner: "e8720000-0000-4000-8000-000000000001",
	projectManager: "e8720000-0000-4000-8000-000000000002",
	employee: "e8720000-0000-4000-8000-000000000003",
	otherEmployee: "e8720000-0000-4000-8000-000000000004",
	project: "e8720000-0000-4000-8000-000000000020",
	unmanagedProject: "e8720000-0000-4000-8000-000000000021",
	otherProject: "e8720000-0000-4000-8000-000000000022",
	otherTask: "e8720000-0000-4000-8000-000000000050",
} as const;
const users = [ids.ownerUser, ids.projectManagerUser, ids.employeeUser, ids.otherUser];

describe("project tasks on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function taskRows(projectId: string = ids.project) {
		const { rows } = await admin.query<{
			id: string;
			name: string;
			description: string | null;
			estimate_hours: string | null;
			state: string;
			done_by: string | null;
			done_at: Date | null;
		}>(
			`select id, name, description, estimate_hours, state, done_by, done_at
			 from project_task where project_id = $1 order by name`,
			[projectId],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T872 tasks', $1, 'Europe/Berlin', $3), ($2, 'T872 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		const members: Array<[string, string, string]> = [
			[ids.organization, ids.ownerUser, "owner"],
			[ids.organization, ids.projectManagerUser, "member"],
			[ids.organization, ids.employeeUser, "member"],
			[ids.otherOrganization, ids.otherUser, "owner"],
		];
		for (const [organizationId, userId, role] of members) {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`${userId}-member`, organizationId, userId, role, timestamp],
			);
		}
		const employees: Array<[string, string, string, string]> = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.projectManager, ids.projectManagerUser, ids.organization, "manager"],
			[ids.employee, ids.employeeUser, ids.organization, "employee"],
			[ids.otherEmployee, ids.otherUser, ids.otherOrganization, "admin"],
		];
		for (const [id, userId, organizationId, role] of employees) {
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
				 values ($1, $2, $3, $4, true, $5)`,
				[id, userId, organizationId, role, timestamp],
			);
		}
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $4, 'T872 project', 'active', true, $6, now()),
			 ($2, $4, 'T872 unmanaged project', 'active', true, $6, now()),
			 ($3, $5, 'T872 foreign project', 'active', true, $7, now())`,
			[
				ids.project,
				ids.unmanagedProject,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.projectManager, ids.ownerUser],
		);
		// The employee is a project manager of the project, but holds no manager role.
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.employee, ids.ownerUser],
		);
		await admin.query(
			`insert into project_task (id, organization_id, project_id, name, created_by, updated_at)
			 values ($1, $2, $3, 'Foreign task', $4, now())`,
			[ids.otherTask, ids.otherOrganization, ids.otherProject, ids.otherUser],
		);
	}

	beforeEach(async () => {
		await seed();
		audit.logAudit.mockClear();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("an org admin", () => {
		it("creates a task and reads it back", async () => {
			const created = await actAs(ids.ownerUser, () =>
				tasks.createProjectTask({
					projectId: ids.project,
					name: "  Design  ",
					description: "Wireframes",
					estimateHours: 12.5,
				}),
			);
			expect(created.success).toBe(true);

			const listed = await actAs(ids.ownerUser, () => tasks.getProjectTasks(ids.project));
			expect(listed).toMatchObject({
				success: true,
				data: [
					{
						projectId: ids.project,
						name: "Design",
						description: "Wireframes",
						estimateHours: "12.50",
						state: "open",
						doneAt: null,
						doneBy: null,
					},
				],
			});
		});
	});
});
