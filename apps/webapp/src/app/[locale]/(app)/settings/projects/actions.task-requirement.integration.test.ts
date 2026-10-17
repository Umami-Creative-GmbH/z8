/**
 * #884 runtime evidence: a project's task requirement setting, on projects
 * and project templates. Booking behaviour does not read it yet (#1294).
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real project settings and template server actions run against
 * PostgreSQL. Only the request/session, SSO proof, billing, notification
 * delivery, audit sink, logger and Next cache boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{
			userId: string;
			organizationId: string;
		}>(),
	};
});

// getRequestSession awaits connection(), which throws outside a Next request scope.
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
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t884-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
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

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import(
		"@/lib/authorization/principal-loader"
	);
	return {
		...original,
		getPrincipalContext: async () => {
			const current = sessions.getStore();
			return current ? loadOrganizationPrincipalContext(db, current) : null;
		},
	};
});

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(
		importOriginal,
	),
);

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: async () => undefined,
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
	};
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const projects = await import("./actions");
const templates = await import("./template-actions");
const fromTemplate = await import("./from-template-actions");

const ids = {
	organization: "t884-requirement-org",
	otherOrganization: "t884-requirement-other-org",
	ownerUser: "t884-requirement-owner-user",
	projectManagerUser: "t884-requirement-pm-user",
	employeeUser: "t884-requirement-employee-user",
	otherUser: "t884-requirement-other-user",
	owner: "e8840000-0000-4000-8000-000000000001",
	projectManager: "e8840000-0000-4000-8000-000000000002",
	employee: "e8840000-0000-4000-8000-000000000003",
	otherEmployee: "e8840000-0000-4000-8000-000000000004",
	managedProject: "e8840000-0000-4000-8000-000000000020",
	unmanagedProject: "e8840000-0000-4000-8000-000000000021",
	foreignProject: "e8840000-0000-4000-8000-000000000022",
} as const;
const users = [
	ids.ownerUser,
	ids.projectManagerUser,
	ids.employeeUser,
	ids.otherUser,
];

describe("project task requirement on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function requiresTask(projectId: string) {
		const { rows } = await admin.query<{ requires_task: boolean }>(
			"select requires_task from project where id = $1",
			[projectId],
		);
		return rows[0]?.requires_task;
	}

	async function templateRequiresTask(templateId: string) {
		const { rows } = await admin.query<{ requires_task: boolean }>(
			"select requires_task from project_template where id = $1",
			[templateId],
		);
		return rows[0]?.requires_task;
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at) values
			 ($1, 'T884 requirement', $1, 'UTC', true, $3), ($2, 'T884 other', $2, 'UTC', true, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ($2 || '-member', $1, $2, 'owner', 'approved', $7),
			 ($3 || '-member', $1, $3, 'member', 'approved', $7),
			 ($4 || '-member', $1, $4, 'member', 'approved', $7),
			 ($5 || '-member', $6, $5, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.projectManagerUser,
				ids.employeeUser,
				ids.otherUser,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'admin', $10), ($3, $4, $9, 'manager', $10), ($5, $6, $9, 'employee', $10),
			 ($7, $8, $11, 'admin', $10)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.projectManager,
				ids.projectManagerUser,
				ids.employee,
				ids.employeeUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $4, 'Managed project', 'active', true, $5, $7),
			 ($2, $4, 'Unmanaged project', 'active', true, $5, $7),
			 ($3, $6, 'Foreign project', 'active', true, $8, $7)`,
			[
				ids.managedProject,
				ids.unmanagedProject,
				ids.foreignProject,
				ids.organization,
				ids.ownerUser,
				ids.otherOrganization,
				timestamp,
				ids.otherUser,
			],
		);
		await admin.query(
			"insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)",
			[ids.managedProject, ids.projectManager, ids.ownerUser],
		);
	});

	afterAll(cleanup);

	describe("on a project", () => {
		it("is off by default and lets an org admin turn it on and off again", async () => {
			expect(await requiresTask(ids.managedProject)).toBe(false);

			await expect(
				actAs(ids.ownerUser, () =>
					projects.updateProject(ids.managedProject, { requiresTask: true }),
				),
			).resolves.toEqual({ success: true, data: undefined });
			expect(await requiresTask(ids.managedProject)).toBe(true);
			const listed = await actAs(ids.ownerUser, () =>
				projects.getProjects(ids.organization),
			);
			expect(
				listed.success &&
					listed.data.find((project) => project.id === ids.managedProject),
			).toMatchObject({ requiresTask: true });

			await expect(
				actAs(ids.ownerUser, () =>
					projects.updateProject(ids.managedProject, { requiresTask: false }),
				),
			).resolves.toMatchObject({ success: true });
			expect(await requiresTask(ids.managedProject)).toBe(false);
		});

		it("keeps the setting when other fields are edited", async () => {
			await actAs(ids.ownerUser, () =>
				projects.updateProject(ids.managedProject, { requiresTask: true }),
			);

			await actAs(ids.ownerUser, () =>
				projects.updateProject(ids.managedProject, { description: "Edited" }),
			);

			expect(await requiresTask(ids.managedProject)).toBe(true);
		});

		it("creates a project with the requirement on", async () => {
			const created = await actAs(ids.ownerUser, () =>
				projects.createProject({
					organizationId: ids.organization,
					name: "Strict project",
					requiresTask: true,
				}),
			);

			if (!created.success) throw new Error(created.error);
			expect(await requiresTask(created.data.id)).toBe(true);
		});

		it("lets a project manager change it on their project, but not on another one", async () => {
			await expect(
				actAs(ids.projectManagerUser, () =>
					projects.updateProject(ids.managedProject, { requiresTask: true }),
				),
			).resolves.toMatchObject({ success: true });
			expect(await requiresTask(ids.managedProject)).toBe(true);

			await expect(
				actAs(ids.projectManagerUser, () =>
					projects.updateProject(ids.unmanagedProject, { requiresTask: true }),
				),
			).resolves.toMatchObject({ success: false });
			expect(await requiresTask(ids.unmanagedProject)).toBe(false);
		});

		it("refuses users who cannot edit the project, and another organization's project", async () => {
			await expect(
				actAs(ids.employeeUser, () =>
					projects.updateProject(ids.managedProject, { requiresTask: true }),
				),
			).resolves.toMatchObject({ success: false });
			await expect(
				actAs(ids.ownerUser, () =>
					projects.updateProject(ids.foreignProject, { requiresTask: true }),
				),
			).resolves.toMatchObject({ success: false });

			expect(await requiresTask(ids.managedProject)).toBe(false);
			expect(await requiresTask(ids.foreignProject)).toBe(false);
		});

		it("refuses a requirement that is not a boolean", async () => {
			await expect(
				actAs(ids.ownerUser, () =>
					projects.updateProject(ids.managedProject, {
						requiresTask: "yes" as never,
					}),
				),
			).resolves.toMatchObject({ success: false });
			await expect(
				actAs(ids.ownerUser, () =>
					projects.createProject({
						organizationId: ids.organization,
						name: "Not a boolean",
						requiresTask: 1 as never,
					}),
				),
			).resolves.toMatchObject({ success: false });

			expect(await requiresTask(ids.managedProject)).toBe(false);
			const { rows } = await admin.query(
				"select id from project where name = 'Not a boolean'",
			);
			expect(rows).toEqual([]);
		});
	});

	describe("on a project template", () => {
		async function createTemplate(
			input: Parameters<typeof templates.createProjectTemplate>[0],
		) {
			const result = await actAs(ids.ownerUser, () =>
				templates.createProjectTemplate(input),
			);
			if (!result.success)
				throw new Error(`Template creation failed: ${result.error}`);
			return result.data.id;
		}

		it("stores the requirement, shows it, and changes it with the template", async () => {
			const templateId = await createTemplate({
				name: "Strict",
				requiresTask: true,
			});

			expect(await templateRequiresTask(templateId)).toBe(true);
			await expect(
				actAs(ids.ownerUser, () =>
					templates.getProjectTemplateDetails(templateId),
				),
			).resolves.toMatchObject({ success: true, data: { requiresTask: true } });

			await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(templateId, {
					name: "Strict",
					requiresTask: false,
				}),
			);
			expect(await templateRequiresTask(templateId)).toBe(false);
		});

		it("starts a project created from it with the requirement, copied once", async () => {
			const templateId = await createTemplate({
				name: "Strict",
				requiresTask: true,
				tasks: [{ name: "Build" }],
			});

			const created = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({
					templateId,
					name: "From strict",
				}),
			);
			if (!created.success) throw new Error(created.error);
			expect(await requiresTask(created.data.id)).toBe(true);

			// No live link either way.
			await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(templateId, {
					name: "Strict",
					requiresTask: false,
				}),
			);
			expect(await requiresTask(created.data.id)).toBe(true);
			await actAs(ids.ownerUser, () =>
				projects.updateProject(created.data.id, { requiresTask: false }),
			);
			await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(templateId, {
					name: "Strict",
					requiresTask: true,
				}),
			);
			expect(await requiresTask(created.data.id)).toBe(false);
		});

		it("starts a project from a template without it with the requirement off", async () => {
			const templateId = await createTemplate({ name: "Relaxed" });

			const created = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({
					templateId,
					name: "From relaxed",
				}),
			);

			if (!created.success) throw new Error(created.error);
			expect(await requiresTask(created.data.id)).toBe(false);
		});

		it("keeps the project's requirement when the project is saved as a template", async () => {
			await admin.query(
				"update project set requires_task = true where id = $1",
				[ids.managedProject],
			);

			const strict = await actAs(ids.ownerUser, () =>
				fromTemplate.saveProjectAsTemplate(ids.managedProject, {
					name: "From managed",
				}),
			);
			const relaxed = await actAs(ids.ownerUser, () =>
				fromTemplate.saveProjectAsTemplate(ids.unmanagedProject, {
					name: "From unmanaged",
				}),
			);

			if (!strict.success) throw new Error(strict.error);
			if (!relaxed.success) throw new Error(relaxed.error);
			expect(await templateRequiresTask(strict.data.id)).toBe(true);
			expect(await templateRequiresTask(relaxed.data.id)).toBe(false);
		});

		it("refuses a template requirement that is not a boolean", async () => {
			const result = await actAs(ids.ownerUser, () =>
				templates.createProjectTemplate({
					name: "Odd",
					requiresTask: "yes" as never,
				}),
			);

			expect(result).toMatchObject({ success: false });
			const { rows } = await admin.query(
				"select id from project_template where organization_id = $1",
				[ids.organization],
			);
			expect(rows).toEqual([]);
		});
	});
});
