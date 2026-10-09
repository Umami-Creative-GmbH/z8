/**
 * #874 runtime evidence: the task choices the web booking surfaces offer.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real server reads behind the clock popover and calendar project edit
 * (`getAssignedProjects`), the manual entry dialog (`getManualEntryTargetContext`)
 * and the clock-out on behalf dialog (`getClockOutOnBehalfTaskChoices`) run
 * against PostgreSQL, as does the calendar read that shows a booking's task.
 * Only the request/session, billing, notification and Next cache boundaries are
 * replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

// getRequestSession awaits connection(), which throws outside a Next request scope.
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
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		// The real loader on the test database, without Better Auth's session store.
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	return {
		...original,
		logger: {
			...original.logger,
			error: () => {},
			warn: () => {},
			info: () => {},
			debug: () => {},
		},
	};
});

const { getAssignedProjects } = await import("../actions");
const { getManualEntryTargetContext } = await import("./manual-entry-context");
const { getClockOutOnBehalfTaskChoices } = await import("./on-behalf-task-choices");
const { closeWorkOnBehalf } = await import("./clock-out-on-behalf");
const { clockIn } = await import("./clocking");
const { getWorkPeriodsForMonth } = await import("@/lib/calendar/work-period-service");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ids = {
	organization: "t874-task-org",
	otherOrganization: "t874-other-org",
	employeeUser: "t874-employee-user",
	ownerUser: "t874-owner-user",
	otherUser: "t874-other-user",
	employee: "e8740000-0000-4000-8000-000000000001",
	owner: "e8740000-0000-4000-8000-000000000002",
	otherEmployee: "e8740000-0000-4000-8000-000000000003",
	project: "e8740000-0000-4000-8000-000000000020",
	secondProject: "e8740000-0000-4000-8000-000000000021",
	emptyProject: "e8740000-0000-4000-8000-000000000022",
	otherProject: "e8740000-0000-4000-8000-000000000023",
	design: "e8740000-0000-4000-8000-000000000030",
	build: "e8740000-0000-4000-8000-000000000031",
	kickoff: "e8740000-0000-4000-8000-000000000032",
	audit: "e8740000-0000-4000-8000-000000000033",
	foreign: "e8740000-0000-4000-8000-000000000034",
} as const;
const users = [ids.employeeUser, ids.ownerUser, ids.otherUser];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** Each choice's project with the names of its tasks, in the offered order. */
function taskNamesByProject(projects: ReadonlyArray<{ id: string; tasks: { name: string }[] }>) {
	return Object.fromEntries(
		projects.map((project) => [project.id, project.tasks.map((task) => task.name)]),
	);
}

describe("task choices of the web booking surfaces on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
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
			 ($1, 'T874 tasks', $1, 'Europe/Berlin', $3), ($2, 'T874 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t874-m-employee', $1, $3, 'member', 'approved', $6),
			 ('t874-m-owner', $1, $4, 'owner', 'approved', $6),
			 ('t874-m-other', $2, $5, 'owner', 'approved', $6)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.employeeUser,
				ids.ownerUser,
				ids.otherUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $9), ($3, $4, $7, 'admin', $9), ($5, $6, $8, 'admin', $9)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.owner,
				ids.ownerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values
			 ($1, 'Europe/Berlin', $3), ($2, 'Europe/Berlin', $3)`,
			[ids.employeeUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now()),
			        ($1, 'policy_clock_out', 'legacy', 'legacy', now(), now()),
			        ($1, 'time_correction', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $5, 'T874 website', 'active', true, $7, now()),
			 ($2, $5, 'T874 audit', 'active', true, $7, now()),
			 ($3, $5, 'T874 internal', 'active', true, $7, now()),
			 ($4, $6, 'T874 foreign', 'active', true, $8, now())`,
			[
				ids.project,
				ids.secondProject,
				ids.emptyProject,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.otherUser,
			],
		);
		for (const projectId of [ids.project, ids.secondProject, ids.emptyProject]) {
			await admin.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, 'employee', $3, $4)`,
				[projectId, ids.organization, ids.employee, ids.ownerUser],
			);
		}
		const tasks: Array<[string, string, string, string, "open" | "done"]> = [
			[ids.design, ids.organization, ids.project, "Design", "open"],
			[ids.build, ids.organization, ids.project, "Build", "open"],
			[ids.kickoff, ids.organization, ids.project, "Kickoff", "done"],
			[ids.audit, ids.organization, ids.secondProject, "Fieldwork", "open"],
			[ids.foreign, ids.otherOrganization, ids.otherProject, "Foreign", "open"],
		];
		for (const [id, organizationId, projectId, name, state] of tasks) {
			const creator = organizationId === ids.organization ? ids.ownerUser : ids.otherUser;
			await admin.query(
				`insert into project_task (id, organization_id, project_id, name, state, done_at, done_by,
				  created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
				[
					id,
					organizationId,
					projectId,
					name,
					state,
					state === "done" ? timestamp : null,
					state === "done" ? creator : null,
					creator,
				],
			);
		}
	}

	/**
	 * The employee's running period in this legacy organization, booked to the given
	 * project and task as a resume after a break would carry them.
	 */
	async function runningPeriod(booking: { projectId: string | null; taskId: string | null }) {
		actAs(ids.employeeUser);
		const instant = systemClock.nowInstant().subtract({ hours: 2 });
		await expect(clockIn("office", { instant, browserTimezone: "UTC" })).resolves.toMatchObject({
			success: true,
		});
		const { rows } = await admin.query<{ id: string }>(
			`update work_period set project_id = $2, task_id = $3
			 where organization_id = $1 and end_time is null returning id`,
			[ids.organization, booking.projectId, booking.taskId],
		);
		return only(rows).id;
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("gives each of the employee's own projects its open tasks, by name", async () => {
		actAs(ids.employeeUser);

		const result = await getAssignedProjects();

		if (!result.success) throw new Error(result.error);
		expect(taskNamesByProject(result.data ?? [])).toEqual({
			[ids.project]: ["Build", "Design"],
			[ids.secondProject]: ["Fieldwork"],
			[ids.emptyProject]: [],
		});
	});

	it("gives a manual entry for another employee that employee's projects with their open tasks", async () => {
		actAs(ids.ownerUser);

		const result = await getManualEntryTargetContext({ targetEmployeeId: ids.employee });

		if (!result.success) throw new Error(result.error);
		expect(taskNamesByProject(result.data?.projects ?? [])).toEqual({
			[ids.project]: ["Build", "Design"],
			[ids.secondProject]: ["Fieldwork"],
			[ids.emptyProject]: [],
		});
	});

	describe("clock-out on behalf", () => {
		it("offers the open tasks of the running work's project and names its current task", async () => {
			const workPeriodId = await runningPeriod({ projectId: ids.project, taskId: ids.kickoff });
			actAs(ids.ownerUser);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			expect(result).toEqual({
				success: true,
				data: {
					projectId: ids.project,
					tasks: [
						{ id: ids.build, name: "Build" },
						{ id: ids.design, name: "Design" },
					],
					currentTask: {
						id: ids.kickoff,
						name: "Kickoff",
						state: "done",
						projectId: ids.project,
					},
				},
			});
		});

		it("offers nothing for running work without a project", async () => {
			const workPeriodId = await runningPeriod({ projectId: null, taskId: null });
			actAs(ids.ownerUser);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			expect(result).toEqual({
				success: true,
				data: { projectId: null, tasks: [], currentTask: null },
			});
		});

		it("refuses the employee's own running work", async () => {
			const workPeriodId = await runningPeriod({ projectId: ids.project, taskId: null });
			actAs(ids.employeeUser);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			expect(result).toMatchObject({ success: false });
		});

		it("does not reveal another organization's running work", async () => {
			const workPeriodId = await runningPeriod({ projectId: ids.project, taskId: null });
			actAs(ids.otherUser, ids.otherOrganization);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			expect(result).toMatchObject({ success: false });
		});

		it("books the task chosen in the dialog", async () => {
			const workPeriodId = await runningPeriod({ projectId: ids.project, taskId: null });
			actAs(ids.ownerUser);
			const choices = await getClockOutOnBehalfTaskChoices(workPeriodId);
			if (!choices.success) throw new Error(choices.error);
			const design = choices.data?.tasks.find((task) => task.name === "Design");

			const outcome = await closeWorkOnBehalf({
				request: { workPeriodId, operationId: randomUUID(), taskId: design?.id },
				session: { userId: ids.ownerUser, activeOrganizationId: ids.organization },
			});

			expect(outcome).toMatchObject({ outcome: "executed" });
			const { rows } = await admin.query<{ project_id: string; task_id: string }>(
				"select project_id, task_id from work_period where organization_id = $1 and id = $2",
				[ids.organization, workPeriodId],
			);
			expect(only(rows)).toEqual({ project_id: ids.project, task_id: ids.design });
		});
	});

	it("shows a booking's task next to its project on the calendar", async () => {
		const workPeriodId = await runningPeriod({ projectId: ids.project, taskId: ids.design });
		const now = systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin");

		const events = await getWorkPeriodsForMonth(
			now.month - 1,
			now.year,
			{ organizationId: ids.organization },
			"Europe/Berlin",
		);

		const event = only(events.filter((candidate) => candidate.id === workPeriodId));
		expect(event.title).toMatch(/^\[T874 website · Design\] /);
		expect(event.metadata).toMatchObject({
			projectId: ids.project,
			projectName: "T874 website",
			taskId: ids.design,
			taskName: "Design",
			taskState: "open",
		});
	});
});
