/**
 * #880 runtime evidence: creating a project from a template, and saving a
 * project as a template.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real server actions run against PostgreSQL. Only the request/session,
 * SSO proof, audit sink, logger and Next cache boundaries are replaced.
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

/** Runs once right after the next project read for "save as template", before its write. */
const hooks = vi.hoisted(() => ({ afterProjectRead: null as null | (() => Promise<void>) }));

vi.mock("@/lib/projects/project-from-template", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/projects/project-from-template")>();
	return {
		...original,
		projectAsTemplateInput: async (
			...args: Parameters<typeof original.projectAsTemplateInput>
		) => {
			const source = await original.projectAsTemplateInput(...args);
			const hook = hooks.afterProjectRead;
			hooks.afterProjectRead = null;
			if (hook) await hook();
			return source;
		},
	};
});

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
								id: `t880-session-${current.userId}`,
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

const templates = await import("./template-actions");
const fromTemplate = await import("./from-template-actions");
const { getProjectTemplate } = await import("@/lib/projects/project-templates");

const ids = {
	organization: "t880-template-org",
	otherOrganization: "t880-other-org",
	ownerUser: "t880-owner-user",
	adminUser: "t880-admin-user",
	projectManagerUser: "t880-pm-user",
	employeeUser: "t880-employee-user",
	departedUser: "t880-departed-user",
	otherUser: "t880-other-user",
	owner: "e8800000-0000-4000-8000-000000000001",
	admin: "e8800000-0000-4000-8000-000000000002",
	projectManager: "e8800000-0000-4000-8000-000000000003",
	employee: "e8800000-0000-4000-8000-000000000004",
	departed: "e8800000-0000-4000-8000-000000000005",
	otherEmployee: "e8800000-0000-4000-8000-000000000006",
	team: "e8800000-0000-4000-8000-000000000010",
	secondTeam: "e8800000-0000-4000-8000-000000000011",
	customer: "e8800000-0000-4000-8000-000000000040",
	otherTemplate: "e8800000-0000-4000-8000-000000000030",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.projectManagerUser,
	ids.employeeUser,
	ids.departedUser,
	ids.otherUser,
];

const ORGANIZATION_TIMEZONE = "Europe/Berlin";

/** Today's date in the organization's timezone plus `days`, as the UTC-midnight Date a project deadline holds. */
function organizationDatePlus(days: number) {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: ORGANIZATION_TIMEZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
	const date = new Date(`${today}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date;
}

describe("project templates in use on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
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
			 ($1, 'T880 templates', $1, $4, $3), ($2, 'T880 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp, ORGANIZATION_TIMEZONE],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, initcap(replace(user_id, '-', ' ')), user_id || '@example.test', $2, $2
			 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		const members: Array<[string, string, string]> = [
			[ids.organization, ids.ownerUser, "owner"],
			[ids.organization, ids.adminUser, "admin"],
			[ids.organization, ids.projectManagerUser, "member"],
			[ids.organization, ids.employeeUser, "member"],
			[ids.organization, ids.departedUser, "member"],
			[ids.otherOrganization, ids.otherUser, "owner"],
		];
		for (const [organizationId, userId, role] of members) {
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`${userId}-member`, organizationId, userId, role, timestamp],
			);
		}
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $3, 'Design team', now()), ($2, $3, 'Build team', now())`,
			[ids.team, ids.secondTeam, ids.organization],
		);
		const employees: Array<[string, string, string, string]> = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.admin, ids.adminUser, ids.organization, "employee"],
			[ids.projectManager, ids.projectManagerUser, ids.organization, "manager"],
			[ids.employee, ids.employeeUser, ids.organization, "employee"],
			[ids.departed, ids.departedUser, ids.organization, "employee"],
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
			`insert into customer (id, organization_id, name, is_active, created_by, updated_at)
			 values ($1, $2, 'Acme', true, $3, now())`,
			[ids.customer, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into project_template (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Foreign template', $3, now())`,
			[ids.otherTemplate, ids.otherOrganization, ids.otherUser],
		);
	}

	beforeEach(async () => {
		await seed();
		audit.logAudit.mockClear();
		hooks.afterProjectRead = null;
	});

	afterAll(async () => {
		await cleanup();
	});

	const relaunchTemplate = {
		name: "Website relaunch",
		description: "Our standard relaunch",
		icon: "IconRocket",
		color: "#3b82f6",
		budgetHours: 120.5,
		deadlineOffsetDays: 30,
		tasks: [{ name: "Design", description: "Wireframes", estimateHours: 12.5 }, { name: "Build" }],
		managerEmployeeIds: [ids.projectManager],
		assignments: [
			{ type: "team" as const, targetId: ids.team },
			{ type: "employee" as const, targetId: ids.employee },
		],
	};

	describe("creating a project from a template", () => {
		it("copies the icon, colour, budget, offset deadline, open tasks, managers and assignments", async () => {
			const templateId = await createTemplate(relaunchTemplate);

			const created = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({
					templateId,
					name: "Acme relaunch",
					customerId: ids.customer,
					status: "active",
				}),
			);

			expect(created).toEqual({
				success: true,
				data: { id: expect.any(String), skipped: [] },
			});
			if (!created.success) return;
			expect(await readProject(created.data.id)).toEqual({
				name: "Acme relaunch",
				status: "active",
				customerId: ids.customer,
				icon: "IconRocket",
				color: "#3b82f6",
				budgetHours: "120.50",
				deadline: organizationDatePlus(30),
				tasks: [
					{ name: "Build", description: null, estimateHours: null, state: "open" },
					{ name: "Design", description: "Wireframes", estimateHours: "12.50", state: "open" },
				],
				managerEmployeeIds: [ids.projectManager],
				teamIds: [ids.team],
				employeeIds: [ids.employee],
			});
		});

		it("skips and reports a departed employee and a deleted team, and still creates the project", async () => {
			const templateId = await createTemplate({
				name: "Relaunch",
				managerEmployeeIds: [ids.projectManager, ids.departed],
				assignments: [
					{ type: "team", targetId: ids.team },
					{ type: "team", targetId: ids.secondTeam },
					{ type: "employee", targetId: ids.departed },
					{ type: "employee", targetId: ids.employee },
				],
			});
			await admin.query("update employee set is_active = false where id = $1", [ids.departed]);
			await admin.query("delete from team where id = $1", [ids.team]);

			const created = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Relaunch 2027" }),
			);

			expect(created).toEqual({
				success: true,
				data: {
					id: expect.any(String),
					skipped: expect.arrayContaining([
						{ role: "manager", name: "T880 Departed User", reason: "departed" },
						{ role: "team", name: "Design team", reason: "removed" },
						{ role: "employee", name: "T880 Departed User", reason: "departed" },
					]),
				},
			});
			if (!created.success) return;
			expect(created.data.skipped).toHaveLength(3);
			expect(await readProject(created.data.id)).toMatchObject({
				name: "Relaunch 2027",
				status: "planned",
				deadline: null,
				managerEmployeeIds: [ids.projectManager],
				teamIds: [ids.secondTeam],
				employeeIds: [ids.employee],
			});
		});

		it("keeps no live link: later template edits leave the project alone, and the other way round", async () => {
			const templateId = await createTemplate(relaunchTemplate);
			const created = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Acme relaunch" }),
			);
			if (!created.success) throw new Error(created.error);
			const projectBefore = await readProject(created.data.id);
			const templateBefore = await readTemplate(templateId);

			const edited = await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(templateId, {
					name: "Website relaunch",
					color: "#ef4444",
					budgetHours: 5,
					deadlineOffsetDays: 1,
					tasks: [{ name: "Launch" }],
					managerEmployeeIds: [ids.employee],
					assignments: [{ type: "team", targetId: ids.secondTeam }],
				}),
			);
			expect(edited.success).toBe(true);
			expect(await readProject(created.data.id)).toEqual(projectBefore);

			await admin.query("update project set color = '#000000', budget_hours = 1 where id = $1", [
				created.data.id,
			]);
			await admin.query("delete from project_task where project_id = $1", [created.data.id]);
			await admin.query("delete from project_manager where project_id = $1", [created.data.id]);
			await admin.query("delete from project_assignment where project_id = $1", [created.data.id]);
			expect(await readTemplate(templateId)).toMatchObject({
				color: "#ef4444",
				budgetHours: "5.00",
				tasks: [{ name: "Launch" }],
				managers: [{ employeeId: ids.employee }],
				assignments: [{ teamId: ids.secondTeam }],
			});
			expect(templateBefore?.color).toBe("#3b82f6");
		});

		it("refuses a name the organization already uses, leaving no partial project behind", async () => {
			const templateId = await createTemplate(relaunchTemplate);
			await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Acme relaunch" }),
			);

			const clash = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: " Acme relaunch " }),
			);

			expect(clash).toMatchObject({
				success: false,
				error: expect.stringMatching(/already exists/),
			});
			const { rows } = await admin.query<{ count: string }>(
				`select (select count(*) from project where organization_id = $1)
				 + (select count(*) from project_task where organization_id = $1) as count`,
				[ids.organization],
			);
			expect(rows[0]?.count).toBe("3");
		});

		it("refuses another organization's template, creating nothing", async () => {
			const result = await actAs(ids.ownerUser, () =>
				fromTemplate.createProjectFromTemplate({
					templateId: ids.otherTemplate,
					name: "Borrowed",
				}),
			);

			expect(result).toMatchObject({ success: false });
			expect(await projectNames()).toEqual([]);
		});

		it("is open to a manager-tier project creator, who also manages the new project", async () => {
			const templateId = await createTemplate(relaunchTemplate);

			const created = await actAs(ids.projectManagerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Managed relaunch" }),
			);

			expect(created.success).toBe(true);
			if (!created.success) return;
			expect(await readProject(created.data.id)).toMatchObject({
				managerEmployeeIds: [ids.projectManager],
				teamIds: [ids.team],
				employeeIds: [ids.employee],
			});
		});

		it("copies no template manager for a manager-tier creator, who manages the project alone", async () => {
			const templateId = await createTemplate({
				...relaunchTemplate,
				managerEmployeeIds: [ids.employee, ids.projectManager],
			});

			const created = await actAs(ids.projectManagerUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Managed relaunch" }),
			);

			if (!created.success) throw new Error(created.error);
			// Only org admins assign project managers (#367); the assignments are still copied.
			expect(created.data.skipped).toEqual([
				{ role: "manager", name: "T880 Employee User", reason: "adminOnly" },
			]);
			expect(await readProject(created.data.id)).toMatchObject({
				managerEmployeeIds: [ids.projectManager],
				teamIds: [ids.team],
				employeeIds: [ids.employee],
			});
		});

		it("is refused to a plain employee, who cannot create projects", async () => {
			const templateId = await createTemplate(relaunchTemplate);
			audit.logAudit.mockClear();

			const result = await actAs(ids.employeeUser, () =>
				fromTemplate.createProjectFromTemplate({ templateId, name: "Sneaky" }),
			);

			expect(result).toMatchObject({ success: false });
			expect(await projectNames()).toEqual([]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});

		it("makes the project billable by default only with a customer and while Billable Time is on (#900)", async () => {
			const templateId = await createTemplate({ name: "Billable relaunch" });
			const create = (name: string, extra: { customerId?: string; billableDefault?: unknown }) =>
				actAs(ids.ownerUser, () =>
					fromTemplate.createProjectFromTemplate({
						templateId,
						name,
						...extra,
					} as Parameters<typeof fromTemplate.createProjectFromTemplate>[0]),
				);

			// Billable Time is off: changing the default is refused, the project is not created.
			await expect(
				create("While off", { customerId: ids.customer, billableDefault: true }),
			).resolves.toMatchObject({ success: false });

			await admin.query(
				"update organization set projects_enabled = true, billable_time_enabled = true where id = $1",
				[ids.organization],
			);
			await admin.query(
				`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR')`,
				[ids.organization],
			);

			await expect(create("Without customer", { billableDefault: true })).resolves.toMatchObject({
				success: false,
			});
			await expect(
				create("Not a boolean", { customerId: ids.customer, billableDefault: "yes" }),
			).resolves.toMatchObject({ success: false });
			expect(await projectNames()).toEqual([]);

			const billable = await create("Billable", {
				customerId: ids.customer,
				billableDefault: true,
			});
			const plain = await create("Plain", { customerId: ids.customer });
			if (!billable.success) throw new Error(billable.error);
			if (!plain.success) throw new Error(plain.error);
			const { rows } = await admin.query<{ id: string; billable_default: boolean }>(
				"select id, billable_default from project where id = any($1::uuid[])",
				[[billable.data.id, plain.data.id]],
			);
			expect(Object.fromEntries(rows.map((row) => [row.id, row.billable_default]))).toEqual({
				[billable.data.id]: true,
				[plain.data.id]: false,
			});
		});
	});

	describe("reading templates to create a project from", () => {
		it("lets a manager-tier project creator list and preview the organization's templates", async () => {
			const templateId = await createTemplate(relaunchTemplate);
			await admin.query("update employee set is_active = false where id = $1", [ids.employee]);

			const listed = await actAs(ids.projectManagerUser, () =>
				fromTemplate.getProjectTemplateChoices(),
			);
			const preview = await actAs(ids.projectManagerUser, () =>
				fromTemplate.getProjectTemplatePreview(templateId),
			);

			expect(listed).toMatchObject({
				success: true,
				data: [{ id: templateId, name: "Website relaunch", taskCount: 2, deadlineOffsetDays: 30 }],
			});
			expect(listed.success && listed.data).toHaveLength(1);
			expect(preview).toMatchObject({
				success: true,
				data: {
					id: templateId,
					tasks: [{ name: "Build" }, { name: "Design" }],
					assignments: [
						{ type: "team", name: "Design team", availability: "available" },
						{ type: "employee", name: "T880 Employee User", availability: "departed" },
					],
				},
			});
		});

		it("refuses a plain employee and never shows another organization's template", async () => {
			await createTemplate(relaunchTemplate);

			const refused = await actAs(ids.employeeUser, () =>
				Promise.all([
					fromTemplate.getProjectTemplateChoices(),
					fromTemplate.getProjectTemplatePreview(ids.otherTemplate),
				]),
			);
			const foreign = await actAs(ids.ownerUser, () =>
				fromTemplate.getProjectTemplatePreview(ids.otherTemplate),
			);

			expect(refused.map((result) => result.success)).toEqual([false, false]);
			expect(foreign).toMatchObject({ success: false });
		});
	});

	describe("saving a project as a template", () => {
		async function seedProject() {
			const projectId = "e8800000-0000-4000-8000-000000000020";
			await admin.query(
				`insert into project (id, organization_id, name, description, status, icon, color, budget_hours,
				                      deadline, is_active, created_by, updated_at)
				 values ($1, $2, 'Acme relaunch', 'For Acme', 'active', 'IconBolt', '#22c55e', 80,
				         '2026-12-24', true, $3, now())`,
				[projectId, ids.organization, ids.ownerUser],
			);
			await admin.query(
				`insert into project_task (organization_id, project_id, name, description, estimate_hours,
				                           state, done_at, done_by, created_by, updated_at) values
				 ($1, $2, 'Design', 'Wireframes', 12.5, 'open', null, null, $3, now()),
				 ($1, $2, 'Build', null, null, 'open', null, null, $3, now()),
				 ($1, $2, 'Kickoff', null, 2, 'done', now(), $3, $3, now())`,
				[ids.organization, projectId, ids.ownerUser],
			);
			await admin.query(
				`insert into project_manager (project_id, employee_id, assigned_by) values
				 ($1, $2, $4), ($1, $3, $4)`,
				[projectId, ids.projectManager, ids.departed, ids.ownerUser],
			);
			await admin.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, team_id, employee_id, created_by)
				 values ($1, $2, 'team', $3, null, $6), ($1, $2, 'employee', null, $4, $6),
				        ($1, $2, 'employee', null, $5, $6)`,
				[projectId, ids.organization, ids.team, ids.employee, ids.departed, ids.ownerUser],
			);
			await admin.query("update employee set is_active = false where id = $1", [ids.departed]);
			return projectId;
		}

		it("builds a template from the project's icon, colour, budget, open tasks, managers and assignments", async () => {
			const projectId = await seedProject();

			const saved = await actAs(ids.adminUser, () =>
				fromTemplate.saveProjectAsTemplate(projectId, { name: "Relaunch blueprint" }),
			);

			expect(saved).toEqual({
				success: true,
				data: {
					id: expect.any(String),
					name: "Relaunch blueprint",
					skipped: [
						{ role: "manager", name: "T880 Departed User", reason: "departed" },
						{ role: "employee", name: "T880 Departed User", reason: "departed" },
					],
				},
			});
			if (!saved.success) return;
			expect(await readTemplate(saved.data.id)).toMatchObject({
				name: "Relaunch blueprint",
				description: null,
				icon: "IconBolt",
				color: "#22c55e",
				budgetHours: "80.00",
				deadlineOffsetDays: null,
				tasks: [
					{ name: "Build", description: null, estimateHours: null },
					{ name: "Design", description: "Wireframes", estimateHours: "12.50" },
				],
				managers: [{ employeeId: ids.projectManager, availability: "available" }],
				assignments: [
					{ type: "team", teamId: ids.team, availability: "available" },
					{ type: "employee", employeeId: ids.employee, availability: "available" },
				],
			});
			const template = await readTemplate(saved.data.id);
			expect(template?.tasks).toHaveLength(2);
			expect(template?.managers).toHaveLength(1);
			expect(template?.assignments).toHaveLength(2);
		});

		it("skips and reports a member who leaves while the template is saved, still saving it", async () => {
			const projectId = await seedProject();
			hooks.afterProjectRead = async () => {
				await admin.query("update employee set is_active = false where id = $1", [ids.employee]);
			};

			const saved = await actAs(ids.adminUser, () =>
				fromTemplate.saveProjectAsTemplate(projectId, { name: "Relaunch blueprint" }),
			);

			expect(saved).toMatchObject({
				success: true,
				data: {
					skipped: expect.arrayContaining([
						{ role: "employee", name: "T880 Employee User", reason: "departed" },
					]),
				},
			});
			if (!saved.success) return;
			expect(saved.data.skipped).toHaveLength(3);
			expect((await readTemplate(saved.data.id))?.assignments).toMatchObject([
				{ type: "team", teamId: ids.team },
			]);
		});

		it("saves a project whose icon and colour predate the icon and colour pickers", async () => {
			const projectId = await seedProject();
			await admin.query("update project set icon = 'rocket', color = 'blue' where id = $1", [
				projectId,
			]);

			const saved = await actAs(ids.adminUser, () => fromTemplate.saveProjectAsTemplate(projectId));

			if (!saved.success) throw new Error(saved.error);
			expect(await readTemplate(saved.data.id)).toMatchObject({ icon: "rocket", color: "blue" });
		});

		it("names the template after the project unless told otherwise, and refuses a taken name", async () => {
			const projectId = await seedProject();

			const first = await actAs(ids.ownerUser, () => fromTemplate.saveProjectAsTemplate(projectId));
			const second = await actAs(ids.ownerUser, () =>
				fromTemplate.saveProjectAsTemplate(projectId, { name: "ACME RELAUNCH" }),
			);

			expect(first).toMatchObject({ success: true, data: { name: "Acme relaunch" } });
			expect(second).toMatchObject({
				success: false,
				error: expect.stringMatching(/already exists/),
			});
		});

		it("is refused to anyone but org owners and admins, and for another organization's project", async () => {
			const projectId = await seedProject();
			await admin.query(
				"insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)",
				[projectId, ids.employee, ids.ownerUser],
			);
			await admin.query(
				`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
				 values ('e8800000-0000-4000-8000-000000000021', $1, 'Foreign project', 'active', true, $2, now())`,
				[ids.otherOrganization, ids.otherUser],
			);
			audit.logAudit.mockClear();

			const refused = [
				await actAs(ids.projectManagerUser, () => fromTemplate.saveProjectAsTemplate(projectId)),
				await actAs(ids.employeeUser, () => fromTemplate.saveProjectAsTemplate(projectId)),
				await actAs(ids.ownerUser, () =>
					fromTemplate.saveProjectAsTemplate("e8800000-0000-4000-8000-000000000021"),
				),
			];

			expect(refused.map((result) => result.success)).toEqual([false, false, false]);
			const { rows } = await admin.query(
				"select id from project_template where organization_id = $1",
				[ids.organization],
			);
			expect(rows).toEqual([]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});
	});

	async function createTemplate(input: Parameters<typeof templates.createProjectTemplate>[0]) {
		const result = await actAs(ids.ownerUser, () => templates.createProjectTemplate(input));
		if (!result.success) throw new Error(`Template creation failed: ${result.error}`);
		return result.data.id;
	}

	async function projectNames() {
		const { rows } = await admin.query<{ name: string }>(
			"select name from project where organization_id = any($1::text[]) order by name",
			[[ids.organization, ids.otherOrganization]],
		);
		return rows.map((row) => row.name);
	}

	async function readProject(projectId: string) {
		const {
			rows: [project],
		} = await admin.query<{
			name: string;
			status: string;
			customer_id: string | null;
			icon: string | null;
			color: string | null;
			budget_hours: string | null;
			deadline: Date | null;
		}>(
			`select name, status, customer_id, icon, color, budget_hours,
			        deadline at time zone 'UTC' as deadline
			 from project where id = $1 and organization_id = $2`,
			[projectId, ids.organization],
		);
		if (!project) return null;
		const { rows: tasks } = await admin.query(
			`select name, description, estimate_hours as "estimateHours", state
			 from project_task where project_id = $1 order by lower(name)`,
			[projectId],
		);
		const { rows: managers } = await admin.query<{ employee_id: string }>(
			"select employee_id from project_manager where project_id = $1 order by employee_id",
			[projectId],
		);
		const { rows: assignments } = await admin.query<{
			assignment_type: string;
			team_id: string | null;
			employee_id: string | null;
		}>(
			`select assignment_type, team_id, employee_id from project_assignment
			 where project_id = $1 and organization_id = $2 order by team_id, employee_id`,
			[projectId, ids.organization],
		);
		return {
			name: project.name,
			status: project.status,
			customerId: project.customer_id,
			icon: project.icon,
			color: project.color,
			budgetHours: project.budget_hours,
			deadline: project.deadline,
			tasks,
			managerEmployeeIds: managers.map((row) => row.employee_id),
			teamIds: assignments.flatMap((row) => (row.team_id ? [row.team_id] : [])),
			employeeIds: assignments.flatMap((row) => (row.employee_id ? [row.employee_id] : [])),
		};
	}

	function readTemplate(templateId: string) {
		return getProjectTemplate({ organizationId: ids.organization, templateId });
	}
});
