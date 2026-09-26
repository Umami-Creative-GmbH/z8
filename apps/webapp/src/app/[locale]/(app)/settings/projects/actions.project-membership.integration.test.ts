/**
 * #367 runtime evidence: project assignment and project manager settings.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real project settings server actions run against PostgreSQL. Only the
 * request/session, SSO proof, billing, notification delivery, audit sink and
 * Next cache boundaries are replaced.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
	};
});

const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 6,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t367-session-${current.userId}`,
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

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getPrincipalContext: async () => {
			const current = sessions.getStore();
			return current ? loadOrganizationPrincipalContext(db, current) : null;
		},
	};
});

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

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

const projects = await import("./actions");
const { getAssignedProjects } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { getManualEntryTargetContext } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/manual-entry-context"
);

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`project membership PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t367-membership-org",
	otherOrganization: "t367-other-org",
	ownerUser: "t367-owner-user",
	projectManagerUser: "t367-pm-user",
	employeeUser: "t367-employee-user",
	soloUser: "t367-solo-user",
	inactiveUser: "t367-inactive-user",
	otherUser: "t367-other-user",
	owner: "e3670000-0000-4000-8000-000000000001",
	projectManager: "e3670000-0000-4000-8000-000000000002",
	employee: "e3670000-0000-4000-8000-000000000003",
	soloEmployee: "e3670000-0000-4000-8000-000000000004",
	inactiveEmployee: "e3670000-0000-4000-8000-000000000005",
	otherEmployee: "e3670000-0000-4000-8000-000000000006",
	team: "e3670000-0000-4000-8000-000000000010",
	otherTeam: "e3670000-0000-4000-8000-000000000011",
	project: "e3670000-0000-4000-8000-000000000020",
	unmanagedProject: "e3670000-0000-4000-8000-000000000021",
	otherProject: "e3670000-0000-4000-8000-000000000022",
	projectManagerRow: "e3670000-0000-4000-8000-000000000030",
	otherAssignment: "e3670000-0000-4000-8000-000000000040",
} as const;
const users = [
	ids.ownerUser,
	ids.projectManagerUser,
	ids.employeeUser,
	ids.soloUser,
	ids.inactiveUser,
	ids.otherUser,
];

describeIntegration("project membership settings on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function managerIds() {
		const { rows } = await admin.query<{ employee_id: string }>(
			"select employee_id from project_manager where project_id = $1 order by employee_id",
			[ids.project],
		);
		return rows.map((row) => row.employee_id);
	}

	async function assignments(projectId: string = ids.project) {
		const { rows } = await admin.query<{ id: string; target: string }>(
			`select id, coalesce(team_id, employee_id)::text as target
			 from project_assignment where project_id = $1 order by target`,
			[projectId],
		);
		return rows;
	}

	async function assignmentIdFor(target: string) {
		const assignment = (await assignments()).find((row) => row.target === target);
		if (!assignment) throw new Error(`No assignment for ${target}`);
		return assignment.id;
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
			 ($1, 'T367 membership', $1, 'Europe/Berlin', $3), ($2, 'T367 other', $2, 'UTC', $3)`,
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
			[ids.organization, ids.soloUser, "member"],
			[ids.organization, ids.inactiveUser, "member"],
			[ids.otherOrganization, ids.otherUser, "member"],
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
			 ($1, $3, 'T367 team', $5), ($2, $4, 'T367 foreign team', $5)`,
			[ids.team, ids.otherTeam, ids.organization, ids.otherOrganization, timestamp],
		);
		const employees: Array<[string, string, string, string | null, string, boolean]> = [
			[ids.owner, ids.ownerUser, ids.organization, null, "admin", true],
			[ids.projectManager, ids.projectManagerUser, ids.organization, null, "manager", true],
			[ids.employee, ids.employeeUser, ids.organization, ids.team, "employee", true],
			[ids.soloEmployee, ids.soloUser, ids.organization, null, "employee", true],
			[ids.inactiveEmployee, ids.inactiveUser, ids.organization, null, "employee", false],
			[ids.otherEmployee, ids.otherUser, ids.otherOrganization, ids.otherTeam, "employee", true],
		];
		for (const [id, userId, organizationId, teamId, role, isActive] of employees) {
			await admin.query(
				`insert into employee (id, user_id, organization_id, team_id, role, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[id, userId, organizationId, teamId, role, isActive, timestamp],
			);
		}
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $4, 'T367 project', 'active', true, $6, now()),
			 ($2, $4, 'T367 unmanaged project', 'active', true, $6, now()),
			 ($3, $5, 'T367 foreign project', 'active', true, $6, now())`,
			[
				ids.project,
				ids.unmanagedProject,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
			],
		);
		await admin.query(
			`insert into project_manager (id, project_id, employee_id, assigned_by)
			 values ($1, $2, $3, $4)`,
			[ids.projectManagerRow, ids.project, ids.projectManager, ids.ownerUser],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[
				ids.otherAssignment,
				ids.otherProject,
				ids.otherOrganization,
				ids.otherEmployee,
				ids.otherUser,
			],
		);
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Project membership PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		await seed();
		audit.logAudit.mockClear();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("project managers", () => {
		it("a manager-tier project manager cannot add a project manager", async () => {
			const result = await actAs(ids.projectManagerUser, () =>
				projects.addProjectManager(ids.project, ids.employee),
			);

			expect(result.success).toBe(false);
			expect(await managerIds()).toEqual([ids.projectManager]);
		});

		it("a manager-tier project manager cannot remove a project manager, including themselves", async () => {
			const result = await actAs(ids.projectManagerUser, () =>
				projects.removeProjectManager(ids.project, ids.projectManager),
			);

			expect(result.success).toBe(false);
			expect(await managerIds()).toEqual([ids.projectManager]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});

		it("an org admin adds and removes a project manager", async () => {
			const added = await actAs(ids.ownerUser, () =>
				projects.addProjectManager(ids.project, ids.employee),
			);
			expect(added).toEqual({ success: true, data: undefined });
			expect(await managerIds()).toEqual([ids.projectManager, ids.employee].sort());

			const removed = await actAs(ids.ownerUser, () =>
				projects.removeProjectManager(ids.project, ids.projectManager),
			);
			expect(removed).toEqual({ success: true, data: undefined });
			expect(await managerIds()).toEqual([ids.employee]);
		});

		it("removing an employee who is not a manager of the project fails and writes no audit entry", async () => {
			const result = await actAs(ids.ownerUser, () =>
				projects.removeProjectManager(ids.project, ids.employee),
			);

			expect(result).toMatchObject({ success: false, error: expect.stringMatching(/not found/i) });
			expect(await managerIds()).toEqual([ids.projectManager]);
			expect(audit.logAudit).not.toHaveBeenCalled();
		});

		it("rejects inactive and foreign employees as project managers", async () => {
			for (const employeeId of [ids.inactiveEmployee, ids.otherEmployee]) {
				const result = await actAs(ids.ownerUser, () =>
					projects.addProjectManager(ids.project, employeeId),
				);
				expect(result.success).toBe(false);
			}
			expect(await managerIds()).toEqual([ids.projectManager]);
		});

		it("rejects project manager changes on a foreign project", async () => {
			const added = await actAs(ids.ownerUser, () =>
				projects.addProjectManager(ids.otherProject, ids.employee),
			);
			const removed = await actAs(ids.ownerUser, () =>
				projects.removeProjectManager(ids.otherProject, ids.otherEmployee),
			);

			expect(added.success).toBe(false);
			expect(removed.success).toBe(false);
		});
	});

	describe("project assignments", () => {
		it("a manager-tier project manager assigns a team and an employee to a managed project and removes one", async () => {
			const team = await actAs(ids.projectManagerUser, () =>
				projects.addProjectAssignment(ids.project, "team", ids.team),
			);
			const employee = await actAs(ids.projectManagerUser, () =>
				projects.addProjectAssignment(ids.project, "employee", ids.soloEmployee),
			);
			expect(team).toEqual({ success: true, data: undefined });
			expect(employee).toEqual({ success: true, data: undefined });
			expect((await assignments()).map((row) => row.target)).toEqual(
				[ids.team, ids.soloEmployee].sort(),
			);

			const teamAssignmentId = await assignmentIdFor(ids.team);
			const removed = await actAs(ids.projectManagerUser, () =>
				projects.removeProjectAssignment(teamAssignmentId),
			);
			expect(removed).toEqual({ success: true, data: undefined });
			expect((await assignments()).map((row) => row.target)).toEqual([ids.soloEmployee]);
		});

		it("a manager-tier employee cannot change assignments of a project they do not manage", async () => {
			const result = await actAs(ids.projectManagerUser, () =>
				projects.addProjectAssignment(ids.unmanagedProject, "employee", ids.soloEmployee),
			);

			expect(result.success).toBe(false);
			expect(await assignments(ids.unmanagedProject)).toEqual([]);
		});

		it("a member-tier employee cannot change assignments or project managers", async () => {
			const results = await actAs(ids.employeeUser, () =>
				Promise.all([
					projects.addProjectAssignment(ids.project, "employee", ids.employee),
					projects.addProjectManager(ids.project, ids.employee),
				]),
			);

			expect(results.map((result) => result.success)).toEqual([false, false]);
			expect(await assignments()).toEqual([]);
			expect(await managerIds()).toEqual([ids.projectManager]);
		});

		it("rejects foreign teams, foreign employees and inactive employees as assignment targets", async () => {
			const targets = [
				["team", ids.otherTeam],
				["employee", ids.otherEmployee],
				["employee", ids.inactiveEmployee],
			] as const;
			for (const [type, targetId] of targets) {
				const result = await actAs(ids.ownerUser, () =>
					projects.addProjectAssignment(ids.project, type, targetId),
				);
				expect(result.success).toBe(false);
			}
			expect(await assignments()).toEqual([]);
		});

		it("rejects assignment changes on a foreign project", async () => {
			const added = await actAs(ids.ownerUser, () =>
				projects.addProjectAssignment(ids.otherProject, "employee", ids.employee),
			);
			const removed = await actAs(ids.ownerUser, () =>
				projects.removeProjectAssignment(ids.otherAssignment),
			);

			expect(added.success).toBe(false);
			expect(removed.success).toBe(false);
			expect((await assignments(ids.otherProject)).map((row) => row.id)).toEqual([
				ids.otherAssignment,
			]);
		});
	});

	describe("project choices after assignment", () => {
		/** Project ids offered by the time clock and by manual entry (self and on behalf). */
		async function offeredProjects(employeeUserId: string, employeeId: string) {
			const clock = await actAs(employeeUserId, () => getAssignedProjects());
			const manualSelf = await actAs(employeeUserId, () => getManualEntryTargetContext({}));
			const manualOnBehalf = await actAs(ids.ownerUser, () =>
				getManualEntryTargetContext({ targetEmployeeId: employeeId }),
			);
			if (!clock.success || !manualSelf.success || !manualOnBehalf.success) {
				throw new Error(
					`Project choices failed: ${JSON.stringify([clock, manualSelf, manualOnBehalf])}`,
				);
			}
			return {
				clock: clock.data.map((choice) => choice.id),
				manualSelf: manualSelf.data.projects.map((choice) => choice.id),
				manualOnBehalf: manualOnBehalf.data.projects.map((choice) => choice.id),
			};
		}

		const none = { clock: [], manualSelf: [], manualOnBehalf: [] };
		const onlyProject = {
			clock: [ids.project],
			manualSelf: [ids.project],
			manualOnBehalf: [ids.project],
		};

		it("a team assignment offers the project to the team's employees", async () => {
			expect(await offeredProjects(ids.employeeUser, ids.employee)).toEqual(none);

			const result = await actAs(ids.ownerUser, () =>
				projects.addProjectAssignment(ids.project, "team", ids.team),
			);
			expect(result.success).toBe(true);

			expect(await offeredProjects(ids.employeeUser, ids.employee)).toEqual(onlyProject);
			expect(await offeredProjects(ids.soloUser, ids.soloEmployee)).toEqual(none);
		});

		it("an employee assignment offers the project to that employee until it is removed", async () => {
			const result = await actAs(ids.ownerUser, () =>
				projects.addProjectAssignment(ids.project, "employee", ids.soloEmployee),
			);
			expect(result.success).toBe(true);
			expect(await offeredProjects(ids.soloUser, ids.soloEmployee)).toEqual(onlyProject);

			const assignmentId = await assignmentIdFor(ids.soloEmployee);
			const removed = await actAs(ids.ownerUser, () =>
				projects.removeProjectAssignment(assignmentId),
			);
			expect(removed.success).toBe(true);
			expect(await offeredProjects(ids.soloUser, ids.soloEmployee)).toEqual(none);
		});
	});
});
