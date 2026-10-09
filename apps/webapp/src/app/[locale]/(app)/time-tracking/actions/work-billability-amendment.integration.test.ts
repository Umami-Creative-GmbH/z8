/**
 * #900 (pass B) runtime evidence: changing billability after recording.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real web clock-in/out, project-change and billability-change actions run
 * against PostgreSQL in both admissions (legacy and adopted append). A project
 * change re-applies the new project's billable default unless the same edit sets
 * the flag; a billability-only change is an attribution amendment
 * (`amendCompletedWork` in adopted organizations, with a receipt). The employee,
 * admins, the employee's managers and the project's project managers may change
 * billability; anyone else is refused and nothing is written. After every change
 * the legacy period and its canonical record agree on project and billability.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
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
							session: {
								id: `t900b-session-${harness.userId}`,
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

const { clockIn, clockOut } = await import("./clocking");
const { updateWorkPeriodBillability, updateWorkPeriodProject } = await import("../actions");
const { AMEND_COMPLETED_WORK_COMMAND_VERSION, amendCompletedWork } = await import(
	"@/lib/time-tracking/amend-completed-work"
);
const { withCompletedWorkTransaction } = await import(
	"@/lib/time-tracking/completed-work-transaction"
);

const ids = {
	organization: "t900b-billability-org",
	employeeUser: "t900b-employee-user",
	ownerUser: "t900b-owner-user",
	adminUser: "t900b-admin-user",
	managerUser: "t900b-manager-user",
	projectManagerUser: "t900b-project-manager-user",
	otherUser: "t900b-other-user",
	employee: "e9001000-0000-4000-8000-000000000001",
	owner: "e9001000-0000-4000-8000-000000000002",
	admin: "e9001000-0000-4000-8000-000000000003",
	manager: "e9001000-0000-4000-8000-000000000004",
	projectManager: "e9001000-0000-4000-8000-000000000005",
	other: "e9001000-0000-4000-8000-000000000006",
	customer: "e9001000-0000-4000-8000-000000000010",
	/** A customer's project whose billable default is on. */
	billableProject: "e9001000-0000-4000-8000-000000000021",
	/** A customer's project whose billable default is off; the project manager's project. */
	customerProject: "e9001000-0000-4000-8000-000000000022",
	/** An internal project without a customer. */
	internalProject: "e9001000-0000-4000-8000-000000000023",
} as const;
const users = [
	ids.employeeUser,
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.projectManagerUser,
	ids.otherUser,
];
const now = parseInstant("2026-07-22T18:00:00Z");
const workStart = parseInstant("2026-07-22T08:00:00Z");
const workEnd = parseInstant("2026-07-22T12:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type Attribution = {
	id: string;
	project_id: string | null;
	is_billable: boolean;
	is_active: boolean;
	graph_revision: number;
	canonical_record_id: string | null;
	allocations: { projectId: string; isBillable: boolean }[] | null;
};

describe("changing billability after recording on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string = ids.employeeUser) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function attributionOf(periodId: string): Promise<Attribution> {
		const { rows } = await admin.query<Attribution>(
			`select wp.id, wp.project_id, wp.is_billable, wp.is_active, wp.graph_revision,
			        wp.canonical_record_id,
			        (select json_agg(json_build_object('projectId', a.project_id, 'isBillable', a.is_billable)
			                         order by a.id)
			           from time_record_allocation a
			          where a.record_id = wp.canonical_record_id and a.allocation_kind = 'project') as allocations
			   from work_period wp
			  where wp.organization_id = $1 and wp.id = $2`,
			[ids.organization, periodId],
		);
		return only(rows);
	}

	/**
	 * The period records the expected project and billability, and its canonical
	 * record (when it has one) carries exactly the same project and billability.
	 */
	function expectAgreement(
		period: Attribution,
		expected: { projectId: string | null; billable: boolean },
		options: { canonical: boolean } = { canonical: true },
	) {
		expect({ projectId: period.project_id, billable: period.is_billable }).toEqual(expected);
		if (!options.canonical) return;
		expect(period.canonical_record_id).not.toBeNull();
		expect(period.allocations ?? []).toEqual(
			expected.projectId ? [{ projectId: expected.projectId, isBillable: expected.billable }] : [],
		);
	}

	/** Every work row, to prove a refused change left nothing behind. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function startWork() {
		actAs();
		await expect(
			clockIn("office", { instant: workStart, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null and deleted_at is null",
			[ids.employee],
		);
		return only(rows).id;
	}

	/** The employee's real clock-in and clock-out; returns the closed period. */
	async function recordWork(projectId: string | null) {
		const periodId = await startWork();
		await expect(
			clockOut(projectId, undefined, {
				submissionId: randomUUID(),
				instant: workEnd,
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		return attributionOf(periodId);
	}

	async function receipts() {
		const { rows } = await admin.query<{
			kind: string;
			writer: string;
			actor_user_id: string;
			work_period_id: string;
			result: {
				authority: string;
				changes: Record<string, boolean>;
				segment: { attribution: { projectId: string | null; isBillable: boolean } };
			};
		}>(
			`select kind, writer, actor_user_id, work_period_id, result
			   from completed_work_operation where organization_id = $1 order by created_at`,
			[ids.organization],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, created_at)
			 values ($1, 'T900b billability', $1, 'UTC', true, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'manual_time_submission', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'm-' || user_id, $1, user_id, role, 'approved', $4
			   from unnest($2::text[], $3::text[]) as t(user_id, role)`,
			[
				ids.organization,
				users,
				["member", "owner", "admin", "member", "member", "member"],
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 select employee_id, user_id, $4, role::role, $5
			   from unnest($1::uuid[], $2::text[], $3::text[]) as t(employee_id, user_id, role)`,
			[
				[ids.employee, ids.owner, ids.admin, ids.manager, ids.projectManager, ids.other],
				users,
				["employee", "admin", "employee", "manager", "manager", "employee"],
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.employee, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at) values
			 ($1, $4, 'Billable by default', 'active', true, $5, true, $6, $7),
			 ($2, $4, 'Customer project', 'active', true, $5, false, $6, $7),
			 ($3, $4, 'Internal', 'active', true, null, false, $6, $7)`,
			[
				ids.billableProject,
				ids.customerProject,
				ids.internalProject,
				ids.organization,
				ids.customer,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 select gen_random_uuid(), project_id, $2, 'employee', $3, $4 from unnest($1::uuid[]) as project_id`,
			[
				[ids.billableProject, ids.customerProject, ids.internalProject],
				ids.organization,
				ids.employee,
				ids.ownerUser,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.customerProject, ids.projectManager, ids.ownerUser],
		);
	}

	beforeEach(async () => {
		harness.now = now;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		describe("the employee", () => {
			it("lets the toggle override the new project's default in the same edit", async () => {
				const period = await recordWork(ids.customerProject);

				actAs();
				await expect(
					updateWorkPeriodProject(period.id, ids.billableProject, { billable: false }),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.billableProject,
					billable: false,
				});

				await expect(
					updateWorkPeriodProject(period.id, ids.customerProject, { billable: true }),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.customerProject,
					billable: true,
				});
			});

			it("re-applies the new project's default when the edit leaves the flag alone", async () => {
				const period = await recordWork(ids.billableProject);
				actAs();
				await expect(
					updateWorkPeriodBillability(period.id, false),
				).resolves.toMatchObject({ success: true });

				await expect(
					updateWorkPeriodProject(period.id, ids.customerProject),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.customerProject,
					billable: false,
				});
				await expect(
					updateWorkPeriodProject(period.id, ids.billableProject),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.billableProject,
					billable: true,
				});
			});

			it("changes billability alone and keeps the project", async () => {
				const period = await recordWork(ids.customerProject);

				actAs();
				await expect(
					updateWorkPeriodProject(period.id, ids.customerProject, { billable: true }),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.customerProject,
					billable: true,
				});

				await expect(
					updateWorkPeriodBillability(period.id, false),
				).resolves.toMatchObject({ success: true });
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.customerProject,
					billable: false,
				});
			});

			it.each([
				[
					"a project without a customer",
					ids.internalProject,
					"Work on a project without a customer cannot be billable",
				],
				["no project", null, "Work without a project cannot be billable"],
			])("refuses billable work on %s and writes nothing", async (_label, projectId, error) => {
				const period = await recordWork(projectId);
				const before = await snapshot();

				actAs();
				await expect(updateWorkPeriodBillability(period.id, true)).resolves.toEqual({
					success: false,
					error,
					code: "billable_not_allowed",
				});
				expect(await snapshot()).toEqual(before);
			});
		});

		describe("who else may change it", () => {
			it.each([
				["an organization owner", ids.ownerUser],
				["an organization admin", ids.adminUser],
				["the employee's manager", ids.managerUser],
				["a project manager of the work's project", ids.projectManagerUser],
			])("lets %s change billability", async (_label, actor) => {
				const period = await recordWork(ids.customerProject);

				actAs(actor);
				await expect(updateWorkPeriodBillability(period.id, true)).resolves.toMatchObject({
					success: true,
				});
				expectAgreement(await attributionOf(period.id), {
					projectId: ids.customerProject,
					billable: true,
				});
			});

			it.each([
				["another employee", ids.otherUser, ids.customerProject],
				["a project manager of another project", ids.projectManagerUser, ids.billableProject],
			])("refuses %s and writes nothing", async (_label, actor, projectId) => {
				const period = await recordWork(projectId);
				const before = await snapshot();

				actAs(actor);
				await expect(
					updateWorkPeriodBillability(period.id, period.is_billable === false),
				).resolves.toEqual({
					success: false,
					error: "Not authorized to correct this time entry",
				});
				expect(await snapshot()).toEqual(before);
			});

			it("never lets them change the project", async () => {
				const period = await recordWork(ids.customerProject);
				const before = await snapshot();

				actAs(ids.managerUser);
				await expect(
					updateWorkPeriodProject(period.id, ids.billableProject),
				).resolves.toEqual({ success: false, error: "Work period not found" });
				expect(await snapshot()).toEqual(before);
			});
		});
	});

	describe("adopted organizations", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("runs a billable-only change as an attribution amendment with a receipt", async () => {
			const period = await recordWork(ids.customerProject);
			const before = await receipts();

			actAs(ids.projectManagerUser);
			await expect(updateWorkPeriodBillability(period.id, true)).resolves.toMatchObject({
				success: true,
			});

			const after = await attributionOf(period.id);
			expect(after.graph_revision).toBe(period.graph_revision + 1);
			const [receipt, ...rest] = (await receipts()).slice(before.length);
			expect(rest).toEqual([]);
			expect(receipt).toMatchObject({
				kind: "amend_completed_work",
				writer: "work_period_attribution_edit",
				actor_user_id: ids.projectManagerUser,
				work_period_id: period.id,
				result: {
					authority: "owner_manager_or_project_manager",
					changes: {
						clockIn: false,
						clockOut: false,
						project: false,
						workCategory: false,
						workLocation: false,
						billable: true,
					},
					segment: { attribution: { projectId: ids.customerProject, isBillable: true } },
				},
			});
		});

		it("refuses a billable-only change that changes nothing", async () => {
			const period = await recordWork(ids.billableProject);
			const before = await snapshot();

			actAs();
			await expect(updateWorkPeriodBillability(period.id, true)).resolves.toEqual({
				success: false,
				error: "At least one correction value must change",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("changes the billability of live work, and the closure keeps it", async () => {
			const periodId = await startWork();
			actAs();
			await expect(updateWorkPeriodProject(periodId, ids.customerProject)).resolves.toMatchObject(
				{ success: true },
			);

			actAs(ids.managerUser);
			await expect(updateWorkPeriodBillability(periodId, true)).resolves.toMatchObject({
				success: true,
			});
			expectAgreement(
				await attributionOf(periodId),
				{ projectId: ids.customerProject, billable: true },
				{ canonical: false },
			);

			actAs();
			await expect(
				clockOut(undefined, undefined, {
					submissionId: randomUUID(),
					instant: workEnd,
					browserTimezone: "UTC",
				}),
			).resolves.toMatchObject({ success: true });
			expectAgreement(await attributionOf(periodId), {
				projectId: ids.customerProject,
				billable: true,
			});
		});

		it("limits the billability authority to billability-only intents", async () => {
			const period = await recordWork(ids.customerProject);
			const { rows } = await admin.query<{
				clock_in_id: string;
				clock_out_id: string;
				start_time: Date;
				end_time: Date;
			}>("select clock_in_id, clock_out_id, start_time, end_time from work_period where id = $1", [
				period.id,
			]);
			const source = only(rows);
			const before = await snapshot();

			await expect(
				withCompletedWorkTransaction(
					{
						organizationId: ids.organization,
						employeeId: ids.employee,
						actorUserId: ids.managerUser,
					},
					(scope) =>
						amendCompletedWork(scope, {
							organizationId: ids.organization,
							employeeId: ids.employee,
							actorUserId: ids.managerUser,
							authority: "owner_manager_or_project_manager",
							writer: "work_period_attribution_edit",
							command: {
								version: AMEND_COMPLETED_WORK_COMMAND_VERSION,
								operationId: randomUUID(),
								request: { workPeriodId: period.id, projectId: ids.billableProject },
							},
							intent: {
								workPeriodId: period.id,
								clockIn: { kind: "preserve" },
								clockOut: { kind: "preserve" },
								project: { kind: "replace", id: ids.billableProject },
								workCategory: { kind: "preserve" },
								workLocation: { kind: "preserve" },
								billable: { kind: "set", billable: true },
								notes: null,
							},
							expectedSource: {
								clockInId: source.clock_in_id,
								clockOutId: source.clock_out_id,
								startAt: instantFromDate(source.start_time),
								endAt: instantFromDate(source.end_time),
							},
							evaluatedAt: now,
							request: { ipAddress: null, deviceInfo: null },
						}),
				),
			).rejects.toMatchObject({ _tag: "AuthorizationError" });
			expect(await snapshot()).toEqual(before);
		});
	});
});
