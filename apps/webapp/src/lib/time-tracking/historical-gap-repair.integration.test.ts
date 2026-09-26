/**
 * #320 / T55 runtime evidence: evidence-only repair of historical gaps.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Work is written by the real legacy `createManualTimeEntry` action; historical gaps
 * that no current writer produces (a missing record, link, detail or completion) are
 * injected with SQL, as history would contain them. Plans are read and applied
 * through the real repair route (membership lookup, principal loader, CASL ability,
 * shared completed-work coordinator). Repair authorization is granted by inserting
 * its control row, because it has no application setter. Concurrent writers hold
 * the same employee coordination key real writers take; the calendar split is the
 * real legacy action.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
			max: 8,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

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
							session: {
								id: `t320-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

const { POST: repairRoute } = await import("@/app/api/time-entries/diagnostics/repair/route");
const { POST: diagnosticsRoute } = await import("@/app/api/time-entries/diagnostics/route");
const { createManualTimeEntry, splitWorkPeriod } = await import(
	"@/app/[locale]/(app)/time-tracking/actions"
);

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
	describe.skip(`gap repair PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t320-repair-org",
	otherOrganization: "t320-other-org",
	ownerUser: "t320-owner-user",
	managerUser: "t320-manager-user",
	workerUser: "t320-worker-user",
	peerUser: "t320-peer-user",
	foreignUser: "t320-foreign-user",
	owner: "d3200000-0000-4000-8000-000000000001",
	manager: "d3200000-0000-4000-8000-000000000002",
	worker: "d3200000-0000-4000-8000-000000000003",
	peer: "d3200000-0000-4000-8000-000000000004",
	foreign: "d3200000-0000-4000-8000-000000000005",
	project: "d3200000-0000-4000-8000-0000000000a1",
	category: "d3200000-0000-4000-8000-0000000000a2",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.workerUser, ids.peerUser, ids.foreignUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31" };

type Plan = {
	authorized: boolean;
	plan: {
		employees: {
			employeeId: string;
			fingerprint: string;
			units: {
				workPeriodId: string;
				canonicalRecordId: string;
				fills: { kind: string }[];
				originalActor: { kind: string; userId?: string };
			}[];
		}[];
		held: { findingId: string; kind: string; reason: string; workPeriodIds: string[] }[];
	};
};

describeIntegration("historical gap repair on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function call(
		route: (request: NextRequest) => Promise<Response>,
		userId: string,
		body: Record<string, unknown>,
	) {
		actAs(userId);
		const response = await route(
			new Request("http://localhost/api/time-entries/diagnostics/repair", {
				method: "POST",
				body: JSON.stringify(body),
			}) as unknown as NextRequest,
		);
		return { status: response.status, body: await response.json() };
	}

	async function readPlan(body: Record<string, unknown> = {}): Promise<Plan> {
		const { status, body: result } = await call(repairRoute, ids.ownerUser, {
			action: "plan",
			employeeId: ids.worker,
			...july,
			...body,
		});
		expect(status).toBe(200);
		return result;
	}

	function expectedOf(plan: Plan) {
		return plan.plan.employees.map(({ employeeId, fingerprint }) => ({ employeeId, fingerprint }));
	}

	async function apply(plan: Plan, userId: string = ids.ownerUser, body = {}) {
		return call(repairRoute, userId, {
			action: "apply",
			employeeId: ids.worker,
			...july,
			expected: expectedOf(plan),
			reason: "Evidence-only repair of July history",
			...body,
		});
	}

	async function findingKinds(employeeId: string = ids.worker) {
		const { status, body } = await call(diagnosticsRoute, ids.ownerUser, { employeeId, ...july });
		expect(status).toBe(200);
		return (body.work.findings as { kind: string; treatment: string }[]).map(
			(finding) => `${finding.kind}:${finding.treatment}`,
		);
	}

	async function authorizeRepair() {
		await admin.query(
			"insert into historical_work_repair_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
	}

	/** A legacy manual submission for the worker (organization not adopted). */
	async function legacyManual(input: {
		date: string;
		clockInTime: string;
		clockOutTime: string;
	}) {
		actAs(ids.workerUser);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Forgot to clock",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			...input,
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
		return (result as { data: { workPeriodId: string } }).data.workPeriodId;
	}

	async function periodRow(periodId: string) {
		const { rows } = await admin.query("select * from work_period where id = $1", [periodId]);
		return rows[0];
	}

	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as details,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_approval_decision t where organization_id = $1) as decisions,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return rows[0];
	}

	/** Holds the coordination key every participating writer of the worker takes. */
	async function asConcurrentWriter(write: (client: PoolClient) => Promise<void>) {
		const client = await admin.connect();
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ids.worker]);
		return {
			async commit() {
				await write(client);
				await client.query("commit");
				client.release();
			},
		};
	}

	async function waitForLockWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query(
				"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
			);
			if (rows[0].waiting > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("The repair never waited for the concurrent writer");
	}

	async function cleanup() {
		await admin.query("drop function if exists t327_park() cascade");
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
			 ($1, 'T320 repair', $1, 'Europe/Berlin', $3), ($2, 'T320 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t320-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t320-m-manager', $1, $3, 'member', 'approved', $7),
			 ('t320-m-worker', $1, $4, 'member', 'approved', $7),
			 ('t320-m-peer', $1, $5, 'member', 'approved', $7),
			 ('t320-m-foreign', $6, $8, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.managerUser,
				ids.workerUser,
				ids.peerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'employee', $12), ($7, $8, $11, 'employee', $12),
			 ($9, $10, $13, 'employee', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.worker,
				ids.workerUser,
				ids.peer,
				ids.peerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.worker, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'T320 project', $3, now())`,
			[ids.project, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, factor, created_by, updated_at)
			 values ($1, $2, 'T320 category', '1.00', $3, now())`,
			[ids.category, ids.organization, ids.ownerUser],
		);
	}

	/** Legacy work whose canonical record was never written. */
	async function missingRecord(date: string) {
		const periodId = await legacyManual({ date, clockInTime: "08:00", clockOutTime: "12:00" });
		const { canonical_record_id: recordId } = await periodRow(periodId);
		await admin.query(
			`update work_period set canonical_record_id = null, project_id = $2, work_category_id = $3
			 where id = $1`,
			[periodId, ids.project, ids.category],
		);
		await admin.query("delete from time_record where id = $1", [recordId]);
		return periodId;
	}

	/** Legacy work whose record carries the period's ID but was never linked. */
	async function missingLink(date: string) {
		const periodId = await legacyManual({ date, clockInTime: "13:00", clockOutTime: "15:00" });
		const { canonical_record_id: recordId } = await periodRow(periodId);
		await admin.query("update work_period set canonical_record_id = null where id = $1", [
			periodId,
		]);
		// Re-key the record (and its detail) to the period's ID, as the backfill convention did.
		await admin.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			   duration_minutes, approval_state, origin, created_at, created_by, updated_at, updated_by)
			 select $2, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes,
			   approval_state, origin, created_at, created_by, updated_at, updated_by
			 from time_record where id = $1`,
			[recordId, periodId],
		);
		await admin.query("update time_record_work set record_id = $2 where record_id = $1", [
			recordId,
			periodId,
		]);
		await admin.query("delete from time_record where id = $1", [recordId]);
		return periodId;
	}

	/** Legacy canonical work opened but never completed, without its detail. */
	async function incompleteRecord(date: string) {
		const periodId = await legacyManual({ date, clockInTime: "08:00", clockOutTime: "10:30" });
		const { canonical_record_id: recordId } = await periodRow(periodId);
		await admin.query(
			"update time_record set end_at = null, duration_minutes = null where id = $1",
			[recordId],
		);
		await admin.query("delete from time_record_work where record_id = $1", [recordId]);
		return { periodId, recordId };
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
			throw new Error("Gap repair PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("fills uniquely evidenced gaps preserving identity, minutes, metadata and history, then replays", async () => {
		const created = await missingRecord("2026-07-02");
		const linked = await missingLink("2026-07-02");
		const incomplete = await incompleteRecord("2026-07-03");
		const beforeCreated = await periodRow(created);
		// Established historical minutes differ from today's rounding of the endpoints.
		await admin.query("update work_period set duration_minutes = 239 where id = $1", [created]);
		// Agreeing established minutes of the linked work stay as stored (not 120).
		await admin.query("update work_period set duration_minutes = 125 where id = $1", [linked]);
		await admin.query("update time_record set duration_minutes = 125 where id = $1", [linked]);
		// Pending work with a legacy approval request whose history must survive.
		await admin.query("update work_period set approval_status = 'pending' where id = $1", [
			created,
		]);
		await admin.query(
			`insert into approval_request
			 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, 'pending', now())`,
			[ids.organization, created, ids.worker, ids.manager],
		);
		expect(await findingKinds()).toEqual(
			expect.arrayContaining([
				"canonical_missing:historical_gap",
				"canonical_link_missing:historical_gap",
				"endpoint_missing:historical_gap",
				"canonical_detail_missing:historical_gap",
			]),
		);

		// Repair is not authorized until its control is activated: nothing is written.
		const plan = await readPlan();
		expect(plan.authorized).toBe(false);
		expect(plan.plan.held).toEqual([]);
		const before = await snapshot();
		const refused = await apply(plan);
		expect(refused).toMatchObject({ status: 409, body: { code: "repair_not_authorized" } });
		expect(await snapshot()).toEqual(before);

		await authorizeRepair();
		const applied = await apply(plan);
		expect(applied.status).toBe(200);
		expect(applied.body.outcomes).toMatchObject([{ employeeId: ids.worker, status: "applied" }]);
		expect(applied.body.outcomes[0].receipts).toHaveLength(3);

		// Created record: the period's ID, stored minutes, pending state, metadata and
		// the completing entry's author; approval request untouched.
		const createdPeriod = await periodRow(created);
		expect(createdPeriod.canonical_record_id).toBe(created);
		expect(createdPeriod.graph_revision).toBe(beforeCreated.graph_revision + 1);
		const {
			rows: [record],
		} = await admin.query("select * from time_record where id = $1", [created]);
		const {
			rows: [clockOut],
		} = await admin.query("select created_by from time_entry where id = $1", [
			createdPeriod.clock_out_id,
		]);
		expect(record).toMatchObject({
			employee_id: ids.worker,
			start_at: createdPeriod.start_time,
			end_at: createdPeriod.end_time,
			duration_minutes: 239,
			approval_state: "pending",
			origin: "system",
			created_by: clockOut.created_by,
			// The repair wrote the row; the completing author stays its creator.
			updated_by: ids.ownerUser,
		});
		expect(clockOut.created_by).toBe(ids.workerUser);
		const { rows: createdDetail } = await admin.query(
			`select d.work_category_id, a.project_id, a.weight_percent from time_record_work d
			 left join time_record_allocation a on a.record_id = d.record_id where d.record_id = $1`,
			[created],
		);
		expect(createdDetail).toEqual([
			{ work_category_id: ids.category, project_id: ids.project, weight_percent: 100 },
		]);
		const { rows: requests } = await admin.query(
			"select status from approval_request where entity_id = $1",
			[created],
		);
		expect(requests).toEqual([{ status: "pending" }]);

		// Link: the existing record keeps its ID and its own established minutes.
		expect((await periodRow(linked)).canonical_record_id).toBe(linked);
		const {
			rows: [linkedRecord],
		} = await admin.query("select duration_minutes from time_record where id = $1", [linked]);
		expect(linkedRecord.duration_minutes).toBe(125);

		// Completion and detail filled on the existing record.
		const incompletePeriod = await periodRow(incomplete.periodId);
		const {
			rows: [completed],
		} = await admin.query(
			"select end_at, duration_minutes, created_by, updated_by from time_record where id = $1",
			[incomplete.recordId],
		);
		expect(completed).toEqual({
			end_at: incompletePeriod.end_time,
			duration_minutes: incompletePeriod.duration_minutes,
			created_by: ids.workerUser,
			updated_by: ids.ownerUser,
		});

		// Receipts: the executor acts; the original actor stays honest and separate.
		const { rows: receipts } = await admin.query(
			`select id, kind, writer, actor_kind, actor_user_id, work_period_id, result, command
			 from completed_work_operation where organization_id = $1 order by work_period_id`,
			[ids.organization],
		);
		expect(receipts).toHaveLength(3);
		for (const receipt of receipts) {
			expect(receipt).toMatchObject({
				kind: "repair_historical_gap",
				writer: "historical_gap_repair",
				actor_kind: "human",
				actor_user_id: ids.ownerUser,
				command: { reason: "Evidence-only repair of July history" },
				result: {
					executor: { kind: "human", userId: ids.ownerUser },
					reason: "Evidence-only repair of July history",
				},
			});
		}
		const receiptFor = (periodId: string) =>
			receipts.find((receipt) => receipt.work_period_id === periodId);
		expect(receiptFor(created).result.originalActor).toEqual({
			kind: "human",
			userId: ids.workerUser,
			evidence: { entryId: createdPeriod.clock_out_id, side: "end" },
		});
		expect(receiptFor(linked).result.originalActor).toEqual({ kind: "unknown_historical" });
		expect(receiptFor(incomplete.periodId).result.fills.map((fill: { kind: string }) => fill.kind))
			.toEqual(["canonical_detail", "canonical_completion"]);

		// The gaps are gone; the stored 125 minutes remain a disclosure, not a repair.
		expect(await findingKinds()).toEqual(["stored_elapsed_discrepancy:disclosed"]);

		// Repeating the reviewed plan returns the committed receipts and writes nothing.
		const repaired = await snapshot();
		const replayed = await apply(plan);
		expect(replayed.body.outcomes).toMatchObject([
			{ employeeId: ids.worker, status: "already_applied" },
		]);
		expect(replayed.body.outcomes[0].receipts.map((item: { operationId: string }) => item.operationId))
			.toEqual(applied.body.outcomes[0].receipts.map((item: { operationId: string }) => item.operationId));
		expect(await snapshot()).toEqual(repaired);
		expect((await readPlan()).plan.employees).toEqual([]);
	});

	it("holds conflicting, unrestorable and deleted work for review and never writes them", async () => {
		await authorizeRepair();
		// A metadata gap on work whose durations disagree.
		const conflicted = await legacyManual({
			date: "2026-07-06",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query("update work_period set project_id = $2 where id = $1", [
			conflicted,
			ids.project,
		]);
		await admin.query(
			"update time_record set duration_minutes = 200 where id = (select canonical_record_id from work_period where id = $1)",
			[conflicted],
		);
		// No representation holds the minutes: never derived.
		const unmeasured = await legacyManual({
			date: "2026-07-07",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query("update work_period set duration_minutes = null where id = $1", [unmeasured]);
		await admin.query(
			"update time_record set duration_minutes = null where id = (select canonical_record_id from work_period where id = $1)",
			[unmeasured],
		);
		// Pending work without any relationship: no workflow is started.
		const orphaned = await legacyManual({
			date: "2026-07-08",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query("update work_period set approval_status = 'pending' where id = $1", [
			orphaned,
		]);
		await admin.query(
			"update time_record set approval_state = 'pending' where id = (select canonical_record_id from work_period where id = $1)",
			[orphaned],
		);
		// A missing record without a completing entry: its creator cannot be named.
		const unattributed = await missingRecord("2026-07-09");
		await admin.query("update work_period set clock_out_id = null where id = $1", [unattributed]);
		// Deleted work without a record stays deleted and unrepresented.
		const deleted = await missingRecord("2026-07-10");
		await admin.query(
			"update work_period set deleted_at = now(), deletion_reason = 'duplicate' where id = $1",
			[deleted],
		);
		// Overlapping duplicates are never resolved by repair.
		await missingRecord("2026-07-13");
		await legacyManual({ date: "2026-07-13", clockInTime: "11:00", clockOutTime: "13:00" });
		await admin.query(
			`update work_period set start_time = start_time - interval '2 hours'
			 where employee_id = $1 and start_time::date = '2026-07-13' and canonical_record_id is not null`,
			[ids.worker],
		);

		const plan = await readPlan();
		expect(plan.plan.employees).toEqual([]);
		const reasons = plan.plan.held.map((gap) => `${gap.kind}:${gap.reason}`).toSorted();
		expect(reasons).toEqual(
			[
				"metadata_missing:conflicting_evidence",
				"duration_missing:original_rule_unknown",
				"duration_missing:original_rule_unknown",
				"approval_relationship_missing:no_restorable_evidence",
				"canonical_missing:original_actor_unrepresentable",
				"endpoint_entry_missing:no_restorable_evidence",
				"canonical_missing:conflicting_evidence",
			].toSorted(),
		);
		expect(plan.plan.held.some((gap) => gap.workPeriodIds.includes(deleted))).toBe(false);

		const before = await snapshot();
		const applied = await apply(plan, ids.ownerUser, {
			expected: [{ employeeId: ids.worker, fingerprint: "0".repeat(64) }],
		});
		expect(applied.body.outcomes).toEqual([{ employeeId: ids.worker, status: "stale" }]);
		expect(await snapshot()).toEqual(before);
		expect((await periodRow(deleted)).deleted_at).not.toBeNull();
	});

	it("stops a stale plan after a concurrent completion, approval or deletion under coordination", async () => {
		await authorizeRepair();
		const scenarios: [string, (client: PoolClient, periodId: string) => Promise<void>][] = [
			[
				"completion",
				async (client, periodId) => {
					await client.query(
						`update time_record set end_at = start_at + interval '2 hours', duration_minutes = 120
						 where id = (select canonical_record_id from work_period where id = $1)`,
						[periodId],
					);
				},
			],
			[
				"approval",
				async (client, periodId) => {
					await client.query(
						// A legacy decision: it does not advance the graph revision.
						"update work_period set approval_status = 'rejected' where id = $1",
						[periodId],
					);
				},
			],
			[
				"deletion",
				async (client, periodId) => {
					await client.query(
						"update work_period set deleted_at = now(), deletion_reason = 'removed' where id = $1",
						[periodId],
					);
				},
			],
		];
		for (const [index, [name, write]] of scenarios.entries()) {
			const { periodId } = await incompleteRecord(`2026-07-1${index + 4}`);
			const plan = await readPlan();
			const unit = plan.plan.employees[0].units.find((item) => item.workPeriodId === periodId);
			expect(unit, name).toBeDefined();

			const writer = await asConcurrentWriter((client) => write(client, periodId));
			const pending = apply(plan);
			await waitForLockWaiter();
			const before = await snapshot();
			await writer.commit();
			const outcome = await pending;

			expect(outcome.body.outcomes, name).toEqual([{ employeeId: ids.worker, status: "stale" }]);
			const after = await snapshot();
			expect(after.receipts, name).toEqual(before.receipts);
			expect(after.details, name).toEqual(before.details);
			// Leave no gap behind for the next scenario.
			await admin.query("update work_period set deleted_at = now() where id = $1", [periodId]);
		}
	});

	it("stops a stale plan after a real calendar split", async () => {
		await authorizeRepair();
		const { periodId } = await incompleteRecord("2026-07-20");
		const plan = await readPlan();
		const before = await snapshot();

		actAs(ids.workerUser);
		const split = await splitWorkPeriod(periodId, "2026-07-20", "09:00");
		expect(split).toMatchObject({ success: true });
		const afterSplit = await snapshot();

		const outcome = await apply(plan);
		expect(outcome.body.outcomes).toEqual([{ employeeId: ids.worker, status: "stale" }]);
		expect((await snapshot()).receipts).toEqual(before.receipts);
		expect(await snapshot()).toEqual(afterSplit);
	});

	/**
	 * Parks the first insert into `table` on a lock the returned holder owns (#327), so
	 * that writer keeps the employee key while a competing real writer arrives.
	 */
	async function parkNextInsert(table: "time_entry" | "completed_work_operation") {
		await admin.query(`create function t327_park() returns trigger language plpgsql as $$
			begin perform pg_advisory_xact_lock(hashtextextended('t327-park', 0)); return new; end $$`);
		await admin.query(
			`create trigger t327_park before insert on ${table} for each row execute function t327_park()`,
		);
		const client = await admin.connect();
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended('t327-park', 0))");
		return {
			async release() {
				await client.query("commit");
				client.release();
				await admin.query("drop function if exists t327_park() cascade");
			},
		};
	}

	async function waitForLockWaiters(count: number) {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query(
				"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
			);
			if (rows[0].waiting >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Fewer than ${count} transactions waited on advisory locks`);
	}

	// #327: the real split writer races the repair in both arrival orders, instead of
	// an SQL write holding the shared key.
	it("stops a stale plan when a real split commits first while the repair waits", async () => {
		await authorizeRepair();
		const { periodId } = await incompleteRecord("2026-07-23");
		const plan = await readPlan();
		const before = await snapshot();

		const park = await parkNextInsert("time_entry");
		actAs(ids.workerUser);
		const split = splitWorkPeriod(periodId, "2026-07-23", "09:00");
		await waitForLockWaiters(1);
		const repair = apply(plan);
		await waitForLockWaiters(2);
		await park.release();

		await expect(split).resolves.toMatchObject({ success: true });
		const outcome = await repair;
		expect(outcome.body.outcomes).toEqual([{ employeeId: ids.worker, status: "stale" }]);
		expect((await snapshot()).receipts).toEqual(before.receipts);
	});

	it("lets a real split proceed on the repaired graph when the repair commits first", async () => {
		await authorizeRepair();
		const { periodId } = await incompleteRecord("2026-07-24");
		const plan = await readPlan();

		const park = await parkNextInsert("completed_work_operation");
		const repair = apply(plan);
		await waitForLockWaiters(1);
		actAs(ids.workerUser);
		const split = splitWorkPeriod(periodId, "2026-07-24", "09:00");
		await waitForLockWaiters(2);
		await park.release();

		const outcome = await repair;
		expect(outcome.body.outcomes).toEqual([
			expect.objectContaining({ employeeId: ids.worker, status: "applied" }),
		]);
		await expect(split).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query(
			`select count(*)::int as periods from work_period
			 where employee_id = $1 and deleted_at is null
			   and start_time >= '2026-07-24T00:00:00Z' and start_time < '2026-07-25T00:00:00Z'`,
			[ids.worker],
		);
		expect(rows[0].periods).toBe(2);
	});

	it("applies a plan once under concurrent repeats and rolls back entirely on a failed write", async () => {
		await authorizeRepair();
		await missingRecord("2026-07-21");
		await missingLink("2026-07-22");
		const plan = await readPlan();

		// Injected failure at the receipt: the created record, detail, link and
		// revision roll back with it.
		await admin.query(`
			create function t320_fail_repair_receipt() returns trigger language plpgsql as $$
			begin raise exception 't320 injected receipt failure'; end $$;
			create trigger t320_fail_repair_receipt before insert on completed_work_operation
			for each row when (new.kind = 'repair_historical_gap') execute function t320_fail_repair_receipt();
		`);
		const before = await snapshot();
		try {
			const failed = await apply(plan);
			expect(failed.status).toBe(500);
		} finally {
			await admin.query(`
				drop trigger t320_fail_repair_receipt on completed_work_operation;
				drop function t320_fail_repair_receipt();
			`);
		}
		expect(await snapshot()).toEqual(before);

		const [first, second] = await Promise.all([apply(plan), apply(plan)]);
		const statuses = [first.body.outcomes[0].status, second.body.outcomes[0].status].toSorted();
		expect(statuses).toEqual(["already_applied", "applied"]);
		const { rows } = await admin.query(
			`select
			   (select count(*)::int from completed_work_operation where organization_id = $1) as receipts,
			   (select count(*)::int from time_record where organization_id = $1) as records,
			   (select count(*)::int from time_record_allocation where organization_id = $1) as allocations`,
			[ids.organization],
		);
		expect(rows[0]).toEqual({ receipts: 2, records: 2, allocations: 1 });
	});

	it("repairs only pre-adoption gaps of an adopted organization", async () => {
		await authorizeRepair();
		const historical = await missingLink("2026-07-23");
		// Pending without a relationship: a gap repair cannot fill, which stays historical.
		await admin.query("update work_period set approval_status = 'pending' where id = $1", [
			historical,
		]);
		await admin.query("update time_record set approval_state = 'pending' where id = $1", [
			historical,
		]);
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		actAs(ids.workerUser);
		const submissionId = randomUUID();
		const fresh = await createManualTimeEntry({
			version: 2,
			submissionId,
			targetEmployeeId: ids.worker,
			date: "2026-07-24",
			clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "12:00", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "target", timezone: "Europe/Berlin" },
			browserTimezone: "Europe/Berlin",
			reason: "Backdated entry",
			projectId: null,
			workCategoryId: null,
		});
		expect(fresh).toMatchObject({ success: true });
		await admin.query(
			"delete from time_record_work where record_id = (select canonical_record_id from work_period where id = $1)",
			[submissionId],
		);

		const plan = await readPlan();
		expect(plan.plan.employees[0].units.map((unit) => unit.workPeriodId)).toEqual([historical]);
		expect(plan.plan.held.map((gap) => [gap.kind, gap.reason])).toEqual([
			["approval_relationship_missing", "no_restorable_evidence"],
		]);
		expect(await findingKinds()).toContain("canonical_detail_missing:integrity_incident");

		const applied = await apply(plan);
		expect(applied.body.outcomes).toMatchObject([{ status: "applied" }]);
		// The repair receipt runs under append admission but does not make the
		// repaired work look amended after adoption.
		const { rows } = await admin.query(
			"select append_admission from completed_work_operation where kind = 'repair_historical_gap' and organization_id = $1",
			[ids.organization],
		);
		expect(rows).toEqual([{ append_admission: "append" }]);
		expect((await findingKinds()).toSorted()).toEqual([
			"approval_relationship_missing:historical_gap",
			"canonical_detail_missing:integrity_incident",
		]);
	});

	it("authorizes repair for organization administrators within their organization only", async () => {
		await authorizeRepair();
		await missingLink("2026-07-27");
		const plan = await readPlan();
		const before = await snapshot();

		expect((await apply(plan, ids.managerUser)).status).toBe(403);
		expect(
			(await call(repairRoute, ids.managerUser, { action: "plan", employeeId: ids.worker, ...july }))
				.status,
		).toBe(403);
		expect((await apply(plan, ids.workerUser)).status).toBe(403);
		expect(
			(await call(repairRoute, ids.ownerUser, { action: "plan", employeeId: ids.foreign, ...july }))
				.status,
		).toBe(404);
		expect(
			(
				await call(repairRoute, ids.ownerUser, {
					action: "apply",
					employeeId: ids.worker,
					...july,
					expected: [{ employeeId: ids.foreign, fingerprint: "0".repeat(64) }],
					reason: "cross-organization",
				})
			).status,
		).toBe(400);
		expect((await apply(plan, ids.ownerUser, { reason: " " })).status).toBe(400);
		expect(
			(
				await call(repairRoute, ids.ownerUser, {
					action: "plan",
					startDate: "2026-07-31",
					endDate: "2026-07-01",
				})
			).status,
		).toBe(400);
		expect(await snapshot()).toEqual(before);

		// Another organization's control does not authorize this one.
		await admin.query("delete from historical_work_repair_control where organization_id = $1", [
			ids.organization,
		]);
		await admin.query(
			"insert into historical_work_repair_control (organization_id, mode) values ($1, 'active')",
			[ids.otherOrganization],
		);
		expect((await apply(plan)).status).toBe(409);
		expect(await snapshot()).toEqual(before);
	});

	it("never repairs inline when a committed submission is replayed", async () => {
		await authorizeRepair();
		// The legacy period ID is its submission ID; the gap is a missing link.
		const submissionId = await missingLink("2026-07-28");
		const before = await snapshot();

		actAs(ids.workerUser);
		const replay = await createManualTimeEntry({
			submissionId,
			reason: "Forgot to clock",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date: "2026-07-28",
			clockInTime: "13:00",
			clockOutTime: "15:00",
		} as unknown as ManualTimeEntryCommand);

		// The replay keeps its established collision handling and repairs nothing.
		expect(replay).toMatchObject({ success: false });
		expect(await snapshot()).toEqual(before);
		expect(await findingKinds()).toContain("canonical_link_missing:historical_gap");
	});
});
