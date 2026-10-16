/**
 * #1295 runtime evidence: bookings accepted without a task although their
 * project's task requirement was active are marked as missing a task (#884,
 * Projects ADR 0002), and writers that keep attribution keep the marker.
 * #1296: the marker ends when a task is added, the project changes, or the
 * project's requirement is turned off; a lapse keeps it.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real public server actions run against PostgreSQL in a legacy and an
 * adopted organization. Only the request/session, billing provisioning,
 * notification delivery and Next cache boundaries are replaced. Append
 * admission is enabled per organization by inserting its control row directly.
 * Automatic, legacy-route, frozen, kiosk and departure clock-outs and imports
 * have their marker cases in their own suites.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
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
								id: `t1295-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

// Project settings (#1296) check the session's SSO proof and write an audit record.
vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: async () => undefined,
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
				session: { activeOrganizationId: harness.organizationId },
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

const { splitWorkPeriod } = await import("../actions");
const { clockIn, clockOutAs, addBreakToActiveSession } = await import("./clocking");
const { editSameDayTimeEntry } = await import("./corrections");
const { updateWorkPeriodProject } = await import("./mutations");
const { applyAdminWorkPeriodTimeEdit } = await import(
	"@/lib/time-tracking/admin-work-period-time-edit"
);
const projectSettings = await import("../../settings/projects/actions");
const projectTasks = await import("../../settings/projects/task-actions");
const { systemClock } = await import("@/lib/datetime/temporal-core");
const { db } = await import("@/db");
const { employee } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

const ids = {
	organization: "t1295-missing-task-org",
	employeeUser: "t1295-employee-user",
	ownerUser: "t1295-owner-user",
	employee: "e1295000-0000-4000-8000-000000000001",
	owner: "e1295000-0000-4000-8000-000000000002",
	/** Requires a task (once turned on) and has open tasks: the requirement is active. */
	project: "e1295000-0000-4000-8000-000000000020",
	/** Requires a task but has no open task: the requirement has lapsed. */
	lapsedProject: "e1295000-0000-4000-8000-000000000021",
	/** Does not require a task. */
	plainProject: "e1295000-0000-4000-8000-000000000022",
	task: "e1295000-0000-4000-8000-000000000030",
	secondTask: "e1295000-0000-4000-8000-000000000031",
	lapsedDoneTask: "e1295000-0000-4000-8000-000000000032",
} as const;
const users = [ids.employeeUser, ids.ownerUser];

/** A Wednesday morning in Berlin (UTC+2): 08:00 to 12:00 local. */
const workStart = parseInstant("2026-07-22T06:00:00Z");
const workEnd = parseInstant("2026-07-22T10:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Admission = "legacy" | "adopted";

describe("marking bookings that came in missing a task on PostgreSQL (#1295)", () => {
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

	/** Turns the task requirement on for the requiring project. */
	async function requireTasks() {
		await admin.query(
			"update project set requires_task = true where organization_id = $1 and id = $2",
			[ids.organization, ids.project],
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
			 values ($1, 'T1295 missing task', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1295-m-employee', $1, $2, 'member', 'approved', $4),
			 ('t1295-m-owner', $1, $3, 'owner', 'approved', $4)`,
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
			`insert into project (id, organization_id, name, status, is_active, requires_task, created_by, updated_at) values
			 ($1, $4, 'T1295 required', 'active', true, false, $5, now()),
			 ($2, $4, 'T1295 lapsed', 'active', true, true, $5, now()),
			 ($3, $4, 'T1295 plain', 'active', true, false, $5, now())`,
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

	/** Clocks the employee in and returns the live period. */
	async function clockInEmployee(instant: Instant) {
		actAs(ids.employeeUser);
		await expect(
			clockIn("office", { instant, browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where organization_id = $1 and end_time is null",
			[ids.organization],
		);
		return only(rows).id;
	}

	/** Books the running period to a project directly, as a resume would carry it. */
	async function bookRunning(workPeriodId: string, projectId: string) {
		await admin.query(
			"update work_period set project_id = $3 where organization_id = $1 and id = $2",
			[ids.organization, workPeriodId, projectId],
		);
	}

	/** A bot clock-out of the employee's running work, keeping its project. */
	async function botClockOut(instant: Instant) {
		const [subject] = await db.select().from(employee).where(eq(employee.id, ids.employee));
		if (!subject) throw new Error("The employee is missing");
		const result = await clockOutAs(
			{ userId: ids.employeeUser, employee: subject, resolveTimezone: async () => "Europe/Berlin" },
			undefined,
			undefined,
			{
				submissionId: randomUUID(),
				identityOrigin: "server",
				deviceInfo: "telegram-bot",
				instant,
				browserTimezone: "Europe/Berlin",
			},
		);
		expect(result.success ? null : result.refusal).toBeNull();
	}

	/**
	 * Completed work on `projectId`, closed by a bot with nobody to pick a task,
	 * `laterDays` after the first work day.
	 */
	async function botWork(projectId: string, laterDays = 0) {
		const workPeriodId = await clockInEmployee(workStart.add({ hours: 24 * laterDays }));
		await bookRunning(workPeriodId, projectId);
		await botClockOut(workEnd.add({ hours: 24 * laterDays }));
		return workPeriodId;
	}

	/** The marker of every period of the employee and of its project allocation, in work order. */
	async function markers() {
		const { rows } = await admin.query<{
			project: string | null;
			task: string | null;
			period: boolean;
			allocation: boolean | null;
		}>(
			`select p.project_id as project, p.task_id as task, p.missing_task as period,
			        a.missing_task as allocation
			 from work_period p
			 left join time_record_allocation a
			   on a.record_id = p.canonical_record_id and a.organization_id = p.organization_id
			  and a.allocation_kind = 'project'
			 where p.organization_id = $1 and p.deleted_at is null
			 order by p.start_time`,
			[ids.organization],
		);
		return rows;
	}

	const marked = { project: ids.project, task: null, period: true, allocation: true };
	const unmarked = (project: string) => ({ project, task: null, period: false, allocation: false });

	describe.each(["legacy", "adopted"] as const)(
		"writers where nobody can pick a task in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
			});

			it("marks a bot clock-out without a task on both records", async () => {
				await requireTasks();

				await botWork(ids.project);

				expect(await markers()).toEqual([marked]);
			});

			it("marks the work a break closes, not the resumed work", async () => {
				await requireTasks();
				const workPeriodId = await clockInEmployee(systemClock.nowInstant().subtract({ hours: 2 }));
				await bookRunning(workPeriodId, ids.project);

				actAs(ids.employeeUser);
				await expect(
					addBreakToActiveSession(15, { submissionId: randomUUID(), browserTimezone: "UTC" }),
				).resolves.toMatchObject({ success: true });

				const [closed, resumed] = await markers();
				expect(closed).toEqual(marked);
				// The resumed work is live: no marker and no canonical record yet.
				expect(resumed).toMatchObject({ task: null, period: false, allocation: null });
			});

			it.each([
				["the requirement is off", ids.project],
				["the requirement lapsed with no open task", ids.lapsedProject],
				["the project requires no task", ids.plainProject],
			])("leaves a bot clock-out unmarked while %s", async (_case, projectId) => {
				await botWork(projectId);

				expect(await markers()).toEqual([unmarked(projectId)]);
			});

			it("never marks bookings made before the requirement was turned on", async () => {
				await botWork(ids.project);

				await requireTasks();

				expect(await markers()).toEqual([unmarked(ids.project)]);
			});
		},
	);

	describe.each(["legacy", "adopted"] as const)(
		"writers that keep attribution in a %s organization",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
				await requireTasks();
			});

			it("a split keeps the marker on both halves", async () => {
				const workPeriodId = await botWork(ids.project);

				actAs(ids.employeeUser);
				await expect(
					splitWorkPeriod(
						workPeriodId,
						"2026-07-22",
						"10:00",
						undefined,
						undefined,
						undefined,
						randomUUID(),
					),
				).resolves.toMatchObject({ success: true });

				expect(await markers()).toEqual([marked, marked]);
			});

			it("a time correction keeps the marker", async () => {
				const workPeriodId = await botWork(ids.project);

				actAs(ids.employeeUser);
				await expect(
					editSameDayTimeEntry({
						workPeriodId,
						submissionId: randomUUID(),
						newClockInDate: "2026-07-22",
						newClockInTime: "07:30",
						newClockOutDate: "2026-07-22",
						newClockOutTime: "12:00",
						workLocationType: "office",
						workCategoryId: null,
					}),
				).resolves.toEqual({ success: true, data: { workPeriodId } });

				expect(await markers()).toEqual([marked]);
				const { rows } = await admin.query("select start_time from work_period where id = $1", [
					workPeriodId,
				]);
				expect(rows).toEqual([{ start_time: new Date("2026-07-22T05:30:00Z") }]);
			});

			it("an admin time edit keeps the marker", async () => {
				const workPeriodId = await botWork(ids.project);
				const { rows } = await admin.query<{
					clock_in_id: string;
					clock_out_id: string;
					start_time: Date;
					end_time: Date;
				}>(
					"select clock_in_id, clock_out_id, start_time, end_time from work_period where id = $1",
					[workPeriodId],
				);
				const period = only(rows);

				await expect(
					applyAdminWorkPeriodTimeEdit({
						organizationId: ids.organization,
						actorUserId: ids.ownerUser,
						workPeriodId,
						submissionId: randomUUID(),
						submitted: {
							clockInDate: "2026-07-22",
							clockInTime: "08:00",
							clockOutDate: "2026-07-22",
							clockOutTime: "13:00",
						},
						expected: {
							employeeId: ids.employee,
							clockInId: period.clock_in_id,
							clockOutId: period.clock_out_id,
							startTime: period.start_time,
							endTime: period.end_time,
						},
						clockIn: period.start_time,
						clockOut: new Date("2026-07-22T11:00:00Z"),
						timezone: "Europe/Berlin",
						timezoneSource: "user_setting",
						notes: "Stayed longer",
						ipAddress: "",
						deviceInfo: "",
					}),
				).resolves.toMatchObject({ workPeriodId });

				expect(await markers()).toEqual([marked]);
				const { rows: edited } = await admin.query(
					"select end_time from work_period where id = $1",
					[workPeriodId],
				);
				expect(edited).toEqual([{ end_time: new Date("2026-07-22T11:00:00Z") }]);
			});
		},
	);

	describe.each(["legacy", "adopted"] as const)(
		"ending a missing task in a %s organization (#1296)",
		(admission) => {
			beforeEach(async () => {
				await setAdmission(admission);
				await requireTasks();
			});

			function changeProject(workPeriodId: string, projectId: string, taskId?: string) {
				actAs(ids.employeeUser);
				return updateWorkPeriodProject(workPeriodId, projectId, taskId);
			}

			function saveRequirement(projectId: string, requiresTask: boolean) {
				actAs(ids.ownerUser);
				return projectSettings.updateProject(projectId, { requiresTask });
			}

			/** Makes the lapsed project's task requirement active, so its bookings are marked too. */
			async function activateLapsedRequirement() {
				await admin.query(
					`update project_task set state = 'open', done_at = null, done_by = null
					 where organization_id = $1 and id = $2`,
					[ids.organization, ids.lapsedDoneTask],
				);
			}

			async function revisions() {
				const { rows } = await admin.query<{ id: string; graph_revision: number }>(
					`select id, graph_revision from work_period
					 where organization_id = $1 and deleted_at is null order by start_time`,
					[ids.organization],
				);
				return rows;
			}

			it("adding a task to a marked booking clears its marker", async () => {
				const workPeriodId = await botWork(ids.project);

				await expect(changeProject(workPeriodId, ids.project, ids.task)).resolves.toMatchObject({
					success: true,
				});

				expect(await markers()).toEqual([
					{ project: ids.project, task: ids.task, period: false, allocation: false },
				]);
			});

			it("changing a marked booking's project clears its marker", async () => {
				const workPeriodId = await botWork(ids.project);

				await expect(changeProject(workPeriodId, ids.plainProject)).resolves.toMatchObject({
					success: true,
				});

				expect(await markers()).toEqual([unmarked(ids.plainProject)]);
			});

			it("turning the requirement off clears that project's markers only, without a new revision", async () => {
				await activateLapsedRequirement();
				await botWork(ids.project);
				await botWork(ids.lapsedProject, 1);
				await botWork(ids.project, 2);
				const before = await revisions();

				await expect(saveRequirement(ids.project, false)).resolves.toMatchObject({
					success: true,
				});

				expect(await markers()).toEqual([
					unmarked(ids.project),
					{ ...marked, project: ids.lapsedProject },
					unmarked(ids.project),
				]);
				expect(await revisions()).toEqual(before);
			});

			it("turning the requirement back on does not bring cleared markers back", async () => {
				await botWork(ids.project);
				await expect(saveRequirement(ids.project, false)).resolves.toMatchObject({
					success: true,
				});

				await expect(saveRequirement(ids.project, true)).resolves.toMatchObject({
					success: true,
				});

				expect(await markers()).toEqual([unmarked(ids.project)]);
			});

			it("turning the requirement off clears markers in a closed month", async () => {
				await botWork(ids.project);
				const { rows } = await admin.query<{ id: string }>(
					`insert into closed_month (organization_id, month, scope, actor_kind, closed_by)
					 values ($1, '2026-07-01', 'organization', 'user', $2) returning id`,
					[ids.organization, ids.ownerUser],
				);
				await admin.query(
					`insert into closed_month_employee
					 (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
					 values ($1, $2, $3, '2026-07-01', '2026-07-01T00:00:00', '2026-08-01T00:00:00', 'Europe/Berlin')`,
					[ids.organization, only(rows).id, ids.employee],
				);

				await expect(saveRequirement(ids.project, false)).resolves.toMatchObject({
					success: true,
				});

				expect(await markers()).toEqual([unmarked(ids.project)]);
			});

			it("a lapse keeps the markers, and reopening a task makes them fixable again", async () => {
				const workPeriodId = await botWork(ids.project);

				actAs(ids.ownerUser);
				for (const taskId of [ids.task, ids.secondTask]) {
					await expect(projectTasks.markProjectTaskDone(taskId)).resolves.toMatchObject({
						success: true,
					});
				}
				expect(await markers()).toEqual([marked]);

				await expect(projectTasks.reopenProjectTask(ids.task)).resolves.toMatchObject({
					success: true,
				});
				await expect(changeProject(workPeriodId, ids.project, ids.task)).resolves.toMatchObject({
					success: true,
				});
				expect(await markers()).toEqual([
					{ project: ids.project, task: ids.task, period: false, allocation: false },
				]);
			});
		},
	);

	describe("the canonical divergence check in an adopted organization", () => {
		beforeEach(async () => {
			await setAdmission("adopted");
			await requireTasks();
		});

		function changeProject(workPeriodId: string, projectId: string, taskId: string) {
			actAs(ids.employeeUser);
			return updateWorkPeriodProject(workPeriodId, projectId, taskId);
		}

		it("holds work whose allocation lost the period's marker for review", async () => {
			const workPeriodId = await botWork(ids.project);
			await admin.query(
				`update time_record_allocation set missing_task = false
				 where organization_id = $1
				   and record_id = (select canonical_record_id from work_period where id = $2)`,
				[ids.organization, workPeriodId],
			);

			await expect(changeProject(workPeriodId, ids.project, ids.task)).resolves.toMatchObject({
				success: false,
				code: "completed_work_review_required",
			});
			expect(await markers()).toEqual([{ ...marked, allocation: false }]);
		});

		it("holds work whose allocation alone is marked for review", async () => {
			const workPeriodId = await botWork(ids.plainProject);
			await admin.query(
				`update time_record_allocation set missing_task = true
				 where organization_id = $1
				   and record_id = (select canonical_record_id from work_period where id = $2)`,
				[ids.organization, workPeriodId],
			);

			actAs(ids.employeeUser);
			const edited = await editSameDayTimeEntry({
				workPeriodId,
				submissionId: randomUUID(),
				newClockInDate: "2026-07-22",
				newClockInTime: "07:30",
				newClockOutDate: "2026-07-22",
				newClockOutTime: "12:00",
				workLocationType: "office",
				workCategoryId: null,
			});

			expect(edited).toMatchObject({ success: false });
			expect(await markers()).toEqual([{ ...unmarked(ids.plainProject), allocation: true }]);
		});
	});
});
