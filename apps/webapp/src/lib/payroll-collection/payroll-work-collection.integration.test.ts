/**
 * #322 / T57 runtime evidence: scoped payroll work collection and persisted export input.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Work is written by the real legacy `createManualTimeEntry` action (an administrator's
 * entry for an employee is approved; an employee's own old entry awaits approval).
 * Shapes no current writer produces (open work, a missing link, foreign-owned work) are
 * injected with SQL, as history would contain them. Exports and the workspace go through
 * the real payroll server actions (session, membership, payroll access grants, CASL-free
 * payroll scope, the export service and DATEV formatter); the queued delivery is
 * processed by the same `processExportJob` the worker runs. Only the session, the
 * object store and the queue transport are mocked. Both controls are granted by
 * inserting their rows, because neither has an application setter.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	beforeEvidenceRead: null as null | (() => Promise<void>),
	uploads: [] as Buffer[],
	failNextUpload: false,
	queued: [] as unknown[],
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
								id: `t322-session-${harness.userId}`,
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

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	uploadExport: async (_organizationId: string, _key: string, content: Buffer) => {
		harness.uploads.push(content);
		if (harness.failNextUpload) {
			harness.failNextUpload = false;
			throw new Error("Object store unavailable");
		}
	},
	getPresignedUrl: async (_organizationId: string, key: string) => `https://exports.test/${key}`,
}));

vi.mock("@/lib/queue", () => ({
	addJob: async (...args: unknown[]) => {
		harness.queued.push(args);
		return { id: "queued" };
	},
}));

/** Lets a test commit a concurrent write between the snapshot's work and evidence reads. */
vi.mock("@/lib/time-tracking/historical-work-diagnostics-reader", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/time-tracking/historical-work-diagnostics-reader")>();
	return {
		...original,
		readHistoricalWorkEvidence: async (
			...args: Parameters<typeof original.readHistoricalWorkEvidence>
		) => {
			const hook = harness.beforeEvidenceRead;
			harness.beforeEvidenceRead = null;
			await hook?.();
			return original.readHistoricalWorkEvidence(...args);
		},
	};
});

const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { getPayrollWorkspaceSummaryAction, startScopedPayrollExportAction } = await import(
	"@/app/[locale]/(app)/payroll/actions"
);
const { createExportJob, processExportJob } = await import("@/lib/payroll-export/export-service");
const { DatevLohnFormatter } = await import("@/lib/payroll-export/formatters/datev-lohn-formatter");
const { PayrollWorkCollectionBlockedError } = await import(
	"./payroll-work-collection-blocked-error"
);
const { payrollWorkInputDigest } = await import("./payroll-work-collection");
const { PAYROLL_COLLECTION_REPAIR_REASON, readPayrollWorkCollection } = await import(
	"./payroll-work-collection-reader"
);
const { db } = await import("@/db");

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
	describe.skip(`payroll collection PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t322-payroll-org",
	otherOrganization: "t322-other-org",
	ownerUser: "t322-owner-user",
	clerkUser: "t322-clerk-user",
	workerUser: "t322-worker-user",
	peerUser: "t322-peer-user",
	foreignUser: "t322-foreign-user",
	owner: "d3220000-0000-4000-8000-000000000001",
	clerk: "d3220000-0000-4000-8000-000000000002",
	worker: "d3220000-0000-4000-8000-000000000003",
	peer: "d3220000-0000-4000-8000-000000000004",
	foreign: "d3220000-0000-4000-8000-000000000005",
} as const;
const users = [ids.ownerUser, ids.clerkUser, ids.workerUser, ids.peerUser, ids.foreignUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" };

type ExportResult = Awaited<ReturnType<typeof startScopedPayrollExportAction>>;
type StoredInput = {
	digest: string;
	work: {
		recordId: string;
		employeeId: string;
		minutes: number;
		source: { graphRevision: number | null; workPeriodId: string | null };
	}[];
};

describeIntegration("scoped payroll work collection on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function exportJuly(userId: string = ids.ownerUser): Promise<ExportResult> {
		actAs(userId);
		return startScopedPayrollExportAction({ ...july, formatId: "datev_lohn" });
	}

	async function workspace(userId: string = ids.ownerUser) {
		actAs(userId);
		const result = await getPayrollWorkspaceSummaryAction(july);
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	/** A legacy manual entry; the owner's entry for an employee is approved. */
	async function manual(input: {
		actor: string;
		employeeId?: string;
		date: string;
		clockInTime: string;
		clockOutTime: string;
	}) {
		actAs(input.actor);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Payroll evidence",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date: input.date,
			clockInTime: input.clockInTime,
			clockOutTime: input.clockOutTime,
			...(input.employeeId ? { employeeId: input.employeeId } : {}),
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
		const periodId = (result as { data: { workPeriodId: string } }).data.workPeriodId;
		const { rows } = await admin.query(
			`select p.id as period_id, p.canonical_record_id as record_id, p.graph_revision,
			   p.approval_status, r.approval_state
			 from work_period p join time_record r on r.id = p.canonical_record_id where p.id = $1`,
			[periodId],
		);
		return rows[0] as {
			period_id: string;
			record_id: string;
			graph_revision: number;
			approval_status: string;
			approval_state: string;
		};
	}

	async function approvedWork(
		employeeId: string,
		date: string,
		clockInTime = "08:00",
		clockOutTime = "12:00",
	) {
		const work = await manual({
			actor: ids.ownerUser,
			employeeId,
			date,
			clockInTime,
			clockOutTime,
		});
		expect(work.approval_state).toBe("approved");
		return work;
	}

	async function setStoredMinutes(
		work: { period_id: string; record_id: string },
		minutes: number | null,
	) {
		await admin.query("update work_period set duration_minutes = $2 where id = $1", [
			work.period_id,
			minutes,
		]);
		await admin.query("update time_record set duration_minutes = $2 where id = $1", [
			work.record_id,
			minutes,
		]);
	}

	async function counts() {
		const { rows } = await admin.query(
			`select (select count(*)::int from payroll_export_job where organization_id = $1) as jobs,
			   (select count(*)::int from payroll_export_work_input where organization_id = $1) as inputs`,
			[ids.organization],
		);
		return rows[0] as { jobs: number; inputs: number };
	}

	async function storedInput(jobId: string) {
		const { rows } = await admin.query(
			"select digest, work_count, input from payroll_export_work_input where job_id = $1",
			[jobId],
		);
		return rows[0] as { digest: string; work_count: number; input: StoredInput } | undefined;
	}

	async function activateCollection(organizationId: string = ids.organization) {
		await admin.query(
			`insert into payroll_work_collection_control (organization_id, mode) values ($1, 'active')
			 on conflict (organization_id) do update set mode = 'active', updated_at = now()`,
			[organizationId],
		);
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
			 ($1, 'T322 payroll', $1, 'Europe/Berlin', $3), ($2, 'T322 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t322-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t322-m-clerk', $1, $3, 'member', 'approved', $7),
			 ('t322-m-worker', $1, $4, 'member', 'approved', $7),
			 ('t322-m-peer', $1, $5, 'member', 'approved', $7),
			 ('t322-m-foreign', $6, $8, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.clerkUser,
				ids.workerUser,
				ids.peerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 ($1, $2, $11, 'admin', 'OWN-1', $12), ($3, $4, $11, 'employee', 'CLK-1', $12),
			 ($5, $6, $11, 'employee', 'WRK-1', $12), ($7, $8, $11, 'employee', 'PER-1', $12),
			 ($9, $10, $13, 'employee', 'FOR-1', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.clerk,
				ids.clerkUser,
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
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
		);
		await admin.query(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, 'datev_lohn', $2::jsonb, $3, now())`,
			[
				ids.organization,
				JSON.stringify({
					mandantennummer: "12345",
					beraternummer: "1234567",
					personnelNumberType: "employeeNumber",
					includeZeroHours: false,
				}),
				ids.ownerUser,
			],
		);
		// The owner's payroll scope is the organization; the clerk's is the worker only.
		await admin.query(
			`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
			 values ($1, $2, 'all', $3, now())`,
			[ids.organization, ids.owner, ids.ownerUser],
		);
		const { rows } = await admin.query(
			`insert into payroll_access_grant (organization_id, payroll_employee_id, scope, created_by, updated_at)
			 values ($1, $2, 'specific', $3, now()) returning id`,
			[ids.organization, ids.clerk, ids.ownerUser],
		);
		await admin.query(
			`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
			 values ($1, $2, $3, $4)`,
			[ids.organization, rows[0].id, ids.worker, ids.ownerUser],
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
			throw new Error("Payroll collection PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.beforeEvidenceRead = null;
		harness.uploads.length = 0;
		harness.failNextUpload = false;
		harness.queued.length = 0;
		vi.restoreAllMocks();
		await seed();
		await activateCollection();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("exports complete scoped work with protected minutes, and the workspace credits the same minutes", async () => {
		const worker = await approvedWork(ids.worker, "2026-07-10");
		// Established stored minutes (239) differ from the 240 elapsed: they govern.
		await setStoredMinutes(worker, 239);
		const peer = await approvedWork(ids.peer, "2026-07-11", "09:00", "10:00");

		const result = await exportJuly();
		expect(result).toMatchObject({ success: true, data: { isAsync: false } });
		const { jobId, fileContent } = (result as { data: { jobId: string; fileContent: string } })
			.data;
		expect(fileContent).toContain("WRK-1");
		expect(fileContent).toContain("PER-1");

		const stored = await storedInput(jobId);
		expect(stored?.work_count).toBe(2);
		expect(stored?.input.digest).toBe(stored?.digest);
		expect(payrollWorkInputDigest(stored?.input as never)).toBe(stored?.digest);
		expect(
			stored?.input.work.map((line) => [line.recordId, line.employeeId, line.minutes]),
		).toEqual([
			[worker.record_id, ids.worker, 239],
			[peer.record_id, ids.peer, 60],
		]);
		expect(stored?.input.work[0]?.source).toMatchObject({
			workPeriodId: worker.period_id,
			graphRevision: worker.graph_revision,
		});
		const { rows: jobRows } = await admin.query(
			"select status, work_period_count from payroll_export_job where id = $1",
			[jobId],
		);
		expect(jobRows[0]).toMatchObject({ status: "completed" });

		const summary = await workspace();
		expect(summary.blockers).toEqual([]);
		const hours = Object.fromEntries(summary.employees.map((row) => [row.id, row.workedHours]));
		expect(hours[ids.worker]).toBe(Math.round((239 / 60) * 100) / 100);
		expect(hours[ids.peer]).toBe(1);

		// The stored input is immutable.
		await expect(
			admin.query("update payroll_export_work_input set work_count = 0 where job_id = $1", [jobId]),
		).rejects.toThrow("payroll export work input is immutable");
	});

	it("refuses the whole export for uncertain work that approval and end filters would drop", async () => {
		const approved = await approvedWork(ids.worker, "2026-07-10");
		// Work awaiting approval, with its legacy approval request.
		const pending = await approvedWork(ids.worker, "2026-07-14", "08:00", "10:00");
		await admin.query("update work_period set approval_status = 'pending' where id = $1", [
			pending.period_id,
		]);
		await admin.query("update time_record set approval_state = 'pending' where id = $1", [
			pending.record_id,
		]);
		await admin.query(
			`insert into approval_request
			 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, 'pending', now())`,
			[ids.organization, pending.period_id, ids.worker, ids.owner],
		);
		const open = await approvedWork(ids.worker, "2026-07-20");
		// Work whose end was never recorded, as a live clock-in leaves it.
		await admin.query(
			`update work_period set end_time = null, clock_out_id = null, duration_minutes = null,
			   is_active = true where id = $1`,
			[open.period_id],
		);
		await admin.query(
			"update time_record set end_at = null, duration_minutes = null where id = $1",
			[open.record_id],
		);
		// Approved work whose correction still awaits a decision.
		const corrected = await approvedWork(ids.worker, "2026-07-22", "08:00", "09:00");
		await admin.query(
			`insert into approval_request (organization_id, entity_type, entity_id, canonical_record_id,
			   requested_by, approver_id, status, updated_at)
			 values ($1, 'time_entry', $2, $3, $4, $5, 'pending', now())`,
			[ids.organization, corrected.period_id, corrected.record_id, ids.worker, ids.owner],
		);
		const before = await counts();

		const refused = await exportJuly();
		expect(refused).toEqual({
			success: false,
			error: "Export blocked: resolve the uncertain work in the selected scope first",
			code: "ConflictError",
		});
		expect(await counts()).toEqual(before);

		// The export service names the blockers; nothing is partially exported.
		const direct = createExportJob({
			organizationId: ids.organization,
			formatId: "datev_lohn",
			requestedById: ids.owner,
			filters: {
				dateRange: {
					start: DateTime.fromISO(july.startDate, { zone: "utc" }),
					end: DateTime.fromISO(july.endDate, { zone: "utc" }),
				},
			},
		});
		await expect(direct).rejects.toBeInstanceOf(PayrollWorkCollectionBlockedError);
		const blockers = await direct.catch(
			(error: InstanceType<typeof PayrollWorkCollectionBlockedError>) => error.blockers,
		);
		expect(
			(blockers as { kind: string; sourceId: string }[])
				.filter((blocker) => blocker.kind !== "uncertain_historical_work")
				.map((blocker) => [blocker.kind, blocker.sourceId]),
		).toEqual([
			["open_work", open.record_id],
			["pending_work_approval", pending.record_id],
			["pending_work_correction", corrected.record_id],
		]);
		expect(await counts()).toEqual(before);

		// The workspace is explicitly incomplete: approved work credited, uncertain work listed.
		const summary = await workspace();
		expect(summary.employees.find((row) => row.id === ids.worker)?.workedHours).toBe(4);
		expect(summary.blockers.map((blocker) => [blocker.type, blocker.id])).toEqual(
			expect.arrayContaining([
				["open_work", open.record_id],
				["pending_work_approval", pending.record_id],
				["pending_work_correction", corrected.record_id],
			]),
		);
		// The collection owns these: no dismissible duplicates of the same work.
		expect(
			summary.blockers.filter((blocker) =>
				["missing_clock_out", "pending_time_correction"].includes(blocker.type),
			),
		).toEqual([]);

		// Without the control the legacy read runs and silently drops both: the difference
		// this slice closes. Another organization's active control does not change that.
		await admin.query("delete from payroll_work_collection_control where organization_id = $1", [
			ids.organization,
		]);
		await activateCollection(ids.otherOrganization);
		const legacy = await exportJuly();
		expect(legacy).toMatchObject({ success: true });
		const legacyJobId = (legacy as { data: { jobId: string } }).data.jobId;
		expect(await storedInput(legacyJobId)).toBeUndefined();
		expect(approved.approval_state).toBe("approved");
	});

	it("widens organization-level uncertainty to the reader's scope without disclosing others", async () => {
		await approvedWork(ids.worker, "2026-07-10");
		await approvedWork(ids.peer, "2026-07-11");
		// Work recorded in this organization for an employee of another organization.
		const foreignRecordId = randomUUID();
		await admin.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
			 values ($1, $2, $3, 'work', '2026-07-12T08:00:00Z', '2026-07-12T09:00:00Z', 60,
			   'approved', 'manual', $4, $4, now())`,
			[foreignRecordId, ids.organization, ids.foreign, ids.foreignUser],
		);

		const clerkSummary = await workspace(ids.clerkUser);
		expect(clerkSummary.employees.map((row) => row.id)).toEqual([ids.worker]);
		expect(clerkSummary.blockers.map((blocker) => [blocker.type, blocker.employeeId])).toEqual([
			["uncertain_historical_work", ids.worker],
		]);
		const disclosed = JSON.stringify(clerkSummary);
		for (const hidden of [ids.peer, ids.foreign, foreignRecordId]) {
			expect(disclosed).not.toContain(hidden);
		}

		const clerkExport = await exportJuly(ids.clerkUser);
		expect(clerkExport).toMatchObject({ success: false, code: "ConflictError" });
		expect(JSON.stringify(clerkExport)).not.toContain(ids.peer);

		const ownerSummary = await workspace();
		expect(
			new Set(
				ownerSummary.blockers
					.filter((blocker) => blocker.type === "uncertain_historical_work")
					.map((blocker) => blocker.employeeId),
			),
		).toEqual(new Set([ids.owner, ids.clerk, ids.worker, ids.peer]));
	});

	it("repairs eligible historical gaps before the final snapshot, only when authorized", async () => {
		const work = await approvedWork(ids.worker, "2026-07-10");
		// A pre-adoption gap: the record carries the period's ID but was never linked.
		await admin.query("update work_period set canonical_record_id = null where id = $1", [
			work.period_id,
		]);
		await admin.query(
			`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
			   duration_minutes, approval_state, origin, created_at, created_by, updated_at, updated_by)
			 select $2, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes,
			   approval_state, origin, created_at, created_by, updated_at, updated_by
			 from time_record where id = $1`,
			[work.record_id, work.period_id],
		);
		await admin.query("update time_record_work set record_id = $2 where record_id = $1", [
			work.record_id,
			work.period_id,
		]);
		await admin.query("delete from time_record where id = $1", [work.record_id]);

		expect(await exportJuly()).toMatchObject({ success: false, code: "ConflictError" });
		const { rows: noReceipts } = await admin.query(
			"select count(*)::int as count from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		const receiptsBefore = noReceipts[0].count;

		await admin.query(
			"insert into historical_work_repair_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		// A payroll clerk is not an organization administrator: no repair runs for them.
		expect(await exportJuly(ids.clerkUser)).toMatchObject({
			success: false,
			code: "ConflictError",
		});
		const { rows: afterClerk } = await admin.query(
			"select count(*)::int as count from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		expect(afterClerk[0].count).toBe(receiptsBefore);

		const result = await exportJuly();
		expect(result).toMatchObject({ success: true });
		const { jobId } = (result as { data: { jobId: string } }).data;

		const { rows: receipts } = await admin.query(
			`select kind, writer, actor_user_id, result->>'reason' as reason, work_period_id
			 from completed_work_operation
			 where organization_id = $1 and kind = 'repair_historical_gap'`,
			[ids.organization],
		);
		expect(receipts).toEqual([
			{
				kind: "repair_historical_gap",
				writer: "historical_gap_repair",
				actor_user_id: ids.ownerUser,
				reason: PAYROLL_COLLECTION_REPAIR_REASON,
				work_period_id: work.period_id,
			},
		]);
		const { rows: linked } = await admin.query(
			"select canonical_record_id from work_period where id = $1",
			[work.period_id],
		);
		expect(linked[0].canonical_record_id).toBe(work.period_id);
		expect((await storedInput(jobId))?.input.work.map((line) => line.recordId)).toEqual([
			work.period_id,
		]);
		const { rows: after } = await admin.query(
			"select count(*)::int as count from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		expect(after[0].count).toBe(receiptsBefore + 1);
	});

	it("assesses and collects in one repeatable-read snapshot under a concurrent write", async () => {
		const work = await approvedWork(ids.worker, "2026-07-10");
		// Committed after the work rows were read, before the evidence is read. Seen by the
		// evidence read, it would report missing minutes against a collected 240.
		harness.beforeEvidenceRead = () => setStoredMinutes(work, null);

		const result = await exportJuly();
		expect(result).toMatchObject({ success: true });
		const { jobId } = (result as { data: { jobId: string } }).data;
		expect((await storedInput(jobId))?.input.work.map((line) => line.minutes)).toEqual([240]);

		// The concurrent write belongs to the next collection, which now blocks.
		const next = await readPayrollWorkCollection(db, ids.organization, {
			startDate: july.startDate,
			endDate: july.endDate,
			employeeIds: [ids.worker],
		});
		expect(new Set(next.blockers.map((blocker) => blocker.reason))).toEqual(
			new Set(["missing_stored_minutes", "duration_missing"]),
		);
	});

	it("recovers a failed queued delivery from the persisted input, not from changed work", async () => {
		vi.spyOn(DatevLohnFormatter.prototype, "getSyncThreshold").mockReturnValue(0);
		const work = await approvedWork(ids.worker, "2026-07-10");

		const queued = await exportJuly();
		expect(queued).toMatchObject({ success: true, data: { isAsync: true } });
		const { jobId } = (queued as { data: { jobId: string } }).data;
		expect(harness.queued).toEqual([
			[
				"process-payroll-export",
				{ jobId, organizationId: ids.organization, type: "payroll-export" },
				expect.objectContaining({ jobId: `payroll-export-${jobId}` }),
			],
		]);
		const stored = await storedInput(jobId);

		// Work changes after collection: minutes are corrected and new work is approved.
		await setStoredMinutes(work, 60);
		await approvedWork(ids.worker, "2026-07-12");

		// The worker's first delivery fails; its retry recovers.
		harness.failNextUpload = true;
		await expect(processExportJob({ jobId, organizationId: ids.organization })).rejects.toThrow(
			"Object store unavailable",
		);
		const { rows: failed } = await admin.query(
			"select status from payroll_export_job where id = $1",
			[jobId],
		);
		expect(failed[0].status).toBe("failed");

		const recovered = await processExportJob({ jobId, organizationId: ids.organization });
		expect(recovered.downloadUrl).toContain(jobId);
		const { rows: done } = await admin.query(
			"select status, work_period_count from payroll_export_job where id = $1",
			[jobId],
		);
		expect(done[0]).toEqual({ status: "completed", work_period_count: 1 });

		// Both attempts formatted the same collected input: one line of 4.00 hours.
		expect(harness.uploads).toHaveLength(2);
		expect(harness.uploads[1]?.equals(harness.uploads[0] as Buffer)).toBe(true);
		expect(harness.uploads[0]?.toString("utf-8")).toMatch(/4[,.]00/);
		expect(await storedInput(jobId)).toEqual(stored);

		// A fresh collection would read the changed work: a different input.
		const fresh = await readPayrollWorkCollection(db, ids.organization, {
			startDate: july.startDate,
			endDate: july.endDate,
			employeeIds: [ids.worker],
		});
		expect(fresh.input.digest).not.toBe(stored?.digest);

		// Linked cleanup: the input leaves with its job.
		await admin.query("delete from payroll_export_job where id = $1", [jobId]);
		expect(await storedInput(jobId)).toBeUndefined();
	});
});
