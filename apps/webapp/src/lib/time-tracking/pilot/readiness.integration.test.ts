/**
 * #329 / T64 runtime evidence: the time pilot readiness report.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The work the report reads is written by the real callers: the public
 * `createManualTimeEntry` action (legacy before adoption, strict version 2
 * after it) under a real change policy that requires approval, `clockIn` and
 * `clockOut`, the on-behalf clock-out route called without an operation ID the
 * way calendar bundles from before #401 call it, and the reviewed-import commit
 * worker. Controls are inserted directly, as the documented operator SQL does:
 * production has no setter. Tampering and stored-minute changes that no current
 * writer produces are injected with SQL, as history would contain them. Only
 * the session, request headers, billing guard, notification delivery, the
 * import queue and the Next cache are replaced.
 */

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { parseInstant } from "@/lib/datetime/temporal-core";
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
								id: `t329-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
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
	sendClockOutApprovalNotifications: async () => undefined,
	sendClockOutApprovedNotification: async () => undefined,
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

// The reviewed-import worker enqueues nothing outside the test.
vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportCommitJob: async () => {},
	enqueueImportScanJob: async () => {},
}));

const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { POST: clockOutOnBehalf } = await import("@/app/api/time-entries/clock-out-on-behalf/route");
const { processImportReviewJob } = await import("@/lib/import-review/worker");
const { assessOrganizationTimePilotReadiness } = await import("./readiness-reader");

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
	describe.skip(`time pilot readiness PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t329-pilot-org",
	otherOrganization: "t329-other-org",
	ownerUser: "t329-owner-user",
	managerUser: "t329-manager-user",
	workerUser: "t329-worker-user",
	peerUser: "t329-peer-user",
	foreignUser: "t329-foreign-user",
	owner: "d3290000-0000-4000-8000-000000000001",
	manager: "d3290000-0000-4000-8000-000000000002",
	worker: "d3290000-0000-4000-8000-000000000003",
	peer: "d3290000-0000-4000-8000-000000000004",
	foreign: "d3290000-0000-4000-8000-000000000005",
	changePolicy: "d3290000-0000-4000-8000-000000000006",
	changePolicyAssignment: "d3290000-0000-4000-8000-000000000007",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.workerUser, ids.peerUser, ids.foreignUser];

describeIntegration("time pilot readiness on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	/** A legacy manual submission (organization not adopted), routed for approval. */
	async function legacyManual(userId: string, date: string) {
		actAs(userId);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Forgot to clock",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date,
			clockInTime: "08:00",
			clockOutTime: "12:00",
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
		return (result as { data: { workPeriodId: string } }).data.workPeriodId;
	}

	/** A strict version-2 manual command (organization adopted), routed for approval. */
	async function manualCommand(userId: string, employeeId: string, date: string) {
		actAs(userId);
		const submissionId = randomUUID();
		const result = await createManualTimeEntry({
			version: 2,
			submissionId,
			targetEmployeeId: employeeId,
			date,
			clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "12:00", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "target", timezone: "Europe/Berlin" },
			browserTimezone: "Europe/Berlin",
			reason: "Forgot to clock",
			projectId: null,
			workCategoryId: null,
		});
		expect(result).toMatchObject({ success: true });
		return submissionId;
	}

	async function liveWork(userId: string, startsAt: string, endsAt: string | null) {
		actAs(userId);
		await expect(
			clockIn("office", { instant: parseInstant(startsAt), browserTimezone: "Europe/Berlin" }),
		).resolves.toMatchObject({ success: true });
		if (endsAt === null) return;
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: parseInstant(endsAt),
				browserTimezone: "Europe/Berlin",
			}),
		).resolves.toMatchObject({ success: true });
	}

	async function pendingRequests() {
		const { rows } = await admin.query<{ count: number }>(
			`select count(*)::int as count from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and status = 'pending'`,
			[ids.organization],
		);
		return rows[0]?.count;
	}

	/** Every row the report reads or could be suspected of touching. */
	async function snapshot() {
		const tables = [
			"work_period",
			"time_entry",
			"time_record",
			"completed_work_operation",
			"time_entry_append_position",
			"time_entry_append_control",
			"approval_request",
			"approval_submitted_revision",
			"approval_evidence_control",
			"import_batch",
			"import_staged_row",
			"work_balance_rebuild_intent",
			"payroll_work_collection_control",
		];
		const snapshots: Record<string, unknown> = {};
		for (const table of tables) {
			const { rows } = await admin.query(
				`select coalesce(json_agg(row_to_json(t) order by row_to_json(t)::text), '[]') as rows
				 from ${table} t where organization_id = $1`,
				[ids.organization],
			);
			snapshots[table] = rows[0]?.rows;
		}
		return snapshots;
	}

	async function readReport() {
		const before = await snapshot();
		const report = await assessOrganizationTimePilotReadiness({
			organizationId: ids.organization,
		});
		// The report is a read: nothing it reads changes.
		expect(await snapshot()).toEqual(before);
		return report;
	}

	async function waitForAdvisoryWaiters(count: number) {
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
			);
			if ((rows[0]?.waiting ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Fewer than ${count} transactions waited on advisory locks`);
	}

	/**
	 * The exclusive activation statement from docs/refs/time-pilot.md, verbatim.
	 * `whileLocked` starts a writer after the gate is held; it must wait for the switch.
	 */
	async function activateAppendAdmission(whileLocked?: () => Promise<unknown>) {
		const client = await admin.connect();
		try {
			await client.query("begin");
			await client.query(
				`select pg_advisory_xact_lock(hashtextextended('["completed-work-adoption","' || $1::text || '"]', 0))`,
				[ids.organization],
			);
			const writer = whileLocked?.();
			if (writer) await waitForAdvisoryWaiters(1);
			await client.query(
				`insert into time_entry_append_control (organization_id, mode, updated_at)
				 values ($1, 'active', clock_timestamp())
				 on conflict (organization_id) do update set mode = excluded.mode, updated_at = excluded.updated_at`,
				[ids.organization],
			);
			await client.query("commit");
			await writer;
		} finally {
			client.release();
		}
	}

	/** A reviewed-import batch whose only row ends in the future, committed by the real worker. */
	async function importHeldRow() {
		const batchId = randomUUID();
		const jobId = randomUUID();
		await admin.query(
			`insert into import_batch
			 (id, organization_id, provider, status, selected_scope, date_range, started_by, committed_by, created_at, updated_at)
			 values ($1, $2, 'clockodo', 'committing', '{}', '{"startDate":"2021-01-01","endDate":"2031-12-31"}', $3, $3, now(), now())`,
			[batchId, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into import_batch_job
			 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
			 values ($1, $2, $3, 'commit', 'queued', 'work_period', 'work_period', now(), now())`,
			[jobId, batchId, ids.organization],
		);
		const sourcePayload = { id: `t329:${randomUUID()}` };
		await admin.query(
			`insert into import_staged_row
			 (id, batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
			  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
			 values ($1, $2, $3, 'work_period', $4, $5, $6, $7, 'accepted', 'none', now(), now())`,
			[
				randomUUID(),
				batchId,
				ids.organization,
				sourcePayload.id,
				createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
				sourcePayload,
				{
					employeeId: ids.worker,
					startsAt: "2031-01-02T08:00:00Z",
					endsAt: "2031-01-02T12:00:00Z",
				},
			],
		);
		await processImportReviewJob({
			data: {
				type: "import-review-commit" as const,
				batchId,
				jobId,
				organizationId: ids.organization,
				entityType: "work_period" as const,
				committedBy: ids.ownerUser,
			},
			opts: { attempts: 3 },
			attemptsMade: 2,
		} as never).catch(() => undefined);
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
			 ($1, 'T329 pilot', $1, 'Europe/Berlin', $3), ($2, 'T329 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t329-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t329-m-manager', $1, $3, 'member', 'approved', $7),
			 ('t329-m-worker', $1, $4, 'member', 'approved', $7),
			 ('t329-m-peer', $1, $5, 'member', 'approved', $7),
			 ('t329-m-foreign', $6, $8, 'member', 'approved', $7)`,
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
			 values ($1, $3, true, $4), ($2, $3, true, $4)`,
			[ids.worker, ids.peer, ids.manager, ids.ownerUser],
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
		// Any past manual entry needs approval, through the real change policy.
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T329 manual approval', 0, 3650, $3, now())`,
			[ids.changePolicy, ids.organization, ids.managerUser],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, now())`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.managerUser],
		);
		// Another organization's pending work never counts here.
		await admin.query(
			`insert into work_balance_rebuild_intent (organization_id, reason, requested_at)
			 values ($1, 'organization_timezone', now())`,
			[ids.otherOrganization],
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
			throw new Error("Time pilot readiness PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("classifies in-flight work and lineage of an organization before adoption", async () => {
		await legacyManual(ids.workerUser, "2026-07-02");
		expect(await pendingRequests()).toBe(1);
		// The manager's history no longer forms one lineage.
		await liveWork(ids.managerUser, "2026-07-03T06:00:00Z", "2026-07-03T10:00:00Z");
		await admin.query(
			"update time_entry set hash = 'tampered' where employee_id = $1 and type = 'clock_out'",
			[ids.manager],
		);
		// Live work open at the snapshot.
		await liveWork(ids.peerUser, "2026-07-04T06:00:00Z", null);
		await admin.query(
			`insert into work_balance_rebuild_intent (organization_id, reason, requested_at)
			 values ($1, 'organization_timezone', now())`,
			[ids.organization],
		);

		const report = await readReport();

		expect(report.adoption).toMatchObject({
			appendMode: "inactive",
			activatedAt: null,
			employees: {
				total: 4,
				admitted: { empty_history: 0, verified_lineage: 0, authorized_continuation: 0 },
				notAdmitted: 4,
				lineageReview: 1,
				continuityInterrupted: 0,
			},
			openWork: 1,
			verdict: "hold",
			findings: [
				{ code: "append_inactive", severity: "hold" },
				{ code: "open_work_in_flight", severity: "hold", count: 1 },
				{ code: "lineage_review_required", severity: "hold", count: 1 },
			],
		});
		expect(report.history.treatments).toMatchObject({
			integrity_incident: 0,
			investigation_required: 0,
		});
		expect(report.approvals.unclassifiedPending).toBe(0);
		expect(report.approvals.kinds).toEqual([
			{
				workflowType: "manual_time_submission",
				authority: "legacy",
				lifecycleMode: "legacy",
				evidenceMode: "inactive",
				pending: { total: 1, current: 0, notCaptured: 1, materialChange: 0, multiStage: 0 },
				verdict: "hold",
				findings: [
					{ code: "evidence_capture_inactive", severity: "hold" },
					{ code: "in_flight_without_revision", severity: "hold", count: 1 },
				],
			},
			expect.objectContaining({
				workflowType: "policy_clock_out",
				authority: "legacy",
				// Seeded as `legacy` by the approval write gate the live clock-out takes.
				lifecycleMode: "legacy",
				pending: expect.objectContaining({ total: 0 }),
			}),
			expect.objectContaining({
				workflowType: "time_correction",
				pending: expect.objectContaining({ total: 0 }),
			}),
		]);
		expect(report.operations).toEqual({
			receiptsSinceActivation: {},
			verdict: "ready",
			findings: [],
		});
		expect(report.imports).toMatchObject({ heldRows: 0, failedBatches: 0, verdict: "ready" });
		expect(report.followUps).toMatchObject({
			payrollCollection: "inactive",
			historicalRepair: "inactive",
			pendingRebuildIntents: 1,
			openProposals: 0,
			pendingBreakAdjustments: 0,
			findings: [
				{ code: "payroll_collection_inactive", severity: "hold" },
				{ code: "balance_rebuild_pending", severity: "hold", count: 1 },
			],
		});
		expect(report.verdict).toBe("hold");
	});

	it("reports held approvals, old clients, held imports and incidents after adoption", async () => {
		// Submitted before capture: it has no revision.
		await legacyManual(ids.workerUser, "2026-07-02");
		// Work still running at the switch.
		const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		await liveWork(ids.peerUser, startedAt, null);
		// A clock-in that arrives while the switch holds the gate waits, then appends.
		const switchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
		await activateAppendAdmission(() => liveWork(ids.ownerUser, switchedAt, null));
		const {
			rows: [ownerPosition],
		} = await admin.query(
			"select admission, admitted_operation from time_entry_append_position where employee_id = $1",
			[ids.owner],
		);
		expect(ownerPosition).toEqual({
			admission: "empty_history",
			admitted_operation: "live_clock_in",
		});
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'manual_time_submission', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			"insert into payroll_work_collection_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		const {
			rows: [control],
		} = await admin.query<{ updated_at: Date }>(
			"select updated_at from time_entry_append_control where organization_id = $1",
			[ids.organization],
		);

		await manualCommand(ids.peerUser, ids.peer, "2026-07-06");
		const changed = await manualCommand(ids.peerUser, ids.peer, "2026-07-07");
		expect(await pendingRequests()).toBe(3);
		// The live work no longer matches its submitted revision.
		await admin.query("update work_period set duration_minutes = 200 where id = $1", [changed]);
		await admin.query(
			"update time_record set duration_minutes = 200 where id = (select canonical_record_id from work_period where id = $1)",
			[changed],
		);

		// Fresh live work, then a defect in it and a write that bypassed the collaborator.
		await liveWork(ids.workerUser, "2026-07-10T06:00:00Z", "2026-07-10T10:00:00Z");
		const {
			rows: [live],
		} = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and start_time = '2026-07-10T06:00:00Z'",
			[ids.worker],
		);
		await admin.query(
			"update time_record set duration_minutes = 1 where id = (select canonical_record_id from work_period where id = $1)",
			[live?.id],
		);

		// A calendar bundle from before #401 closes the peer's pre-adoption work
		// without an operation ID, through the adopted clock-out operation.
		const {
			rows: [open],
		} = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null",
			[ids.peer],
		);
		actAs(ids.managerUser);
		const closed = await clockOutOnBehalf(
			new Request("http://localhost/api/time-entries/clock-out-on-behalf", {
				method: "POST",
				body: JSON.stringify({ workPeriodId: open?.id }),
			}) as unknown as NextRequest,
		);
		expect(closed.status).toBe(201);

		await importHeldRow();
		await admin.query(
			`update time_entry set hash = 'tampered'
			 where id = (select clock_out_id from work_period where id = $1)`,
			[live?.id],
		);

		const report = await readReport();

		expect(report.adoption).toMatchObject({
			appendMode: "active",
			activatedAt: control?.updated_at.toISOString(),
			employees: {
				total: 4,
				admitted: { empty_history: 1, verified_lineage: 2, authorized_continuation: 0 },
				notAdmitted: 1,
				lineageReview: 0,
				continuityInterrupted: 1,
			},
			verdict: "blocked",
			findings: [{ code: "continuity_interrupted", severity: "blocker", count: 1 }],
		});
		expect(report.history.treatments.integrity_incident).toBeGreaterThanOrEqual(1);
		expect(report.history.findings[0]).toMatchObject({
			code: "history_integrity_incident",
			severity: "blocker",
		});
		expect(report.history.blockingKinds).toMatchObject({ duration_conflict: 1 });
		expect(report.approvals.kinds[0]).toEqual({
			workflowType: "manual_time_submission",
			authority: "legacy",
			lifecycleMode: "legacy",
			evidenceMode: "capture",
			pending: { total: 3, current: 1, notCaptured: 1, materialChange: 1, multiStage: 0 },
			verdict: "hold",
			findings: [
				{ code: "evidence_held", severity: "hold", count: 1 },
				{ code: "evidence_material_change", severity: "hold", count: 1 },
			],
		});
		expect(report.operations.receiptsSinceActivation).toMatchObject({
			manual_entry: 2,
			web_clock_out: 1,
			manager_on_behalf: 1,
		});
		expect(report.operations.findings).toEqual([
			{ code: "server_identity_on_behalf", severity: "hold", count: 1 },
		]);
		expect(report.imports).toMatchObject({
			heldRows: 1,
			failedBatches: 1,
			inProgressBatches: 0,
			findings: [
				{ code: "import_rows_held", severity: "hold", count: 1 },
				{ code: "import_commit_failed", severity: "hold", count: 1 },
			],
		});
		expect(report.followUps).toMatchObject({ payrollCollection: "active", findings: [] });
		expect(report.verdict).toBe("blocked");
	});

	it("refuses an organization that does not exist", async () => {
		await expect(
			assessOrganizationTimePilotReadiness({ organizationId: "t329-missing-org" }),
		).rejects.toThrow("Unknown organization t329-missing-org");
	});
});
