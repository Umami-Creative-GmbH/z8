/**
 * #873 runtime evidence: booking time to a project task.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public server actions (manual entry, clock-out, the project change)
 * run against PostgreSQL in a legacy and an adopted organization. Only the
 * request/session, billing provisioning, notification delivery and Next cache
 * boundaries are replaced. Append admission is enabled per organization by
 * inserting its control row directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

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

const { createManualTimeEntry } = await import("../actions");
const { clockIn, clockOut } = await import("./clocking");
const { updateWorkPeriodProject } = await import("./mutations");
const { systemClock } = await import("@/lib/datetime/temporal-core");

const ids = {
	organization: "t873-task-org",
	otherOrganization: "t873-other-org",
	employeeUser: "t873-employee-user",
	ownerUser: "t873-owner-user",
	otherUser: "t873-other-user",
	employee: "e8730000-0000-4000-8000-000000000001",
	owner: "e8730000-0000-4000-8000-000000000002",
	otherEmployee: "e8730000-0000-4000-8000-000000000003",
	project: "e8730000-0000-4000-8000-000000000020",
	secondProject: "e8730000-0000-4000-8000-000000000021",
	closedProject: "e8730000-0000-4000-8000-000000000022",
	otherProject: "e8730000-0000-4000-8000-000000000023",
	task: "e8730000-0000-4000-8000-000000000030",
	secondTask: "e8730000-0000-4000-8000-000000000031",
	doneTask: "e8730000-0000-4000-8000-000000000032",
	secondProjectTask: "e8730000-0000-4000-8000-000000000033",
	closedProjectTask: "e8730000-0000-4000-8000-000000000034",
	otherOrganizationTask: "e8730000-0000-4000-8000-000000000035",
} as const;
const users = [ids.employeeUser, ids.ownerUser, ids.otherUser];

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

/** The unversioned manual input a legacy organization still commits. */
function legacyManualInput(overrides: Record<string, unknown> = {}) {
	return {
		submissionId: randomUUID(),
		date: "2026-09-01",
		clockInTime: "08:00",
		clockOutTime: "12:30",
		reason: "Forgot to clock in",
		timezone: "Europe/Berlin",
		browserTimezone: "Europe/Berlin",
		...overrides,
	};
}

type Admission = "legacy" | "adopted";

describe("booking time to a project task on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
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
		return createManualTimeEntry(
			legacyManualInput({
				date,
				...(booking.projectId ? { projectId: booking.projectId } : {}),
				...(booking.taskId ? { taskId: booking.taskId } : {}),
			}) as never,
		);
	}

	/** The booking of one period, as its work period and its canonical allocation record it. */
	async function booking(workPeriodId: string) {
		const { rows } = await admin.query<{
			period_project: string | null;
			period_task: string | null;
			allocation_project: string | null;
			allocation_task: string | null;
		}>(
			`select p.project_id as period_project, p.task_id as period_task,
			        a.project_id as allocation_project, a.task_id as allocation_task
			 from work_period p
			 left join time_record_allocation a
			   on a.record_id = p.canonical_record_id and a.organization_id = p.organization_id
			 where p.organization_id = $1 and p.id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
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
			 ($1, 'T873 tasks', $1, 'Europe/Berlin', $3), ($2, 'T873 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t873-m-employee', $1, $3, 'member', 'approved', $6),
			 ('t873-m-owner', $1, $4, 'owner', 'approved', $6),
			 ('t873-m-other', $2, $5, 'owner', 'approved', $6)`,
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
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $5, 'T873 project', 'active', true, $7, now()),
			 ($2, $5, 'T873 second project', 'active', true, $7, now()),
			 ($3, $5, 'T873 completed project', 'completed', true, $7, now()),
			 ($4, $6, 'T873 foreign project', 'active', true, $8, now())`,
			[
				ids.project,
				ids.secondProject,
				ids.closedProject,
				ids.otherProject,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.otherUser,
			],
		);
		for (const projectId of [ids.project, ids.secondProject, ids.closedProject]) {
			await admin.query(
				`insert into project_assignment (project_id, organization_id, assignment_type, employee_id, created_by)
				 values ($1, $2, 'employee', $3, $4)`,
				[projectId, ids.organization, ids.employee, ids.ownerUser],
			);
		}
		const tasks: Array<[string, string, string, string, "open" | "done"]> = [
			[ids.task, ids.organization, ids.project, "Design", "open"],
			[ids.secondTask, ids.organization, ids.project, "Build", "open"],
			[ids.doneTask, ids.organization, ids.project, "Kickoff", "done"],
			[ids.secondProjectTask, ids.organization, ids.secondProject, "Audit", "open"],
			[ids.closedProjectTask, ids.organization, ids.closedProject, "Wait", "open"],
			[ids.otherOrganizationTask, ids.otherOrganization, ids.otherProject, "Foreign", "open"],
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

	beforeEach(async () => {
		harness.now = null;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each(["legacy", "adopted"] as const)("manual entry in a %s organization", (admission) => {
		beforeEach(async () => {
			await setAdmission(admission);
		});

		it("books the work to the task on both the allocation and the work period", async () => {
			const result = await submitManual(admission, { projectId: ids.project, taskId: ids.task });

			expect(result).toMatchObject({ success: true });
			if (!result.success) throw new Error(result.error);
			expect(await booking(result.data.workPeriodId)).toEqual({
				period_project: ids.project,
				period_task: ids.task,
				allocation_project: ids.project,
				allocation_task: ids.task,
			});
		});

		it("books no task when the entry names none", async () => {
			const result = await submitManual(admission, { projectId: ids.project });

			if (!result.success) throw new Error(result.error);
			expect(await booking(result.data.workPeriodId)).toEqual({
				period_project: ids.project,
				period_task: null,
				allocation_project: ids.project,
				allocation_task: null,
			});
		});

		it.each([
			["a done task", ids.doneTask, ids.project, "task_done"],
			["another project's task", ids.secondProjectTask, ids.project, "task_other_project"],
			["another organization's task", ids.otherOrganizationTask, ids.project, "task_not_found"],
		])("refuses %s with a stable reason and writes nothing", async (_case, taskId, projectId, code) => {
			const result = await submitManual(admission, { projectId, taskId });

			expect(result).toMatchObject({ success: false, code });
			const { rows } = await admin.query("select id from work_period where organization_id = $1", [
				ids.organization,
			]);
			expect(rows).toEqual([]);
		});
	});

	/** Completed work of the employee, booked through manual entry. */
	async function bookedWork(admission: Admission, taskId: string | undefined = ids.task) {
		const result = await submitManual(admission, { projectId: ids.project, taskId });
		if (!result.success) throw new Error(result.error);
		return result.data.workPeriodId;
	}

	function changeProject(workPeriodId: string, projectId: string | null, taskId?: string | null) {
		actAs(ids.employeeUser);
		return updateWorkPeriodProject(workPeriodId, projectId, taskId);
	}

	async function amendReceipts() {
		const { rows } = await admin.query<{ kind: string; command: unknown }>(
			`select kind, command from completed_work_operation
			 where organization_id = $1 and kind = 'amend_completed_work' order by created_at`,
			[ids.organization],
		);
		return rows;
	}

	describe.each(["legacy", "adopted"] as const)("the project change in a %s organization", (admission) => {
		beforeEach(async () => {
			await setAdmission(admission);
		});

		it("clears the task when the project changes without a task", async () => {
			const workPeriodId = await bookedWork(admission);

			await expect(changeProject(workPeriodId, ids.secondProject)).resolves.toMatchObject({
				success: true,
			});

			const booked = await booking(workPeriodId);
			expect(booked).toMatchObject({ period_project: ids.secondProject, period_task: null });
			if (admission === "adopted") {
				expect(booked).toMatchObject({
					allocation_project: ids.secondProject,
					allocation_task: null,
				});
				expect(await amendReceipts()).toHaveLength(1);
			}
		});

		it("changes only the task", async () => {
			const workPeriodId = await bookedWork(admission);

			await expect(
				changeProject(workPeriodId, ids.project, ids.secondTask),
			).resolves.toMatchObject({ success: true });

			const booked = await booking(workPeriodId);
			expect(booked).toMatchObject({ period_project: ids.project, period_task: ids.secondTask });
			if (admission === "adopted") {
				expect(booked).toMatchObject({
					allocation_project: ids.project,
					allocation_task: ids.secondTask,
				});
				expect(await amendReceipts()).toEqual([
					expect.objectContaining({
						command: expect.objectContaining({
							request: {
								workPeriodId,
								projectId: ids.project,
								taskId: ids.secondTask,
							},
						}),
					}),
				]);
			}
		});

		it("books a task of the new project with the project change", async () => {
			const workPeriodId = await bookedWork(admission);

			await expect(
				changeProject(workPeriodId, ids.secondProject, ids.secondProjectTask),
			).resolves.toMatchObject({ success: true });

			expect(await booking(workPeriodId)).toMatchObject({
				period_project: ids.secondProject,
				period_task: ids.secondProjectTask,
			});
		});

		it.each([
			["a done task", ids.doneTask, "task_done"],
			["another project's task", ids.secondProjectTask, "task_other_project"],
			["another organization's task", ids.otherOrganizationTask, "task_not_found"],
		])("refuses %s with a stable reason", async (_case, taskId, code) => {
			const workPeriodId = await bookedWork(admission);

			await expect(changeProject(workPeriodId, ids.project, taskId)).resolves.toMatchObject({
				success: false,
				code,
			});
			expect(await booking(workPeriodId)).toMatchObject({ period_task: ids.task });
		});

		it("refuses a task of a project that can no longer be booked", async () => {
			const workPeriodId = await bookedWork(admission);
			await admin.query("update project set status = 'completed' where id = $1", [ids.project]);

			await expect(
				changeProject(workPeriodId, ids.project, ids.secondTask),
			).resolves.toMatchObject({ success: false, code: "project_not_bookable" });
		});
	});

	describe("the canonical divergence check in an adopted organization", () => {
		beforeEach(async () => {
			await setAdmission("adopted");
		});

		it("holds work whose period and allocation disagree on the task for review", async () => {
			const workPeriodId = await bookedWork("adopted");
			await admin.query("update work_period set task_id = $2 where id = $1", [
				workPeriodId,
				ids.secondTask,
			]);

			await expect(changeProject(workPeriodId, ids.secondProject)).resolves.toMatchObject({
				success: false,
				code: "completed_work_review_required",
			});
			expect(await booking(workPeriodId)).toMatchObject({
				period_project: ids.project,
				period_task: ids.secondTask,
				allocation_task: ids.task,
			});
		});
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

	function clockOutEmployee(projectId: string | null | undefined, taskId?: string | null) {
		actAs(ids.employeeUser);
		return clockOut(projectId, undefined, {
			submissionId: randomUUID(),
			instant: systemClock.nowInstant().subtract({ hours: 1 }),
			browserTimezone: "UTC",
			...(taskId !== undefined ? { taskId } : {}),
		});
	}

	describe.each(["legacy", "adopted"] as const)("clock-out in a %s organization", (admission) => {
		beforeEach(async () => {
			await setAdmission(admission);
		});

		it("books the closed work to the task on both the allocation and the work period", async () => {
			const workPeriodId = await clockInEmployee();

			await expect(clockOutEmployee(ids.project, ids.task)).resolves.toMatchObject({
				success: true,
			});

			expect(await booking(workPeriodId)).toEqual({
				period_project: ids.project,
				period_task: ids.task,
				allocation_project: ids.project,
				allocation_task: ids.task,
			});
		});

		it("closes without a task when the clock-out names none", async () => {
			const workPeriodId = await clockInEmployee();

			await expect(clockOutEmployee(ids.project)).resolves.toMatchObject({ success: true });

			expect(await booking(workPeriodId)).toMatchObject({
				period_project: ids.project,
				period_task: null,
				allocation_task: null,
			});
		});

		it.each([
			["a done task", ids.doneTask],
			["another project's task", ids.secondProjectTask],
			["another organization's task", ids.otherOrganizationTask],
		])("refuses %s and leaves the work running", async (_case, taskId) => {
			const workPeriodId = await clockInEmployee();

			const result = await clockOutEmployee(ids.project, taskId);

			expect(result).toEqual({ success: false, error: "Cannot book time to this task" });
			const { rows } = await admin.query(
				"select end_time, task_id from work_period where organization_id = $1 and id = $2",
				[ids.organization, workPeriodId],
			);
			expect(rows).toEqual([{ end_time: null, task_id: null }]);
		});
	});
});
