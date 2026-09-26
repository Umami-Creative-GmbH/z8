/**
 * #272 / T08 runtime evidence for the web clock-out outer transaction.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn`/`clockOut` server actions run against that database. Only the
 * request/session, external billing provisioning, notification delivery, and Next
 * cache boundaries are replaced. `checkClockOutNeedsApproval` is production-false
 * today, so approval scenarios force only that decision and keep the real routing,
 * approval runtime, repository, write gate, and submission collaborators.
 */

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	forceApproval: false,
	queries: [] as { sql: string; params: unknown[] }[],
	errors: [] as { context: unknown; message: unknown }[],
	notifications: [] as { event: string; managerId: string }[],
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import(
		"@/db/postgres-utc"
	);
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({
		client: pool,
		schema: { ...authSchema, ...schema },
		logger: {
			logQuery: (query, params) => {
				harness.queries.push({ sql: query, params });
			},
		},
	});
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
	isBillingMutationAllowed: (access: { canAccess: boolean }) =>
		access.canAccess,
}));

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendClockOutApprovalNotifications: async (params: { managerId: string }) => {
		harness.notifications.push({
			event: "pending",
			managerId: params.managerId,
		});
	},
	sendClockOutApprovedNotification: async (params: { managerId: string }) => {
		harness.notifications.push({
			event: "approved",
			managerId: params.managerId,
		});
	},
}));

vi.mock("./policy-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("./policy-helpers")>();
	return {
		...original,
		checkClockOutNeedsApproval: async (employeeId: string) =>
			harness.forceApproval ||
			(await original.checkClockOutNeedsApproval(employeeId)),
	};
});

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const record = (context: unknown, message?: unknown) => {
		harness.errors.push({ context, message });
	};
	return {
		...original,
		logger: {
			...original.logger,
			error: record,
			warn: record,
			info: () => {},
			debug: () => {},
		},
	};
});

const { clockIn, clockOut } = await import("./clocking");
const { db } = await import("@/db");
const { createOrganizationApprovalRollouts } = await import(
	"@/lib/approvals/workflow/organization-rollout"
);
const { checkClockOutNeedsApproval: productionClockOutApprovalDecision } =
	await import("./policy-helpers");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
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
	describe.skip(`web clock-out PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const clockInAt = parseInstant("2026-07-22T08:00:00Z");
const clockOutAt = parseInstant("2026-07-22T16:00:00Z");
const ids = {
	organization: "t272-web-clock-out-org",
	requesterUser: "t272-requester-user",
	managerUser: "t272-manager-user",
	lateManagerUser: "t272-late-manager-user",
	peerUser: "t272-peer-user",
	requester: "d1000000-0000-4000-8000-000000000001",
	manager: "d1000000-0000-4000-8000-000000000002",
	lateManager: "d1000000-0000-4000-8000-000000000003",
	peer: "d1000000-0000-4000-8000-000000000004",
	managerLink: "d2000000-0000-4000-8000-000000000001",
	lateManagerLink: "d2000000-0000-4000-8000-000000000002",
	workPolicy: "d3000000-0000-4000-8000-000000000001",
	regulation: "d3000000-0000-4000-8000-000000000002",
	breakRule: "d3000000-0000-4000-8000-000000000003",
	policyAssignment: "d3000000-0000-4000-8000-000000000004",
	approvalPolicy: "d4000000-0000-4000-8000-000000000001",
	approvalStage: "d4000000-0000-4000-8000-000000000002",
} as const;
const genericFailure = "Failed to clock out. Please try again.";
const lifecycleModes = ["legacy", "canonical"] as const;
type LifecycleMode = (typeof lifecycleModes)[number];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("web clock-out outer transaction on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 12 });
	const openHolders = new Set<Holder>();

	type Holder = {
		pid: number;
		query: (text: string, params?: unknown[]) => Promise<unknown>;
		commit: () => Promise<void>;
	};

	async function openHolder(): Promise<Holder> {
		const client: PoolClient = await admin.connect();
		await client.query("begin");
		await client.query("set local lock_timeout = '20s'");
		const { rows } = await client.query<{ pid: number }>(
			"select pg_backend_pid() as pid",
		);
		let open = true;
		const holder: Holder = {
			pid: only(rows).pid,
			query: (text, params) => client.query(text, params),
			commit: async () => {
				if (!open) return;
				open = false;
				openHolders.delete(holder);
				try {
					await client.query("commit");
				} finally {
					client.release();
				}
			},
		};
		openHolders.add(holder);
		return holder;
	}

	const advisoryLock = "select pg_advisory_xact_lock(hashtextextended($1, 0))";

	async function holdAdvisory(key: string) {
		const holder = await openHolder();
		await holder.query(advisoryLock, [key]);
		return holder;
	}

	async function waitFor<T>(
		label: string,
		probe: () => Promise<T | undefined>,
	): Promise<T> {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const value = await probe();
			if (value !== undefined) return value;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out waiting for ${label}`);
	}

	async function lockWaiters(holderPid: number, exclude: number[] = []) {
		const { rows } = await admin.query<{ pid: number }>(
			`select pid from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'
			   and $1 = any(pg_blocking_pids(pid)) and not (pid = any($2::int[]))
			 order by pid`,
			[holderPid, exclude],
		);
		return rows.map((row) => row.pid);
	}

	function waitForWaiter(holderPid: number, exclude: number[] = []) {
		return waitFor(`a backend blocked by ${holderPid}`, async () => {
			const [pid] = await lockWaiters(holderPid, exclude);
			return pid;
		});
	}

	function waitForWaiting(pid: number) {
		return waitFor(`backend ${pid} to wait`, async () => {
			const { rows } = await admin.query<{ waiting: boolean }>(
				"select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
				[pid],
			);
			return rows[0]?.waiting ? true : undefined;
		});
	}

	/**
	 * Lets the action's committed-replay lookup pass one holder, then keeps the
	 * fresh closure waiting behind a second holder queued after that lookup.
	 */
	async function blockFreshAttempt(key: string, start: () => Promise<unknown>) {
		const first = await holdAdvisory(key);
		const action = start();
		await waitForWaiter(first.pid);
		const second = await openHolder();
		const granted = second.query(advisoryLock, [key]);
		await waitForWaiting(second.pid);
		await first.commit();
		await granted;
		const waiterPid = await waitForWaiter(second.pid, [second.pid]);
		return { action, holder: second, waiterPid };
	}

	/** Queues the next holder behind the waiting action, then releases the current one. */
	async function handOff(current: Holder, key: string) {
		const next = await openHolder();
		const granted = next.query(advisoryLock, [key]);
		await waitForWaiting(next.pid);
		await current.commit();
		await granted;
		return next;
	}

	async function advisoryHeld(pid: number, key: string) {
		const { rows } = await admin.query<{ mode: string; granted: boolean }>(
			`select mode, granted from pg_locks
			 where pid = $1 and locktype = 'advisory' and objsubid = 1
			   and ((classid::bigint << 32) | objid::bigint) = hashtextextended($2, 0)`,
			[pid, key],
		);
		return rows.map((row) => `${row.mode}:${row.granted ? "held" : "waiting"}`);
	}

	async function rowLockProbe(
		table: string,
		id: string,
		strength: "update" | "no key update",
	) {
		const client = await admin.connect();
		try {
			await client.query("begin");
			await client.query(
				`select 1 from "${table}" where id = $1 for ${strength} nowait`,
				[id],
			);
			return "free";
		} catch (error) {
			if ((error as { code?: string }).code === "55P03") return "locked";
			throw error;
		} finally {
			await client.query("rollback");
			client.release();
		}
	}

	const keys = {
		adoption: JSON.stringify(["completed-work-adoption", ids.organization]),
		writeGate: `approval-rollout:${ids.organization.length}:${ids.organization}:16:policy_clock_out`,
		organization: JSON.stringify([
			"work-organization-configuration",
			ids.organization,
		]),
		requesterAccess: JSON.stringify([
			"work-user-configuration-access",
			ids.requesterUser,
		]),
		employee: ids.requester,
		ownership: JSON.stringify([ids.organization, ids.requester]),
		source: (kind: string, periodId: string) =>
			JSON.stringify([ids.organization, kind, "time_entry", periodId]),
	};

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	function adoptionAttempts() {
		return harness.queries.filter(
			(query) =>
				query.sql.includes("pg_advisory_xact_lock_shared") &&
				query.params.some(
					(param) =>
						typeof param === "string" &&
						param.includes("completed-work-adoption"),
				),
		).length;
	}

	async function clockInRequester(userId: string = ids.requesterUser) {
		actAs(userId);
		const result = await clockIn("office", {
			instant: clockInAt,
			browserTimezone: "UTC",
		});
		expect(result).toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			`select wp.id from work_period wp join employee e on e.id = wp.employee_id
			 where e.user_id = $1 and wp.end_time is null`,
			[userId],
		);
		expect(rows).toHaveLength(1);
		harness.queries.length = 0;
		return only(rows).id;
	}

	function clockOutRequester(
		submissionId: string = randomUUID(),
		userId: string = ids.requesterUser,
		instant: Instant = clockOutAt,
	) {
		actAs(userId);
		return clockOut(undefined, undefined, {
			submissionId,
			instant,
			browserTimezone: "UTC",
		});
	}

	async function workState(employeeId: string = ids.requester) {
		const { rows } = await admin.query<{
			open_periods: number;
			closed_periods: number;
			clock_outs: number;
			records: number;
			approval_requests: number;
			workflows: number;
			outbox: number;
		}>(
			`select
			   (select count(*)::int from work_period where employee_id = $1 and end_time is null) as open_periods,
			   (select count(*)::int from work_period where employee_id = $1 and end_time is not null) as closed_periods,
			   (select count(*)::int from time_entry where employee_id = $1 and type = 'clock_out') as clock_outs,
			   (select count(*)::int from time_record where employee_id = $1) as records,
			   (select count(*)::int from approval_request where organization_id = $2) as approval_requests,
			   (select count(*)::int from approval_workflow where organization_id = $2) as workflows,
			   (select count(*)::int from approval_outbox where organization_id = $2) as outbox`,
			[employeeId, ids.organization],
		);
		return only(rows);
	}

	/**
	 * Legacy side effects dispatch through the action after commit; canonical side
	 * effects are durable outbox rows for the pending stage assignment instead.
	 */
	async function expectPendingApprover(
		mode: LifecycleMode,
		approverEmployeeId: string,
	) {
		const { rows } = await admin.query<{ approver_employee_id: string }>(
			`select approver_employee_id from approval_stage_assignment
			 where organization_id = $1 and status = 'pending'`,
			[ids.organization],
		);
		if (mode === "legacy") {
			expect(harness.notifications).toEqual([
				{ event: "pending", managerId: approverEmployeeId },
			]);
			return;
		}
		expect(harness.notifications).toEqual([]);
		expect(rows.map((row) => row.approver_employee_id)).toEqual([
			approverEmployeeId,
		]);
		expect((await workState()).outbox).toBeGreaterThan(0);
	}

	/** One genesis, no dangling link, and no fork in the employee hash chain. */
	async function expectCoherentChain(employeeId: string = ids.requester) {
		const { rows } = await admin.query<{
			genesis: number;
			dangling: number;
			forks: number;
		}>(
			`select
			   (select count(*)::int from time_entry
			    where employee_id = $1 and previous_hash is null) as genesis,
			   (select count(*)::int from time_entry child
			    where child.employee_id = $1 and child.previous_hash is not null
			      and not exists (select 1 from time_entry parent
			        where parent.employee_id = $1 and parent.hash = child.previous_hash)) as dangling,
			   (select count(*)::int from (select previous_hash from time_entry
			    where employee_id = $1 and previous_hash is not null
			    group by previous_hash having count(*) > 1) fork) as forks`,
			[employeeId],
		);
		expect(rows[0]).toEqual({ genesis: 1, dangling: 0, forks: 0 });
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [
			ids.organization,
		]);
		await admin.query('delete from "user" where id in ($1, $2, $3, $4)', [
			ids.requesterUser,
			ids.managerUser,
			ids.lateManagerUser,
			ids.peerUser,
		]);
	}

	async function seed(
		options: {
			manager?: boolean;
			requesterSelfApproves?: boolean;
			breakPolicy?: boolean;
			rolloutBootstrapped?: boolean;
			mode?: LifecycleMode;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'T272 web clock-out', $1, $2)`,
			[ids.organization, timestamp],
		);
		// Steady state after the organization's first policy clock-out write gate.
		if (options.rolloutBootstrapped !== false) {
			const mode = options.mode ?? "legacy";
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, 'policy_clock_out', $2, $3, $4, $4)`,
				[
					ids.organization,
					mode,
					mode === "canonical" ? "canonical" : "legacy",
					timestamp,
				],
			);
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't272-requester@example.test', $5, $5),
			 ($2, 'Manager', 't272-manager@example.test', $5, $5),
			 ($3, 'Late manager', 't272-late-manager@example.test', $5, $5),
			 ($4, 'Peer', 't272-peer@example.test', $5, $5)`,
			[
				ids.requesterUser,
				ids.managerUser,
				ids.lateManagerUser,
				ids.peerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't272-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.lateManagerUser, ids.peerUser],
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, $10, $11), ($3, $4, $9, 'manager', $11),
			 ($5, $6, $9, 'manager', $11), ($7, $8, $9, 'employee', $11)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.lateManager,
				ids.lateManagerUser,
				ids.peer,
				ids.peerUser,
				ids.organization,
				options.requesterSelfApproves ? "manager" : "employee",
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.requesterUser, ids.peerUser], timestamp],
		);
		if (options.manager || options.requesterSelfApproves) {
			await admin.query(
				`insert into employee_managers
				 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
				 values ($1, $2, $3, true, $4, $5, $5)`,
				[
					ids.managerLink,
					ids.requester,
					options.requesterSelfApproves ? ids.requester : ids.manager,
					ids.managerUser,
					timestamp,
				],
			);
		}
		if (options.breakPolicy) {
			await admin.query(
				`insert into work_policy
				 (id, organization_id, name, schedule_enabled, regulation_enabled,
				  is_active, created_by, updated_at)
				 values ($1, $2, 'T272 break', false, true, true, $3, $4)`,
				[ids.workPolicy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into work_policy_regulation
				 (id, policy_id, max_uninterrupted_minutes, updated_at)
				 values ($1, $2, 360, $3)`,
				[ids.regulation, ids.workPolicy, timestamp],
			);
			await admin.query(
				`insert into work_policy_break_rule
				 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
				 values ($1, $2, 360, 30, $3)`,
				[ids.breakRule, ids.regulation, timestamp],
			);
			await admin.query(
				`insert into work_policy_assignment
				 (id, policy_id, organization_id, assignment_type, employee_id,
				  priority, is_active, created_by, updated_at)
				 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
				[
					ids.policyAssignment,
					ids.workPolicy,
					ids.organization,
					ids.requester,
					ids.managerUser,
					timestamp,
				],
			);
		}
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
			throw new Error("Web clock-out PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.forceApproval = false;
		harness.queries.length = 0;
		harness.errors.length = 0;
		harness.notifications.length = 0;
		await seed();
	});

	afterEach(async () => {
		for (const holder of [...openHolders]) await holder.commit();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("keeps the production clock-out approval decision false", async () => {
		await expect(
			productionClockOutApprovalDecision(ids.requester),
		).resolves.toBe(false);
	});

	it("closes the period in legacy admission and replays the committed result", async () => {
		const periodId = await clockInRequester();
		const submissionId = randomUUID();

		const first = await clockOutRequester(submissionId);
		expect(first).toMatchObject({ success: true });
		expect(first.success && first.data.pendingApproval).toBeUndefined();
		expect(adoptionAttempts()).toBe(2);

		const { rows } = await admin.query<{
			end_time: Date;
			clock_out_id: string;
			canonical_record_id: string;
			approval_status: string;
			approval_state: string;
		}>(
			`select wp.end_time, wp.clock_out_id, wp.canonical_record_id, wp.approval_status,
			        tr.approval_state
			 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[periodId],
		);
		expect(rows[0]).toMatchObject({
			end_time: new Date("2026-07-22T16:00:00Z"),
			approval_status: "approved",
			approval_state: "approved",
		});
		expect(first.success && first.data.id).toBe(only(rows).clock_out_id);
		const before = await workState();
		expect(before).toMatchObject({
			open_periods: 0,
			closed_periods: 1,
			clock_outs: 1,
			records: 1,
			approval_requests: 0,
			workflows: 0,
		});
		await expectCoherentChain();

		harness.queries.length = 0;
		const replay = await clockOutRequester(submissionId);
		expect(replay).toMatchObject({ success: true });
		expect(replay.success && replay.data.id).toBe(only(rows).clock_out_id);
		expect(adoptionAttempts()).toBe(1);
		expect(await workState()).toEqual(before);
		// The write gate's idempotent rollout bootstrap is the only statement issued as an insert.
		expect(
			harness.queries
				.filter((query) => /^\s*insert\b/i.test(query.sql))
				.every((query) =>
					/insert into approval_workflow_rollout[\s\S]*on conflict \(organization_id, workflow_type\) do nothing/.test(
						query.sql,
					),
				),
		).toBe(true);
	});

	async function durations(periodId: string) {
		const { rows } = await admin.query<{
			period_minutes: number;
			record_minutes: number;
		}>(
			`select wp.duration_minutes as period_minutes, tr.duration_minutes as record_minutes
			 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	it("stores one half-up duration and replays a clock-out 40 seconds past the minute (#388)", async () => {
		const periodId = await clockInRequester();
		const submissionId = randomUUID();
		const instant = clockOutAt.add({ seconds: 40 });

		const first = await clockOutRequester(submissionId, ids.requesterUser, instant);
		expect(first).toMatchObject({ success: true });
		// 8h0m40s: the period and the canonical record agree on 481 minutes.
		expect(await durations(periodId)).toEqual({
			period_minutes: 481,
			record_minutes: 481,
		});
		const committed = await workState();

		const retry = await clockOutRequester(submissionId, ids.requesterUser, instant);

		expect(retry).toMatchObject({
			success: true,
			data: { id: first.success ? first.data.id : undefined },
		});
		expect(await workState()).toEqual(committed);
		expect(await durations(periodId)).toEqual({
			period_minutes: 481,
			record_minutes: 481,
		});
	});

	it("keeps a committed row with mismatched minutes a replay collision (#388)", async () => {
		const periodId = await clockInRequester();
		const submissionId = randomUUID();
		const instant = clockOutAt.add({ seconds: 40 });
		await expect(
			clockOutRequester(submissionId, ids.requesterUser, instant),
		).resolves.toMatchObject({ success: true });
		// Historical rows written before #388 floored the canonical minutes.
		await admin.query(
			`update time_record set duration_minutes = duration_minutes - 1
			 where id = (select canonical_record_id from work_period where id = $1)`,
			[periodId],
		);
		const committed = await workState();

		await expect(
			clockOutRequester(submissionId, ids.requesterUser, instant),
		).resolves.toEqual({ success: false, error: genericFailure });

		expect(await workState()).toEqual(committed);
		expect(await durations(periodId)).toEqual({
			period_minutes: 481,
			record_minutes: 480,
		});
	});

	it("acquires advisory scope before the employee key and routed rows in the amended order", async () => {
		const periodId = await clockInRequester();
		const rowHolder = await openHolder();
		await rowHolder.query(
			"select id from work_period where id = $1 for update",
			[periodId],
		);

		const { action, holder, waiterPid } = await blockFreshAttempt(
			keys.employee,
			() => clockOutRequester(),
		);

		// Waiting on the employee key: steps 1-4 held, nothing later acquired.
		expect(await advisoryHeld(waiterPid, keys.adoption)).toEqual([
			"ShareLock:held",
		]);
		expect(await advisoryHeld(waiterPid, keys.writeGate)).toEqual([
			"ShareLock:held",
		]);
		expect(await advisoryHeld(waiterPid, keys.organization)).toEqual([
			"ShareLock:held",
		]);
		expect(await advisoryHeld(waiterPid, keys.requesterAccess)).toEqual([
			"ShareLock:held",
		]);
		expect(await advisoryHeld(waiterPid, keys.employee)).toEqual([
			"ExclusiveLock:waiting",
		]);
		expect(await advisoryHeld(waiterPid, keys.ownership)).toEqual([]);
		expect(
			await rowLockProbe("organization", ids.organization, "no key update"),
		).toBe("free");
		expect(await rowLockProbe("employee", ids.requester, "update")).toBe(
			"free",
		);

		await holder.commit();
		expect(await waitForWaiter(rowHolder.pid)).toBe(waiterPid);

		// Waiting on the routed work_period row: employee, auxiliary/source keys and
		// earlier-ranked rows are held; later-ranked rows are not yet acquired.
		expect(await advisoryHeld(waiterPid, keys.employee)).toEqual([
			"ExclusiveLock:held",
		]);
		expect(await advisoryHeld(waiterPid, keys.ownership)).toEqual([
			"ExclusiveLock:held",
		]);
		for (const kind of ["manual_time_submission", "policy_clock_out"]) {
			expect(
				await advisoryHeld(waiterPid, keys.source(kind, periodId)),
			).toEqual(["ExclusiveLock:held"]);
		}
		expect(
			await rowLockProbe("organization", ids.organization, "no key update"),
		).toBe("locked");
		expect(await rowLockProbe("employee", ids.requester, "update")).toBe(
			"locked",
		);
		const { rows } = await admin.query<{ clock_in_id: string }>(
			"select clock_in_id from work_period where id = $1",
			[periodId],
		);
		expect(
			await rowLockProbe("time_entry", only(rows).clock_in_id, "update"),
		).toBe("free");

		await rowHolder.commit();
		await expect(action).resolves.toMatchObject({ success: true });
		expect(adoptionAttempts()).toBe(2);
		expect(await workState()).toMatchObject({ open_periods: 0, clock_outs: 1 });
	});

	it.each([{ order: "first-to-second" }, { order: "second-to-first" }])(
		"serializes competing clock-outs for one employee ($order arrival)",
		async ({ order }) => {
			await clockInRequester();
			const submissions = [randomUUID(), randomUUID()];
			if (order === "second-to-first") submissions.reverse();
			const blocker = await holdAdvisory(keys.employee);

			const first = clockOutRequester(submissions[0]);
			await waitForWaiter(blocker.pid);
			const second = clockOutRequester(submissions[1]);
			await waitFor("both arrivals to wait", async () =>
				(await lockWaiters(blocker.pid)).length === 2 ? true : undefined,
			);
			await blocker.commit();

			const results = await Promise.all([first, second]);
			expect(results.filter((result) => result.success)).toHaveLength(1);
			expect(results.filter((result) => !result.success)).toEqual([
				{ success: false, error: "You are not currently clocked in" },
			]);
			expect(await workState()).toMatchObject({
				open_periods: 0,
				closed_periods: 1,
				clock_outs: 1,
				records: 1,
			});
			await expectCoherentChain();
		},
	);

	it("replays one committed result for a concurrent duplicate submission", async () => {
		await clockInRequester();
		const submissionId = randomUUID();
		const blocker = await holdAdvisory(keys.employee);

		const first = clockOutRequester(submissionId);
		await waitForWaiter(blocker.pid);
		const second = clockOutRequester(submissionId);
		await waitFor("both duplicates to wait", async () =>
			(await lockWaiters(blocker.pid)).length === 2 ? true : undefined,
		);
		await blocker.commit();

		const [left, right] = await Promise.all([first, second]);
		expect(left).toMatchObject({ success: true });
		expect(right).toMatchObject({ success: true });
		expect(
			left.success && right.success && left.data.id === right.data.id,
		).toBe(true);
		expect(await workState()).toMatchObject({ clock_outs: 1, records: 1 });
		await expectCoherentChain();
	});

	it("does not serialize a distinct employee behind a held employee key", async () => {
		await clockInRequester();
		await clockInRequester(ids.peerUser);
		const blocker = await holdAdvisory(keys.employee);

		let requesterSettled = false;
		const requester = clockOutRequester().finally(() => {
			requesterSettled = true;
		});
		await waitForWaiter(blocker.pid);

		await expect(
			clockOutRequester(randomUUID(), ids.peerUser),
		).resolves.toMatchObject({ success: true });
		expect(requesterSettled).toBe(false);
		expect(await workState(ids.peer)).toMatchObject({
			open_periods: 0,
			clock_outs: 1,
		});

		await blocker.commit();
		await expect(requester).resolves.toMatchObject({ success: true });
	});

	async function policyClockOutRollouts() {
		const { rows } = await admin.query<{
			lifecycle_mode: string;
			side_effect_mode: string;
		}>(
			`select lifecycle_mode, side_effect_mode from approval_workflow_rollout
			 where organization_id = $1 and workflow_type = 'policy_clock_out'`,
			[ids.organization],
		);
		return rows;
	}

	// #359: organization creation pre-creates the rollout rows, so the first
	// policy clock-out no longer bootstraps one and holds other employees behind it.
	it("does not serialize a distinct employee behind the organization's first clock-out once its rollout rows exist", async () => {
		await seed({ rolloutBootstrapped: false });
		await createOrganizationApprovalRollouts(db, ids.organization);
		await clockInRequester();
		await clockInRequester(ids.peerUser);
		const blocker = await holdAdvisory(keys.employee);

		let requesterSettled = false;
		const requester = clockOutRequester().finally(() => {
			requesterSettled = true;
		});
		const requesterPid = await waitForWaiter(blocker.pid);
		// The requester already passed its write gate and waits on its employee key.
		expect(await advisoryHeld(requesterPid, keys.writeGate)).toEqual([
			"ShareLock:held",
		]);

		await expect(
			clockOutRequester(randomUUID(), ids.peerUser),
		).resolves.toMatchObject({ success: true });
		expect(requesterSettled).toBe(false);
		expect(await workState(ids.peer)).toMatchObject({
			open_periods: 0,
			clock_outs: 1,
		});

		await blocker.commit();
		await expect(requester).resolves.toMatchObject({ success: true });
		expect(await policyClockOutRollouts()).toEqual([
			{ lifecycle_mode: "legacy", side_effect_mode: "legacy" },
		]);
	});

	it("still bootstraps a missing rollout row in the write gate", async () => {
		await seed({ rolloutBootstrapped: false });
		await clockInRequester();
		expect(await policyClockOutRollouts()).toEqual([]);

		await expect(clockOutRequester()).resolves.toMatchObject({
			success: true,
		});

		expect(await policyClockOutRollouts()).toEqual([
			{ lifecycle_mode: "legacy", side_effect_mode: "legacy" },
		]);
		expect(await workState()).toMatchObject({ open_periods: 0, clock_outs: 1 });
	});

	it("restarts the whole transaction when protected configuration changes while waiting", async () => {
		await clockInRequester();
		const { action, holder } = await blockFreshAttempt(keys.adoption, () =>
			clockOutRequester(),
		);

		// A new applicable policy assignment is discovered only by re-routing.
		await seedBreakPolicy();
		await holder.commit();

		await expect(action).resolves.toMatchObject({ success: true });
		expect(adoptionAttempts()).toBe(3);
		expect(
			harness.queries.some(
				(query) =>
					query.sql.includes("web-clock-out:lock") &&
					query.sql.includes('"work_policy"') &&
					query.params.includes(ids.workPolicy),
			),
		).toBe(true);
		expect(await workState()).toMatchObject({ open_periods: 0, clock_outs: 1 });
	});

	it("restarts after routed-row acquisition when a legacy row writer changes a binding", async () => {
		const periodId = await clockInRequester();
		const rowHolder = await openHolder();
		await rowHolder.query(
			"select id from work_period where id = $1 for update",
			[periodId],
		);
		const action = clockOutRequester();
		await waitForWaiter(rowHolder.pid);
		await rowHolder.query(
			"update work_period set work_location_type = 'home' where id = $1",
			[periodId],
		);
		await rowHolder.commit();

		await expect(action).resolves.toMatchObject({ success: true });
		expect(adoptionAttempts()).toBe(3);
		expect(await workState()).toMatchObject({ open_periods: 0, clock_outs: 1 });
	});

	it("fails closed without residue after three changed-scope attempts", async () => {
		const periodId = await clockInRequester();
		const before = await workState();
		const { action, holder } = await blockFreshAttempt(keys.adoption, () =>
			clockOutRequester(),
		);

		// Each attempt has routed and is waiting before its protected binding changes.
		let current = holder;
		for (const [attempt, location] of ["home", "office", "home"].entries()) {
			await admin.query(
				"update work_period set work_location_type = $2 where id = $1",
				[periodId, location],
			);
			current = await handOff(current, keys.adoption);
			if (attempt < 2) await waitForWaiter(current.pid, [current.pid]);
		}
		await current.commit();

		await expect(action).resolves.toEqual({
			success: false,
			error: genericFailure,
		});
		expect(adoptionAttempts()).toBe(4);
		expect(
			harness.errors.some(
				({ context }) =>
					(context as { error?: Error })?.error?.name ===
					"WorkTransactionScopeChanged",
			),
		).toBe(true);
		expect(await workState()).toEqual(before);
	});

	it("fails closed without writes when membership is revoked while waiting", async () => {
		await clockInRequester();
		const before = await workState();
		const blocker = await holdAdvisory(keys.employee);
		const action = clockOutRequester();
		await waitForWaiter(blocker.pid);
		await admin.query(
			"update member set status = 'pending' where organization_id = $1 and user_id = $2",
			[ids.organization, ids.requesterUser],
		);
		await blocker.commit();

		await expect(action).resolves.toEqual({
			success: false,
			error: genericFailure,
		});
		expect(
			harness.errors.some(
				({ context }) =>
					(context as { error?: Error })?.error?.message ===
					"Active organization-scoped clocking access required",
			),
		).toBe(true);
		expect(await workState()).toEqual(before);
	});

	it("rolls the closed period back when approval routing finds no manager", async () => {
		harness.forceApproval = true;
		await clockInRequester();
		const before = await workState();

		await expect(clockOutRequester()).resolves.toEqual({
			success: false,
			error: "No manager assigned to approve time changes",
		});
		expect(await workState()).toEqual(before);
		expect(harness.notifications).toEqual([]);
	});

	it.each(lifecycleModes)(
		"creates one pending approval and replays it without duplicate side effects in %s mode",
		async (mode) => {
			await seed({ manager: true, mode });
			harness.forceApproval = true;
			await clockInRequester();
			const submissionId = randomUUID();

			const first = await clockOutRequester(submissionId);
			expect(first).toMatchObject({ success: true });
			expect(first.success && first.data.pendingApproval).toBe(true);
			await expectPendingApprover(mode, ids.manager);
			const committed = await workState();
			expect(committed).toMatchObject({
				open_periods: 0,
				clock_outs: 1,
				records: 1,
			});
			expect(committed.approval_requests + committed.workflows).toBeGreaterThan(
				0,
			);

			const replay = await clockOutRequester(submissionId);
			expect(replay).toMatchObject({ success: true });
			expect(replay.success && replay.data.pendingApproval).toBe(true);
			expect(replay.success && first.success && replay.data.id).toBe(
				first.success ? first.data.id : undefined,
			);
			expect(await workState()).toEqual(committed);
			expect(harness.notifications).toHaveLength(mode === "legacy" ? 1 : 0);
		},
	);

	it.each(lifecycleModes)(
		"restarts when a new approval participant appears while waiting in %s mode",
		async (mode) => {
			await seed({ manager: true, mode });
			harness.forceApproval = true;
			await clockInRequester();
			const { action, holder } = await blockFreshAttempt(keys.adoption, () =>
				clockOutRequester(),
			);

			await admin.query(
				"update employee_managers set is_primary = false where id = $1",
				[ids.managerLink],
			);
			await admin.query(
				`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
				[ids.lateManagerLink, ids.requester, ids.lateManager, ids.managerUser],
			);
			await holder.commit();

			const result = await action;
			expect(result).toMatchObject({ success: true });
			expect(result.success && result.data.pendingApproval).toBe(true);
			expect(adoptionAttempts()).toBe(3);
			await expectPendingApprover(mode, ids.lateManager);
		},
	);

	it("restarts when an approval policy is activated while waiting in canonical mode", async () => {
		await seed({ manager: true, mode: "canonical" });
		harness.forceApproval = true;
		await clockInRequester();
		const { action, holder } = await blockFreshAttempt(keys.adoption, () =>
			clockOutRequester(),
		);

		await admin.query(
			`insert into approval_policy
			 (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'T272 late policy', true, 1, $3, now())`,
			[ids.approvalPolicy, ids.organization, ids.managerUser],
		);
		await admin.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type,
			  fallback_behavior, updated_at)
			 values ($1, $2, $3, 1, 'Manager', 'direct_manager', 'fail', now())`,
			[ids.approvalStage, ids.organization, ids.approvalPolicy],
		);
		await holder.commit();

		const result = await action;
		expect(result).toMatchObject({ success: true });
		expect(result.success && result.data.pendingApproval).toBe(true);
		expect(adoptionAttempts()).toBe(3);
		expect(
			harness.queries.some(
				(query) =>
					query.sql.includes("web-clock-out:lock") &&
					query.sql.includes('"approval_policy_stage"') &&
					query.params.includes(ids.approvalStage),
			),
		).toBe(true);
	});

	it.each(lifecycleModes)(
		"auto-completes requester approval with the terminal break split in one transaction in %s mode",
		async (mode) => {
			await seed({ requesterSelfApproves: true, breakPolicy: true, mode });
			harness.forceApproval = true;
			await clockInRequester();

			const result = await clockOutRequester();
			expect(result).toMatchObject({ success: true });
			expect(result.success && result.data.pendingApproval).toBe(false);
			expect(adoptionAttempts()).toBe(2);

			const { rows } = await admin.query<{
				start_time: Date;
				end_time: Date;
				approval_status: string;
			}>(
				`select start_time, end_time, approval_status from work_period
			 where employee_id = $1 order by start_time`,
				[ids.requester],
			);
			expect(rows.length).toBeGreaterThan(1);
			expect(rows.every((row) => row.approval_status === "approved")).toBe(
				true,
			);
			const breakMinutes = rows
				.slice(1)
				.reduce(
					(total, row, index) =>
						total +
						(row.start_time.getTime() -
							(rows[index]?.end_time.getTime() ?? Number.NaN)) /
							60_000,
					0,
				);
			expect(breakMinutes).toBeGreaterThanOrEqual(30);
			expect(rows.at(-1)?.end_time).toEqual(new Date("2026-07-22T16:00:00Z"));
			await expectCoherentChain();
		},
	);

	async function seedBreakPolicy() {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled,
			  is_active, created_by, updated_at)
			 values ($1, $2, 'T272 late policy', false, false, true, $3, $4)`,
			[ids.workPolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (id, policy_id, organization_id, assignment_type, employee_id,
			  priority, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
			[
				ids.policyAssignment,
				ids.workPolicy,
				ids.organization,
				ids.requester,
				ids.managerUser,
				timestamp,
			],
		);
	}
});
