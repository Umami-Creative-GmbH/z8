/**
 * #1294 runtime evidence: a project's active task requirement (#884, Projects
 * ADR 0002) refuses bookings without a task where someone can pick one.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public server actions run against PostgreSQL in a legacy and an
 * adopted organization. Only the request/session, billing provisioning,
 * notification delivery and Next cache boundaries are replaced. Append
 * admission is enabled per organization by inserting its control row directly.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

// The employee edits their own work directly, as without a change policy's approval window.
vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	getEditCapabilityForPeriod: async () => ({
		type: "direct" as const,
		reason: "no_policy" as const,
	}),
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
							session: {
								id: `integration-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	const { employee } = await import("@/db/schema");
	const { and, eq } = await import("drizzle-orm");
	return {
		...original,
		// React `cache` would pin the first actor for the whole test process.
		getAuthContext: async () => {
			if (!harness.userId || !harness.organizationId) return null;
			const [row] = await db
				.select()
				.from(employee)
				.where(
					and(
						eq(employee.userId, harness.userId),
						eq(employee.organizationId, harness.organizationId),
					),
				)
				.limit(1);
			return {
				user: { id: harness.userId, name: harness.userId, email: `${harness.userId}@example.test` },
				session: {
					id: `integration-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
				employee: row
					? { id: row.id, organizationId: row.organizationId, role: row.role, teamId: row.teamId }
					: null,
			};
		},
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

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

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

const { createManualTimeEntry, getAssignedProjects, updateWorkPeriodBillability } = await import(
	"../actions"
);
const { getManualEntryTargetContext } = await import("./manual-entry-context");
const { getClockOutOnBehalfTaskChoices } = await import("./on-behalf-task-choices");
const { clockIn, clockOut, clockOutAs } = await import("./clocking");
const { closeWorkOnBehalf } = await import("./clock-out-on-behalf");
const { editSameDayTimeEntry } = await import("./corrections");
const { updateWorkPeriodProject } = await import("./mutations");
const { systemClock } = await import("@/lib/datetime/temporal-core");
const { db } = await import("@/db");
const { employee } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const ids = {
	organization: "t1294-task-org",
	employeeUser: "t1294-employee-user",
	ownerUser: "t1294-owner-user",
	employee: "e1294000-0000-4000-8000-000000000001",
	owner: "e1294000-0000-4000-8000-000000000002",
	/** Requires a task and has open tasks: the requirement is active. */
	project: "e1294000-0000-4000-8000-000000000020",
	/** Requires a task but has no open task: the requirement has lapsed. */
	lapsedProject: "e1294000-0000-4000-8000-000000000021",
	/** Does not require a task. */
	plainProject: "e1294000-0000-4000-8000-000000000022",
	task: "e1294000-0000-4000-8000-000000000030",
	secondTask: "e1294000-0000-4000-8000-000000000031",
	lapsedDoneTask: "e1294000-0000-4000-8000-000000000032",
	plainTask: "e1294000-0000-4000-8000-000000000033",
	customer: "e1294000-0000-4000-8000-000000000040",
} as const;
const users = [ids.employeeUser, ids.ownerUser];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** A Berlin summer entry for the signed-in employee unless overridden. */
function manualCommand(overrides: Partial<ManualTimeEntryCommand> = {}): ManualTimeEntryCommand {
	return {
		version: 2,
		submissionId: randomUUID(),
		targetEmployeeId: ids.employee,
		date: "2026-09-01",
		clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
		clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: 120 },
		zone: { basis: "target", timezone: "Europe/Berlin" },
		browserTimezone: "Europe/Berlin",
		reason: "Forgot to clock in",
		projectId: null,
		workCategoryId: null,
		...overrides,
	};
}

type Admission = "legacy" | "adopted";

describe("refusing bookings without a task on PostgreSQL (#1294)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(admission: Admission) {
		await admin.query("delete from time_entry_append_control where organization_id = $1", [
			ids.organization,
		]);
		if (admission === "adopted") {
			await admin.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
				[ids.organization],
			);
		}
	}

	/** Turns the task requirement on for the requiring projects. */
	async function requireTasks() {
		await admin.query(
			"update project set requires_task = true where organization_id = $1 and id = any($2::uuid[])",
			[ids.organization, [ids.project, ids.lapsedProject]],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1294 tasks', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1294-m-employee', $1, $2, 'member', 'approved', $4),
			 ('t1294-m-owner', $1, $3, 'owner', 'approved', $4)`,
			[ids.organization, ids.employeeUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'admin', $6)`,
			[ids.employee, ids.employeeUser, ids.owner, ids.ownerUser, ids.organization, timestamp],
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
			 ($1, $4, 'T1294 required', 'active', true, $5, now()),
			 ($2, $4, 'T1294 lapsed', 'active', true, $5, now()),
			 ($3, $4, 'T1294 plain', 'active', true, $5, now())`,
			[ids.project, ids.lapsedProject, ids.plainProject, ids.organization, ids.ownerUser],
		);
		for (const projectId of [ids.project, ids.lapsedProject, ids.plainProject]) {
			await admin.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, 'employee', $3, $4)`,
				[projectId, ids.organization, ids.employee, ids.ownerUser],
			);
		}
		const tasks: Array<[string, string, string, "open" | "done"]> = [
			[ids.task, ids.project, "Design", "open"],
			[ids.secondTask, ids.project, "Build", "open"],
			[ids.lapsedDoneTask, ids.lapsedProject, "Kickoff", "done"],
			[ids.plainTask, ids.plainProject, "Support", "open"],
		];
		for (const [id, projectId, name, state] of tasks) {
			await admin.query(
				`insert into project_task (id, organization_id, project_id, name, state, done_at, done_by,
				  created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
				[
					id,
					ids.organization,
					projectId,
					name,
					state,
					state === "done" ? timestamp : null,
					state === "done" ? ids.ownerUser : null,
					ids.ownerUser,
				],
			);
		}
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	/** Clocks the employee in two hours ago and returns the live period. */
	async function clockInEmployee() {
		actAs(ids.employeeUser);
		const instant = systemClock.nowInstant().subtract({ hours: 2 });
		await expect(clockIn("office", { instant, browserTimezone: "UTC" })).resolves.toMatchObject({
			success: true,
		});
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where organization_id = $1 and end_time is null",
			[ids.organization],
		);
		return only(rows).id;
	}

	/** Books the running period to a project and task directly, as a resume would carry them. */
	async function bookRunning(workPeriodId: string, projectId: string, taskId: string | null) {
		await admin.query(
			"update work_period set project_id = $3, task_id = $4 where organization_id = $1 and id = $2",
			[ids.organization, workPeriodId, projectId, taskId],
		);
	}

	function clockOutEmployee(projectId: string | null | undefined, taskId?: string | null) {
		actAs(ids.employeeUser);
		return clockOut(projectId, undefined, {
			submissionId: randomUUID(),
			instant: systemClock.nowInstant().subtract({ hours: 1 }),
			browserTimezone: "UTC",
			...(taskId !== undefined ? { taskId } : {}),
		});
	}

	async function period(workPeriodId: string) {
		const { rows } = await admin.query<{
			end_time: Date | null;
			project_id: string | null;
			task_id: string | null;
		}>(
			"select end_time, project_id, task_id from work_period where organization_id = $1 and id = $2",
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	/** Whether the work ended, its project and task, and whether it is marked missing a task. */
	async function closedWork(workPeriodId: string) {
		const { rows } = await admin.query<{
			ended: boolean;
			project_id: string | null;
			task_id: string | null;
			missing_task: boolean;
		}>(
			`select end_time is not null as ended, project_id, task_id, missing_task
			 from work_period where organization_id = $1 and id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	/**
	 * Makes the requiring project unbookable for the employee while it keeps its
	 * open tasks: nobody can pick one of them for the employee's work.
	 */
	async function makeProjectUnbookable(how: "unassigned" | "archived") {
		if (how === "unassigned") {
			await admin.query(
				"delete from project_assignment where organization_id = $1 and project_id = $2",
				[ids.organization, ids.project],
			);
			return;
		}
		await admin.query(
			"update project set status = 'archived' where organization_id = $1 and id = $2",
			[ids.organization, ids.project],
		);
	}

	describe("the pickers' project choices", () => {
		beforeEach(async () => {
			await requireTasks();
		});

		/** Each choice's project with its requirement setting and open task count. */
		function requirementsOf(
			projects: ReadonlyArray<{ id: string; requiresTask: boolean; tasks: unknown[] }>,
		) {
			return Object.fromEntries(
				projects.map((project) => [project.id, [project.requiresTask, project.tasks.length]]),
			);
		}

		it("carry each project's task requirement for the web clock", async () => {
			actAs(ids.employeeUser);

			const result = await getAssignedProjects();

			if (!result.success) throw new Error(result.error);
			expect(requirementsOf(result.data ?? [])).toEqual({
				[ids.project]: [true, 2],
				[ids.lapsedProject]: [true, 0],
				[ids.plainProject]: [false, 1],
			});
		});

		it("carry each project's task requirement for a manual entry", async () => {
			actAs(ids.ownerUser);

			const result = await getManualEntryTargetContext({ targetEmployeeId: ids.employee });

			if (!result.success) throw new Error(result.error);
			expect(requirementsOf(result.data?.projects ?? [])).toEqual({
				[ids.project]: [true, 2],
				[ids.lapsedProject]: [true, 0],
				[ids.plainProject]: [false, 1],
			});
		});

		it("carry the running work's project requirement for a clock-out on behalf", async () => {
			const workPeriodId = await clockInEmployee();
			await bookRunning(workPeriodId, ids.project, null);
			actAs(ids.ownerUser);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			expect(result).toMatchObject({
				success: true,
				data: { projectId: ids.project, requiresTask: true },
			});
		});

		it("offer no task for a clock-out on behalf once the project is not bookable", async () => {
			const workPeriodId = await clockInEmployee();
			await bookRunning(workPeriodId, ids.project, null);
			await makeProjectUnbookable("unassigned");
			actAs(ids.ownerUser);

			const result = await getClockOutOnBehalfTaskChoices(workPeriodId);

			// No open task to choose, so the dialog asks for none; the server accepts it.
			expect(result).toMatchObject({
				success: true,
				data: { projectId: ids.project, tasks: [] },
			});
		});
	});

	describe.each(["legacy", "adopted"] as const)(
		"web clock-out in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
				await requireTasks();
			});

			it("refuses a clock-out without a task and leaves the work running", async () => {
				const workPeriodId = await clockInEmployee();

				const result = await clockOutEmployee(ids.project);

				expect(result).toEqual({
					success: false,
					error: "Cannot book time to this task",
					code: "task_required",
				});
				expect(await period(workPeriodId)).toEqual({
					end_time: null,
					project_id: null,
					task_id: null,
				});
			});

			it("refuses a clock-out that keeps the running work's project without a task", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, null);

				await expect(clockOutEmployee(undefined)).resolves.toMatchObject({
					success: false,
					code: "task_required",
				});
				expect((await period(workPeriodId)).end_time).toBeNull();
			});

			it("refuses a clock-out that clears the running work's task on such a project", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, ids.task);

				await expect(clockOutEmployee(ids.project, null)).resolves.toMatchObject({
					success: false,
					code: "task_required",
				});
				expect(await period(workPeriodId)).toMatchObject({ end_time: null, task_id: ids.task });
			});

			it("clocks out with an open task of the project", async () => {
				const workPeriodId = await clockInEmployee();

				await expect(clockOutEmployee(ids.project, ids.task)).resolves.toMatchObject({
					success: true,
				});
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.task,
				});
			});

			it("keeps the running work's current task when the clock-out names none", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, ids.task);

				await expect(clockOutEmployee(ids.project)).resolves.toMatchObject({ success: true });
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.task,
				});
				expect((await period(workPeriodId)).end_time).not.toBeNull();
			});

			it.each([
				["a project whose requirement lapsed", ids.lapsedProject],
				["a project without the requirement", ids.plainProject],
				["no project", null],
			])("clocks out without a task on %s", async (_case, projectId) => {
				const workPeriodId = await clockInEmployee();

				await expect(clockOutEmployee(projectId)).resolves.toMatchObject({ success: true });
				expect(await period(workPeriodId)).toMatchObject({ project_id: projectId, task_id: null });
			});

			it.each([
				["no longer assigned to the employee", "unassigned"],
				["archived", "archived"],
			] as const)(
				"accepts and marks a clock-out keeping a project %s, where no task can be picked",
				async (_case, how) => {
					const workPeriodId = await clockInEmployee();
					await bookRunning(workPeriodId, ids.project, null);
					await makeProjectUnbookable(how);

					await expect(clockOutEmployee(undefined)).resolves.toMatchObject({ success: true });
					expect(await closedWork(workPeriodId)).toEqual({
						ended: true,
						project_id: ids.project,
						task_id: null,
						missing_task: true,
					});
				},
			);

			it("accepts a bot clock-out without a task", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, null);
				const [subject] = await db.select().from(employee).where(eq(employee.id, ids.employee));
				if (!subject) throw new Error("The employee is missing");

				const result = await clockOutAs(
					{
						userId: ids.employeeUser,
						employee: subject,
						resolveTimezone: async () => "Europe/Berlin",
					},
					undefined,
					undefined,
					{ submissionId: randomUUID(), identityOrigin: "server", deviceInfo: "telegram-bot" },
				);

				expect(result.success ? null : result.refusal).toBeNull();
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: null,
				});
				expect((await period(workPeriodId)).end_time).not.toBeNull();
			});
		},
	);

	describe.each(["legacy", "adopted"] as const)(
		"clock-out on behalf in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
				await requireTasks();
			});

			function closeOnBehalf(workPeriodId: string, taskId?: string) {
				return closeWorkOnBehalf({
					request: { workPeriodId, operationId: randomUUID(), taskId },
					session: { userId: ids.ownerUser, activeOrganizationId: ids.organization },
				});
			}

			it("refuses a clock-out without a task and leaves the work running", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, null);

				await expect(closeOnBehalf(workPeriodId)).resolves.toMatchObject({
					outcome: "rejected",
					code: "attribution_not_allowed",
					field: "taskId",
					reason: "task_required",
				});
				expect((await period(workPeriodId)).end_time).toBeNull();
			});

			it("clocks out with an open task of the project", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, null);

				await expect(closeOnBehalf(workPeriodId, ids.secondTask)).resolves.toMatchObject({
					outcome: "executed",
				});
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.secondTask,
				});
			});

			it("keeps the running work's current task", async () => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, ids.project, ids.task);

				await expect(closeOnBehalf(workPeriodId)).resolves.toMatchObject({
					outcome: "executed",
				});
				expect(await period(workPeriodId)).toMatchObject({ task_id: ids.task });
			});

			it.each([
				["a project whose requirement lapsed", ids.lapsedProject],
				["a project without the requirement", ids.plainProject],
			])("clocks out without a task on %s", async (_case, projectId) => {
				const workPeriodId = await clockInEmployee();
				await bookRunning(workPeriodId, projectId, null);

				await expect(closeOnBehalf(workPeriodId)).resolves.toMatchObject({
					outcome: "executed",
				});
				expect(await closedWork(workPeriodId)).toEqual({
					ended: true,
					project_id: projectId,
					task_id: null,
					missing_task: false,
				});
			});

			it.each([
				["no longer assigned to the employee", "unassigned"],
				["archived", "archived"],
			] as const)(
				"accepts and marks a clock-out keeping a project %s, where no task can be picked",
				async (_case, how) => {
					const workPeriodId = await clockInEmployee();
					await bookRunning(workPeriodId, ids.project, null);
					await makeProjectUnbookable(how);

					await expect(closeOnBehalf(workPeriodId)).resolves.toMatchObject({
						outcome: "executed",
					});
					expect(await closedWork(workPeriodId)).toEqual({
						ended: true,
						project_id: ids.project,
						task_id: null,
						missing_task: true,
					});
				},
			);
		},
	);

	/** Manual work for the employee: a version-2 command when adopted, legacy input otherwise. */
	function submitManual(
		admission: Admission,
		booking: { projectId: string | null; taskId?: string },
		date = "2026-09-01",
	) {
		actAs(ids.employeeUser);
		if (admission === "adopted") {
			return createManualTimeEntry(
				manualCommand({
					date,
					projectId: booking.projectId,
					...(booking.taskId ? { taskId: booking.taskId } : {}),
				}) as never,
			);
		}
		return createManualTimeEntry({
			submissionId: randomUUID(),
			date,
			clockInTime: "08:00",
			clockOutTime: "12:30",
			reason: "Forgot to clock in",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			...(booking.projectId ? { projectId: booking.projectId } : {}),
			...(booking.taskId ? { taskId: booking.taskId } : {}),
		} as never);
	}

	async function workPeriodCount() {
		const { rows } = await admin.query("select id from work_period where organization_id = $1", [
			ids.organization,
		]);
		return rows.length;
	}

	describe.each(["legacy", "adopted"] as const)(
		"manual entry in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
				await requireTasks();
			});

			it("refuses an entry without a task and writes nothing", async () => {
				const result = await submitManual(admission, { projectId: ids.project });

				expect(result).toMatchObject({ success: false, code: "task_required" });
				expect(await workPeriodCount()).toBe(0);
			});

			it("books an entry with an open task of the project", async () => {
				const result = await submitManual(admission, { projectId: ids.project, taskId: ids.task });

				if (!result.success) throw new Error(result.error);
				expect(await period(result.data.workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.task,
				});
			});

			it.each([
				["a project whose requirement lapsed", ids.lapsedProject],
				["a project without the requirement", ids.plainProject],
				["no project", null],
			])("books an entry without a task on %s", async (_case, projectId) => {
				const result = await submitManual(admission, { projectId });

				if (!result.success) throw new Error(result.error);
				expect(await period(result.data.workPeriodId)).toMatchObject({
					project_id: projectId,
					task_id: null,
				});
			});
		},
	);

	/** Completed work of the employee, booked before the requirement is turned on. */
	async function bookedWork(admission: Admission, projectId: string, taskId?: string) {
		const result = await submitManual(admission, { projectId, taskId });
		if (!result.success) throw new Error(result.error);
		return result.data.workPeriodId;
	}

	function changeProject(workPeriodId: string, projectId: string | null, taskId?: string | null) {
		actAs(ids.employeeUser);
		return updateWorkPeriodProject(workPeriodId, projectId, taskId);
	}

	describe.each(["legacy", "adopted"] as const)(
		"calendar edit in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
			});

			it("refuses setting the project without a task and keeps the booking", async () => {
				const workPeriodId = await bookedWork(admission, ids.plainProject, ids.plainTask);
				await requireTasks();

				await expect(changeProject(workPeriodId, ids.project)).resolves.toMatchObject({
					success: false,
					code: "task_required",
				});
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.plainProject,
					task_id: ids.plainTask,
				});
			});

			it("refuses clearing the task while keeping such a project", async () => {
				const workPeriodId = await bookedWork(admission, ids.project, ids.task);
				await requireTasks();

				await expect(changeProject(workPeriodId, ids.project, null)).resolves.toMatchObject({
					success: false,
					code: "task_required",
				});
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.task,
				});
			});

			it("sets the project with an open task of it", async () => {
				const workPeriodId = await bookedWork(admission, ids.plainProject);
				await requireTasks();

				await expect(
					changeProject(workPeriodId, ids.project, ids.secondTask),
				).resolves.toMatchObject({ success: true });
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.project,
					task_id: ids.secondTask,
				});
			});

			it("sets a project whose requirement lapsed without a task", async () => {
				const workPeriodId = await bookedWork(admission, ids.plainProject);
				await requireTasks();

				await expect(changeProject(workPeriodId, ids.lapsedProject)).resolves.toMatchObject({
					success: true,
				});
				expect(await period(workPeriodId)).toMatchObject({
					project_id: ids.lapsedProject,
					task_id: null,
				});
			});

			it("refuses setting the project of running work without a task", async () => {
				const workPeriodId = await clockInEmployee();
				await requireTasks();

				await expect(changeProject(workPeriodId, ids.project)).resolves.toMatchObject({
					success: false,
					code: "task_required",
				});
				expect(await period(workPeriodId)).toEqual({
					end_time: null,
					project_id: null,
					task_id: null,
				});
			});

			it("still changes the billability of a booking without a task on such a project", async () => {
				await admin.query(
					"update organization set projects_enabled = true, billable_time_enabled = true where id = $1",
					[ids.organization],
				);
				await admin.query(
					"insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR')",
					[ids.organization],
				);
				await admin.query(
					`insert into customer (id, organization_id, name, created_by, updated_at)
					 values ($1, $2, 'T1294 customer', $3, now())`,
					[ids.customer, ids.organization, ids.ownerUser],
				);
				await admin.query("update project set customer_id = $2 where id = $1", [
					ids.project,
					ids.customer,
				]);
				const workPeriodId = await bookedWork(admission, ids.project);
				await requireTasks();

				actAs(ids.employeeUser);
				await expect(updateWorkPeriodBillability(workPeriodId, true)).resolves.toEqual({
					success: true,
					data: { workPeriodId, isBillable: true },
				});
				const { rows } = await admin.query(
					"select is_billable, project_id, task_id from work_period where id = $1",
					[workPeriodId],
				);
				expect(rows).toEqual([{ is_billable: true, project_id: ids.project, task_id: null }]);
			});

			it("still edits the time of a booking without a task on such a project", async () => {
				const workPeriodId = await bookedWork(admission, ids.project);
				await requireTasks();

				actAs(ids.employeeUser);
				await expect(
					editSameDayTimeEntry({
						workPeriodId,
						submissionId: randomUUID(),
						newClockInDate: "2026-09-01",
						newClockInTime: "07:30",
						newClockOutDate: "2026-09-01",
						newClockOutTime: "12:30",
						workLocationType: "office",
						workCategoryId: null,
					}),
				).resolves.toEqual({ success: true, data: { workPeriodId } });
				const { rows } = await admin.query(
					"select start_time, project_id, task_id from work_period where id = $1",
					[workPeriodId],
				);
				expect(rows).toEqual([
					{
						start_time: new Date("2026-09-01T05:30:00Z"),
						project_id: ids.project,
						task_id: null,
					},
				]);
			});
		},
	);
});
