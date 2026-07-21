/**
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import { configurePostgresUtcTypes } from "@/db/postgres-utc";
import * as schema from "@/db/schema";
import {
	type Clock,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "../workflow/identity";
import type {
	ApprovalCommandResult,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
} from "../workflow/ports";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "../workflow/repository-integration-harness";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import {
	bindTimeCorrectionWorkflowToWorkPeriod,
	deleteCancelledTimeCorrectionsInTransaction,
	executeTimeCorrectionSubmissionInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
	lockTimeCorrectionSubmissionSourceInTransaction,
} from "./time-correction-approvals";
import { cancelPendingTimeCorrection } from "./time-correction-cancellation";
import type { ApprovalDbService } from "./types";

configurePostgresUtcTypes();

const productionSource = readFileSync(
	join(process.cwd(), "src/lib/approvals/server/time-correction-approvals.ts"),
	"utf8",
);
const migrationSource = readFileSync(
	join(process.cwd(), "drizzle/0054_approval_workflow_expand.sql"),
	"utf8",
);
const cycleMigrationSource = readFileSync(
	join(process.cwd(), "drizzle/0055_approval_workflow_cycle_identity.sql"),
	"utf8",
);
const runnerSource = readFileSync(
	join(
		process.cwd(),
		"scripts/run-approval-workflow-repository-integration.sh",
	),
	"utf8",
);
const integrationSource = readFileSync(
	join(
		process.cwd(),
		"src/lib/approvals/server/time-correction-approvals.integration.test.ts",
	),
	"utf8",
);
const databaseSchema = { ...authSchema, ...schema };

function functionSource(name: string): string {
	const start = productionSource.indexOf(`function ${name}`);
	const next = productionSource.indexOf("\nfunction ", start + 1);
	if (start === -1) throw new Error(`Missing production function ${name}`);
	return productionSource.slice(start, next === -1 ? undefined : next);
}

describe("time correction PostgreSQL non-live contracts", () => {
	it("migrates the source link with an organization-composite foreign key and per-workflow-type pending identity", () => {
		expect(migrationSource).toContain(
			'ALTER TABLE "work_period" ADD COLUMN "approval_workflow_id" uuid',
		);
		expect(migrationSource).toContain(
			'FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id")',
		);
		expect(cycleMigrationSource).toContain(
			'("organization_id","workflow_type","source_type","source_id") WHERE status = \'pending\'',
		);
	});

	it("locks employee rows in sorted order before period, endpoints, predecessors, and canonical record", () => {
		const body = functionSource(
			"finalizeTimeCorrectionTerminalDetailedInTransaction",
		);
		const employeeLock = body.indexOf(".from(employee)");
		const periodLock = body.indexOf(".from(workPeriod)");
		const endpointLock = body.indexOf(".from(timeEntry)");
		const predecessorLock = body.indexOf("lockCurrentEndpointPredecessors");
		const canonicalLock = body.indexOf(".from(timeRecord)");

		expect(body.slice(employeeLock, periodLock)).toContain(
			".orderBy(asc(employee.id))",
		);
		expect(body.slice(employeeLock, periodLock)).toContain('.for("update")');
		expect(body.slice(periodLock, endpointLock)).toContain('.for("update")');
		expect(body.slice(endpointLock, predecessorLock)).toContain(
			".orderBy(asc(timeEntry.id))",
		);
		expect(body.slice(endpointLock, predecessorLock)).toContain(
			'.for("update")',
		);
		expect(body.slice(canonicalLock)).toContain('.for("update")');
		expect([
			employeeLock,
			periodLock,
			endpointLock,
			predecessorLock,
			canonicalLock,
		]).toEqual(
			[
				...[
					employeeLock,
					periodLock,
					endpointLock,
					predecessorLock,
					canonicalLock,
				],
			].sort((left, right) => left - right),
		);
	});

	it("uses affected-row CAS for corrections, originals, period, canonical record, and source binding", () => {
		const finalizer = functionSource(
			"finalizeTimeCorrectionTerminalDetailedInTransaction",
		);
		const binding = functionSource("bindTimeCorrectionWorkflowToWorkPeriod");

		for (const predicate of [
			"eq(timeEntry.isSuperseded, true)",
			"eq(timeEntry.isSuperseded, false)",
			"eq(workPeriod.clockInId, period.clockInId)",
			"eq(workPeriod.approvalWorkflowId, expectedApprovalWorkflowId)",
			"eq(timeRecord.startAt, canonical.startAt)",
		]) {
			expect(finalizer).toContain(predicate);
		}
		const returningCount =
			finalizer.match(
				/\.returning\(\{ id: (?:timeEntry|workPeriod|timeRecord)\.id \}\)/g,
			)?.length ?? 0;
		const affectedRowCheckCount =
			finalizer.match(/requireSingleMutation\(/g)?.length ?? 0;
		expect(returningCount).toBeGreaterThanOrEqual(4);
		expect(affectedRowCheckCount).toBe(returningCount);
		expect(binding).toContain("source.approvalWorkflowId === null");
		expect(binding).toContain(
			"eq(workPeriod.approvalWorkflowId, source.approvalWorkflowId)",
		);
		expect(binding).toContain("updated.length !== 1");
	});

	it("runs only against a label-owned disposable database and includes this suite", () => {
		expect(runnerSource).toContain("docker run --detach");
		expect(runnerSource).toContain(
			"--label z8.agent-owned=approval-workflow-repository-test",
		);
		expect(runnerSource).toContain(
			"APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL=",
		);
		expect(runnerSource).toContain(
			"src/lib/approvals/server/time-correction-approvals.integration.test.ts",
		);
		expect(runnerSource).toContain(
			'PGOPTIONS="-c statement_timeout=15000 -c timezone=UTC"',
		);
		expect(runnerSource).not.toMatch(
			/(^|[^A-Z_])(?:DATABASE_URL|POSTGRES_URL|PGHOST)=/m,
		);
	});

	it("defines every named Task 13 PostgreSQL race rollback and replay scenario", () => {
		for (const scenario of [
			"requester cancellation versus approval commits one winner with source parity",
			"concurrent cancellation and approval obey employee-period-endpoint-predecessor-canonical lock order without deadlock",
			"manager-before-requester UUID decision versus requester auto-completion avoids lock inversion",
			"concurrent distinct correction cycles leave exactly one pending winner",
			"terminal cycle followed by next cycle retains both workflow histories",
			"immediate manager finalization versus pending creation commits one source winner",
			"stale %s CAS rolls the full transaction back",
			"injected %s failure restores every durable Task 13 snapshot",
			"duplicate terminal finalization applies source effects once and rejects the duplicate",
			"canonical transition receipt replay returns once without duplicate finalizer events or effects",
		]) {
			expect(integrationSource).toContain(scenario);
		}
	});
});

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
	describe.skip(`time correction PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}
const organizationId = "task12-replay-race-org";
const userId = "task12-replay-race-user";
const employeeId = "a1000000-0000-4000-8000-000000000001";
const timeEntryId = "a2000000-0000-4000-8000-000000000001";
const workPeriodId = "a3000000-0000-4000-8000-000000000001";
const terminalWorkflowId = "a4000000-0000-4000-8000-000000000001";
const pendingWorkflowId = "a4000000-0000-4000-8000-000000000002";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
	return promise.then(
		(value) => ({ status: "fulfilled", value }),
		(reason) => ({ status: "rejected", reason }),
	);
}

async function runSqlStatements(
	pool: Pool,
	statements: Array<{ text: string; values?: unknown[] }>,
) {
	const client = await pool.connect();
	try {
		await client.query("begin");
		for (const { text, values } of statements) {
			await client.query(text, values);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

async function waitForTransactionLock(
	observer: Pool,
	applicationName: string,
	timeoutMilliseconds = 5_000,
) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (true) {
		const activity = await observer.query<{ wait_event_type: string | null }>(
			`select wait_event_type
			from pg_stat_activity
			where application_name = $1
				and wait_event_type = 'Lock'`,
			[applicationName],
		);
		if (activity.rows.length === 1) return;
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for ${applicationName} row lock`);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
}

type Task13LockTable =
	| "employee"
	| "work_period"
	| "time_entry"
	| "time_record";

interface HeldTask13RowLock {
	client: PoolClient;
	pid: number;
	table: Task13LockTable;
}

interface ObservedTask13LockWait {
	pid: number;
	blockedRelation: Task13LockTable;
	query: string;
	waitEventType: string;
	waitEvent: string;
	blockingPids: number[];
	heldRelations: string[];
	ungrantedLockTypes: string[];
}

async function holdTask13Rows(
	pool: Pool,
	table: Task13LockTable,
	ids: readonly string[],
): Promise<HeldTask13RowLock> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query("set local statement_timeout = '15s'");
		const pid = await client.query<{ pid: number }>(
			"select pg_backend_pid() as pid",
		);
		await client.query(
			`select id from ${table} where id = any($1::uuid[]) order by id for update`,
			[[...ids]],
		);
		return { client, pid: pid.rows[0]?.pid ?? -1, table };
	} catch (error) {
		client.release();
		throw error;
	}
}

async function releaseTask13Rows(lock: HeldTask13RowLock): Promise<void> {
	try {
		await lock.client.query("commit");
	} finally {
		lock.client.release();
	}
}

async function waitForTask13LockWait(
	observer: Pool,
	input: {
		blocker: Pick<HeldTask13RowLock, "pid" | "table">;
		pid?: number;
		timeoutMilliseconds?: number;
	},
): Promise<ObservedTask13LockWait> {
	const deadline = Date.now() + (input.timeoutMilliseconds ?? 8_000);
	while (Date.now() < deadline) {
		const result = await observer.query<{
			pid: number;
			query: string;
			wait_event_type: string | null;
			wait_event: string | null;
			blocking_pids: number[];
			held_relations: string[];
			ungranted_lock_types: string[];
		}>(
			`select activity.pid,
				activity.query,
				activity.wait_event_type,
				activity.wait_event,
				pg_blocking_pids(activity.pid) as blocking_pids,
				coalesce((
					select array_agg(distinct relation.relname order by relation.relname)
					from pg_locks held
					join pg_class relation on relation.oid = held.relation
					where held.pid = activity.pid and held.granted
				), array[]::text[]) as held_relations,
				coalesce((
					select array_agg(distinct waiting.locktype order by waiting.locktype)
					from pg_locks waiting
					where waiting.pid = activity.pid and not waiting.granted
				), array[]::text[]) as ungranted_lock_types
			from pg_stat_activity activity
			where activity.datname = current_database()
				and activity.wait_event_type = 'Lock'
				and $1 = any(pg_blocking_pids(activity.pid))
				and ($2::int is null or activity.pid = $2)
			order by activity.pid`,
			[input.blocker.pid, input.pid ?? null],
		);
		const row = result.rows[0];
		if (row?.wait_event_type === "Lock" && row.wait_event) {
			const evidence = {
				pid: row.pid,
				blockedRelation: input.blocker.table,
				query: row.query,
				waitEventType: row.wait_event_type,
				waitEvent: row.wait_event,
				blockingPids: row.blocking_pids,
				heldRelations: row.held_relations,
				ungrantedLockTypes: row.ungranted_lock_types,
			};
			expect(evidence.blockingPids).toContain(input.blocker.pid);
			expect(evidence.query.trim().length).toBeGreaterThan(0);
			expect(evidence.heldRelations).toContain(input.blocker.table);
			expect(evidence.ungrantedLockTypes).toContain("transactionid");
			return evidence;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Timed out observing ${input.blocker.table} row-lock wait`);
}

describeIntegration("time correction source-lock PostgreSQL contract", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 4 });
	const database = drizzle({ client: pool, schema: databaseSchema });

	async function cleanup() {
		await runSqlStatements(pool, [
			{ text: "delete from work_period where id = $1", values: [workPeriodId] },
			{ text: "delete from time_entry where id = $1", values: [timeEntryId] },
			{
				text: "delete from approval_workflow where id in ($1, $2)",
				values: [terminalWorkflowId, pendingWorkflowId],
			},
			{ text: "delete from employee where id = $1", values: [employeeId] },
			{ text: 'delete from "user" where id = $1', values: [userId] },
			{
				text: "delete from organization where id = $1",
				values: [organizationId],
			},
		]);
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled")
			throw new Error("Approval workflow integration test is disabled");
	});

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-07-21T08:00:00Z");
		await runSqlStatements(pool, [
			{
				text: `insert into organization (id, name, slug, created_at)
				 values ($1, 'Task 12 Replay Race', $1, $2)`,
				values: [organizationId, timestamp],
			},
			{
				text: `insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, 'Task 12 Requester', 'task12-replay@example.test', $2, $2)`,
				values: [userId, timestamp],
			},
			{
				text: `insert into employee (id, user_id, organization_id, updated_at)
				 values ($1, $2, $3, $4)`,
				values: [employeeId, userId, organizationId, timestamp],
			},
			{
				text: `insert into time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				 ) values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'backfill', 'task12-lock', $5, $4)`,
				values: [timeEntryId, employeeId, organizationId, timestamp, userId],
			},
			{
				text: `insert into work_period (
					id, employee_id, organization_id, clock_in_id, start_time, updated_at
				 ) values ($1, $2, $3, $4, $5, $5)`,
				values: [
					workPeriodId,
					employeeId,
					organizationId,
					timeEntryId,
					timestamp,
				],
			},
		]);
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	it("makes the post-lock READ COMMITTED snapshot observe the winning new cycle", async () => {
		const firstLocked = deferred();
		const releaseFirst = deferred();
		const applicationName = `task12-replay-waiter-${process.pid}`;
		const first = database.transaction(async (transaction) => {
			await lockTimeCorrectionSubmissionSourceInTransaction({
				dbService: { db: transaction } as unknown as ApprovalDbService,
				organizationId,
				requesterEmployeeId: employeeId,
				workPeriodId,
			});
			await transaction.execute(sql`
				update work_period
				set pending_changes = ${"new-cycle"}
				where id = ${workPeriodId} and organization_id = ${organizationId}
			`);
			firstLocked.resolve();
			await releaseFirst.promise;
		});
		await firstLocked.promise;
		const second = database.transaction(async (transaction) => {
			await transaction.execute(
				sql`select set_config('application_name', ${applicationName}, true)`,
			);
			await lockTimeCorrectionSubmissionSourceInTransaction({
				dbService: { db: transaction } as unknown as ApprovalDbService,
				organizationId,
				requesterEmployeeId: employeeId,
				workPeriodId,
			});
			const result = await transaction.execute<{
				pending_changes: string | null;
			}>(
				sql`select pending_changes from work_period
					where id = ${workPeriodId} and organization_id = ${organizationId}`,
			);
			return result.rows[0]?.pending_changes ?? null;
		});
		await waitForTransactionLock(pool, applicationName);
		releaseFirst.resolve();

		await expect(first).resolves.toBeUndefined();
		await expect(second).resolves.toBe("new-cycle");
	});

	it("has the migrated typed pending index and organization-composite work-period workflow foreign key", async () => {
		const index = await pool.query<{ definition: string }>(
			`select indexdef as definition from pg_indexes
			where schemaname = 'public'
				and indexname = 'approvalWorkflow_org_source_pending_idx'`,
		);
		expect(index.rows[0]?.definition).toContain(
			"(organization_id, workflow_type, source_type, source_id)",
		);
		expect(index.rows[0]?.definition).toContain(
			"WHERE (status = 'pending'::approval_workflow_status)",
		);
		const foreignKey = await pool.query<{ definition: string }>(
			`select pg_get_constraintdef(oid) as definition from pg_constraint
			where conname = 'work_period_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk'`,
		);
		expect(foreignKey.rows).toEqual([
			{
				definition: expect.stringContaining(
					"FOREIGN KEY (approval_workflow_id, organization_id) REFERENCES approval_workflow(id, organization_id)",
				),
			},
		]);
	});

	it("replaces a terminal source binding with a new pending cycle and rejects replacement of that pending cycle", async () => {
		const submitted = new Date("2026-07-21T09:00:00Z");
		const completed = new Date("2026-07-21T09:05:00Z");
		const nextSubmitted = new Date("2026-07-21T09:06:00Z");
		await runSqlStatements(pool, [
			{
				text: `insert into approval_workflow (
				id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version,
				policy_snapshot, context_snapshot, display_snapshot, submitted_at,
				completed_at, created_at, updated_at
			) values
				($1, $3, 'time_correction', 'time_entry', $4, $5, 'approved', null, 2,
				 '{}', '{}', '{}', $6, $7, $6, $7),
				($2, $3, 'time_correction', 'time_entry', $4, $5, 'pending', 1, 1,
				 '{}', '{}', '{}', $8, null, $8, $8)`,
				values: [
					terminalWorkflowId,
					pendingWorkflowId,
					organizationId,
					workPeriodId,
					employeeId,
					submitted,
					completed,
					nextSubmitted,
				],
			},
			{
				text: `update work_period set approval_workflow_id = $1
				 where id = $2 and organization_id = $3 and employee_id = $4`,
				values: [terminalWorkflowId, workPeriodId, organizationId, employeeId],
			},
		]);

		await database.transaction(async (transaction) => {
			await bindTimeCorrectionWorkflowToWorkPeriod({
				dbService: { db: transaction } as unknown as ApprovalDbService,
				organizationId,
				workPeriodId,
				employeeId,
				workflowId: pendingWorkflowId,
			});
		});
		await expect(
			pool.query(
				"select approval_workflow_id from work_period where id = $1 and organization_id = $2",
				[workPeriodId, organizationId],
			),
		).resolves.toMatchObject({
			rows: [{ approval_workflow_id: pendingWorkflowId }],
		});
		await expect(
			database.transaction(async (transaction) =>
				bindTimeCorrectionWorkflowToWorkPeriod({
					dbService: { db: transaction } as unknown as ApprovalDbService,
					organizationId,
					workPeriodId,
					employeeId,
					workflowId: terminalWorkflowId,
				}),
			),
		).rejects.toThrow("Time correction workflow binding conflict");
	});

	it("surfaces a PostgreSQL lock timeout instead of silently deadlocking", async () => {
		const firstLocked = deferred();
		const releaseFirst = deferred();
		const first = database.transaction(async (transaction) => {
			await lockTimeCorrectionSubmissionSourceInTransaction({
				dbService: { db: transaction } as unknown as ApprovalDbService,
				organizationId,
				requesterEmployeeId: employeeId,
				workPeriodId,
			});
			firstLocked.resolve();
			await releaseFirst.promise;
		});
		await firstLocked.promise;
		const waiter = pool.connect();
		const client = await waiter;
		try {
			await client.query("begin");
			await client.query("set local lock_timeout = '100ms'");
			await expect(
				client.query("select id from employee where id = $1 for update", [
					employeeId,
				]),
			).rejects.toMatchObject({ code: "55P03" });
			await client.query("rollback");
		} finally {
			client.release();
			releaseFirst.resolve();
			await first;
		}
	});
});

describeIntegration(
	"Task 13 time correction PostgreSQL races and atomicity",
	() => {
		const pool = new Pool({ connectionString: databaseUrl, max: 16 });
		const database = drizzle({ client: pool, schema: databaseSchema });
		const now = parseInstant("2026-07-20T12:00:00Z");
		const ids = {
			organization: "task13-time-correction-org",
			requesterUser: "task13-requester-user",
			managerUser: "task13-manager-user",
			requester: "b1000000-0000-4000-8000-000000000001",
			manager: "a1000000-0000-4000-8000-000000000002",
			originalIn: "b2000000-0000-4000-8000-000000000001",
			originalOut: "b2000000-0000-4000-8000-000000000002",
			correction: "b2000000-0000-4000-8000-000000000003",
			period: "b3000000-0000-4000-8000-000000000001",
			canonical: "b4000000-0000-4000-8000-000000000001",
		} as const;
		const originalStart = new Date("2026-07-20T08:00:00Z");
		const correctedStart = new Date("2026-07-20T08:15:00Z");
		const originalEnd = new Date("2026-07-20T16:00:00Z");
		const correctedStartJson = "2026-07-20T08:15:00";

		type Task13EffectCounters = {
			finalizer: number;
			cancellation: number;
			externalEffect: number;
		};

		function runtime(
			counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			},
			clock: Clock = { nowInstant: () => now },
		) {
			return createProductionApprovalWorkflowRuntime({
				db: database as unknown as ApprovalWorkflowDatabase,
				adapters: {
					absence: {
						clock,
						finalizeAbsenceTerminal: async () => {
							throw new Error("absence finalization is outside Task 13");
						},
						deleteCancelledAbsence: async () => {
							throw new Error("absence cancellation is outside Task 13");
						},
					},
					timeCorrection: {
						clock,
						finalizeTimeCorrectionTerminal: async (input) => {
							const result =
								await finalizeTimeCorrectionTerminalInTransaction(input);
							counters.finalizer += 1;
							counters.externalEffect += 1;
							return result;
						},
						deleteCancelledCorrections: async (input) => {
							const result =
								await deleteCancelledTimeCorrectionsInTransaction(input);
							counters.cancellation += 1;
							counters.externalEffect += 1;
							return result;
						},
					},
				},
				canManageApproval: async () => false,
				clock,
			});
		}

		function initialWorkflowInput(submissionKey: string) {
			const workflowId = deriveApprovalWorkflowId({
				organizationId: ids.organization,
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: ids.period,
				allocationKey: submissionKey,
			});
			const stageId = deriveApprovalStageId({
				organizationId: ids.organization,
				workflowId,
				allocationKey: "stage:1",
			});
			const assignmentId = deriveApprovalAssignmentId({
				organizationId: ids.organization,
				workflowId,
				allocationKey: `${workflowId}:stage:${stageId}:assignment:1`,
			});
			const snapshot: ApprovalWorkflowSnapshot = {
				id: workflowId,
				organizationId: ids.organization,
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: ids.period,
				requesterEmployeeId: ids.requester,
				status: "pending",
				currentStageOrder: 1,
				version: 1,
				policySnapshot: { kind: "task13_manager" },
				contextSnapshot: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: ids.correction,
					},
				},
				displaySnapshot: {
					displayPayload: { title: "Task 13 correction" },
					searchText: "task 13 correction",
				},
				submittedAt: now,
				completedAt: null,
				cancelledAt: null,
				decisionReason: null,
				stages: [
					{
						id: stageId,
						organizationId: ids.organization,
						workflowId,
						sequence: 1,
						label: "Manager",
						resolverSnapshot: { kind: "manager" },
						activationMode: "human",
						status: "pending",
						activatedAt: now,
						decidedAt: null,
						decisionReason: null,
						legacyApprovalRequestId: null,
						assignments: [
							{
								id: assignmentId,
								organizationId: ids.organization,
								workflowId,
								stageId,
								sequence: 1,
								approverEmployeeId: ids.manager,
								status: "pending",
								assignedAt: now,
								resolvedAt: null,
								resolvedBy: null,
								reassignedByEmployeeId: null,
								reassignedFromAssignmentId: null,
								reassignmentMetadata: null,
							},
						],
					},
				],
			};
			const events: ApprovalWorkflowEventSnapshot[] = [
				{
					id: deriveApprovalEventId({
						organizationId: ids.organization,
						workflowId,
						allocationKey: `${workflowId}:event:1:0`,
					}),
					organizationId: ids.organization,
					workflowId,
					version: 1,
					eventIndex: 0,
					eventType: "assignment.created",
					actor: { kind: "system", employeeId: null, userId: null },
					previousState: null,
					resultingState: {
						approverEmployeeId: ids.manager,
						sequence: 1,
						status: "pending",
					},
					reason: null,
					metadata: null,
					references: { assignmentId },
					idempotencyKey: submissionKey,
					occurredAt: now,
				},
				{
					id: deriveApprovalEventId({
						organizationId: ids.organization,
						workflowId,
						allocationKey: `${workflowId}:event:1:1`,
					}),
					organizationId: ids.organization,
					workflowId,
					version: 1,
					eventIndex: 1,
					eventType: "stage.activated",
					actor: { kind: "system", employeeId: null, userId: null },
					previousState: { status: "waiting" },
					resultingState: { status: "pending" },
					reason: null,
					metadata: { stageId, stageOrder: 1 },
					references: {},
					idempotencyKey: `${submissionKey}:1`,
					occurredAt: now,
				},
			];
			return { snapshot, events, submissionKey, stageId, assignmentId };
		}

		async function createCycle(submissionKey: string) {
			const input = initialWorkflowInput(submissionKey);
			const persistenceInput = {
				snapshot: input.snapshot,
				events: input.events,
				submissionKey: input.submissionKey,
			};
			const result = await runtime().repository.withTransaction(
				async (context) => {
					const created =
						await context.repository.createInitialWorkflow(persistenceInput);
					if (created.kind === "created") {
						await context.compatibilityWriter.mirrorCanonicalToLegacy({
							result: pendingCommandResult(input),
						});
					}
					return created;
				},
			);
			if (result.kind === "created") {
				await database.transaction((transaction) =>
					bindTimeCorrectionWorkflowToWorkPeriod({
						dbService: { db: transaction } as unknown as ApprovalDbService,
						organizationId: ids.organization,
						workPeriodId: ids.period,
						employeeId: ids.requester,
						workflowId: input.snapshot.id,
					}),
				);
			}
			return { input, result };
		}

		async function submitCorrection(
			defaultApproverId: string,
			submissionKey: string,
		) {
			return runtime().repository.withTransaction((context) =>
				executeTimeCorrectionSubmissionInTransaction({
					dbService: context.dbService as unknown as ApprovalDbService,
					context,
					organizationId: ids.organization,
					requesterEmployeeId: ids.requester,
					teamId: null,
					workPeriodId: ids.period,
					defaultApproverId,
					reason: null,
					overtimeRisk: null,
					submissionKey,
					submissionId: "b5000000-0000-4000-8000-000000000001",
					correction: {
						action: "edit",
						clockInCorrectionId: ids.correction,
					},
					nowInstant: () => now,
				}),
			);
		}

		async function submitAndApproveCorrectionAsManager(submissionKey: string) {
			const productionRuntime = runtime(undefined, systemClock);
			return productionRuntime.repository.withTransaction(async (context) => {
				const submitted = await executeTimeCorrectionSubmissionInTransaction({
					dbService: context.dbService as unknown as ApprovalDbService,
					context,
					organizationId: ids.organization,
					requesterEmployeeId: ids.requester,
					teamId: null,
					workPeriodId: ids.period,
					defaultApproverId: ids.manager,
					reason: null,
					overtimeRisk: null,
					submissionKey,
					submissionId: "b5000000-0000-4000-8000-000000000001",
					correction: {
						action: "edit",
						clockInCorrectionId: ids.correction,
					},
					nowInstant: () => now,
				});
				if (submitted.kind !== "default_created") {
					throw new Error(
						"Manager correction did not create a pending workflow",
					);
				}
				const workflowId = deriveApprovalWorkflowId({
					organizationId: ids.organization,
					workflowType: "time_correction",
					sourceType: "time_entry",
					sourceId: ids.period,
					allocationKey: submissionKey,
				});
				const snapshot = await context.repository.loadSnapshot({
					organizationId: ids.organization,
					workflowId,
				});
				const stage = snapshot.stages.find(
					(candidate) => candidate.status === "pending",
				);
				const assignment = stage?.assignments.find(
					(candidate) =>
						candidate.status === "pending" &&
						candidate.approverEmployeeId === ids.manager,
				);
				if (!stage || !assignment) {
					throw new Error("Manager correction has no eligible assignment");
				}
				const decision =
					await productionRuntime.transitionEngine.executeInTransaction(
						context,
						{
							organizationId: ids.organization,
							workflowId,
							expectedVersion: snapshot.version,
							idempotencyKey: `${submissionKey}:manager-approve`,
							principal: { kind: "employee", userId: ids.managerUser },
							command: {
								type: "approve",
								stageId: stage.id,
								assignmentId: assignment.id,
							},
						},
					);
				return { kind: "manager_completed" as const, submitted, decision };
			});
		}

		function approvalCommand(
			input: ReturnType<typeof initialWorkflowInput>,
			key: string,
		) {
			return {
				organizationId: ids.organization,
				workflowId: input.snapshot.id,
				expectedVersion: 1,
				idempotencyKey: key,
				principal: { kind: "employee" as const, userId: ids.managerUser },
				command: {
					type: "approve" as const,
					stageId: input.stageId,
					assignmentId: input.assignmentId,
				},
			};
		}

		function pendingCommandResult(
			input: ReturnType<typeof initialWorkflowInput>,
		): ApprovalCommandResult {
			return {
				snapshot: input.snapshot,
				events: input.events,
				projection: {
					organizationId: ids.organization,
					workflowId: input.snapshot.id,
					workflowType: "time_correction",
					sourceType: "time_entry",
					sourceId: ids.period,
					status: "pending",
					currentStageOrder: 1,
					requesterEmployeeId: ids.requester,
					displayPayload: {},
					searchText: "task13",
					activeInboxStage: null,
					updatedAt: now,
				},
				outbox: [],
			};
		}

		async function cleanupTask13() {
			const organizationValues = [ids.organization];
			await runSqlStatements(pool, [
				{
					text: "delete from approval_outbox_delivery where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_outbox where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_inbox_projection where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_requester_projection where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_workflow_command where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_workflow_event where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_stage_assignment where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_workflow_stage where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_request where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "update work_period set approval_workflow_id = null where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_workflow_rollout where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from approval_workflow where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from work_period where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from time_record_work where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from time_record where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from time_entry where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from employee where organization_id = $1",
					values: organizationValues,
				},
				{
					text: "delete from member where organization_id = $1",
					values: organizationValues,
				},
				{
					text: 'delete from "user" where id in ($1, $2)',
					values: [ids.requesterUser, ids.managerUser],
				},
				{
					text: "delete from organization where id = $1",
					values: organizationValues,
				},
			]);
		}

		async function seedTask13() {
			await cleanupTask13();
			const timestamp = new Date(now.epochMilliseconds);
			await runSqlStatements(pool, [
				{
					text: `insert into organization (id, name, slug, created_at)
					 values ($1, 'Task 13 Time Correction', $1, $2)`,
					values: [ids.organization, timestamp],
				},
				{
					text: `insert into "user" (id, name, email, created_at, updated_at) values
					 ($1, 'Task 13 Requester', 'task13-requester@example.test', $3, $3),
					 ($2, 'Task 13 Manager', 'task13-manager@example.test', $3, $3)`,
					values: [ids.requesterUser, ids.managerUser, timestamp],
				},
				{
					text: `insert into member (id, organization_id, user_id, role, status, created_at) values
					 ('task13-requester-member', $1, $2, 'member', 'approved', $4),
					 ('task13-manager-member', $1, $3, 'member', 'approved', $4)`,
					values: [
						ids.organization,
						ids.requesterUser,
						ids.managerUser,
						timestamp,
					],
				},
				{
					text: `insert into employee (id, user_id, organization_id, updated_at) values
					 ($1, $2, $5, $6), ($3, $4, $5, $6)`,
					values: [
						ids.requester,
						ids.requesterUser,
						ids.manager,
						ids.managerUser,
						ids.organization,
						timestamp,
					],
				},
				{
					text: `insert into time_entry (
				id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone, timezone_source, hash, previous_hash, previous_entry_id,
				replaces_entry_id, is_superseded, superseded_by_id, created_by, created_at
			 ) values
			 ($1, $2, $3, 'clock_in', $8, 0, 'UTC', 'backfill', 'task13-in', null, null, null, false, null, $7, $6),
			 ($4, $2, $3, 'clock_out', $9, 0, 'UTC', 'backfill', 'task13-out', 'task13-in', $1, null, false, null, $7, $6),
			 ($5, $2, $3, 'correction', $10, 0, 'UTC', 'backfill', 'task13-correction', 'task13-out', $4, $1, true, null, $7, $6)`,
					values: [
						ids.originalIn,
						ids.requester,
						ids.organization,
						ids.originalOut,
						ids.correction,
						timestamp,
						ids.requesterUser,
						originalStart,
						originalEnd,
						correctedStart,
					],
				},
				{
					text: `insert into time_record (
				id, organization_id, employee_id, record_kind, start_at, end_at,
				duration_minutes, approval_state, origin, created_by, updated_at
			 ) values ($1, $2, $3, 'work', $4, $5, 480, 'approved', 'manual', $6, $7)`,
					values: [
						ids.canonical,
						ids.organization,
						ids.requester,
						originalStart,
						originalEnd,
						ids.requesterUser,
						timestamp,
					],
				},
				{
					text: `insert into time_record_work (record_id, organization_id, record_kind)
					 values ($1, $2, 'work')`,
					values: [ids.canonical, ids.organization],
				},
				{
					text: `insert into work_period (
				id, employee_id, organization_id, clock_in_id, clock_out_id,
				canonical_record_id, start_time, end_time, duration_minutes,
				is_active, approval_status, pending_changes, updated_at
			 ) values ($1, $2, $3, $4, $5, $6, $7, $8, 480, false, 'approved', null, $9)`,
					values: [
						ids.period,
						ids.requester,
						ids.organization,
						ids.originalIn,
						ids.originalOut,
						ids.canonical,
						originalStart,
						originalEnd,
						timestamp,
					],
				},
				{
					text: `insert into approval_workflow_rollout (
				organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at
			 ) values ($1, 'time_correction', 'canonical', 'canonical', $2, $2)`,
					values: [ids.organization, timestamp],
				},
			]);
		}

		async function durableSnapshot() {
			const tables = [
				"approval_workflow",
				"approval_workflow_stage",
				"approval_stage_assignment",
				"approval_workflow_event",
				"approval_workflow_command",
				"approval_requester_projection",
				"approval_inbox_projection",
				"approval_outbox",
				"approval_request",
				"approval_chain_instance",
				"approval_chain_stage_instance",
				"time_entry",
				"work_period",
				"time_record",
			] as const;
			return Object.fromEntries(
				await Promise.all(
					tables.map(async (table) => [
						table,
						(
							await pool.query<{ row: unknown }>(
								`select to_jsonb(row) as row from ${table} row where organization_id = $1 order by id`,
								[ids.organization],
							)
						).rows.map(({ row }) => row),
					]),
				),
			);
		}

		async function finalize(
			context: ApprovalWorkflowTransactionContext,
			workflow: ReturnType<typeof initialWorkflowInput>,
		) {
			return finalizeTimeCorrectionTerminalInTransaction({
				dbService: context.dbService as unknown as ApprovalDbService,
				organizationId: ids.organization,
				workPeriodId: ids.period,
				expectedApprovalWorkflowId: workflow.snapshot.id,
				expectedApprovalWorkflowVersion: 1,
				expectedRequesterEmployeeId: ids.requester,
				actorEmployeeId: ids.manager,
				actorUserId: ids.managerUser,
				correction: { action: "edit", clockInCorrectionId: ids.correction },
				legacyApprovalRequestId: null,
				transition: { kind: "approve", reason: null },
				finalizedAt: now,
				allowMetadataLessLegacyFallback: false,
			});
		}

		async function runConcurrently<Left, Right>(
			left: () => Promise<Left>,
			right: () => Promise<Right>,
		) {
			const start = deferred();
			const leftResult = (async () => {
				await start.promise;
				return left();
			})();
			const rightResult = (async () => {
				await start.promise;
				return right();
			})();
			start.resolve();
			return Promise.allSettled([leftResult, rightResult]);
		}

		function expectTypedTask13Conflict(
			result: PromiseSettledResult<unknown>,
		): void {
			expect(result.status).toBe("rejected");
			if (result.status !== "rejected") {
				throw new Error("Task 13 loser unexpectedly fulfilled");
			}
			const reason = result.reason as { code?: unknown; _tag?: unknown };
			if (
				!(
					(typeof reason.code === "string" && reason.code.length > 0) ||
					reason._tag === "ConflictError"
				)
			) {
				throw new Error(
					`Task 13 loser returned untyped ${result.reason?.constructor?.name ?? typeof result.reason}: ${String(result.reason)}`,
				);
			}
		}

		async function forceApprovalCancellationWinner(
			winner: "approval" | "cancellation",
			cycle: Awaited<ReturnType<typeof createCycle>>,
			counters: Task13EffectCounters,
		) {
			const periodLock = await holdTask13Rows(pool, "work_period", [
				ids.period,
			]);
			const entryLock = await holdTask13Rows(pool, "time_entry", [
				ids.originalIn,
				ids.originalOut,
				ids.correction,
			]);
			const canonicalLock = await holdTask13Rows(pool, "time_record", [
				ids.canonical,
			]);
			const employeeLock = await holdTask13Rows(pool, "employee", [
				winner === "approval" ? ids.manager : ids.requester,
			]);
			const unreleased = new Set([
				periodLock,
				entryLock,
				canonicalLock,
				employeeLock,
			]);
			const approve = () =>
				runtime(counters).transitionEngine.execute(
					approvalCommand(cycle.input, `task13-forced-${winner}-approve`),
				);
			const cancel = () =>
				cancelPendingTimeCorrection({
					organizationId: ids.organization,
					requesterEmployeeId: ids.requester,
					requesterUserId: ids.requesterUser,
					workPeriodId: ids.period,
				});
			const preferred = winner === "approval" ? approve : cancel;
			const competitor = winner === "approval" ? cancel : approve;
			let preferredPromise: Promise<PromiseSettledResult<unknown>> | undefined;
			let competitorPromise: Promise<PromiseSettledResult<unknown>> | undefined;
			try {
				preferredPromise = settle(preferred());
				const employeeEvidence = await waitForTask13LockWait(pool, {
					blocker: employeeLock,
				});
				let periodEvidence: ObservedTask13LockWait;
				let competitorEvidence: ObservedTask13LockWait;
				if (winner === "approval") {
					await releaseTask13Rows(employeeLock);
					unreleased.delete(employeeLock);
					periodEvidence = await waitForTask13LockWait(pool, {
						blocker: periodLock,
						pid: employeeEvidence.pid,
					});
					competitorPromise = settle(competitor());
					competitorEvidence = await waitForTask13LockWait(pool, {
						blocker: { pid: employeeEvidence.pid, table: "employee" },
					});
				} else {
					competitorPromise = settle(competitor());
					await releaseTask13Rows(employeeLock);
					unreleased.delete(employeeLock);
					periodEvidence = await waitForTask13LockWait(pool, {
						blocker: periodLock,
						pid: employeeEvidence.pid,
					});
					competitorEvidence = await waitForTask13LockWait(pool, {
						blocker: { pid: employeeEvidence.pid, table: "employee" },
					});
				}
				await releaseTask13Rows(periodLock);
				unreleased.delete(periodLock);
				const entryEvidence = await waitForTask13LockWait(pool, {
					blocker: entryLock,
					pid: employeeEvidence.pid,
				});
				await releaseTask13Rows(entryLock);
				unreleased.delete(entryLock);
				const canonicalEvidence = await waitForTask13LockWait(pool, {
					blocker: canonicalLock,
					pid: employeeEvidence.pid,
				});
				await releaseTask13Rows(canonicalLock);
				unreleased.delete(canonicalLock);
				const [winnerResult, loserResult] = await Promise.all([
					preferredPromise,
					competitorPromise,
				]);
				return {
					winnerResult,
					loserResult,
					evidence: [
						employeeEvidence,
						periodEvidence,
						entryEvidence,
						canonicalEvidence,
					],
					competitorEvidence,
				};
			} finally {
				for (const lock of unreleased) {
					await releaseTask13Rows(lock);
				}
				await Promise.all(
					[preferredPromise, competitorPromise].filter(
						(value): value is Promise<PromiseSettledResult<unknown>> =>
							value !== undefined,
					),
				);
			}
		}

		async function forceSubmissionWinner(winner: "manager" | "creation") {
			const employeeLock = await holdTask13Rows(pool, "employee", [
				ids.requester,
			]);
			let employeeReleased = false;
			const preferred =
				winner === "manager"
					? () => submitAndApproveCorrectionAsManager("task13-manager-winner")
					: () => submitCorrection(ids.manager, "task13-creation-winner");
			const competitor =
				winner === "manager"
					? () => submitCorrection(ids.manager, "task13-manager-loser")
					: () => submitAndApproveCorrectionAsManager("task13-creation-loser");
			let preferredPromise: Promise<PromiseSettledResult<unknown>> | undefined;
			let competitorPromise: Promise<PromiseSettledResult<unknown>> | undefined;
			try {
				preferredPromise = settle(preferred());
				await waitForTask13LockWait(pool, { blocker: employeeLock });
				competitorPromise = settle(competitor());
				await waitForTask13LockWait(pool, { blocker: employeeLock });
				await releaseTask13Rows(employeeLock);
				employeeReleased = true;
				const [winnerResult, loserResult] = await Promise.all([
					preferredPromise,
					competitorPromise,
				]);
				return { winnerResult, loserResult };
			} finally {
				if (!employeeReleased) await releaseTask13Rows(employeeLock);
				await Promise.all(
					[preferredPromise, competitorPromise].filter(
						(value): value is Promise<PromiseSettledResult<unknown>> =>
							value !== undefined,
					),
				);
			}
		}

		beforeAll(async () => {
			const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
				databaseUrl,
				required: integrationRequired,
				sentinel: testSentinel,
				currentDatabase: async () => {
					const result = await pool.query<{ database_name: string }>(
						"select current_database() as database_name",
					);
					return result.rows[0]?.database_name ?? "";
				},
			});
			if (enabled.status !== "enabled")
				throw new Error("Task 13 PostgreSQL is disabled");
			await runSqlStatements(pool, [
				{
					text: `create or replace function task13_fail_time_correction_cas() returns trigger as $$
					begin
						if current_setting('task13.failpoint', true) in (
							TG_TABLE_NAME,
							concat(TG_TABLE_NAME, ':', NEW.id::text)
						) then
							return null;
						end if;
						return NEW;
					end;
					$$ language plpgsql`,
				},
				{ text: "drop trigger if exists task13_time_entry_cas on time_entry" },
				{
					text: `create trigger task13_time_entry_cas before update on time_entry
					for each row execute function task13_fail_time_correction_cas()`,
				},
				{
					text: "drop trigger if exists task13_work_period_cas on work_period",
				},
				{
					text: `create trigger task13_work_period_cas before update on work_period
					for each row execute function task13_fail_time_correction_cas()`,
				},
				{
					text: "drop trigger if exists task13_time_record_cas on time_record",
				},
				{
					text: `create trigger task13_time_record_cas before update on time_record
					for each row execute function task13_fail_time_correction_cas()`,
				},
			]);
		});

		beforeEach(seedTask13);

		afterAll(async () => {
			await cleanupTask13();
			await runSqlStatements(pool, [
				{ text: "drop trigger if exists task13_time_entry_cas on time_entry" },
				{
					text: "drop trigger if exists task13_work_period_cas on work_period",
				},
				{
					text: "drop trigger if exists task13_time_record_cas on time_record",
				},
				{ text: "drop function if exists task13_fail_time_correction_cas()" },
			]);
			await pool.end();
		});

		it.each([
			"approval",
			"cancellation",
		] as const)("requester cancellation versus approval commits one winner with source parity: %s wins", async (winner) => {
			const cycle = await createCycle(`task13-parity-${winner}`);
			const before = await durableSnapshot();
			const counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			};
			const result = await forceApprovalCancellationWinner(
				winner,
				cycle,
				counters,
			);
			expect(result.winnerResult.status).toBe("fulfilled");
			expectTypedTask13Conflict(result.loserResult);
			expect(result.evidence.map(({ waitEventType }) => waitEventType)).toEqual(
				["Lock", "Lock", "Lock", "Lock"],
			);

			const after = await durableSnapshot();
			const beforeEntries = before.time_entry as Array<Record<string, unknown>>;
			const afterEntries = after.time_entry as Array<Record<string, unknown>>;
			const beforePeriod = (
				before.work_period as Array<Record<string, unknown>>
			)[0];
			const afterPeriod = (
				after.work_period as Array<Record<string, unknown>>
			)[0];
			const beforeCanonical = (
				before.time_record as Array<Record<string, unknown>>
			)[0];
			const afterCanonical = (
				after.time_record as Array<Record<string, unknown>>
			)[0];
			const workflow = (
				after.approval_workflow as Array<Record<string, unknown>>
			)[0];
			const events = after.approval_workflow_event as Array<
				Record<string, unknown>
			>;
			const legacy = after.approval_request as Array<Record<string, unknown>>;
			const requesterProjection = after.approval_requester_projection as Array<
				Record<string, unknown>
			>;
			const inboxProjection = after.approval_inbox_projection as Array<
				Record<string, unknown>
			>;
			const outbox = after.approval_outbox as Array<Record<string, unknown>>;

			if (winner === "approval") {
				expect(counters).toEqual({
					finalizer: 1,
					cancellation: 0,
					externalEffect: 1,
				});
				expect(
					afterEntries.find(({ id }) => id === ids.correction),
				).toMatchObject({ is_superseded: false, superseded_by_id: null });
				expect(
					afterEntries.find(({ id }) => id === ids.originalIn),
				).toMatchObject({
					is_superseded: true,
					superseded_by_id: ids.correction,
				});
				expect(afterPeriod).toMatchObject({
					clock_in_id: ids.correction,
					start_time: correctedStartJson,
					duration_minutes: 465,
					approval_status: "approved",
					approval_workflow_id: cycle.input.snapshot.id,
				});
				expect(afterCanonical).toMatchObject({
					start_at: correctedStartJson,
					duration_minutes: 465,
					approval_state: "approved",
				});
				expect(workflow).toMatchObject({ status: "approved", version: 2 });
				expect(events.map(({ event_type }) => event_type)).toContain(
					"workflow.approved",
				);
				expect(legacy).toHaveLength(1);
				expect(legacy[0]).toMatchObject({ status: "approved" });
				expect(requesterProjection[0]).toMatchObject({ status: "approved" });
				expect(inboxProjection).toEqual([]);
				expect(outbox.length).toBeGreaterThan(0);
			} else {
				expect(counters).toEqual({
					finalizer: 0,
					cancellation: 0,
					externalEffect: 0,
				});
				expect(
					beforeEntries.filter(({ type }) => type === "correction"),
				).toHaveLength(1);
				expect(
					afterEntries.filter(({ type }) => type === "correction"),
				).toHaveLength(0);
				expect(
					afterEntries.filter(({ type }) => type !== "correction"),
				).toEqual(beforeEntries.filter(({ type }) => type !== "correction"));
				expect(afterPeriod).toEqual(beforePeriod);
				expect(afterCanonical).toEqual(beforeCanonical);
				expect(workflow).toMatchObject({ status: "cancelled", version: 2 });
				expect(events.map(({ event_type }) => event_type)).toContain(
					"workflow.cancelled",
				);
				expect(legacy.filter(({ status }) => status === "pending")).toEqual([]);
				expect(requesterProjection[0]).toMatchObject({ status: "cancelled" });
				expect(inboxProjection).toEqual([]);
				expect(outbox.length).toBeGreaterThan(0);
			}
		}, 30_000);

		it.each([
			"approval",
			"cancellation",
		] as const)("concurrent cancellation and approval obey employee-period-endpoint-predecessor-canonical lock order without deadlock: %s wins", async (winner) => {
			const cycle = await createCycle(`task13-lock-order-${winner}`);
			const counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			};
			const result = await forceApprovalCancellationWinner(
				winner,
				cycle,
				counters,
			);
			expect(
				result.evidence.map(({ blockedRelation }) => blockedRelation),
			).toEqual(["employee", "work_period", "time_entry", "time_record"]);
			expect(result.evidence.map(({ waitEvent }) => waitEvent)).toEqual([
				"transactionid",
				"transactionid",
				"transactionid",
				"transactionid",
			]);
			if (winner === "approval") {
				expect(result.evidence[0]?.query.toLowerCase()).toContain("order by");
			}
			expect(result.competitorEvidence).toMatchObject({
				blockedRelation: "employee",
				waitEventType: "Lock",
				waitEvent: "transactionid",
			});
			expect(result.winnerResult.status).toBe("fulfilled");
			expectTypedTask13Conflict(result.loserResult);
			expect([result.winnerResult, result.loserResult]).not.toContainEqual(
				expect.objectContaining({
					reason: expect.objectContaining({ code: "40P01" }),
				}),
			);
		}, 30_000);

		it("manager-before-requester UUID decision versus requester auto-completion avoids lock inversion", async () => {
			expect(ids.manager < ids.requester).toBe(true);
			const cycle = await createCycle("task13-reverse-uuid-pending");
			const counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			};
			const managerLock = await holdTask13Rows(pool, "employee", [ids.manager]);
			const periodLock = await holdTask13Rows(pool, "work_period", [
				ids.period,
			]);
			let managerLockReleased = false;
			let periodLockReleased = false;
			let managerDecision: Promise<PromiseSettledResult<unknown>> | undefined;
			let requesterSubmission:
				| Promise<PromiseSettledResult<unknown>>
				| undefined;
			try {
				managerDecision = settle(
					runtime(counters).transitionEngine.execute(
						approvalCommand(cycle.input, "task13-reverse-uuid-manager"),
					),
				);
				const managerEvidence = await waitForTask13LockWait(pool, {
					blocker: managerLock,
				});

				requesterSubmission = settle(
					submitCorrection(ids.requester, "task13-reverse-uuid-requester"),
				);
				const submissionEvidence = await waitForTask13LockWait(pool, {
					blocker: periodLock,
				});
				expect(submissionEvidence.heldRelations).toContain("employee");

				await releaseTask13Rows(managerLock);
				managerLockReleased = true;
				const requesterEvidence = await waitForTask13LockWait(pool, {
					blocker: { pid: submissionEvidence.pid, table: "employee" },
					pid: managerEvidence.pid,
				});
				expect(requesterEvidence.query.toLowerCase()).toContain("order by");

				await releaseTask13Rows(periodLock);
				periodLockReleased = true;
				const [decisionResult, submissionResult] = await Promise.all([
					managerDecision,
					requesterSubmission,
				]);
				expect(decisionResult.status).toBe("fulfilled");
				expectTypedTask13Conflict(submissionResult);
				expect(counters).toEqual({
					finalizer: 1,
					cancellation: 0,
					externalEffect: 1,
				});
				const after = await durableSnapshot();
				expect(
					(after.time_entry as Array<Record<string, unknown>>).find(
						({ id }) => id === ids.correction,
					),
				).toMatchObject({ is_superseded: false, superseded_by_id: null });
				expect(
					(after.work_period as Array<Record<string, unknown>>)[0],
				).toMatchObject({
					approval_workflow_id: cycle.input.snapshot.id,
					clock_in_id: ids.correction,
				});
				expect(after.approval_workflow).toEqual([
					expect.objectContaining({
						id: cycle.input.snapshot.id,
						status: "approved",
					}),
				]);
			} finally {
				if (!managerLockReleased) await releaseTask13Rows(managerLock);
				if (!periodLockReleased) await releaseTask13Rows(periodLock);
				await Promise.all(
					[managerDecision, requesterSubmission].filter(
						(value): value is Promise<PromiseSettledResult<unknown>> =>
							value !== undefined,
					),
				);
			}
		}, 30_000);

		it("concurrent distinct correction cycles leave exactly one pending winner", async () => {
			const [firstResult, secondResult] = await runConcurrently(
				() => createCycle("task13-cycle-a"),
				() => createCycle("task13-cycle-b"),
			);
			if (
				firstResult.status !== "fulfilled" ||
				secondResult.status !== "fulfilled"
			) {
				throw new Error(
					"distinct cycle race did not return repository outcomes",
				);
			}
			const first = firstResult.value;
			const second = secondResult.value;
			expect([first.result.kind, second.result.kind].sort()).toEqual([
				"created",
				"source_conflict",
			]);
			const pending = await pool.query<{ count: string }>(
				"select count(*)::text as count from approval_workflow where organization_id = $1 and source_id = $2 and status = 'pending'",
				[ids.organization, ids.period],
			);
			expect(pending.rows[0]?.count).toBe("1");
		});

		it("terminal cycle followed by next cycle retains both workflow histories", async () => {
			const first = await createCycle("task13-history-a");
			await runtime().transitionEngine.execute(
				approvalCommand(first.input, "task13-history-approve"),
			);
			const second = await createCycle("task13-history-b");
			expect(second.result.kind).toBe("created");
			const histories = await pool.query<{ status: string }>(
				"select status from approval_workflow where organization_id = $1 and source_id = $2 order by submitted_at",
				[ids.organization, ids.period],
			);
			expect(histories.rows.map(({ status }) => status).sort()).toEqual([
				"approved",
				"pending",
			]);
		});

		it.each([
			"manager",
			"creation",
		] as const)("immediate manager finalization versus pending creation commits one source winner: %s wins", async (winner) => {
			const before = await durableSnapshot();
			const { winnerResult, loserResult } = await forceSubmissionWinner(winner);
			if (winnerResult.status !== "fulfilled") {
				throw winnerResult.reason;
			}
			expectTypedTask13Conflict(loserResult);
			const result = winnerResult.value as { kind?: unknown };
			const after = await durableSnapshot();
			const entries = after.time_entry as Array<Record<string, unknown>>;
			const period = (after.work_period as Array<Record<string, unknown>>)[0];
			const canonical = (
				after.time_record as Array<Record<string, unknown>>
			)[0];
			const workflows = after.approval_workflow as Array<
				Record<string, unknown>
			>;
			if (winner === "manager") {
				expect(result.kind).toBe("manager_completed");
				expect(workflows.map(({ status }) => status)).toEqual(["approved"]);
				expect(workflows.filter(({ status }) => status === "pending")).toEqual(
					[],
				);
				expect(entries.find(({ id }) => id === ids.correction)).toMatchObject({
					is_superseded: false,
				});
				expect(entries.find(({ id }) => id === ids.originalIn)).toMatchObject({
					is_superseded: true,
					superseded_by_id: ids.correction,
				});
				expect(period).toMatchObject({
					clock_in_id: ids.correction,
					start_time: correctedStartJson,
					duration_minutes: 465,
				});
				expect(canonical).toMatchObject({
					start_at: correctedStartJson,
					duration_minutes: 465,
				});
				expect(after.approval_stage_assignment).toEqual([
					expect.objectContaining({
						status: "approved",
						approver_employee_id: ids.manager,
						resolved_by_actor_kind: "employee",
						resolved_by_actor_id: ids.manager,
					}),
				]);
			} else {
				expect(result.kind).toBe("default_created");
				expect(workflows.map(({ status }) => status)).toEqual(["pending"]);
				expect(entries.find(({ id }) => id === ids.correction)).toMatchObject({
					is_superseded: true,
					superseded_by_id: null,
				});
				expect(entries.find(({ id }) => id === ids.originalIn)).toMatchObject({
					is_superseded: false,
					superseded_by_id: null,
				});
				const beforePeriod = (
					before.work_period as Array<Record<string, unknown>>
				)[0];
				const {
					approval_workflow_id: _beforeLink,
					updated_at: _beforeUpdatedAt,
					...beforeSource
				} = beforePeriod ?? {};
				const {
					approval_workflow_id: pendingLink,
					updated_at: _afterUpdatedAt,
					...afterSource
				} = period ?? {};
				expect(afterSource).toEqual(beforeSource);
				expect(pendingLink).toBe(workflows[0]?.id);
				expect(canonical).toEqual(
					(before.time_record as Array<Record<string, unknown>>)[0],
				);
			}
		}, 30_000);

		it.each([
			["correction activation", `time_entry:${ids.correction}`],
			["original supersede", `time_entry:${ids.originalIn}`],
			["period update", "work_period"],
			["canonical update", "time_record"],
		] as const)("stale %s CAS rolls the full transaction back", async (_scenario, failpoint) => {
			const cycle = await createCycle(`task13-cas-${failpoint}`);
			const before = await durableSnapshot();
			await expect(
				runtime().repository.withTransaction(async (context) => {
					await context.dbService.db.execute(
						sql`select set_config('task13.failpoint', ${failpoint}, true)`,
					);
					await finalize(context, cycle.input);
				}),
			).rejects.toThrow("Time correction source changed during finalization");
			expect(await durableSnapshot()).toEqual(before);
		});

		it.each([
			"projection",
			"outbox",
			"compatibility",
			"source binding",
		] as const)("injected %s failure restores every durable Task 13 snapshot", async (failure) => {
			const cycle = await createCycle(`task13-injected-${failure}`);
			if (failure === "source binding") {
				await pool.query(
					"update work_period set approval_workflow_id = null where organization_id = $1 and id = $2",
					[ids.organization, ids.period],
				);
			}
			const before = await durableSnapshot();
			let effectCount = 0;
			await expect(
				runtime().repository.withTransaction(async (context) => {
					if (failure === "source binding") {
						await bindTimeCorrectionWorkflowToWorkPeriod({
							dbService: context.dbService as unknown as ApprovalDbService,
							organizationId: ids.organization,
							workPeriodId: ids.period,
							employeeId: ids.requester,
							workflowId: cycle.input.snapshot.id,
						});
						effectCount += 1;
					} else if (failure === "projection") {
						await context.projectionWriter.write({
							organizationId: ids.organization,
							workflowId: cycle.input.snapshot.id,
							workflowType: "time_correction",
							sourceType: "time_entry",
							sourceId: ids.period,
							status: "pending",
							currentStageOrder: 1,
							requesterEmployeeId: ids.requester,
							displayPayload: {},
							searchText: "task13",
							activeInboxStage: null,
							updatedAt: now,
						});
						effectCount += 1;
					} else if (failure === "outbox") {
						await context.outboxWriter.write({
							organizationId: ids.organization,
							workflowId: cycle.input.snapshot.id,
							eventId: cycle.input.events[0]?.id ?? "",
							eventType:
								cycle.input.events[0]?.eventType ?? "assignment.created",
							dedupeKey: "task13:injected",
							payload: {},
							disposition: "observe",
							createdAt: now,
						});
						effectCount += 1;
					} else {
						await context.compatibilityWriter.mirrorCanonicalToLegacy({
							result: pendingCommandResult(cycle.input),
						});
						effectCount += 1;
					}
					throw new Error(`injected ${failure} failure`);
				}),
			).rejects.toThrow(`injected ${failure} failure`);
			expect(effectCount).toBe(1);
			expect(await durableSnapshot()).toEqual(before);
		});

		it("duplicate terminal finalization applies source effects once and rejects the duplicate", async () => {
			const cycle = await createCycle("task13-duplicate-finalization");
			const counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			};
			const productionRuntime = runtime(counters);
			const attempts = await runConcurrently(
				() =>
					productionRuntime.transitionEngine.execute(
						approvalCommand(cycle.input, "task13-finalization-a"),
					),
				() =>
					productionRuntime.transitionEngine.execute(
						approvalCommand(cycle.input, "task13-finalization-b"),
					),
			);
			expect(
				attempts.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(counters.finalizer).toBe(1);
			expect(
				attempts.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
			const source = await pool.query<{ active: number; superseded: number }>(
				`select
				count(*) filter (where id = $2 and is_superseded = false)::int as active,
				count(*) filter (where id = $3 and is_superseded = true and superseded_by_id = $2)::int as superseded
			 from time_entry where organization_id = $1`,
				[ids.organization, ids.correction, ids.originalIn],
			);
			expect(source.rows).toEqual([{ active: 1, superseded: 1 }]);
		});

		it("canonical transition receipt replay returns once without duplicate finalizer events or effects", async () => {
			const cycle = await createCycle("task13-receipt-replay");
			const counters: Task13EffectCounters = {
				finalizer: 0,
				cancellation: 0,
				externalEffect: 0,
			};
			const productionRuntime = runtime(counters);
			const command = approvalCommand(
				cycle.input,
				"task13-receipt-replay-command",
			);
			const first = await productionRuntime.transitionEngine.execute(command);
			const afterFirst = await durableSnapshot();
			const countersAfterFirst = { ...counters };
			const replay = await productionRuntime.transitionEngine.execute(command);
			const afterReplay = await durableSnapshot();
			expect(replay).toEqual(first);
			expect(countersAfterFirst).toEqual({
				finalizer: 1,
				cancellation: 0,
				externalEffect: 1,
			});
			expect(counters).toEqual(countersAfterFirst);
			for (const table of [
				"approval_workflow",
				"approval_workflow_event",
				"approval_workflow_command",
				"approval_workflow_stage",
				"approval_stage_assignment",
				"approval_requester_projection",
				"approval_inbox_projection",
				"approval_outbox",
				"approval_request",
				"approval_chain_instance",
				"approval_chain_stage_instance",
				"time_entry",
				"work_period",
				"time_record",
			] as const) {
				expect(afterReplay[table]).toEqual(afterFirst[table]);
			}
			expect(afterReplay).toEqual(afterFirst);
			expect(afterReplay.approval_workflow_command).toHaveLength(1);
			expect(afterReplay.approval_workflow_event).toHaveLength(
				first.events.length + 2,
			);
			expect(afterReplay.approval_outbox).toHaveLength(first.outbox.length);
		});
	},
);
