/**
 * #878 runtime evidence: project template management.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real project template server actions and template reads run against
 * PostgreSQL. Only the request/session, SSO proof, audit sink, logger and Next
 * cache boundaries are replaced.
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
								id: `t878-session-${current.userId}`,
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
const { getProjectTemplate, listProjectTemplates } = await import(
	"@/lib/projects/project-templates"
);
const { listEligibleProjects } = await import("@/lib/time-tracking/project-eligibility");
const { getProjects } = await import("./actions");

const ids = {
	organization: "t878-template-org",
	otherOrganization: "t878-other-org",
	ownerUser: "t878-owner-user",
	adminUser: "t878-admin-user",
	projectManagerUser: "t878-pm-user",
	employeeUser: "t878-employee-user",
	departedUser: "t878-departed-user",
	otherUser: "t878-other-user",
	owner: "e8780000-0000-4000-8000-000000000001",
	admin: "e8780000-0000-4000-8000-000000000002",
	projectManager: "e8780000-0000-4000-8000-000000000003",
	employee: "e8780000-0000-4000-8000-000000000004",
	departed: "e8780000-0000-4000-8000-000000000005",
	otherEmployee: "e8780000-0000-4000-8000-000000000006",
	team: "e8780000-0000-4000-8000-000000000010",
	secondTeam: "e8780000-0000-4000-8000-000000000011",
	otherTeam: "e8780000-0000-4000-8000-000000000012",
	project: "e8780000-0000-4000-8000-000000000020",
	otherTemplate: "e8780000-0000-4000-8000-000000000030",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.projectManagerUser,
	ids.employeeUser,
	ids.departedUser,
	ids.otherUser,
];

describe("project templates on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function templateNames(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{ name: string }>(
			"select name from project_template where organization_id = $1 order by name",
			[organizationId],
		);
		return rows.map((row) => row.name);
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
			 ($1, 'T878 templates', $1, 'Europe/Berlin', $3), ($2, 'T878 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
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
			 ($1, $4, 'Design team', now()), ($2, $4, 'Build team', now()), ($3, $5, 'Foreign team', now())`,
			[ids.team, ids.secondTeam, ids.otherTeam, ids.organization, ids.otherOrganization],
		);
		const employees: Array<[string, string, string, string, boolean?]> = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.admin, ids.adminUser, ids.organization, "employee"],
			[ids.projectManager, ids.projectManagerUser, ids.organization, "manager"],
			[ids.employee, ids.employeeUser, ids.organization, "employee"],
			[ids.departed, ids.departedUser, ids.organization, "employee", false],
			[ids.otherEmployee, ids.otherUser, ids.otherOrganization, "admin"],
		];
		for (const [id, userId, organizationId, role, isActive = true] of employees) {
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
				 values ($1, $2, $3, $4, $6, $5)`,
				[id, userId, organizationId, role, timestamp, isActive],
			);
		}
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'T878 project', 'active', true, $3, now())`,
			[ids.project, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.projectManager, ids.ownerUser],
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
	});

	afterAll(async () => {
		await cleanup();
	});

	const fullInput = {
		name: "  Website relaunch  ",
		description: "Our standard relaunch",
		icon: "IconRocket",
		color: "#3b82f6",
		budgetHours: 120.555,
		deadlineOffsetDays: 30,
		tasks: [{ name: "Design", description: "Wireframes", estimateHours: 12.5 }, { name: "Build" }],
		managerEmployeeIds: [ids.projectManager],
		assignments: [
			{ type: "team" as const, targetId: ids.team },
			{ type: "employee" as const, targetId: ids.employee },
		],
	};

	describe("an org admin", () => {
		it("creates a template with tasks, budget, deadline offset, managers and assignments", async () => {
			const created = await actAs(ids.ownerUser, () => templates.createProjectTemplate(fullInput));
			expect(created.success).toBe(true);
			if (!created.success) return;

			const read = await actAs(ids.ownerUser, () =>
				templates.getProjectTemplateDetails(created.data.id),
			);
			expect(read).toMatchObject({
				success: true,
				data: {
					id: created.data.id,
					organizationId: ids.organization,
					name: "Website relaunch",
					description: "Our standard relaunch",
					icon: "IconRocket",
					color: "#3b82f6",
					budgetHours: "120.56",
					deadlineOffsetDays: 30,
					tasks: [
						{ name: "Build", description: null, estimateHours: null },
						{ name: "Design", description: "Wireframes", estimateHours: "12.50" },
					],
					managers: [
						{ employeeId: ids.projectManager, name: "T878 Pm User", availability: "available" },
					],
					assignments: [
						{
							type: "team",
							teamId: ids.team,
							employeeId: null,
							name: "Design team",
							availability: "available",
						},
						{
							type: "employee",
							teamId: null,
							employeeId: ids.employee,
							name: "T878 Employee User",
							availability: "available",
						},
					],
				},
			});
		});

		it("edits a template, replacing its tasks, managers and assignments", async () => {
			const id = await createTemplate(ids.ownerUser, fullInput);

			const updated = await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(id, {
					name: "Website relaunch XL",
					color: "#ef4444",
					budgetHours: null,
					deadlineOffsetDays: 0,
					tasks: [{ name: "Launch", estimateHours: 2 }],
					managerEmployeeIds: [ids.employee],
					assignments: [{ type: "team", targetId: ids.secondTeam }],
				}),
			);
			expect(updated).toEqual({ success: true, data: undefined });

			expect(await readTemplate(id)).toMatchObject({
				name: "Website relaunch XL",
				description: null,
				icon: null,
				color: "#ef4444",
				budgetHours: null,
				deadlineOffsetDays: 0,
				tasks: [{ name: "Launch", estimateHours: "2.00" }],
				managers: [{ employeeId: ids.employee }],
				assignments: [{ type: "team", teamId: ids.secondTeam, name: "Build team" }],
			});
			expect((await readTemplate(id))?.managers).toHaveLength(1);
			expect((await readTemplate(id))?.tasks).toHaveLength(1);
		});

		it("deletes a template with everything it holds", async () => {
			const id = await createTemplate(ids.ownerUser, fullInput);

			const deleted = await actAs(ids.ownerUser, () => templates.deleteProjectTemplate(id));

			expect(deleted).toEqual({ success: true, data: undefined });
			expect(await readTemplate(id)).toBe(null);
			const { rows } = await admin.query<{ count: string }>(
				`select (select count(*) from project_template_task where template_id = $1)
				 + (select count(*) from project_template_manager where template_id = $1)
				 + (select count(*) from project_template_assignment where template_id = $1) as count`,
				[id],
			);
			expect(rows[0]?.count).toBe("0");
		});

		it("lists the organization's templates by name with their content counts", async () => {
			const relaunch = await createTemplate(ids.ownerUser, fullInput);
			const audit = await createTemplate(ids.adminUser, { name: "audit" });

			const listed = await actAs(ids.adminUser, () => templates.getProjectTemplates());

			expect(listed).toMatchObject({
				success: true,
				data: [
					{ id: audit, name: "audit", taskCount: 0, managerCount: 0, assignmentCount: 0 },
					{
						id: relaunch,
						name: "Website relaunch",
						budgetHours: "120.56",
						deadlineOffsetDays: 30,
						taskCount: 2,
						managerCount: 1,
						assignmentCount: 2,
					},
				],
			});
		});
	});

	describe("template names", () => {
		it("are unique within the organization, ignoring case and surrounding spaces", async () => {
			const first = await createTemplate(ids.ownerUser, { name: "Relaunch" });
			const second = await createTemplate(ids.ownerUser, { name: "Retainer" });

			const duplicate = await actAs(ids.ownerUser, () =>
				templates.createProjectTemplate({ name: " relaunch " }),
			);
			const renamedOntoFirst = await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(second, { name: "RELAUNCH" }),
			);

			for (const result of [duplicate, renamedOntoFirst]) {
				expect(result).toMatchObject({
					success: false,
					error: expect.stringMatching(/already exists/i),
				});
			}
			expect(await templateNames()).toEqual(["Relaunch", "Retainer"]);
			expect(first).not.toBe(second);
		});

		it("may repeat another organization's template name", async () => {
			await createTemplate(ids.ownerUser, { name: "Foreign template" });

			expect(await templateNames()).toEqual(["Foreign template"]);
			expect(await templateNames(ids.otherOrganization)).toEqual(["Foreign template"]);
		});
	});

	describe("template input", () => {
		it("refuses a blank name, a bad budget or offset and repeated task names, writing nothing", async () => {
			const results = await actAs(ids.ownerUser, () =>
				Promise.all([
					templates.createProjectTemplate({ name: "   " }),
					templates.createProjectTemplate({ name: "Zero budget", budgetHours: 0 }),
					templates.createProjectTemplate({ name: "Late", deadlineOffsetDays: -1 }),
					templates.createProjectTemplate({ name: "Fraction", deadlineOffsetDays: 1.5 }),
					templates.createProjectTemplate({
						name: "Twice",
						tasks: [{ name: "Design" }, { name: " design " }],
					}),
					templates.createProjectTemplate({ name: "Bad colour", color: "blue" }),
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
			expect(await templateNames()).toEqual([]);
		});
	});

	describe("template members", () => {
		it("refuses teams and employees of another organization", async () => {
			const results = await actAs(ids.ownerUser, () =>
				Promise.all([
					templates.createProjectTemplate({
						name: "Foreign manager",
						managerEmployeeIds: [ids.otherEmployee],
					}),
					templates.createProjectTemplate({
						name: "Foreign team",
						assignments: [{ type: "team", targetId: ids.otherTeam }],
					}),
					templates.createProjectTemplate({
						name: "Foreign employee",
						assignments: [{ type: "employee", targetId: ids.otherEmployee }],
					}),
				]),
			);

			expect(results.map((result) => result.success)).toEqual([false, false, false]);
			expect(await templateNames()).toEqual([]);
		});

		it("refuses adding an employee who has left the organization", async () => {
			const result = await actAs(ids.ownerUser, () =>
				templates.createProjectTemplate({
					name: "Departed",
					managerEmployeeIds: [ids.departed],
				}),
			);

			expect(result).toMatchObject({ success: false, error: expect.stringMatching(/left/i) });
			expect(await templateNames()).toEqual([]);
		});

		it("keeps an employee who left after being added, and reports them as departed", async () => {
			const id = await createTemplate(ids.ownerUser, {
				name: "Relaunch",
				managerEmployeeIds: [ids.employee],
				assignments: [{ type: "employee", targetId: ids.employee }],
			});
			await admin.query("update employee set is_active = false where id = $1", [ids.employee]);

			expect(await readTemplate(id)).toMatchObject({
				managers: [{ employeeId: ids.employee, availability: "departed" }],
				assignments: [{ employeeId: ids.employee, availability: "departed" }],
			});

			const resaved = await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(id, {
					name: "Relaunch",
					managerEmployeeIds: [ids.employee],
					assignments: [{ type: "employee", targetId: ids.employee }],
				}),
			);
			expect(resaved.success).toBe(true);
			expect((await readTemplate(id))?.managers).toMatchObject([
				{ employeeId: ids.employee, availability: "departed" },
			]);
		});

		it("stays valid when a team or employee is deleted, keeping their last known name", async () => {
			const id = await createTemplate(ids.ownerUser, {
				name: "Relaunch",
				managerEmployeeIds: [ids.employee],
				assignments: [
					{ type: "team", targetId: ids.team },
					{ type: "employee", targetId: ids.employee },
				],
			});
			await admin.query("delete from team where id = $1", [ids.team]);
			await admin.query("delete from employee where id = $1", [ids.employee]);

			expect(await readTemplate(id)).toMatchObject({
				managers: [{ employeeId: null, name: "T878 Employee User", availability: "removed" }],
				assignments: [
					{ type: "team", teamId: null, name: "Design team", availability: "removed" },
					{
						type: "employee",
						employeeId: null,
						name: "T878 Employee User",
						availability: "removed",
					},
				],
			});

			const resaved = await actAs(ids.ownerUser, () =>
				templates.updateProjectTemplate(id, { name: "Relaunch", tasks: [{ name: "Design" }] }),
			);
			expect(resaved.success).toBe(true);
			expect(await readTemplate(id)).toMatchObject({
				tasks: [{ name: "Design" }],
				managers: [],
				assignments: [],
			});
		});
	});

	describe("who may manage templates", () => {
		it("an org admin without a manager role may", async () => {
			const id = await createTemplate(ids.adminUser, fullInput);
			const results = [
				await actAs(ids.adminUser, () => templates.updateProjectTemplate(id, { name: "Renamed" })),
				await actAs(ids.adminUser, () => templates.getProjectTemplateDetails(id)),
				await actAs(ids.adminUser, () => templates.deleteProjectTemplate(id)),
			];

			expect(results.map((result) => result.success)).toEqual([true, true, true]);
		});

		it("a project manager and a plain employee are refused every template action", async () => {
			const id = await createTemplate(ids.ownerUser, fullInput);
			audit.logAudit.mockClear();

			for (const userId of [ids.projectManagerUser, ids.employeeUser]) {
				const results = await actAs(userId, () =>
					Promise.all([
						templates.getProjectTemplates(),
						templates.getProjectTemplateDetails(id),
						templates.createProjectTemplate({ name: "Intrusion" }),
						templates.updateProjectTemplate(id, { name: "Renamed" }),
						templates.deleteProjectTemplate(id),
					]),
				);
				expect(results.map((result) => result.success)).toEqual([
					false,
					false,
					false,
					false,
					false,
				]);
			}
			expect(await templateNames()).toEqual(["Website relaunch"]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});
	});

	describe("organization isolation", () => {
		it("an org admin cannot read, change or delete another organization's template", async () => {
			const results = await actAs(ids.ownerUser, () =>
				Promise.all([
					templates.getProjectTemplateDetails(ids.otherTemplate),
					templates.updateProjectTemplate(ids.otherTemplate, { name: "Renamed" }),
					templates.deleteProjectTemplate(ids.otherTemplate),
				]),
			);
			const listed = await actAs(ids.ownerUser, () => templates.getProjectTemplates());

			expect(results.map((result) => result.success)).toEqual([false, false, false]);
			expect(listed).toEqual({ success: true, data: [] });
			expect(await templateNames(ids.otherOrganization)).toEqual(["Foreign template"]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});

		it("the template reads never return another organization's template", async () => {
			await createTemplate(ids.ownerUser, { name: "Mine" });

			expect(await readTemplate(ids.otherTemplate)).toBe(null);
			expect(
				(await listProjectTemplates({ organizationId: ids.organization })).map((t) => t.name),
			).toEqual(["Mine"]);
		});
	});

	describe("templates are never projects", () => {
		it("never appear in project eligibility or the project list", async () => {
			await admin.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, 'employee', $3, $4)`,
				[ids.project, ids.organization, ids.employee, ids.ownerUser],
			);
			await createTemplate(ids.ownerUser, {
				...fullInput,
				managerEmployeeIds: [ids.employee],
				assignments: [
					{ type: "employee", targetId: ids.employee },
					{ type: "team", targetId: ids.team },
				],
			});
			await admin.query("update employee set team_id = $1 where id = $2", [ids.team, ids.employee]);

			const eligible = await listEligibleProjects({
				employeeId: ids.employee,
				teamId: ids.team,
				organizationId: ids.organization,
			});
			const projectList = await actAs(ids.ownerUser, () => getProjects(ids.organization));

			expect(eligible.map((project) => project.name)).toEqual(["T878 project"]);
			expect(projectList.success && projectList.data.map((project) => project.name)).toEqual([
				"T878 project",
			]);
		});
	});

	async function createTemplate(
		userId: string,
		input: Parameters<typeof templates.createProjectTemplate>[0],
	) {
		const result = await actAs(userId, () => templates.createProjectTemplate(input));
		if (!result.success) throw new Error(`Template creation failed: ${result.error}`);
		return result.data.id;
	}

	function readTemplate(templateId: string, organizationId: string = ids.organization) {
		return getProjectTemplate({ organizationId, templateId });
	}
});
