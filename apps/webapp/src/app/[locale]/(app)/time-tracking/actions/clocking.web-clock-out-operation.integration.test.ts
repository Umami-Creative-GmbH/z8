/**
 * #274 / T10 runtime evidence: web clock-out through the completed-work operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn`/`clockOut` server actions run against that database. Only the
 * request/session, external billing provisioning, notification delivery, and Next
 * cache boundaries are replaced. Adoption is enabled per test organization by
 * inserting its append control row directly: production has no activation setter.
 * `checkClockOutNeedsApproval` is production-false today, so approval scenarios
 * force only that decision and keep the real routing and approval collaborators.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

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

const { clockIn, clockOut } = await import("./clocking");
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");

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
	describe.skip(`web clock-out operation PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t274-clock-out-operation-org",
	requesterUser: "t274-requester-user",
	managerUser: "t274-manager-user",
	peerUser: "t274-peer-user",
	requester: "e1000000-0000-4000-8000-000000000001",
	manager: "e1000000-0000-4000-8000-000000000002",
	peer: "e1000000-0000-4000-8000-000000000003",
	managerLink: "e2000000-0000-4000-8000-000000000001",
	projectA: "e3000000-0000-4000-8000-000000000001",
	projectB: "e3000000-0000-4000-8000-000000000002",
	assignmentB: "e3000000-0000-4000-8000-000000000003",
} as const;
const genericFailure = "Failed to clock out. Please try again.";
const collision =
	"This clock-out conflicts with an earlier request or changed work. Please refresh and try again.";
const clockInAt = parseInstant("2026-07-22T08:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("web clock-out through the completed-work operation on PostgreSQL", () => {
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

	async function clockInRequester(instant: Instant = clockInAt, userId = ids.requesterUser) {
		actAs(userId);
		await expect(clockIn("office", { instant, browserTimezone: "UTC" })).resolves.toMatchObject({
			success: true,
		});
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			`select wp.id, wp.clock_in_id from work_period wp join employee e on e.id = wp.employee_id
			 where e.user_id = $1 and wp.end_time is null`,
			[userId],
		);
		return only(rows);
	}

	function clockOutRequester(
		options: {
			submissionId?: string;
			instant?: Instant;
			projectId?: string | null;
			workCategoryId?: string | null;
			userId?: string;
		} = {},
	) {
		actAs(options.userId ?? ids.requesterUser);
		return clockOut(options.projectId, options.workCategoryId, {
			submissionId: options.submissionId ?? randomUUID(),
			instant: options.instant ?? clockInAt.add({ minutes: 60, seconds: 40 }),
			browserTimezone: "UTC",
		});
	}

	/** Every row the closure can write, to prove "no writes" by equality. */
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
			   (select count(*)::int from approval_request where organization_id = $1) as approval_requests`,
			[ids.organization],
		);
		return only(rows);
	}

	async function closedGraph(periodId: string) {
		const { rows } = await admin.query<{
			is_active: boolean;
			end_time: Date;
			duration_minutes: number;
			clock_out_id: string;
			canonical_record_id: string;
			approval_status: string;
			project_id: string | null;
			work_category_id: string | null;
			graph_revision: number;
			record_duration: number;
			record_state: string;
			record_origin: string;
			record_created_by: string;
			record_start: Date;
			record_end: Date;
			work_location_type: string | null;
			work_category: string | null;
			allocations: string[] | null;
		}>(
			`select wp.is_active, wp.end_time, wp.duration_minutes, wp.clock_out_id, wp.canonical_record_id,
			        wp.approval_status, wp.project_id, wp.work_category_id, wp.graph_revision,
			        tr.duration_minutes as record_duration, tr.approval_state as record_state,
			        tr.origin as record_origin, tr.created_by as record_created_by,
			        tr.start_at as record_start, tr.end_at as record_end,
			        w.work_location_type, w.work_category_id as work_category,
			        (select array_agg(a.project_id::text) from time_record_allocation a
			          where a.record_id = tr.id and a.allocation_kind = 'project' and a.weight_percent = 100) as allocations
			 from work_period wp
			 join time_record tr on tr.id = wp.canonical_record_id and tr.organization_id = wp.organization_id
			 join time_record_work w on w.record_id = tr.id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function receipt(operationId: string) {
		const { rows } = await admin.query<{
			organization_id: string;
			employee_id: string;
			kind: string;
			writer: string;
			writer_version: number;
			command_version: number;
			command: Record<string, unknown>;
			append_admission: string;
			actor_kind: string;
			actor_user_id: string;
			work_period_id: string;
			result_version: number;
			result: Record<string, unknown>;
		}>("select * from completed_work_operation where id = $1", [operationId]);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("drop function if exists t274_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2, $3)', [
			ids.requesterUser,
			ids.managerUser,
			ids.peerUser,
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T274 clock-out', $1, $2)`,
			[ids.organization, timestamp],
		);
		// Steady state after the organization's first policy clock-out write gate (#272).
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't274-requester@example.test', $4, $4),
			 ($2, 'Manager', 't274-manager@example.test', $4, $4),
			 ($3, 'Peer', 't274-peer@example.test', $4, $4)`,
			[ids.requesterUser, ids.managerUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't274-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser, ids.peerUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $8), ($3, $4, $7, 'manager', $8), ($5, $6, $7, 'employee', $8)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.peer,
				ids.peerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.requesterUser, ids.managerUser, ids.peerUser], timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $3, 'Project A', 'active', true, $4, $5), ($2, $3, 'Project B', 'active', true, $4, $5)`,
			[ids.projectA, ids.projectB, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignmentB, ids.projectB, ids.organization, ids.requester, ids.managerUser],
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
			throw new Error("Web clock-out operation PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.forceApproval = false;
		harness.logs.length = 0;
		harness.notifications.length = 0;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("closes adopted work atomically with one derived duration across the graph", async () => {
		const period = await clockInRequester();
		const submissionId = randomUUID();

		const result = await clockOutRequester({ submissionId });

		expect(result).toMatchObject({ success: true, data: { id: submissionId, type: "clock_out" } });
		expect(await closedGraph(period.id)).toEqual({
			is_active: false,
			end_time: new Date("2026-07-22T09:00:40Z"),
			// 60m40s rounds half up to 61 in both representations.
			duration_minutes: 61,
			clock_out_id: submissionId,
			canonical_record_id: expect.any(String),
			approval_status: "approved",
			project_id: null,
			work_category_id: null,
			graph_revision: 1,
			record_duration: 61,
			record_state: "approved",
			record_origin: "clock",
			record_created_by: ids.requesterUser,
			record_start: new Date("2026-07-22T08:00:00Z"),
			record_end: new Date("2026-07-22T09:00:40Z"),
			work_location_type: "office",
			work_category: null,
			allocations: null,
		});
		const { rows: entries } = await admin.query<{
			id: string;
			type: string;
			previous_entry_id: string | null;
			previous_hash: string | null;
			created_by: string;
			utc_offset_minutes: number;
		}>(
			`select id, type, previous_entry_id, previous_hash, created_by, utc_offset_minutes
			 from time_entry where employee_id = $1 order by timestamp`,
			[ids.requester],
		);
		const [clockInEntry, clockOutEntry] = entries;
		expect(entries).toHaveLength(2);
		const { rows: clockInHash } = await admin.query<{ hash: string }>(
			"select hash from time_entry where id = $1",
			[period.clock_in_id],
		);
		// The append collaborator linked the exact admitted predecessor by ID and hash.
		expect(clockOutEntry).toEqual({
			id: submissionId,
			type: "clock_out",
			previous_entry_id: period.clock_in_id,
			previous_hash: only(clockInHash).hash,
			created_by: ids.requesterUser,
			utc_offset_minutes: 0,
		});
		expect(clockInEntry?.id).toBe(period.clock_in_id);
		const { rows: positions } = await admin.query(
			`select tip_entry_id, version, entry_count, admission, admitted_operation, last_operation
			 from time_entry_append_position where employee_id = $1`,
			[ids.requester],
		);
		expect(only(positions)).toEqual({
			tip_entry_id: submissionId,
			version: 2,
			entry_count: 2,
			admission: "empty_history",
			admitted_operation: "live_clock_in",
			last_operation: "live_clock_out",
		});
		// The required balance refresh committed with the work.
		const { rows: balances } = await admin.query(
			`select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1`,
			[ids.requester],
		);
		expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });

		const committed = await receipt(submissionId);
		expect(committed).toMatchObject({
			organization_id: ids.organization,
			employee_id: ids.requester,
			kind: "close_active_work",
			writer: "web_clock_out",
			writer_version: 1,
			command_version: 1,
			append_admission: "append",
			actor_kind: "human",
			actor_user_id: ids.requesterUser,
			work_period_id: period.id,
			result_version: 1,
		});
		expect(committed.command).toEqual({
			version: 1,
			operationId: submissionId,
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
			requestedInstant: "2026-07-22T09:00:40Z",
			browserTimezone: "UTC",
			deviceInfo: "web",
		});
		const graph = await closedGraph(period.id);
		expect(committed.result).toEqual({
			version: 1,
			operationId: submissionId,
			owner: { employeeId: ids.requester },
			actors: {
				clockIn: { kind: "human", userId: ids.requesterUser },
				completing: { kind: "human", userId: ids.requesterUser },
			},
			workPeriodId: period.id,
			clockInEntryId: period.clock_in_id,
			clockOutEntryId: submissionId,
			canonicalRecordId: graph.canonical_record_id,
			segment: {
				startAt: "2026-07-22T08:00:00Z",
				endAt: "2026-07-22T09:00:40Z",
				durationMinutes: 61,
				startUtcOffsetMinutes: 0,
				endUtcOffsetMinutes: 0,
				endTimezone: "UTC",
				endTimezoneSource: "browser",
			},
			attribution: { projectId: null, workCategoryId: null, workLocationType: "office" },
			revisions: { workPeriod: { source: 0, result: 1 } },
			append: {
				admission: "append",
				previousEntryId: period.clock_in_id,
				previousHash: only(clockInHash).hash,
			},
			approvalState: "approved",
			approval: { participation: "none" },
			followUps: [
				{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate: "2026-07-22" },
				{ kind: "compliance_check", delivery: "post_commit_best_effort" },
				{ kind: "break_enforcement", delivery: "post_commit_best_effort" },
				{ kind: "surcharge_calculation", delivery: "post_commit_best_effort" },
			],
		});
	});

	it("leaves the adopted lineage admissible for the next clock-in", async () => {
		await clockInRequester();
		const submissionId = randomUUID();
		await expect(clockOutRequester({ submissionId })).resolves.toMatchObject({ success: true });

		const next = await clockInRequester(clockInAt.add({ hours: 2 }));

		const { rows } = await admin.query(
			`select te.previous_entry_id, p.tip_entry_id, p.version, p.entry_count, p.last_operation
			 from time_entry te join time_entry_append_position p on p.employee_id = te.employee_id
			 where te.id = $1`,
			[next.clock_in_id],
		);
		expect(only(rows)).toEqual({
			previous_entry_id: submissionId,
			tip_entry_id: next.clock_in_id,
			version: 3,
			entry_count: 3,
			last_operation: "live_clock_in",
		});
	});

	it("keeps positive zero-minute work and rounds a half minute up", async () => {
		const first = await clockInRequester();
		await expect(
			clockOutRequester({ instant: clockInAt.add({ seconds: 29 }) }),
		).resolves.toMatchObject({ success: true });
		const second = await clockInRequester(clockInAt.add({ hours: 1 }));
		await expect(
			clockOutRequester({ instant: clockInAt.add({ hours: 1, seconds: 30 }) }),
		).resolves.toMatchObject({ success: true });

		expect(await closedGraph(first.id)).toMatchObject({ duration_minutes: 0, record_duration: 0 });
		expect(await closedGraph(second.id)).toMatchObject({ duration_minutes: 1, record_duration: 1 });
	});

	it("rejects equal endpoints without writing anything", async () => {
		await clockInRequester();
		const before = await snapshot();

		await expect(clockOutRequester({ instant: clockInAt })).resolves.toEqual({
			success: false,
			error: "Clock-out must be after clock-in",
		});

		expect(await snapshot()).toEqual(before);
	});

	it("preserves omitted attribution, clears it explicitly and keeps event actors", async () => {
		// An active period can gain a project before clock-out (updateWorkPeriodProject),
		// and a manager may have clocked the employee in on their behalf.
		const preserved = await clockInRequester();
		await admin.query("update work_period set project_id = $2 where id = $1", [
			preserved.id,
			ids.projectA,
		]);
		await admin.query("update time_entry set created_by = $2 where id = $1", [
			preserved.clock_in_id,
			ids.managerUser,
		]);
		const preservedId = randomUUID();
		await expect(clockOutRequester({ submissionId: preservedId })).resolves.toMatchObject({
			success: true,
		});
		expect(await closedGraph(preserved.id)).toMatchObject({
			project_id: ids.projectA,
			allocations: [ids.projectA],
			record_created_by: ids.requesterUser,
		});
		const { rows: clockInActor } = await admin.query<{ created_by: string }>(
			"select created_by from time_entry where id = $1",
			[preserved.clock_in_id],
		);
		expect(only(clockInActor).created_by).toBe(ids.managerUser);
		expect((await receipt(preservedId)).result).toMatchObject({
			owner: { employeeId: ids.requester },
			actors: {
				clockIn: { kind: "human", userId: ids.managerUser },
				completing: { kind: "human", userId: ids.requesterUser },
			},
			attribution: { projectId: ids.projectA },
		});

		const cleared = await clockInRequester(clockInAt.add({ hours: 2 }));
		await admin.query("update work_period set project_id = $2 where id = $1", [
			cleared.id,
			ids.projectA,
		]);
		await expect(
			clockOutRequester({ projectId: null, instant: clockInAt.add({ hours: 3 }) }),
		).resolves.toMatchObject({ success: true });
		expect(await closedGraph(cleared.id)).toMatchObject({ project_id: null, allocations: null });

		const replaced = await clockInRequester(clockInAt.add({ hours: 4 }));
		await admin.query("update work_period set project_id = $2 where id = $1", [
			replaced.id,
			ids.projectA,
		]);
		await expect(
			clockOutRequester({ projectId: ids.projectB, instant: clockInAt.add({ hours: 5 }) }),
		).resolves.toMatchObject({ success: true });
		expect(await closedGraph(replaced.id)).toMatchObject({
			project_id: ids.projectB,
			allocations: [ids.projectB],
		});
	});

	it("replays the committed receipt without writes and rejects a changed command", async () => {
		await clockInRequester();
		const submissionId = randomUUID();
		const first = await clockOutRequester({ submissionId });
		expect(first).toMatchObject({ success: true });
		const committed = await snapshot();

		const retry = await clockOutRequester({ submissionId });
		expect(retry).toEqual(first);
		expect(await snapshot()).toEqual(committed);

		// Same identity, different request evidence: a collision, never new work.
		await expect(clockOutRequester({ submissionId, projectId: null })).resolves.toEqual({
			success: false,
			error: collision,
		});
		await expect(
			clockOutRequester({ submissionId, instant: clockInAt.add({ hours: 2 }) }),
		).resolves.toEqual({ success: false, error: collision });
		expect(await snapshot()).toEqual(committed);
	});

	it("does not replay a receipt whose work was later deleted", async () => {
		const period = await clockInRequester();
		const submissionId = randomUUID();
		await expect(clockOutRequester({ submissionId })).resolves.toMatchObject({ success: true });
		await admin.query("update work_period set deleted_at = now() where id = $1", [period.id]);
		const deleted = await snapshot();

		await expect(clockOutRequester({ submissionId })).resolves.toEqual({
			success: false,
			error: collision,
		});

		expect(await snapshot()).toEqual(deleted);
	});

	it("gives concurrent duplicate submissions one committed result", async () => {
		await clockInRequester();
		const submissionId = randomUUID();

		const results = await Promise.all([
			clockOutRequester({ submissionId }),
			clockOutRequester({ submissionId }),
		]);

		expect(results).toEqual([
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({ id: submissionId }),
			}),
			expect.objectContaining({
				success: true,
				data: expect.objectContaining({ id: submissionId }),
			}),
		]);
		const { rows } = await admin.query<{ receipts: number; clock_outs: number; records: number }>(
			`select
			   (select count(*)::int from completed_work_operation where organization_id = $1) as receipts,
			   (select count(*)::int from time_entry where organization_id = $1 and type = 'clock_out') as clock_outs,
			   (select count(*)::int from time_record where organization_id = $1) as records`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ receipts: 1, clock_outs: 1, records: 1 });
	});

	it("replays receipt-less legacy clock-outs by the legacy matcher, without repair", async () => {
		await setAdmission("inactive");
		const period = await clockInRequester();
		const submissionId = randomUUID();
		// Under 30 seconds past the minute: the legacy closure floors the canonical
		// duration but rounds the period, and its own matcher rejects the mismatch.
		const instant = clockInAt.add({ minutes: 60, seconds: 20 });
		const legacy = await clockOutRequester({ submissionId, instant });
		expect(legacy).toMatchObject({ success: true, data: { id: submissionId } });
		await setAdmission("active");
		const committed = await snapshot();

		await expect(clockOutRequester({ submissionId, instant })).resolves.toEqual(legacy);

		expect(await snapshot()).toEqual(committed);
		expect(committed.receipts).toBeNull();
		expect(await closedGraph(period.id)).toMatchObject({ graph_revision: 0 });
	});

	it("keeps replaying committed receipts after the organization returns to legacy", async () => {
		await clockInRequester();
		const submissionId = randomUUID();
		const first = await clockOutRequester({ submissionId });
		await setAdmission("inactive");
		const committed = await snapshot();

		await expect(clockOutRequester({ submissionId })).resolves.toEqual(first);

		expect(await snapshot()).toEqual(committed);
	});

	it.each([
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_record_allocation", "insert"],
		["time_entry", "insert"],
		["time_entry_append_position", "update"],
		["work_period", "update"],
		["employee_work_balance", "insert"],
		["completed_work_operation", "insert"],
	])("rolls back the complete graph when the %s %s fails", async (table, event) => {
		const period = await clockInRequester();
		// Allocation writes only happen for attributed work.
		await admin.query("update work_period set project_id = $2 where id = $1", [
			period.id,
			ids.projectA,
		]);
		const before = await snapshot();
		await admin.query(
			`create function t274_fail() returns trigger language plpgsql as $$
			 begin raise exception 't274 injected failure'; end $$`,
		);
		await admin.query(
			`create trigger t274_fail before ${event} on ${table} for each row execute function t274_fail()`,
		);

		const result = await clockOutRequester();
		await admin.query("drop function t274_fail() cascade");

		expect(result).toEqual({ success: false, error: genericFailure });
		expect(await snapshot()).toEqual(before);
	});

	it("commits required approval participation with the work and replays its original outcome", async () => {
		harness.forceApproval = true;
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
		const period = await clockInRequester();
		const submissionId = randomUUID();

		const result = await clockOutRequester({ submissionId });

		expect(result).toMatchObject({ success: true, data: { pendingApproval: true } });
		expect(await closedGraph(period.id)).toMatchObject({
			approval_status: "pending",
			record_state: "pending",
			duration_minutes: 61,
		});
		const committed = await receipt(submissionId);
		expect(committed.result).toMatchObject({
			approvalState: "pending",
			approval: {
				participation: "policy_clock_out",
				disposition: "executed",
				outcome: expect.stringMatching(/_created$/),
				approvalRequestId: expect.any(String),
			},
		});
		expect(harness.notifications).toEqual([{ event: "pending", managerId: ids.manager }]);
		const after = await snapshot();
		expect(after.approval_requests).toBe(1);

		await expect(clockOutRequester({ submissionId })).resolves.toEqual(result);
		expect(await snapshot()).toEqual(after);
		expect(harness.notifications).toHaveLength(1);
	});

	it("rolls back work and approval together when the approval request write fails", async () => {
		harness.forceApproval = true;
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
				 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
		await clockInRequester();
		const before = await snapshot();
		await admin.query(
			`create function t274_fail() returns trigger language plpgsql as $$
				 begin raise exception 't274 injected approval failure'; end $$`,
		);
		await admin.query(
			"create trigger t274_fail before insert on approval_request for each row execute function t274_fail()",
		);

		const result = await clockOutRequester();
		await admin.query("drop function t274_fail() cascade");

		expect(result).toEqual({ success: false, error: genericFailure });
		expect(await snapshot()).toEqual(before);
		expect(harness.notifications).toEqual([]);
	});

	it("rolls back the closure when required approval cannot be routed", async () => {
		harness.forceApproval = true;
		await clockInRequester();
		const before = await snapshot();

		await expect(clockOutRequester()).resolves.toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});

		expect(await snapshot()).toEqual(before);
	});

	it("holds the closure for review when adopted history changed outside the collaborator", async () => {
		const period = await clockInRequester();
		await admin.query("update time_entry set hash = 'tampered' where id = $1", [
			period.clock_in_id,
		]);
		const before = await snapshot();

		await expect(clockOutRequester()).resolves.toEqual({
			success: false,
			error:
				"Your time history needs review before you can clock out. Please contact your administrator.",
		});

		expect(await snapshot()).toEqual(before);
		expect(harness.logs).toContainEqual({
			context: {
				appendReviewRequirement: expect.objectContaining({
					organizationId: ids.organization,
					employeeId: ids.requester,
					reasons: expect.arrayContaining([
						{ kind: "position_tip_changed", tipEntryId: period.clock_in_id },
					]),
				}),
			},
			message: "Clock out held for append history review",
		});
	});

	it("removes receipts with the history in organization time-data cleanup", async () => {
		await clockInRequester();
		await expect(clockOutRequester()).resolves.toMatchObject({ success: true });

		await clearOrganizationTimeData(ids.organization);

		expect((await snapshot()).receipts).toBeNull();
	});

	it("removes an employee's receipts when the employee is deleted", async () => {
		await clockInRequester(clockInAt, ids.peerUser);
		await expect(clockOutRequester({ userId: ids.peerUser })).resolves.toMatchObject({
			success: true,
		});

		await admin.query("delete from employee where id = $1", [ids.peer]);

		const { rows } = await admin.query<{ receipts: number }>(
			"select count(*)::int as receipts from completed_work_operation where employee_id = $1",
			[ids.peer],
		);
		expect(only(rows).receipts).toBe(0);
	});
});
