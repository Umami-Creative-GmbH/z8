/**
 * #284 / T20 runtime evidence: reviewed imports through the completed-work operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real reviewed-import worker (`processImportReviewJob`) commits staged rows against
 * that database. The competing live writer is the real web `clockIn`/`clockOut` action.
 * Only the BullMQ enqueue, request/session, external billing provisioning and Next cache
 * boundaries are replaced. Adoption is enabled per test organization by inserting its
 * append control row directly: production has no activation setter.
 */

import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	enqueued: [] as unknown[],
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

vi.mock("./queue", () => ({
	enqueueImportCommitJob: async (data: unknown) => {
		harness.enqueued.push(data);
	},
	enqueueImportScanJob: async () => {},
}));

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

const { processImportReviewJob } = await import("./worker");
const { clockIn, clockOut } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/clocking"
);
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
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
	describe.skip(`reviewed import operation PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t284-reviewed-import-org",
	importerUser: "t284-importer-user",
	employeeUser: "t284-employee-user",
	peerUser: "t284-peer-user",
	employee: "f1000000-0000-4000-8000-000000000001",
	peer: "f1000000-0000-4000-8000-000000000002",
} as const;

type Provider = "clockodo" | "clockin";
type Batch = { batchId: string; jobId: string };
type RowSeed = {
	sourceId: string;
	startsAt: string;
	endsAt: string | null;
	employeeId?: string;
	sourcePayload?: Record<string, unknown>;
	createdAt?: string;
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function elapsedSeconds(startsAt: string, endsAt: string) {
	return (Date.parse(endsAt) - Date.parse(startsAt)) / 1000;
}

describeIntegration("reviewed imports through the completed-work operation on PostgreSQL", () => {
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
		const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
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

	async function holdEmployeeKey(employeeId: string) {
		const holder = await openHolder();
		await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [employeeId]);
		return holder;
	}

	async function waitFor<T>(label: string, probe: () => Promise<T | undefined>): Promise<T> {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const value = await probe();
			if (value !== undefined) return value;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error(`Timed out waiting for ${label}`);
	}

	function waitForWaiters(holderPid: number, count = 1) {
		return waitFor(`${count} backend(s) blocked by ${holderPid}`, async () => {
			const { rows } = await admin.query<{ pid: number }>(
				`select pid from pg_stat_activity
				 where datname = current_database() and wait_event_type = 'Lock'
				   and $1 = any(pg_blocking_pids(pid))
				 order by pid`,
				[holderPid],
			);
			return rows.length >= count ? rows.map((row) => row.pid) : undefined;
		});
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

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function createBatch(provider: Provider = "clockodo"): Promise<Batch> {
		const batchId = randomUUID();
		const jobId = randomUUID();
		await admin.query(
			`insert into import_batch
			 (id, organization_id, provider, status, selected_scope, date_range, started_by, committed_by, created_at, updated_at)
			 values ($1, $2, $3, 'committing', '{}', '{"startDate":"2021-01-01","endDate":"2026-12-31"}', $4, $4, now(), now())`,
			[batchId, ids.organization, provider, ids.importerUser],
		);
		await admin.query(
			`insert into import_batch_job
			 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
			 values ($1, $2, $3, 'commit', 'queued', 'work_period', 'work_period', now(), now())`,
			[jobId, batchId, ids.organization],
		);
		return { batchId, jobId };
	}

	let stagedSequence = 0;
	async function stageRow(batch: Batch, seed: RowSeed): Promise<string> {
		const id = randomUUID();
		const sourcePayload = seed.sourcePayload ?? { id: seed.sourceId };
		stagedSequence++;
		await admin.query(
			`insert into import_staged_row
			 (id, batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
			  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
			 values ($1, $2, $3, 'work_period', $4, $5, $6, $7, 'accepted', 'none', $8, now())`,
			[
				id,
				batch.batchId,
				ids.organization,
				seed.sourceId,
				createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
				sourcePayload,
				{
					employeeId: seed.employeeId ?? ids.employee,
					startsAt: seed.startsAt,
					endsAt: seed.endsAt,
				},
				new Date(seed.createdAt ?? Date.UTC(2026, 8, 1, 0, 0, stagedSequence)),
			],
		);
		return id;
	}

	/** The real worker; the default is the job's final BullMQ attempt. */
	async function runCommit(batch: Batch, options: { finalAttempt?: boolean } = {}) {
		const job = {
			data: {
				type: "import-review-commit" as const,
				batchId: batch.batchId,
				jobId: batch.jobId,
				organizationId: ids.organization,
				entityType: "work_period" as const,
				committedBy: ids.importerUser,
			},
			opts: { attempts: 3 },
			attemptsMade: options.finalAttempt === false ? 0 : 2,
		};
		try {
			return { result: await processImportReviewJob(job as never), error: null };
		} catch (error) {
			return { result: null, error: error as Error };
		}
	}

	async function stagedRow(rowId: string) {
		const { rows } = await admin.query<{
			row_status: string;
			issue_severity: string;
			commit_error: string | null;
			commit_hold: Record<string, unknown> | null;
			commit_target_table: string | null;
			commit_target_id: string | null;
		}>(
			`select row_status, issue_severity, commit_error, commit_hold, commit_target_table, commit_target_id
			 from import_staged_row where id = $1`,
			[rowId],
		);
		return only(rows);
	}

	async function batchState(batch: Batch) {
		const { rows } = await admin.query<{ batch_status: string; job_status: string }>(
			`select b.status as batch_status, j.status as job_status
			 from import_batch b join import_batch_job j on j.batch_id = b.id
			 where b.id = $1 and j.id = $2`,
			[batch.batchId, batch.jobId],
		);
		return only(rows);
	}

	/** Every work row the operation can write, to prove "no writes" by equality. */
	async function workSnapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function entries(employeeId: string = ids.employee) {
		const { rows } = await admin.query<{
			id: string;
			type: string;
			timestamp: Date;
			hash: string;
			previous_hash: string | null;
			previous_entry_id: string | null;
			created_by: string;
			timezone: string;
			timezone_source: string;
			utc_offset_minutes: number;
		}>(
			`select id, type, timestamp, hash, previous_hash, previous_entry_id, created_by, timezone,
			        timezone_source, utc_offset_minutes
			 from time_entry where employee_id = $1 order by created_at, timestamp, id`,
			[employeeId],
		);
		return rows;
	}

	async function position(employeeId: string = ids.employee) {
		const { rows } = await admin.query<{
			tip_entry_id: string;
			version: number;
			entry_count: number;
			admission: string;
			admitted_operation: string;
			last_operation: string;
		}>(
			`select tip_entry_id, version, entry_count, admission, admitted_operation, last_operation
			 from time_entry_append_position where employee_id = $1`,
			[employeeId],
		);
		return rows[0] ?? null;
	}

	async function periods(employeeId: string = ids.employee) {
		const { rows } = await admin.query<{
			id: string;
			clock_in_id: string;
			clock_out_id: string | null;
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			is_active: boolean;
			approval_status: string;
			canonical_record_id: string | null;
			graph_revision: number;
		}>(
			`select id, clock_in_id, clock_out_id, start_time, end_time, duration_minutes, is_active,
			        approval_status, canonical_record_id, graph_revision
			 from work_period where employee_id = $1 order by start_time, id`,
			[employeeId],
		);
		return rows;
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
			source_key: string;
		}>("select * from completed_work_operation where id = $1", [operationId]);
		return only(rows);
	}

	async function countReceipts() {
		const { rows } = await admin.query<{ count: number }>(
			"select count(*)::int as count from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		return only(rows).count;
	}

	async function withFailure<T>(
		table: string,
		event: string,
		condition: string | null,
		run: () => Promise<T>,
	): Promise<T> {
		await admin.query(
			`create function t284_fail() returns trigger language plpgsql as $$
			 begin raise exception 't284 injected failure'; end $$`,
		);
		await admin.query(
			`create trigger t284_fail before ${event} on ${table} for each row
			 ${condition ? `when (${condition})` : ""} execute function t284_fail()`,
		);
		try {
			return await run();
		} finally {
			await admin.query("drop function t284_fail() cascade");
		}
	}

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function cleanup() {
		await admin.query("drop function if exists t284_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2, $3)', [
			ids.importerUser,
			ids.employeeUser,
			ids.peerUser,
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2021-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T284 import', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Importer', 't284-importer@example.test', $4, $4),
			 ($2, 'Employee', 't284-employee@example.test', $4, $4),
			 ($3, 'Peer', 't284-peer@example.test', $4, $4)`,
			[ids.importerUser, ids.employeeUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t284-member-importer', $1, $2, 'admin', 'approved', $5),
			 ('t284-member-employee', $1, $3, 'member', 'approved', $5),
			 ('t284-member-peer', $1, $4, 'member', 'approved', $5)`,
			[ids.organization, ids.importerUser, ids.employeeUser, ids.peerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'employee', $6)`,
			[ids.employee, ids.employeeUser, ids.peer, ids.peerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.importerUser, ids.employeeUser, ids.peerUser], timestamp],
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
			throw new Error("Reviewed import operation PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		for (const holder of [...openHolders]) await holder.commit();
		harness.enqueued.length = 0;
		harness.userId = null;
		await seed();
	});

	afterAll(async () => {
		for (const holder of [...openHolders]) await holder.commit();
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("legacy organizations", () => {
		it("keep the legacy writer, now under the shared employee key and the #264 gates", async () => {
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "clockodo:entry:1",
				startsAt: "2021-03-01T08:00:00Z",
				endsAt: "2021-03-01T09:00:40Z",
			});
			const holder = await holdEmployeeKey(ids.employee);

			const commit = runCommit(batch);
			const [workerPid] = await waitForWaiters(holder.pid);
			if (workerPid === undefined) throw new Error("worker did not wait");
			expect(
				await advisoryHeld(
					workerPid,
					JSON.stringify(["completed-work-adoption", ids.organization]),
				),
			).toEqual(["ShareLock:held"]);
			expect(
				await advisoryHeld(
					workerPid,
					JSON.stringify(["work-organization-configuration", ids.organization]),
				),
			).toEqual(["ShareLock:held"]);
			expect(
				await advisoryHeld(
					workerPid,
					JSON.stringify(["work-user-configuration-access", ids.importerUser]),
				),
			).toEqual(["ShareLock:held"]);
			expect(await advisoryHeld(workerPid, ids.employee)).toEqual(["ExclusiveLock:waiting"]);
			// The former import-only key is gone: no dual-key protocol.
			expect(await advisoryHeld(workerPid, `${ids.organization}:${ids.employee}`)).toEqual([]);
			await holder.commit();

			expect((await commit).error).toBeNull();
			const [period] = await periods();
			expect(period).toMatchObject({
				is_active: false,
				duration_minutes: 61,
				canonical_record_id: null,
				graph_revision: 0,
			});
			expect(await stagedRow(rowId)).toMatchObject({
				row_status: "committed",
				commit_target_table: "work_period",
				commit_target_id: period?.id,
			});
			expect(await position()).toBeNull();
			expect(await countReceipts()).toBe(0);
			expect(await batchState(batch)).toEqual({
				batch_status: "completed",
				job_status: "completed",
			});
		});
	});

	describe("adopted organizations", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("commits an old-dated completed segment as one fresh post-adoption graph", async () => {
			const batch = await createBatch("clockodo");
			const sourcePayload = { id: 11, duration: 3640, offset: 0, users_id: 7 };
			const rowId = await stageRow(batch, {
				sourceId: "clockodo:entry:11",
				startsAt: "2021-03-01T08:00:00Z",
				endsAt: "2021-03-01T09:00:40Z",
				sourcePayload,
			});

			const { result, error } = await runCommit(batch);

			expect(error).toBeNull();
			expect(result).toMatchObject({ success: true, data: { committedRows: 1 } });
			const [clockInEntry, clockOutEntry] = await entries();
			expect(clockInEntry).toMatchObject({
				type: "clock_in",
				timestamp: new Date("2021-03-01T08:00:00Z"),
				previous_entry_id: null,
				previous_hash: null,
				created_by: ids.importerUser,
				timezone: "UTC",
				timezone_source: "backfill",
				utc_offset_minutes: 0,
			});
			expect(clockOutEntry).toMatchObject({
				type: "clock_out",
				timestamp: new Date("2021-03-01T09:00:40Z"),
				previous_entry_id: clockInEntry?.id,
				previous_hash: clockInEntry?.hash,
				created_by: ids.importerUser,
			});
			expect(await position()).toEqual({
				tip_entry_id: clockOutEntry?.id,
				version: 2,
				entry_count: 2,
				admission: "empty_history",
				admitted_operation: "reviewed_import",
				last_operation: "reviewed_import",
			});
			const period = only(await periods());
			expect(period).toEqual({
				id: expect.any(String),
				clock_in_id: clockInEntry?.id,
				clock_out_id: clockOutEntry?.id,
				start_time: new Date("2021-03-01T08:00:00Z"),
				end_time: new Date("2021-03-01T09:00:40Z"),
				// 60m40s rounds half up to 61, derived from the endpoints.
				duration_minutes: 61,
				is_active: false,
				approval_status: "approved",
				canonical_record_id: expect.any(String),
				graph_revision: 1,
			});
			const { rows: records } = await admin.query(
				`select tr.start_at, tr.end_at, tr.duration_minutes, tr.approval_state, tr.origin,
				        tr.created_by, w.work_category_id, w.work_location_type
				 from time_record tr join time_record_work w on w.record_id = tr.id where tr.id = $1`,
				[period.canonical_record_id],
			);
			expect(only(records)).toEqual({
				start_at: new Date("2021-03-01T08:00:00Z"),
				end_at: new Date("2021-03-01T09:00:40Z"),
				duration_minutes: 61,
				approval_state: "approved",
				origin: "import",
				created_by: ids.importerUser,
				work_category_id: null,
				work_location_type: null,
			});
			const { rows: balances } = await admin.query(
				"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
				[ids.employee],
			);
			expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2021-02-28" });

			const committed = await receipt(rowId);
			expect(committed).toMatchObject({
				organization_id: ids.organization,
				employee_id: ids.employee,
				kind: "import_completed_work",
				writer: "reviewed_import",
				writer_version: 1,
				command_version: 1,
				append_admission: "append",
				actor_kind: "human",
				actor_user_id: ids.importerUser,
				work_period_id: period.id,
				result_version: 1,
				source_key: JSON.stringify(["clockodo", "work_period", "clockodo:entry:11"]),
			});
			expect(committed.command).toEqual({
				version: 1,
				operationId: rowId,
				source: {
					provider: "clockodo",
					batchId: batch.batchId,
					entityType: "work_period",
					providerSourceId: "clockodo:entry:11",
					sourcePayloadHash: createHash("sha256")
						.update(JSON.stringify(sourcePayload))
						.digest("hex"),
				},
				startsAt: "2021-03-01T08:00:00Z",
				endsAt: "2021-03-01T09:00:40Z",
				providerEvidence: {
					durationSeconds: 3640,
					breakSeconds: null,
					workSeconds: null,
					correctionSeconds: 0,
				},
			});
			expect(committed.result).toEqual({
				version: 1,
				operationId: rowId,
				owner: { employeeId: ids.employee },
				actors: { importing: { kind: "human", userId: ids.importerUser } },
				source: committed.command.source,
				workPeriodId: period.id,
				clockInEntryId: clockInEntry?.id,
				clockOutEntryId: clockOutEntry?.id,
				canonicalRecordId: period.canonical_record_id,
				segment: {
					startAt: "2021-03-01T08:00:00Z",
					endAt: "2021-03-01T09:00:40Z",
					durationMinutes: 61,
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "backfill",
				},
				providerEvidence: committed.command.providerEvidence,
				revisions: { workPeriod: { source: null, result: 1 } },
				append: {
					admission: "append",
					previousEntryId: null,
					previousHash: null,
					tipEntryId: clockOutEntry?.id,
				},
				approvalState: "approved",
				approval: { participation: "none" },
				followUps: [
					{
						kind: "work_balance_refresh",
						delivery: "committed_intent",
						dirtyFromDate: "2021-02-28",
					},
				],
			});
			expect(await stagedRow(rowId)).toMatchObject({
				row_status: "committed",
				commit_target_table: "work_period",
				commit_target_id: period.id,
				commit_hold: null,
			});
			expect(await batchState(batch)).toEqual({
				batch_status: "completed",
				job_status: "completed",
			});
		});

		it("keeps positive zero-minute work and rounds 30 seconds up", async () => {
			const batch = await createBatch("clockin");
			await stageRow(batch, {
				sourceId: "clockin:workday:29s",
				startsAt: "2021-03-02T08:00:00Z",
				endsAt: "2021-03-02T08:00:29Z",
				sourcePayload: { break_seconds: 0, work_seconds: 29 },
			});
			await stageRow(batch, {
				sourceId: "clockin:workday:30s",
				startsAt: "2021-03-03T08:00:00Z",
				endsAt: "2021-03-03T08:00:30Z",
				sourcePayload: { break_seconds: 0, work_seconds: 30 },
			});

			expect((await runCommit(batch)).error).toBeNull();

			const { rows } = await admin.query<{ period: number; record: number }>(
				`select wp.duration_minutes as period, tr.duration_minutes as record
				 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
				 where wp.employee_id = $1 order by wp.start_time`,
				[ids.employee],
			);
			expect(rows).toEqual([
				{ period: 0, record: 0 },
				{ period: 1, record: 1 },
			]);
		});

		it("commits an open appender that live clock-out later closes through its own operation", async () => {
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "clockodo:entry:open",
				startsAt: "2026-07-22T08:00:00Z",
				endsAt: null,
				sourcePayload: { id: 99, duration: 0, offset: 0 },
			});

			expect((await runCommit(batch)).error).toBeNull();

			const open = only(await periods());
			expect(open).toMatchObject({
				is_active: true,
				end_time: null,
				duration_minutes: null,
				clock_out_id: null,
				canonical_record_id: null,
				graph_revision: 1,
			});
			const opened = await receipt(rowId);
			expect(opened).toMatchObject({ kind: "import_open_work", work_period_id: open.id });
			expect(opened.result).toMatchObject({
				clockOutEntryId: null,
				canonicalRecordId: null,
				segment: { endAt: null, durationMinutes: null },
				followUps: [],
			});
			const { rows: balances } = await admin.query(
				"select 1 from employee_work_balance where employee_id = $1",
				[ids.employee],
			);
			expect(balances).toEqual([]);

			const submissionId = randomUUID();
			actAs(ids.employeeUser);
			const closed = await clockOut(undefined, undefined, {
				submissionId,
				instant: parseInstant("2026-07-22T10:00:00Z"),
				browserTimezone: "UTC",
			});

			expect(closed).toMatchObject({ success: true });
			expect(only(await periods())).toMatchObject({
				id: open.id,
				is_active: false,
				clock_out_id: submissionId,
				duration_minutes: 120,
				graph_revision: 2,
			});
			const [importedClockIn, liveClockOut] = await entries();
			expect(liveClockOut).toMatchObject({
				id: submissionId,
				previous_entry_id: importedClockIn?.id,
				previous_hash: importedClockIn?.hash,
			});
			expect(await position()).toMatchObject({
				version: 2,
				entry_count: 2,
				admitted_operation: "reviewed_import",
				last_operation: "live_clock_out",
			});
			expect((await receipt(submissionId)).kind).toBe("close_active_work");
		});

		it("holds provider interpretations it cannot place, with no work written", async () => {
			const clockodo = await createBatch("clockodo");
			const mismatch = await stageRow(clockodo, {
				sourceId: "clockodo:entry:mismatch",
				startsAt: "2021-04-01T08:00:00Z",
				endsAt: "2021-04-01T09:00:40Z",
				sourcePayload: { duration: 3600, offset: 0 },
			});
			const correction = await stageRow(clockodo, {
				sourceId: "clockodo:entry:offset",
				startsAt: "2021-04-02T08:00:00Z",
				endsAt: "2021-04-02T09:00:00Z",
				sourcePayload: { duration: 3600, offset: -300 },
			});
			const equal = await stageRow(clockodo, {
				sourceId: "clockodo:entry:equal",
				startsAt: "2021-04-03T08:00:00Z",
				endsAt: "2021-04-03T08:00:00Z",
			});
			const zoneless = await stageRow(clockodo, {
				sourceId: "clockodo:entry:zoneless",
				startsAt: "2021-04-04T08:00:00",
				endsAt: "2021-04-04T09:00:00Z",
			});
			const clockin = await createBatch("clockin");
			const unlocatedBreak = await stageRow(clockin, {
				sourceId: "clockin:workday:break",
				startsAt: "2021-04-05T08:00:00Z",
				endsAt: "2021-04-05T17:00:00Z",
				sourcePayload: { break_seconds: 1800, work_seconds: 30600 },
			});
			const before = await workSnapshot();

			const clockodoRun = await runCommit(clockodo, { finalAttempt: false });
			const clockinRun = await runCommit(clockin, { finalAttempt: false });

			expect(await workSnapshot()).toEqual(before);
			expect(await stagedRow(mismatch)).toEqual({
				row_status: "blocked",
				issue_severity: "blocking",
				commit_error: "Held for review: provider_duration_mismatch",
				commit_hold: {
					reason: "provider_duration_mismatch",
					elapsedSeconds: 3640,
					evidence: {
						durationSeconds: 3600,
						breakSeconds: null,
						workSeconds: null,
						correctionSeconds: 0,
					},
				},
				commit_target_table: null,
				commit_target_id: null,
			});
			expect((await stagedRow(correction)).commit_hold).toMatchObject({
				reason: "provider_duration_mismatch",
				evidence: { correctionSeconds: -300 },
			});
			expect((await stagedRow(equal)).commit_hold).toEqual({
				reason: "invalid_interval",
				detail: "non_positive",
			});
			expect((await stagedRow(zoneless)).commit_hold).toEqual({
				reason: "invalid_interval",
				detail: "start_not_exact",
			});
			expect((await stagedRow(unlocatedBreak)).commit_hold).toEqual({
				reason: "unlocated_break",
				evidence: {
					durationSeconds: null,
					breakSeconds: 1800,
					workSeconds: 30600,
					correctionSeconds: null,
				},
			});
			// Held rows are durable on the first attempt: nothing is left for a retry, and
			// the batch reports the unresolved rows instead of completing.
			expect(clockodoRun.error?.message).toContain("Held for review: provider_duration_mismatch");
			expect(clockinRun.error?.message).toContain("Held for review: unlocated_break");
			expect(await batchState(clockodo)).toEqual({
				batch_status: "commit_failed",
				job_status: "failed",
			});
		});

		it("enforces symmetric occupancy: rejected and active work occupy, deleted work and adjacency do not", async () => {
			const first = await createBatch();
			for (const [sourceId, startsAt, endsAt] of [
				["seed:rejected", "2021-05-03T08:00:00Z", "2021-05-03T09:00:00Z"],
				["seed:deleted", "2021-05-03T10:00:00Z", "2021-05-03T11:00:00Z"],
				["seed:approved", "2021-05-03T13:00:00Z", "2021-05-03T14:00:00Z"],
			] as const) {
				await stageRow(first, {
					sourceId,
					startsAt,
					endsAt,
					sourcePayload: { duration: elapsedSeconds(startsAt, endsAt) },
				});
			}
			expect((await runCommit(first)).error).toBeNull();
			const [rejected, deleted, approved] = await periods();
			await admin.query("update work_period set approval_status = 'rejected' where id = $1", [
				rejected?.id,
			]);
			await admin.query("update work_period set deleted_at = now() where id = $1", [deleted?.id]);
			const nativeRecordId = randomUUID();
			await admin.query(
				`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
				  duration_minutes, approval_state, origin, created_by, updated_at)
				 values ($1, $2, $3, 'work', '2021-05-03T15:00:00Z', '2021-05-03T16:00:00Z', 60,
				  'approved', 'manual', $4, now())`,
				[nativeRecordId, ids.organization, ids.employee, ids.importerUser],
			);

			const second = await createBatch();
			const overlapsRejected = await stageRow(second, {
				sourceId: "second:overlaps-rejected",
				startsAt: "2021-05-03T08:30:00Z",
				endsAt: "2021-05-03T09:30:00Z",
			});
			const replacesDeleted = await stageRow(second, {
				sourceId: "second:deleted-slot",
				startsAt: "2021-05-03T10:00:00Z",
				endsAt: "2021-05-03T11:00:00Z",
			});
			const adjacent = await stageRow(second, {
				sourceId: "second:adjacent",
				startsAt: "2021-05-03T09:00:00Z",
				endsAt: "2021-05-03T10:00:00Z",
			});
			const overlapsNative = await stageRow(second, {
				sourceId: "second:overlaps-native",
				startsAt: "2021-05-03T15:30:00Z",
				endsAt: "2021-05-03T15:45:00Z",
			});
			const overlapsBySecond = await stageRow(second, {
				sourceId: "second:one-second",
				startsAt: "2021-05-03T13:59:59Z",
				endsAt: "2021-05-03T14:30:00Z",
			});

			await runCommit(second);

			expect((await stagedRow(overlapsRejected)).commit_hold).toEqual({
				reason: "occupancy_conflict",
				occupants: [
					{
						kind: "work_period",
						id: rejected?.id,
						startAt: "2021-05-03T08:00:00.000Z",
						endAt: "2021-05-03T09:00:00.000Z",
					},
				],
			});
			expect((await stagedRow(replacesDeleted)).row_status).toBe("committed");
			expect((await stagedRow(adjacent)).row_status).toBe("committed");
			expect((await stagedRow(overlapsNative)).commit_hold).toEqual({
				reason: "occupancy_conflict",
				occupants: [
					{
						kind: "time_record",
						id: nativeRecordId,
						startAt: "2021-05-03T15:00:00.000Z",
						endAt: "2021-05-03T16:00:00.000Z",
					},
				],
			});
			expect((await stagedRow(overlapsBySecond)).commit_hold).toMatchObject({
				reason: "occupancy_conflict",
				occupants: [{ kind: "work_period", id: approved?.id }],
			});
		});

		it("treats active work as occupying from a prior-day start onward", async () => {
			actAs(ids.employeeUser);
			await expect(
				clockIn("office", {
					instant: parseInstant("2026-07-21T22:00:00Z"),
					browserTimezone: "UTC",
				}),
			).resolves.toMatchObject({ success: true });
			const active = only(await periods());
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "after-midnight",
				startsAt: "2026-07-22T01:00:00Z",
				endsAt: "2026-07-22T02:00:00Z",
			});

			await runCommit(batch);

			expect((await stagedRow(rowId)).commit_hold).toEqual({
				reason: "occupancy_conflict",
				occupants: [
					{
						kind: "work_period",
						id: active.id,
						startAt: "2026-07-21T22:00:00.000Z",
						endAt: null,
					},
				],
			});
		});

		it("holds a history that needs append review without writing", async () => {
			for (const [id, timestamp] of [
				[randomUUID(), "2021-01-04T08:00:00Z"],
				[randomUUID(), "2021-01-05T08:00:00Z"],
			] as const) {
				// Two unlinked roots: an island history that admission must not guess across.
				await admin.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					  timezone, timezone_source, hash, previous_hash, created_by)
					 values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'backfill', $5, null, $6)`,
					[id, ids.employee, ids.organization, timestamp, `island-${id}`, ids.importerUser],
				);
			}
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "island",
				startsAt: "2021-06-01T08:00:00Z",
				endsAt: "2021-06-01T09:00:00Z",
			});
			const before = await workSnapshot();

			await runCommit(batch);

			expect(await workSnapshot()).toEqual(before);
			const hold = (await stagedRow(rowId)).commit_hold as {
				reason: string;
				reasons: { kind: string }[];
			};
			expect(hold.reason).toBe("append_review_required");
			expect(hold.reasons.map((reason) => reason.kind)).toContain("multiple_roots");
		});

		it("appends rows in deterministic staging order, not work-date order", async () => {
			const batch = await createBatch();
			const stagedFirst = await stageRow(batch, {
				sourceId: "later-work",
				startsAt: "2021-07-02T08:00:00Z",
				endsAt: "2021-07-02T09:00:00Z",
				createdAt: "2026-09-01T00:00:00Z",
			});
			const stagedSecond = await stageRow(batch, {
				sourceId: "earlier-work",
				startsAt: "2021-07-01T08:00:00Z",
				endsAt: "2021-07-01T09:00:00Z",
				createdAt: "2026-09-01T00:00:01Z",
			});

			expect((await runCommit(batch)).error).toBeNull();

			const first = (await receipt(stagedFirst)).result as {
				clockInEntryId: string;
				append: { previousEntryId: string | null; tipEntryId: string };
			};
			const second = (await receipt(stagedSecond)).result as typeof first;
			expect(first.append.previousEntryId).toBeNull();
			expect(second.append.previousEntryId).toBe(first.append.tipEntryId);
			expect(await position()).toMatchObject({ entry_count: 4, version: 4 });
		});

		it("replays a committed receipt without writes, also after a return to legacy", async () => {
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "replay",
				startsAt: "2021-08-02T08:00:00Z",
				endsAt: "2021-08-02T09:00:00Z",
			});
			expect((await runCommit(batch)).error).toBeNull();
			const committed = await stagedRow(rowId);
			const before = await workSnapshot();

			for (const mode of ["active", "inactive"] as const) {
				await setAdmission(mode);
				// A lost acknowledgement re-offers the committed row to the worker.
				await admin.query(
					`update import_staged_row set row_status = 'accepted', commit_target_table = null,
					  commit_target_id = null where id = $1`,
					[rowId],
				);
				await admin.query("update import_batch set status = 'committing' where id = $1", [
					batch.batchId,
				]);
				await admin.query("update import_batch_job set status = 'queued' where id = $1", [
					batch.jobId,
				]);

				expect((await runCommit(batch)).error).toBeNull();

				expect(await workSnapshot()).toEqual(before);
				expect(await stagedRow(rowId)).toEqual(committed);
			}
		});

		it("holds a changed command under a committed identity as an operation collision", async () => {
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "collision",
				startsAt: "2021-08-03T08:00:00Z",
				endsAt: "2021-08-03T09:00:00Z",
			});
			expect((await runCommit(batch)).error).toBeNull();
			const before = await workSnapshot();
			await admin.query(
				`update import_staged_row set row_status = 'accepted',
				  normalized_payload = jsonb_set(normalized_payload, '{endsAt}', '"2021-08-03T10:00:00Z"')
				 where id = $1`,
				[rowId],
			);

			await runCommit(batch);

			expect(await workSnapshot()).toEqual(before);
			expect((await stagedRow(rowId)).commit_hold).toEqual({ reason: "operation_collision" });
		});

		it("holds a provider source that another batch already committed", async () => {
			const first = await createBatch();
			const firstRow = await stageRow(first, {
				sourceId: "clockodo:entry:shared",
				startsAt: "2021-09-01T08:00:00Z",
				endsAt: "2021-09-01T09:00:00Z",
			});
			expect((await runCommit(first)).error).toBeNull();
			const second = await createBatch();
			const secondRow = await stageRow(second, {
				sourceId: "clockodo:entry:shared",
				startsAt: "2021-09-02T08:00:00Z",
				endsAt: "2021-09-02T09:00:00Z",
			});
			const before = await workSnapshot();

			await runCommit(second);

			expect(await workSnapshot()).toEqual(before);
			expect((await stagedRow(secondRow)).commit_hold).toEqual({
				reason: "source_collision",
				operationId: firstRow,
			});
		});

		it.each([
			["time_entry", "insert", "new.type = 'clock_out'"],
			["time_entry_append_position", "insert", null],
			["time_record", "insert", null],
			["time_record_work", "insert", null],
			["work_period", "insert", null],
			["employee_work_balance", "insert", null],
			["completed_work_operation", "insert", null],
			["import_staged_row", "update", "new.row_status = 'committed'"],
		] as const)(
			"rolls back the whole graph when the %s %s fails",
			async (table, event, condition) => {
				const batch = await createBatch();
				const rowId = await stageRow(batch, {
					sourceId: "rollback",
					startsAt: "2021-10-01T08:00:00Z",
					endsAt: "2021-10-01T09:00:00Z",
				});
				const before = await workSnapshot();

				const nonFinal = await withFailure(table, event, condition, () =>
					runCommit(batch, { finalAttempt: false }),
				);

				// Drizzle wraps the injected PostgreSQL exception in its query error.
				expect(nonFinal.error?.message).toContain(`${rowId}: Failed query`);
				expect(await workSnapshot()).toEqual(before);
				expect((await stagedRow(rowId)).row_status).toBe("accepted");

				const final = await withFailure(table, event, condition, () => runCommit(batch));

				expect(final.error?.message).toContain(`${rowId}: Failed query`);
				expect(await workSnapshot()).toEqual(before);
				expect(await stagedRow(rowId)).toMatchObject({
					row_status: "commit_failed",
					commit_hold: null,
				});
				expect(await batchState(batch)).toEqual({
					batch_status: "commit_failed",
					job_status: "failed",
				});
			},
		);

		it("serializes overlapping rows from concurrent batches: one commits, the other is held", async () => {
			const left = await createBatch();
			const right = await createBatch();
			const leftRow = await stageRow(left, {
				sourceId: "left",
				startsAt: "2021-11-01T08:00:00Z",
				endsAt: "2021-11-01T10:00:00Z",
			});
			const rightRow = await stageRow(right, {
				sourceId: "right",
				startsAt: "2021-11-01T09:00:00Z",
				endsAt: "2021-11-01T11:00:00Z",
			});

			await Promise.all([runCommit(left), runCommit(right)]);

			const outcomes = [await stagedRow(leftRow), await stagedRow(rightRow)];
			expect(outcomes.map((row) => row.row_status).sort()).toEqual(["blocked", "committed"]);
			expect(outcomes.find((row) => row.row_status === "blocked")?.commit_hold).toMatchObject({
				reason: "occupancy_conflict",
			});
			expect(await periods()).toHaveLength(1);
			expect(await position()).toMatchObject({ entry_count: 2, version: 2 });
		});

		it("serializes the same source imported through concurrent batches", async () => {
			const left = await createBatch();
			const right = await createBatch();
			const leftRow = await stageRow(left, {
				sourceId: "same-source",
				startsAt: "2021-11-02T08:00:00Z",
				endsAt: "2021-11-02T09:00:00Z",
			});
			const rightRow = await stageRow(right, {
				sourceId: "same-source",
				startsAt: "2021-11-03T08:00:00Z",
				endsAt: "2021-11-03T09:00:00Z",
				employeeId: ids.peer,
			});

			await Promise.all([runCommit(left), runCommit(right)]);

			const outcomes = [await stagedRow(leftRow), await stagedRow(rightRow)];
			expect(outcomes.map((row) => row.row_status).sort()).toEqual(["blocked", "committed"]);
			expect(outcomes.find((row) => row.row_status === "blocked")?.commit_hold).toMatchObject({
				reason: "source_collision",
			});
			expect(await countReceipts()).toBe(1);
		});

		it.each(["import first", "live clock-in first"] as const)(
			"gives one active period when an open import races live clock-in (%s)",
			async (order) => {
				const batch = await createBatch();
				const rowId = await stageRow(batch, {
					sourceId: "open-race",
					startsAt: "2026-07-22T07:00:00Z",
					endsAt: null,
				});
				const liveClockIn = () => {
					actAs(ids.employeeUser);
					return clockIn("office", {
						instant: parseInstant("2026-07-22T08:00:00Z"),
						browserTimezone: "UTC",
					});
				};
				const holder = await holdEmployeeKey(ids.employee);

				const firstArrival = order === "import first" ? runCommit(batch) : liveClockIn();
				await waitForWaiters(holder.pid, 1);
				const secondArrival = order === "import first" ? liveClockIn() : runCommit(batch);
				await waitForWaiters(holder.pid, 2);
				await holder.commit();
				const [first, second] = await Promise.all([firstArrival, secondArrival]);

				const active = (await periods()).filter((period) => period.is_active);
				expect(active).toHaveLength(1);
				if (order === "import first") {
					expect((first as Awaited<ReturnType<typeof runCommit>>).error).toBeNull();
					expect(second).toEqual({ success: false, error: "You are already clocked in" });
					expect((await stagedRow(rowId)).row_status).toBe("committed");
				} else {
					expect(first).toMatchObject({ success: true });
					expect((await stagedRow(rowId)).commit_hold).toMatchObject({
						reason: "occupancy_conflict",
						occupants: [{ kind: "work_period", id: active[0]?.id, endAt: null }],
					});
					void second;
				}
				expect(await position()).toMatchObject({ entry_count: 1, version: 1 });
			},
		);

		it("holds an import over committed manual work, and manual work over imported work", async () => {
			// Manual entry rejects future times, so the scenario uses yesterday (UTC).
			const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
			// Adopted organizations admit strict version-2 manual commands (#308).
			const manualCommand = (clockIn: string, clockOut: string, reason: string) => ({
				version: 2 as const,
				submissionId: randomUUID(),
				targetEmployeeId: ids.employee,
				date: day,
				clockIn: { time: clockIn, occurrence: null, displayedOffsetMinutes: 0 },
				clockOut: { time: clockOut, occurrence: null, displayedOffsetMinutes: 0 },
				zone: { basis: "target" as const, timezone: "UTC" },
				browserTimezone: "UTC",
				reason,
				projectId: null,
				workCategoryId: null,
			});
			actAs(ids.employeeUser);
			const manual = await createManualTimeEntry(
				manualCommand("08:00", "09:00", "Forgot to clock in"),
			);
			expect(manual).toMatchObject({ success: true });
			const manualPeriod = only(await periods());
			const batch = await createBatch();
			const overManual = await stageRow(batch, {
				sourceId: "over-manual",
				startsAt: `${day}T08:30:00Z`,
				endsAt: `${day}T09:30:00Z`,
			});
			const beforeManual = await stageRow(batch, {
				sourceId: "before-manual",
				startsAt: `${day}T06:00:00Z`,
				endsAt: `${day}T07:00:00Z`,
			});

			await runCommit(batch);

			expect((await stagedRow(overManual)).commit_hold).toMatchObject({
				reason: "occupancy_conflict",
				occupants: [{ kind: "work_period", id: manualPeriod.id }],
			});
			expect((await stagedRow(beforeManual)).row_status).toBe("committed");

			// Import first: manual work shares the exact occupancy rule (#308) and is
			// refused without trimming its interval.
			const imported = (await periods()).find(
				(period) => period.start_time.toISOString() === `${day}T06:00:00.000Z`,
			);
			actAs(ids.employeeUser);
			const overImport = await createManualTimeEntry(
				manualCommand("06:30", "07:30", "Overlaps the imported work"),
			);
			expect(overImport).toMatchObject({
				success: false,
				code: "occupancy_conflict",
				rejection: { occupants: [{ kind: "work_period", id: imported?.id }] },
			});
			const { rows: overlaps } = await admin.query(
				`select a.id from work_period a join work_period b
				   on a.employee_id = b.employee_id and a.id < b.id
				  and a.deleted_at is null and b.deleted_at is null
				  and a.start_time < coalesce(b.end_time, 'infinity')
				  and b.start_time < coalesce(a.end_time, 'infinity')
				 where a.employee_id = $1`,
				[ids.employee],
			);
			expect(overlaps).toEqual([]);
		});

		it("keeps other employees independent while one employee's key is held", async () => {
			const batch = await createBatch();
			const peerRow = await stageRow(batch, {
				sourceId: "peer-row",
				startsAt: "2021-12-01T08:00:00Z",
				endsAt: "2021-12-01T09:00:00Z",
				employeeId: ids.peer,
			});
			const holder = await holdEmployeeKey(ids.employee);

			const { error } = await runCommit(batch);
			await holder.commit();

			expect(error).toBeNull();
			expect((await stagedRow(peerRow)).row_status).toBe("committed");
		});

		it("restarts routing when a reviewer remaps the row while it waits", async () => {
			const batch = await createBatch();
			const rowId = await stageRow(batch, {
				sourceId: "remapped",
				startsAt: "2021-12-02T08:00:00Z",
				endsAt: "2021-12-02T09:00:00Z",
			});
			const holder = await holdEmployeeKey(ids.employee);

			const commit = runCommit(batch);
			await waitForWaiters(holder.pid);
			await admin.query(
				`update import_staged_row
				 set normalized_payload = jsonb_set(normalized_payload, '{employeeId}', to_jsonb($2::text))
				 where id = $1`,
				[rowId, ids.peer],
			);
			await holder.commit();

			expect((await commit).error).toBeNull();
			expect(await periods(ids.employee)).toEqual([]);
			expect(await entries(ids.employee)).toEqual([]);
			expect(only(await periods(ids.peer))).toMatchObject({ is_active: false });
			expect((await receipt(rowId)).employee_id).toBe(ids.peer);
		});

		it("removes import receipts with the organization's time data, so a re-import is fresh", async () => {
			const first = await createBatch();
			await stageRow(first, {
				sourceId: "cleared",
				startsAt: "2021-12-03T08:00:00Z",
				endsAt: "2021-12-03T09:00:00Z",
			});
			expect((await runCommit(first)).error).toBeNull();

			await clearOrganizationTimeData(ids.organization);

			expect(await countReceipts()).toBe(0);
			expect(await position()).toBeNull();
			// Its canonical work goes too; left behind it would occupy the interval.
			const { rows: records } = await admin.query(
				"select id from time_record where organization_id = $1",
				[ids.organization],
			);
			expect(records).toEqual([]);
			const second = await createBatch();
			const again = await stageRow(second, {
				sourceId: "cleared",
				startsAt: "2021-12-03T08:00:00Z",
				endsAt: "2021-12-03T09:00:00Z",
			});
			expect((await runCommit(second)).error).toBeNull();
			expect((await stagedRow(again)).row_status).toBe("committed");
		});
	});
});
