/**
 * #304 / T40 runtime evidence: the web active-session break through the shared
 * close/resume operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn` and `addBreakToActiveSession` actions (the calendar-facing
 * wrapper in `../actions` and the clocking action) run against that database.
 * Only the request/session, external billing provisioning, notification delivery
 * and the Next cache are replaced. Adoption is enabled per test organization by
 * inserting its append control row directly: production has no activation setter.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant, systemClock } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	forceApproval: false,
	logs: [] as { context: unknown; message: unknown }[],
	notifications: [] as { event: string; managerId: string }[],
}));

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
			max: 12,
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

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendClockOutApprovalNotifications: async (params: { managerId: string }) => {
		harness.notifications.push({ event: "pending", managerId: params.managerId });
	},
	sendClockOutApprovedNotification: async (params: { managerId: string }) => {
		harness.notifications.push({ event: "approved", managerId: params.managerId });
	},
}));

vi.mock("./policy-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("./policy-helpers")>();
	return {
		...original,
		checkClockOutNeedsApproval: async (employeeId: string) =>
			harness.forceApproval || (await original.checkClockOutNeedsApproval(employeeId)),
	};
});

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const record = (context: unknown, message?: unknown) => {
		harness.logs.push({ context, message });
	};
	return {
		...original,
		logger: { ...original.logger, error: record, warn: record, info: () => {}, debug: () => {} },
	};
});

const { clockIn, addBreakToActiveSession: addBreakAction } = await import("./clocking");
const { addBreakToActiveSession: addBreakFromCalendarActions } = await import("../actions");

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
	describe.skip(`active break PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t304-active-break-org",
	requesterUser: "t304-break-requester-user",
	managerUser: "t304-break-manager-user",
	requester: "e3040000-0000-4000-8000-000000000001",
	manager: "e3040000-0000-4000-8000-000000000002",
	managerLink: "e3040000-0000-4000-8000-000000000011",
	project: "e3040000-0000-4000-8000-000000000021",
	assignment: "e3040000-0000-4000-8000-000000000031",
	category: "e3040000-0000-4000-8000-000000000041",
} as const;
const collision =
	"This clock-out conflicts with an earlier request or changed work. Please refresh and try again.";
const failed = "Failed to add break. Please try again.";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("web active breaks through the close/resume operation on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string) {
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

	/** Real clock-in two hours ago, then the attribution a running session can carry. */
	async function startWork(start: Instant = systemClock.nowInstant().subtract({ hours: 2 })) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: start, browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			`update work_period set project_id = $2, work_category_id = $3, work_location_type = 'home'
			 where employee_id = $1 and end_time is null returning id, clock_in_id`,
			[ids.requester, ids.project, ids.category],
		);
		return only(rows);
	}

	function addBreak(breakMinutes: number, submissionId: string, via = addBreakAction) {
		actAs(ids.requesterUser);
		return via(breakMinutes, { submissionId, browserTimezone: "Europe/Berlin" });
	}

	/** Every row a break can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as approval_requests`,
			[ids.organization],
		);
		return only(rows);
	}

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			clock_in_id: string;
			clock_out_id: string | null;
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			is_active: boolean;
			approval_status: string;
			project_id: string | null;
			work_category_id: string | null;
			work_location_type: string | null;
			canonical_record_id: string | null;
			graph_revision: number;
		}>(
			`select id, clock_in_id, clock_out_id, start_time, end_time, duration_minutes, is_active,
			        approval_status, project_id, work_category_id, work_location_type,
			        canonical_record_id, graph_revision
			 from work_period where organization_id = $1 and deleted_at is null order by start_time`,
			[ids.organization],
		);
		return rows;
	}

	async function receipt(operationId: string) {
		const { rows } = await admin.query<{
			kind: string;
			writer: string;
			actor_user_id: string;
			work_period_id: string;
			command: Record<string, unknown>;
			result: {
				close: Record<string, unknown> & { segment: { startAt: string; endAt: string } };
				resume: Record<string, unknown> & { start: { at: string }; workPeriodId: string };
			};
		}>("select * from completed_work_operation where id = $1", [operationId]);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("drop function if exists t304_break_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const users = [ids.requesterUser, ids.managerUser];
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T304 breaks', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't304b-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at)
			 values ($1, $2, 'Project', 'active', true, $3, $4)`,
			[ids.project, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignment, ids.project, ids.organization, ids.requester, ids.managerUser],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, factor, is_active, created_by, updated_at)
			 values ($1, $2, 'Category', '1.00', true, $3, $4)`,
			[ids.category, ids.organization, ids.managerUser, timestamp],
		);
		await setAdmission("active");
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
			throw new Error("Active break PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.logs.length = 0;
		harness.notifications.length = 0;
		harness.forceApproval = false;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("closes and resumes adopted work in one operation with exact endpoints and carried attribution", async () => {
		const active = await startWork();
		const submissionId = randomUUID();

		const result = await addBreak(15, submissionId, addBreakFromCalendarActions);

		expect(result).toMatchObject({ success: true });
		const committed = await receipt(submissionId);
		expect(committed).toMatchObject({
			kind: "close_resume_work",
			writer: "web_clock_out",
			actor_user_id: ids.requesterUser,
			work_period_id: active.id,
			command: {
				version: 1,
				operationId: submissionId,
				breakMinutes: 15,
				browserTimezone: "Europe/Berlin",
				deviceInfo: "web",
			},
		});
		const resumeAt = parseInstant(committed.result.resume.start.at);
		const breakStart = resumeAt.subtract({ minutes: 15 });
		// The closure ends exactly the requested minutes before the resume.
		expect(committed.result.close.segment.endAt).toBe(breakStart.toString());
		expect(result).toEqual({
			success: true,
			data: {
				id: committed.result.resume.workPeriodId,
				startTime: new Date(resumeAt.epochMilliseconds),
			},
		});

		const [closed, resumed] = await periods();
		expect(closed).toMatchObject({
			id: active.id,
			is_active: false,
			approval_status: "approved",
			end_time: new Date(breakStart.epochMilliseconds),
			duration_minutes: 105,
			project_id: ids.project,
			work_category_id: ids.category,
			graph_revision: 1,
		});
		expect(resumed).toMatchObject({
			id: committed.result.resume.workPeriodId,
			clock_in_id: submissionId,
			is_active: true,
			start_time: new Date(resumeAt.epochMilliseconds),
			// The resumed work continues the closed work's attribution.
			project_id: ids.project,
			work_category_id: ids.category,
			work_location_type: "home",
		});
		expect(committed.result.resume).toMatchObject({
			attribution: {
				workLocationType: "home",
				projectId: ids.project,
				workCategoryId: ids.category,
			},
		});

		// Canonical record and allocation for the closed segment.
		const { rows: records } = await admin.query(
			`select tr.duration_minutes, tr.approval_state, w.work_category_id,
			        (select array_agg(a.project_id::text) from time_record_allocation a where a.record_id = tr.id) as allocations
			 from time_record tr join time_record_work w on w.record_id = tr.id where tr.id = $1`,
			[closed?.canonical_record_id],
		);
		expect(only(records)).toEqual({
			duration_minutes: 105,
			approval_state: "approved",
			work_category_id: ids.category,
			allocations: [ids.project],
		});

		// Append progression: clock-in, close, resume, each with an exact predecessor
		// and its own captured offset.
		const { rows: entries } = await admin.query<{
			id: string;
			type: string;
			previous_entry_id: string | null;
			utc_offset_minutes: number;
			timezone: string;
			timezone_source: string;
		}>(
			`select id, type, previous_entry_id, utc_offset_minutes, timezone, timezone_source
			 from time_entry where organization_id = $1 order by timestamp, created_at`,
			[ids.organization],
		);
		expect(entries.map(({ type }) => type)).toEqual(["clock_in", "clock_out", "clock_in"]);
		expect(entries[1]).toMatchObject({
			previous_entry_id: active.clock_in_id,
			timezone: "Europe/Berlin",
			timezone_source: "browser",
		});
		expect(entries[2]).toMatchObject({ id: submissionId, previous_entry_id: entries[1]?.id });
		const { rows: positions } = await admin.query(
			"select tip_entry_id, version from time_entry_append_position where employee_id = $1",
			[ids.requester],
		);
		expect(only(positions)).toEqual({ tip_entry_id: submissionId, version: 3 });
		const { rows: balances } = await admin.query(
			"select dirty_from_date from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(only(balances).dirty_from_date).not.toBeNull();

		// Exact replay through the other caller writes nothing.
		const after = await snapshot();
		await expect(addBreak(15, submissionId)).resolves.toEqual(result);
		expect(await snapshot()).toEqual(after);
		// A changed request under the same identity is a collision, not new work.
		await expect(addBreak(20, submissionId)).resolves.toEqual({
			success: false,
			error: collision,
		});
		expect(await snapshot()).toEqual(after);
	});

	it("routes the closed segment to required approval without promoting it", async () => {
		harness.forceApproval = true;
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
		await startWork();
		const submissionId = randomUUID();

		await expect(addBreak(15, submissionId)).resolves.toMatchObject({ success: true });

		const [closed, resumed] = await periods();
		expect(closed).toMatchObject({ is_active: false, approval_status: "pending" });
		expect(resumed).toMatchObject({ is_active: true });
		const { rows: requests } = await admin.query(
			"select entity_id, status from approval_request where organization_id = $1",
			[ids.organization],
		);
		expect(only(requests)).toEqual({ entity_id: closed?.id, status: "pending" });
		expect(harness.notifications).toEqual([{ event: "pending", managerId: ids.manager }]);

		// Replay repeats no effects.
		const after = await snapshot();
		await expect(addBreak(15, submissionId)).resolves.toMatchObject({ success: true });
		expect(await snapshot()).toEqual(after);
		expect(harness.notifications).toHaveLength(1);
	});

	it.each([
		["adopted", "active"],
		["legacy", "inactive"],
	] as const)(
		"refuses a %s break while the running work has an unresolved review",
		async (_name, mode) => {
			await setAdmission(mode);
			const active = await startWork();
			await admin.query(
				`insert into approval_request
				 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, reason, created_at, updated_at)
				 values ($1, $2, 'time_entry', $3, $4, $5, 'pending', 'Correction', now(), now())`,
				[randomUUID(), ids.organization, active.id, ids.requester, ids.manager],
			);
			const before = await snapshot();

			await expect(addBreak(15, randomUUID())).resolves.toEqual({
				success: false,
				error:
					"A time correction approval is already pending for this work period. Add the break once it is resolved.",
			});
			expect(await snapshot()).toEqual(before);
		},
	);

	it("rolls the closure back when the resumed interval is occupied", async () => {
		await startWork();
		const now = systemClock.nowInstant();
		// Completed work that ends after the resume instant occupies it.
		await admin.query(
			`insert into work_period (id, organization_id, employee_id, clock_in_id, start_time, end_time,
			  duration_minutes, is_active, approval_status, updated_at)
			 select $1, $2, $3, clock_in_id, $4, $5, 30, false, 'approved', now()
			 from work_period where employee_id = $3 and end_time is null`,
			[
				randomUUID(),
				ids.organization,
				ids.requester,
				new Date(now.add({ minutes: 30 }).epochMilliseconds),
				new Date(now.add({ minutes: 60 }).epochMilliseconds),
			],
		);
		const before = await snapshot();

		await expect(addBreak(15, randomUUID())).resolves.toEqual({
			success: false,
			error: "The break overlaps other recorded work.",
		});
		expect(await snapshot()).toEqual(before);
	});

	it.each([
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_record_allocation", "insert"],
		["time_entry", "insert"],
		["time_entry_append_position", "update"],
		["work_period", "update"],
		["work_period", "insert"],
		["employee_work_balance", "insert"],
		["completed_work_operation", "insert"],
	])(
		"rolls every write back when %s %s fails, and the retry commits once",
		async (table, event) => {
			await startWork();
			const before = await snapshot();
			const submissionId = randomUUID();
			await admin.query(
				`create function t304_break_fail() returns trigger language plpgsql as $$
				 begin raise exception 't304 injected failure'; end $$`,
			);
			await admin.query(
				`create trigger t304_break_fail before ${event} on ${table} for each row execute function t304_break_fail()`,
			);
			try {
				await expect(addBreak(15, submissionId)).resolves.toEqual({
					success: false,
					error: failed,
				});
			} finally {
				await admin.query("drop function t304_break_fail() cascade");
			}
			expect(await snapshot()).toEqual(before);

			await expect(addBreak(15, submissionId)).resolves.toMatchObject({ success: true });
			const { rows } = await admin.query(
				"select count(*)::int as receipts from completed_work_operation where id = $1",
				[submissionId],
			);
			expect(only(rows)).toEqual({ receipts: 1 });
			expect((await periods()).map(({ is_active }) => is_active)).toEqual([false, true]);
		},
	);

	it("keeps the established writes in a legacy organization", async () => {
		await setAdmission("inactive");
		const active = await startWork();

		await expect(addBreak(15, randomUUID())).resolves.toMatchObject({ success: true });

		const [closed, resumed] = await periods();
		expect(closed).toMatchObject({
			id: active.id,
			is_active: false,
			approval_status: "approved",
			graph_revision: 0,
		});
		expect(resumed).toMatchObject({ is_active: true, work_location_type: "home" });
		const { rows } = await admin.query(
			"select count(*)::int as receipts from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		expect(only(rows)).toEqual({ receipts: 0 });
	});
});
