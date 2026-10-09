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
const { findProjectTask, listProjectTasks } = await import("@/lib/projects/project-tasks");

const ids = {
	organization: "t872-task-org",
	otherOrganization: "t872-other-org",
	ownerUser: "t872-owner-user",
	projectManagerUser: "t872-pm-user",
	employeeUser: "t872-employee-user",
	otherUser: "t872-other-user",
	plainUser: "t872-plain-user",
	formerManagerUser: "t872-former-pm-user",
	owner: "e8720000-0000-4000-8000-000000000001",
	projectManager: "e8720000-0000-4000-8000-000000000002",
	employee: "e8720000-0000-4000-8000-000000000003",
	otherEmployee: "e8720000-0000-4000-8000-000000000004",
	plainEmployee: "e8720000-0000-4000-8000-000000000005",
	formerManager: "e8720000-0000-4000-8000-000000000006",
	project: "e8720000-0000-4000-8000-000000000020",
	unmanagedProject: "e8720000-0000-4000-8000-000000000021",
	otherProject: "e8720000-0000-4000-8000-000000000022",
	otherTask: "e8720000-0000-4000-8000-000000000050",
} as const;
const users = [
	ids.ownerUser,
	ids.projectManagerUser,
	ids.employeeUser,
	ids.otherUser,
	ids.plainUser,
	ids.formerManagerUser,
];

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
			[ids.organization, ids.plainUser, "member"],
			[ids.organization, ids.formerManagerUser, "member"],
			[ids.otherOrganization, ids.otherUser, "owner"],
		];
		for (const [organizationId, userId, role] of members) {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`${userId}-member`, organizationId, userId, role, timestamp],
			);
		}
		const employees: Array<[string, string, string, string, boolean?]> = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.projectManager, ids.projectManagerUser, ids.organization, "manager"],
			[ids.employee, ids.employeeUser, ids.organization, "employee"],
			[ids.otherEmployee, ids.otherUser, ids.otherOrganization, "admin"],
			[ids.plainEmployee, ids.plainUser, ids.organization, "employee"],
			[ids.formerManager, ids.formerManagerUser, ids.organization, "employee", false],
		];
		for (const [id, userId, organizationId, role, isActive = true] of employees) {
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
				 values ($1, $2, $3, $4, $6, $5)`,
				[id, userId, organizationId, role, timestamp, isActive],
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
		// A former employee keeps a stale project manager row.
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.formerManager, ids.ownerUser],
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

		it("renames a task and edits its description and estimate", async () => {
			const id = await createTask(ids.ownerUser, "Design", { estimateHours: 4 });

			const updated = await actAs(ids.ownerUser, () =>
				tasks.updateProjectTask(id, {
					name: "Visual design",
					description: "Mockups",
					estimateHours: 6.255,
				}),
			);
			expect(updated).toEqual({ success: true, data: undefined });
			expect(await taskRows()).toMatchObject([
				{ id, name: "Visual design", description: "Mockups", estimate_hours: "6.26" },
			]);

			const cleared = await actAs(ids.ownerUser, () =>
				tasks.updateProjectTask(id, { description: "  ", estimateHours: null }),
			);
			expect(cleared.success).toBe(true);
			expect(await taskRows()).toMatchObject([
				{ id, name: "Visual design", description: null, estimate_hours: null },
			]);
		});

		it("marks a task done, recording who and when, and reopens it", async () => {
			const id = await createTask(ids.ownerUser, "Design");

			const done = await actAs(ids.ownerUser, () => tasks.markProjectTaskDone(id));
			expect(done).toEqual({ success: true, data: undefined });
			const [doneRow] = await taskRows();
			expect(doneRow).toMatchObject({ state: "done", done_by: ids.ownerUser });
			expect(doneRow?.done_at).toBeInstanceOf(Date);

			const reopened = await actAs(ids.ownerUser, () => tasks.reopenProjectTask(id));
			expect(reopened).toEqual({ success: true, data: undefined });
			expect(await taskRows()).toMatchObject([{ state: "open", done_by: null, done_at: null }]);
		});

		it("deletes an unbooked task", async () => {
			const id = await createTask(ids.ownerUser, "Design");

			const deleted = await actAs(ids.ownerUser, () => tasks.deleteProjectTask(id));

			expect(deleted).toEqual({ success: true, data: undefined });
			expect(await taskRows()).toEqual([]);
		});

		it("manages tasks of a project they are not a manager of", async () => {
			const id = await createTask(ids.ownerUser, "Design", {}, ids.unmanagedProject);
			const renamed = await actAs(ids.ownerUser, () =>
				tasks.updateProjectTask(id, { name: "Build" }),
			);
			expect(renamed.success).toBe(true);
			expect((await taskRows(ids.unmanagedProject)).map((row) => row.name)).toEqual(["Build"]);
		});
	});

	describe("task input", () => {
		it("refuses a duplicate name within one project, ignoring case and surrounding spaces", async () => {
			const first = await createTask(ids.ownerUser, "Design");

			const duplicate = await actAs(ids.ownerUser, () =>
				tasks.createProjectTask({ projectId: ids.project, name: " design " }),
			);
			const second = await createTask(ids.ownerUser, "Build");
			const renamedOntoFirst = await actAs(ids.ownerUser, () =>
				tasks.updateProjectTask(second, { name: "DESIGN" }),
			);

			expect(duplicate).toMatchObject({ success: false, error: expect.stringMatching(/already exists/i) });
			expect(renamedOntoFirst).toMatchObject({
				success: false,
				error: expect.stringMatching(/already exists/i),
			});
			expect((await taskRows()).map((row) => row.id).sort()).toEqual([first, second].sort());
		});

		it("allows the same name in two projects", async () => {
			await createTask(ids.ownerUser, "Design");
			await createTask(ids.ownerUser, "Design", {}, ids.unmanagedProject);

			expect((await taskRows()).map((row) => row.name)).toEqual(["Design"]);
			expect((await taskRows(ids.unmanagedProject)).map((row) => row.name)).toEqual(["Design"]);
		});

		it("refuses a blank name and a non-positive estimate", async () => {
			const results = await actAs(ids.ownerUser, () =>
				Promise.all([
					tasks.createProjectTask({ projectId: ids.project, name: "   " }),
					tasks.createProjectTask({ projectId: ids.project, name: "Zero", estimateHours: 0 }),
					tasks.createProjectTask({ projectId: ids.project, name: "Neg", estimateHours: -2 }),
				]),
			);

			expect(results.map((result) => result.success)).toEqual([false, false, false]);
			expect(await taskRows()).toEqual([]);
		});
	});

	describe("a manager-tier project manager", () => {
		it("manages every part of the tasks of a project they manage", async () => {
			const id = await createTask(ids.projectManagerUser, "Design");
			const results = [
				await actAs(ids.projectManagerUser, () =>
					tasks.updateProjectTask(id, { name: "Build", estimateHours: 3 }),
				),
				await actAs(ids.projectManagerUser, () => tasks.markProjectTaskDone(id)),
				await actAs(ids.projectManagerUser, () => tasks.reopenProjectTask(id)),
				await actAs(ids.projectManagerUser, () => tasks.getProjectTasks(ids.project)),
			];
			expect(results.map((result) => result.success)).toEqual([true, true, true, true]);
			expect(await taskRows()).toMatchObject([{ id, name: "Build", state: "open" }]);

			const deleted = await actAs(ids.projectManagerUser, () => tasks.deleteProjectTask(id));
			expect(deleted.success).toBe(true);
			expect(await taskRows()).toEqual([]);
		});

		it("is refused every task action on a project they do not manage", async () => {
			const id = await createTask(ids.ownerUser, "Design", {}, ids.unmanagedProject);

			const results = await actAs(ids.projectManagerUser, () =>
				Promise.all([
					tasks.createProjectTask({ projectId: ids.unmanagedProject, name: "Build" }),
					tasks.updateProjectTask(id, { name: "Renamed" }),
					tasks.markProjectTaskDone(id),
					tasks.reopenProjectTask(id),
					tasks.deleteProjectTask(id),
					tasks.getProjectTasks(ids.unmanagedProject),
				]),
			);

			expect(results.map((result) => result.success)).toEqual([
				false,
				false,
				false,
				false,
				false,
				false,
			]);
			expect(await taskRows(ids.unmanagedProject)).toMatchObject([
				{ id, name: "Design", state: "open" },
			]);
		});
	});

	describe("a project manager with the plain employee role", () => {
		it("manages the tasks of the project they manage", async () => {
			const id = await createTask(ids.employeeUser, "Design");
			const results = [
				await actAs(ids.employeeUser, () => tasks.updateProjectTask(id, { name: "Build" })),
				await actAs(ids.employeeUser, () => tasks.markProjectTaskDone(id)),
				await actAs(ids.employeeUser, () => tasks.reopenProjectTask(id)),
				await actAs(ids.employeeUser, () => tasks.getProjectTasks(ids.project)),
				await actAs(ids.employeeUser, () => tasks.deleteProjectTask(id)),
			];

			expect(results.map((result) => result.success)).toEqual([true, true, true, true, true]);
			expect(await taskRows()).toEqual([]);
		});

		it("is refused on a project they do not manage", async () => {
			const result = await actAs(ids.employeeUser, () =>
				tasks.createProjectTask({ projectId: ids.unmanagedProject, name: "Build" }),
			);

			expect(result.success).toBe(false);
			expect(await taskRows(ids.unmanagedProject)).toEqual([]);
		});

		it("is offered only the projects they manage", async () => {
			const managed = await actAs(ids.employeeUser, () => tasks.getProjectsWithManageableTasks());
			const all = await actAs(ids.ownerUser, () => tasks.getProjectsWithManageableTasks());

			expect(managed).toMatchObject({ success: true, data: [{ id: ids.project }] });
			expect(all.success && all.data.map((project) => project.id)).toEqual([
				ids.project,
				ids.unmanagedProject,
			]);
		});
	});

	describe("a plain employee who manages no project, or a departed project manager", () => {
		it("is refused every task action", async () => {
			const id = await createTask(ids.ownerUser, "Design");

			for (const userId of [ids.plainUser, ids.formerManagerUser]) {
				const results = await actAs(userId, () =>
					Promise.all([
						tasks.createProjectTask({ projectId: ids.project, name: "Build" }),
						tasks.updateProjectTask(id, { name: "Renamed" }),
						tasks.markProjectTaskDone(id),
						tasks.reopenProjectTask(id),
						tasks.deleteProjectTask(id),
						tasks.getProjectTasks(ids.project),
					]),
				);
				expect(results.map((result) => result.success)).toEqual([
					false,
					false,
					false,
					false,
					false,
					false,
				]);
				expect(await actAs(userId, () => tasks.getProjectsWithManageableTasks())).toEqual({
					success: true,
					data: [],
				});
			}
			expect(await taskRows()).toMatchObject([{ id, name: "Design", state: "open" }]);
			expect(audit.logAudit).toHaveBeenCalledTimes(1);
		});
	});

	describe("organization isolation", () => {
		it("an org admin cannot read or change another organization's task", async () => {
			const results = await actAs(ids.ownerUser, () =>
				Promise.all([
					tasks.getProjectTasks(ids.otherProject),
					tasks.createProjectTask({ projectId: ids.otherProject, name: "Intrusion" }),
					tasks.updateProjectTask(ids.otherTask, { name: "Renamed" }),
					tasks.markProjectTaskDone(ids.otherTask),
					tasks.deleteProjectTask(ids.otherTask),
				]),
			);

			expect(results.map((result) => result.success)).toEqual([false, false, false, false, false]);
			expect(await taskRows(ids.otherProject)).toMatchObject([
				{ id: ids.otherTask, name: "Foreign task", state: "open" },
			]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});

		it("the task read never returns another organization's tasks", async () => {
			await createTask(ids.ownerUser, "Design");

			expect(
				await listProjectTasks({ organizationId: ids.organization, projectId: ids.otherProject }),
			).toEqual([]);
			expect(await findProjectTask({ organizationId: ids.organization, taskId: ids.otherTask })).toBe(
				null,
			);
		});
	});

	describe("the task read", () => {
		it("lists open tasks first, by name, and filters by state", async () => {
			const zeta = await createTask(ids.ownerUser, "zeta");
			const alpha = await createTask(ids.ownerUser, "Alpha");
			const done = await createTask(ids.ownerUser, "Beta");
			await actAs(ids.ownerUser, () => tasks.markProjectTaskDone(done));
			const scope = { organizationId: ids.organization, projectId: ids.project };

			expect((await listProjectTasks(scope)).map((task) => task.id)).toEqual([alpha, zeta, done]);
			expect((await listProjectTasks(scope, { state: "open" })).map((task) => task.id)).toEqual([
				alpha,
				zeta,
			]);
			expect((await listProjectTasks(scope, { state: "done" })).map((task) => task.id)).toEqual([
				done,
			]);
		});
	});

	describe("project lifecycle", () => {
		it("archiving a project keeps its tasks", async () => {
			const id = await createTask(ids.ownerUser, "Design");
			await admin.query("update project set status = 'archived' where id = $1", [ids.project]);

			expect((await taskRows()).map((row) => row.id)).toEqual([id]);
		});

		it("deleting a project removes its tasks", async () => {
			await createTask(ids.ownerUser, "Design");
			await admin.query("delete from project where id = $1", [ids.project]);

			expect(await taskRows()).toEqual([]);
		});
	});

	async function createTask(
		userId: string,
		name: string,
		extra: { description?: string; estimateHours?: number } = {},
		projectId: string = ids.project,
	) {
		const result = await actAs(userId, () =>
			tasks.createProjectTask({ projectId, name, ...extra }),
		);
		if (!result.success) throw new Error(`Task creation failed: ${result.error}`);
		return result.data.id;
	}
});
