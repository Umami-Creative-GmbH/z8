/**
 * #301 / T37 runtime evidence: approval-based correction submission, decision
 * (including business deletion) and cancellation through the shared work
 * transaction and the completed-work receipts.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real server actions run against that database: `clockIn`/`clockOut` (adopted
 * work with a complete graph), `requestTimeCorrection` and `requestTimeEntryDeletion`
 * (submission), `approveApprovalInboxItem`/`rejectApprovalInboxItem` (decision),
 * `cancelMyTimeCorrectionRequest` (cancellation), `updateWorkPeriodTimes` (the #286
 * direct edit) and `clearOrganizationTimeData`. Only the request/session, billing,
 * notification delivery, the Next cache and the edit-policy capability are replaced.
 * Adoption is enabled per test organization by inserting its append control row
 * directly: production has no activation setter.
 */

import { createHash, randomUUID } from "node:crypto";
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
	isOrgAdmin: false,
}));

const notifications = vi.hoisted(() => ({
	onTimeCorrectionApproved: vi.fn(async (_params: { workPeriodId: string }) => undefined),
	onTimeCorrectionRejected: vi.fn(async (_params: { workPeriodId: string }) => undefined),
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
							user: {
								id: harness.userId,
								role: "user",
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => harness.isOrgAdmin,
	canApproveFor: async () => false,
	// React `cache` would pin the first actor for the whole test process.
	getAuthContext: async () => {
		if (!harness.userId || !harness.organizationId) return null;
		const { db } = await import("@/db");
		const { employee } = await import("@/db/schema");
		const { and, eq } = await import("drizzle-orm");
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
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return {
		...Object.fromEntries(
			Object.entries(original).map(([name, value]) => [
				name,
				typeof value === "function" ? async () => undefined : value,
			]),
		),
		onTimeCorrectionApproved: notifications.onTimeCorrectionApproved,
		onTimeCorrectionRejected: notifications.onTimeCorrectionRejected,
	};
});

vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	getEditCapabilityForPeriod: async () => ({ type: "approval_required" }),
}));

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

// The reviewed-import worker (#327 races) enqueues nothing outside the test.
vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportCommitJob: async () => {},
	enqueueImportScanJob: async () => {},
}));

const { clockIn, clockOut } = await import("./clocking");
const { processImportReviewJob } = await import("@/lib/import-review/worker");
const { requestTimeCorrection, requestTimeEntryDeletion } = await import("./corrections");
const { updateWorkPeriodTimes } = await import("./work-period-time-edit");
await import("@/lib/approvals/init");
const { approveApprovalInboxItem, rejectApprovalInboxItem } = await import(
	"@/lib/approvals/inbox/decision-service"
);
const { cancelMyTimeCorrectionRequest } = await import("../../my-requests/actions");
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
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
	describe.skip(`correction lifecycle PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t301-correction-org",
	requesterUser: "t301-requester-user",
	managerUser: "t301-manager-user",
	adminUser: "t301-admin-user",
	requester: "e3010000-0000-4000-8000-000000000001",
	manager: "e3010000-0000-4000-8000-000000000002",
	admin: "e3010000-0000-4000-8000-000000000003",
	managerLink: "e3010000-0000-4000-8000-000000000011",
} as const;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function at(value: string): Instant {
	return parseInstant(value);
}

describeIntegration("approval-based correction lifecycles on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string, roles: { isOrgAdmin?: boolean } = {}) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
		harness.isOrgAdmin = roles.isOrgAdmin ?? false;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function setCorrectionRollout(mode: "legacy" | "canonical") {
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'time_correction', $2, $3, now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = excluded.lifecycle_mode, side_effect_mode = excluded.side_effect_mode`,
			[ids.organization, mode, mode],
		);
	}

	/** Real clock-in and clock-out: a complete graph (with a receipt when adopted). */
	async function recordWork(start: Instant, end: Instant) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: start, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: end,
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string; clock_out_id: string }>(
			`select id, clock_in_id, clock_out_id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(start.epochMilliseconds)],
		);
		return only(rows);
	}

	function requestEdit(
		workPeriodId: string,
		values: { clockIn: string; clockOut: string; date?: string },
		submissionId: string = randomUUID(),
	) {
		actAs(ids.requesterUser);
		return requestTimeCorrection({
			workPeriodId,
			submissionId,
			newClockInDate: values.date ?? "2026-07-22",
			newClockInTime: values.clockIn,
			newClockOutDate: values.date ?? "2026-07-22",
			newClockOutTime: values.clockOut,
			reason: "Forgot to clock correctly",
			workLocationType: "office",
			workCategoryId: null,
		});
	}

	async function pendingApprovalId(workPeriodId: string) {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows).id;
	}

	function approve(approvalId: string) {
		actAs(ids.managerUser);
		return approveApprovalInboxItem({
			approvalId,
			actorEmployeeId: ids.manager,
			organizationId: ids.organization,
		});
	}

	function reject(approvalId: string) {
		actAs(ids.managerUser);
		return rejectApprovalInboxItem({
			approvalId,
			actorEmployeeId: ids.manager,
			organizationId: ids.organization,
			reason: "Not what happened",
		});
	}

	function cancel(workPeriodId: string) {
		actAs(ids.requesterUser);
		return cancelMyTimeCorrectionRequest(workPeriodId);
	}

	/** Every row a correction lifecycle can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from approval_workflow t where organization_id = $1) as workflows`,
			[ids.organization],
		);
		return only(rows);
	}

	async function period(periodId: string) {
		const { rows } = await admin.query<{
			start_time: Date;
			end_time: Date | null;
			duration_minutes: number | null;
			clock_in_id: string;
			clock_out_id: string | null;
			graph_revision: number;
			deleted_at: Date | null;
			record_start: Date;
			record_end: Date | null;
			record_duration: number | null;
		}>(
			`select wp.start_time, wp.end_time, wp.duration_minutes, wp.clock_in_id, wp.clock_out_id,
			        wp.graph_revision, wp.deleted_at,
			        tr.start_at as record_start, tr.end_at as record_end,
			        tr.duration_minutes as record_duration
			 from work_period wp
			 join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function corrections(periodId: string) {
		const { rows } = await admin.query<{
			id: string;
			replaces_entry_id: string;
			is_superseded: boolean;
			superseded_by_id: string | null;
			previous_entry_id: string | null;
			previous_hash: string | null;
		}>(
			`select e.id, e.replaces_entry_id, e.is_superseded, e.superseded_by_id,
			        e.previous_entry_id, e.previous_hash
			 from time_entry e
			 join work_period wp on e.replaces_entry_id in (
			   select id from time_entry where id in (wp.clock_in_id, wp.clock_out_id)
			   union select replaces_entry_id from time_entry where id in (wp.clock_in_id, wp.clock_out_id)
			 )
			 where wp.id = $1 and e.type = 'correction'
			 order by e.created_at`,
			[periodId],
		);
		return rows;
	}

	async function position() {
		const { rows } = await admin.query<{
			tip_entry_id: string;
			tip_hash: string;
			entry_count: number;
			last_operation: string;
		}>(
			`select tip_entry_id, tip_hash, entry_count, last_operation from time_entry_append_position
			 where organization_id = $1 and employee_id = $2`,
			[ids.organization, ids.requester],
		);
		return only(rows);
	}

	async function receipts(kind: string) {
		const { rows } = await admin.query<{
			id: string;
			kind: string;
			writer: string;
			actor_user_id: string;
			work_period_id: string;
			command: Record<string, unknown>;
			result: Record<string, unknown>;
		}>(
			`select id, kind, writer, actor_user_id, work_period_id, command, result
			 from completed_work_operation
			 where organization_id = $1 and kind = $2 order by created_at`,
			[ids.organization, kind],
		);
		return rows;
	}

	async function setEvidenceCapture(mode: "capture" | "inactive") {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'time_correction', $2)
			 on conflict (organization_id, workflow_type) do update set mode = excluded.mode`,
			[ids.organization, mode],
		);
	}

	async function revisions() {
		const { rows } = await admin.query<{
			id: string;
			authority: string;
			workflow_id: string | null;
			legacy_approval_request_id: string | null;
			request_cycle_key: string;
			submitter_user_id: string;
			material_fingerprint: string;
			facts: Record<string, unknown>;
			labels: Record<string, unknown>;
		}>(
			`select id, authority, workflow_id, legacy_approval_request_id, request_cycle_key,
			        submitter_user_id, material_fingerprint, facts, labels
			 from approval_submitted_revision
			 where organization_id = $1 and workflow_type = 'time_correction' order by created_at`,
			[ids.organization],
		);
		return rows;
	}

	async function decisions() {
		const { rows } = await admin.query<{
			submitted_revision_id: string;
			operation_kind: string;
			action: string;
			request_outcome: string;
			actor_user_id: string | null;
			stage_id: string | null;
			legacy_approval_request_id: string | null;
			result: Record<string, unknown>;
		}>(
			`select submitted_revision_id, operation_kind, action, request_outcome, actor_user_id,
			        stage_id, legacy_approval_request_id, result
			 from approval_decision_evidence
			 where organization_id = $1 order by created_at`,
			[ids.organization],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("drop function if exists t301_fail() cascade");
		await admin.query("drop function if exists t327_park() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.adminUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const users = [ids.requesterUser, ids.managerUser, ids.adminUser];
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T301 corrections', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'time_correction', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t301-member-requester', $1, $2, 'member', 'approved', $5),
			 ('t301-member-manager', $1, $3, 'member', 'approved', $5),
			 ('t301-member-admin', $1, $4, 'admin', 'approved', $5)`,
			[ids.organization, ids.requesterUser, ids.managerUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $8), ($3, $4, $7, 'manager', $8), ($5, $6, $7, 'admin', $8)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[ids.managerLink, ids.requester, ids.manager, ids.adminUser],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await setAdmission("active");
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const { rows } = await admin.query<{ current_database: string }>(
					"select current_database()",
				);
				return only(rows).current_database;
			},
		});
		if (!enabled) throw new Error("Disposable PostgreSQL test database is not verified");
	});

	beforeEach(async () => {
		notifications.onTimeCorrectionApproved.mockClear();
		notifications.onTimeCorrectionRejected.mockClear();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("appends a pending correction through the collaborator and approves it with fresh minutes", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:40Z"));
		const before = await period(work.id);
		const tipBefore = await position();

		const submitted = await requestEdit(work.id, { clockIn: "09:00", clockOut: "10:00" });
		expect(submitted).toMatchObject({ success: true, data: { status: "pending" } });

		// Submission: the pending entry follows the admitted tip; the revision advances.
		const [pending] = await corrections(work.id);
		expect(pending).toMatchObject({
			replaces_entry_id: work.clock_in_id,
			is_superseded: true,
			superseded_by_id: null,
			previous_entry_id: tipBefore.tip_entry_id,
			previous_hash: tipBefore.tip_hash,
		});
		expect(await position()).toMatchObject({
			tip_entry_id: pending?.id,
			entry_count: tipBefore.entry_count + 1,
			last_operation: "time_correction_submission",
		});
		expect((await period(work.id)).graph_revision).toBe(before.graph_revision + 1);
		const [submission] = await receipts("submit_time_correction");
		expect(submission).toMatchObject({
			writer: "time_correction_request",
			actor_user_id: ids.requesterUser,
			work_period_id: work.id,
			result: {
				intent: "edit",
				changeMask: { clockIn: true, clockOut: false, workLocation: false, workCategory: false },
				baseline: {
					clockInEntryId: work.clock_in_id,
					clockOutEntryId: work.clock_out_id,
					startAt: "2026-07-22T08:00:00Z",
					endAt: "2026-07-22T10:00:40Z",
					durationMinutes: 121,
					startUtcOffsetMinutes: 0,
				},
				requested: {
					clockIn: { originalEntryId: work.clock_in_id, at: "2026-07-22T09:00:00Z" },
					clockOut: null,
					workLocationType: "office",
					workCategoryId: null,
				},
				corrections: [
					{
						endpoint: "clock_in",
						entryId: pending?.id,
						meaning: "pending",
						previousEntryId: tipBefore.tip_entry_id,
					},
				],
				revisions: {
					workPeriod: { source: before.graph_revision, result: before.graph_revision + 1 },
				},
				approval: { lifecycle: { authority: "legacy" }, outcome: "pending" },
			},
		});

		// While the correction is unresolved, the direct edit (#286) is refused.
		actAs(ids.adminUser, { isOrgAdmin: true });
		const direct = await updateWorkPeriodTimes({
			workPeriodId: work.id,
			submissionId: randomUUID(),
			clockInDate: "2026-07-22",
			clockInTime: "07:00",
			clockOutDate: "2026-07-22",
			clockOutTime: "10:00",
			reason: "Direct",
		});
		expect(direct).toMatchObject({ success: false });

		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		// 09:00:00 → 10:00:40 is 60m40s: half up to 61 in both representations.
		const approved = await period(work.id);
		expect(approved).toMatchObject({
			clock_in_id: pending?.id,
			clock_out_id: work.clock_out_id,
			duration_minutes: 61,
			record_duration: 61,
			graph_revision: before.graph_revision + 2,
			deleted_at: null,
		});
		expect(approved.start_time.toISOString()).toBe("2026-07-22T09:00:00.000Z");
		expect(approved.record_start.toISOString()).toBe("2026-07-22T09:00:00.000Z");
		const [activated] = await corrections(work.id);
		expect(activated).toMatchObject({ is_superseded: false, superseded_by_id: null });
		const { rows: originals } = await admin.query(
			"select is_superseded, superseded_by_id from time_entry where id = $1",
			[work.clock_in_id],
		);
		expect(only(originals)).toEqual({ is_superseded: true, superseded_by_id: pending?.id });
		const { rows: balances } = await admin.query(
			`select is_dirty, dirty_from_date::text from employee_work_balance
			 where organization_id = $1 and employee_id = $2`,
			[ids.organization, ids.requester],
		);
		expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
		const [finalized] = await receipts("finalize_time_correction");
		expect(finalized).toMatchObject({
			writer: "time_correction_decision",
			actor_user_id: ids.managerUser,
			command: { transition: "approved" },
			result: {
				transition: "approved",
				intent: "edit",
				lifecycle: { authority: "legacy" },
				source: { startAt: "2026-07-22T08:00:00Z", durationMinutes: 121 },
				result: {
					kind: "amended",
					segment: {
						clockInEntryId: pending?.id,
						startAt: "2026-07-22T09:00:00Z",
						endAt: "2026-07-22T10:00:40Z",
						durationMinutes: 61,
					},
				},
				corrections: [{ endpoint: "clock_in", entryId: pending?.id, meaning: "active" }],
				revisions: {
					workPeriod: {
						source: before.graph_revision + 1,
						result: before.graph_revision + 2,
					},
				},
				followUps: [
					{
						kind: "work_balance_refresh",
						delivery: "committed_intent",
						dirtyFromDate: "2026-07-22",
					},
				],
			},
		});

		// The append position stays consistent: the next live work is admitted.
		await recordWork(at("2026-07-22T12:00:00Z"), at("2026-07-22T13:00:00Z"));
		expect(await position()).toMatchObject({ last_operation: "live_clock_out" });
	});

	it("replays an exact submission retry without writes and refuses a changed one", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		const submissionId = randomUUID();
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId),
		).resolves.toMatchObject({ success: true });
		const committed = await snapshot();

		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
		expect(await snapshot()).toEqual(committed);

		await expect(
			requestEdit(work.id, { clockIn: "08:45", clockOut: "10:00" }, submissionId),
		).resolves.toMatchObject({ success: false });
		expect(await snapshot()).toEqual(committed);
	});

	it("replays a submission retry after cancellation without recreating the work", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		const submissionId = randomUUID();
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId),
		).resolves.toMatchObject({ success: true });
		await expect(cancel(work.id)).resolves.toEqual({ success: true });
		const committed = await snapshot();

		await requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId);

		expect(await snapshot()).toEqual(committed);
	});

	for (const admission of ["active", "inactive"] as const) {
		it(`refuses a submission retry after privileged cleanup purged its lifecycle (${admission})`, async () => {
			const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
			await setAdmission(admission);
			const submissionId = randomUUID();
			await expect(
				requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId),
			).resolves.toMatchObject({ success: true });
			await deleteApproval(db, ids.organization, await pendingApprovalId(work.id));
			const purged = await snapshot();

			// The retained correction entries name a lifecycle that no longer exists: a
			// late retry must not route a new approval around them (#306).
			await expect(
				requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }, submissionId),
			).resolves.toMatchObject({ success: false });
			expect(await snapshot()).toEqual(purged);
		});
	}

	it("serializes a correction submission with a concurrent live clock-in", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		const before = await position();

		const [submitted, clocked] = await Promise.all([
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
			(async () => {
				actAs(ids.requesterUser);
				return clockIn("office", {
					instant: at("2026-07-22T12:00:00Z"),
					browserTimezone: "UTC",
				});
			})(),
		]);

		expect(submitted).toMatchObject({ success: true });
		expect(clocked).toMatchObject({ success: true });
		// Both appends were admitted in turn: one lineage, two entries past the tip.
		const after = await position();
		expect(after.entry_count).toBe(before.entry_count + 2);
		const { rows } = await admin.query<{ id: string; previous_entry_id: string | null }>(
			`select id, previous_entry_id from time_entry
			 where organization_id = $1 and employee_id = $2`,
			[ids.organization, ids.requester],
		);
		const predecessors = rows.map((row) => row.previous_entry_id).filter(Boolean);
		expect(new Set(predecessors).size).toBe(predecessors.length);
	});

	it("rejects with the entries retained inactive and a rejection receipt", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:00", clockOut: "11:00" }),
		).resolves.toMatchObject({ success: true });
		const submitted = await period(work.id);

		await expect(reject(await pendingApprovalId(work.id))).resolves.toBeDefined();

		const rejected = await period(work.id);
		expect(rejected).toMatchObject({
			clock_out_id: work.clock_out_id,
			duration_minutes: 120,
			graph_revision: submitted.graph_revision + 1,
		});
		const [retained] = await corrections(work.id);
		expect(retained).toMatchObject({ is_superseded: true, superseded_by_id: null });
		const [finalized] = await receipts("finalize_time_correction");
		expect(finalized?.result).toMatchObject({
			transition: "rejected",
			result: { kind: "unchanged" },
			corrections: [{ endpoint: "clock_out", entryId: retained?.id, meaning: "rejected_inactive" }],
		});
		// The after-commit dispatch notified the requester.
		expect(notifications.onTimeCorrectionApproved).not.toHaveBeenCalled();
		expect(notifications.onTimeCorrectionRejected).toHaveBeenCalledTimes(1);
		expect(notifications.onTimeCorrectionRejected).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: work.id,
				employeeUserId: ids.requesterUser,
				organizationId: ids.organization,
			}),
		);
	});

	// #461: the after-commit dispatch parsed the whole legacy request metadata as the
	// strict correction payload and threw on the submission evidence beside it, which
	// skipped the requester's notification and the work-balance dirty mark. Without
	// adoption the dirty mark only happens after commit, so it is observable here.
	it("runs a legacy decision's after-commit work despite the submission metadata", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await setAdmission("inactive");
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const approvalId = await pendingApprovalId(work.id);
		const { rows: requests } = await admin.query<{ metadata: Record<string, unknown> }>(
			"select metadata from approval_request where organization_id = $1 and id = $2",
			[ids.organization, approvalId],
		);
		expect(Object.keys(only(requests).metadata)).toEqual(
			expect.arrayContaining([
				"timeCorrection",
				"submission",
				"timeCorrectionOriginalWorkMetadata",
			]),
		);
		await admin.query(
			"delete from employee_work_balance where organization_id = $1 and employee_id = $2",
			[ids.organization, ids.requester],
		);

		await expect(approve(approvalId)).resolves.toBeDefined();

		const { rows: balances } = await admin.query(
			`select is_dirty, dirty_from_date::text from employee_work_balance
			 where organization_id = $1 and employee_id = $2`,
			[ids.organization, ids.requester],
		);
		expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });
		expect(notifications.onTimeCorrectionRejected).not.toHaveBeenCalled();
		expect(notifications.onTimeCorrectionApproved).toHaveBeenCalledTimes(1);
		expect(notifications.onTimeCorrectionApproved).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: work.id,
				employeeUserId: ids.requesterUser,
				organizationId: ids.organization,
				originalTime: new Date("2026-07-22T08:00:00Z"),
				correctedTime: new Date("2026-07-22T08:30:00Z"),
			}),
		);
	});

	it("cancels by retaining the committed entries, replays, and keeps appending", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "07:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const submitted = await period(work.id);
		const tip = await position();

		await expect(cancel(work.id)).resolves.toEqual({ success: true });

		const [retained] = await corrections(work.id);
		expect(retained).toMatchObject({
			id: tip.tip_entry_id,
			is_superseded: true,
			superseded_by_id: null,
		});
		expect(await position()).toEqual(tip);
		const cancelled = await period(work.id);
		expect(cancelled).toMatchObject({
			clock_in_id: work.clock_in_id,
			duration_minutes: 120,
			graph_revision: submitted.graph_revision + 1,
		});
		const [cancellation] = await receipts("cancel_time_correction");
		expect(cancellation).toMatchObject({
			writer: "time_correction_cancellation",
			actor_user_id: ids.requesterUser,
			result: {
				lifecycle: { authority: "legacy" },
				retained: [{ endpoint: "clock_in", entryId: retained?.id, meaning: "cancelled_inactive" }],
				revisions: {
					workPeriod: { source: submitted.graph_revision, result: submitted.graph_revision + 1 },
				},
			},
		});

		// Replay: no writes, no recreated or removed entry.
		const committed = await snapshot();
		await expect(cancel(work.id)).resolves.toEqual({ success: true });
		expect(await snapshot()).toEqual(committed);

		// The retained entry stays a legitimate append predecessor.
		await recordWork(at("2026-07-22T12:00:00Z"), at("2026-07-22T13:00:00Z"));
		const { rows } = await admin.query<{ previous_entry_id: string }>(
			`select previous_entry_id from time_entry
			 where organization_id = $1 and employee_id = $2 and type = 'clock_in'
			   and timestamp = $3`,
			[ids.organization, ids.requester, new Date("2026-07-22T12:00:00Z")],
		);
		expect(only(rows).previous_entry_id).toBe(retained?.id);
	});

	it("approves a business deletion as a soft-deleted period with a zero-length sentinel", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		actAs(ids.requesterUser);
		await expect(
			requestTimeEntryDeletion({
				workPeriodId: work.id,
				submissionId: randomUUID(),
				reason: "Recorded by mistake",
			}),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
		const submitted = await period(work.id);
		const [submission] = await receipts("submit_time_correction");
		expect(submission?.result).toMatchObject({
			intent: "delete",
			changeMask: { clockIn: true, clockOut: true },
		});

		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		const deleted = await period(work.id);
		expect(deleted.deleted_at).not.toBeNull();
		expect(deleted.graph_revision).toBe(submitted.graph_revision + 1);
		expect(deleted.duration_minutes).toBe(0);
		expect(deleted.record_duration).toBe(0);
		expect(deleted.record_start.toISOString()).toBe(deleted.record_end?.toISOString());
		const sentinels = await corrections(work.id);
		expect(sentinels).toHaveLength(2);
		for (const sentinel of sentinels) expect(sentinel.is_superseded).toBe(false);
		const [finalized] = await receipts("finalize_time_correction");
		expect(finalized?.result).toMatchObject({
			transition: "approved",
			intent: "delete",
			result: { kind: "deleted", sentinel: { durationMinutes: 0 } },
		});

		// Deleted work no longer occupies its interval.
		await recordWork(at("2026-07-22T08:30:00Z"), at("2026-07-22T09:30:00Z"));
	});

	it("refuses an approval whose interval became occupied, changing nothing", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:00", clockOut: "10:30" }),
		).resolves.toMatchObject({ success: true });
		await recordWork(at("2026-07-22T10:15:00Z"), at("2026-07-22T10:45:00Z"));
		const approvalId = await pendingApprovalId(work.id);
		const committed = await snapshot();

		await expect(approve(approvalId)).rejects.toMatchObject({
			conflictType: "work_interval_occupied",
		});
		expect(await snapshot()).toEqual(committed);
	});

	// #327: a reviewed import and a correction submission of the same employee race
	// in both arrival orders. The first writer parks at its first entry insert while it
	// holds the employee key; the second waits on that key and sees the committed work.
	describe("reviewed import and correction arrival order (#327)", () => {
		async function importBatch(startsAt: string, endsAt: string) {
			const batchId = randomUUID();
			const jobId = randomUUID();
			await admin.query(
				`insert into import_batch
				 (id, organization_id, provider, status, selected_scope, date_range, started_by, committed_by, created_at, updated_at)
				 values ($1, $2, 'clockodo', 'committing', '{}', '{"startDate":"2021-01-01","endDate":"2026-12-31"}', $3, $3, now(), now())`,
				[batchId, ids.organization, ids.adminUser],
			);
			await admin.query(
				`insert into import_batch_job
				 (id, batch_id, organization_id, kind, status, entity_type, partition_key, created_at, updated_at)
				 values ($1, $2, $3, 'commit', 'queued', 'work_period', 'work_period', now(), now())`,
				[jobId, batchId, ids.organization],
			);
			const rowId = randomUUID();
			const sourcePayload = { id: `t327:${rowId}` };
			await admin.query(
				`insert into import_staged_row
				 (id, batch_id, organization_id, entity_type, provider_source_id, source_payload_hash,
				  source_payload, normalized_payload, row_status, issue_severity, created_at, updated_at)
				 values ($1, $2, $3, 'work_period', $4, $5, $6, $7, 'accepted', 'none', now(), now())`,
				[
					rowId,
					batchId,
					ids.organization,
					sourcePayload.id,
					createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
					sourcePayload,
					{ employeeId: ids.requester, startsAt, endsAt },
				],
			);
			return {
				rowId,
				/** The real worker, as the job's final BullMQ attempt. */
				commit: () =>
					processImportReviewJob({
						data: {
							type: "import-review-commit" as const,
							batchId,
							jobId,
							organizationId: ids.organization,
							entityType: "work_period" as const,
							committedBy: ids.adminUser,
						},
						opts: { attempts: 3 },
						attemptsMade: 2,
					} as never),
			};
		}

		async function stagedRow(rowId: string) {
			const { rows } = await admin.query<{
				row_status: string;
				commit_hold: Record<string, unknown> | null;
				commit_target_id: string | null;
			}>("select row_status, commit_hold, commit_target_id from import_staged_row where id = $1", [
				rowId,
			]);
			return only(rows);
		}

		async function parkNextEntryInsert() {
			await admin.query(`create function t327_park() returns trigger language plpgsql as $$
				begin perform pg_advisory_xact_lock(hashtextextended('t327-park', 0)); return new; end $$`);
			await admin.query(
				"create trigger t327_park before insert on time_entry for each row execute function t327_park()",
			);
			const client = await admin.connect();
			await client.query("begin");
			await client.query("select pg_advisory_xact_lock(hashtextextended('t327-park', 0))");
			return {
				async release() {
					await client.query("commit");
					client.release();
				},
			};
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

		/** Undeleted work of the employee that overlaps other undeleted work. */
		async function overlaps() {
			const { rows } = await admin.query(
				`select a.id from work_period a join work_period b
				   on a.employee_id = b.employee_id and a.id < b.id
				  and a.deleted_at is null and b.deleted_at is null
				  and a.start_time < coalesce(b.end_time, 'infinity')
				  and b.start_time < coalesce(a.end_time, 'infinity')
				 where a.employee_id = $1`,
				[ids.requester],
			);
			return rows;
		}

		it("imports around a correction that committed first, whose approval is then refused", async () => {
			const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
			const batch = await importBatch("2026-07-22T10:30:00Z", "2026-07-22T11:30:00Z");
			const park = await parkNextEntryInsert();
			const correction = requestEdit(work.id, { clockIn: "08:00", clockOut: "11:00" });
			await waitForAdvisoryWaiters(1);
			const imported = batch.commit();
			await waitForAdvisoryWaiters(2);
			await park.release();

			await expect(correction).resolves.toMatchObject({ success: true });
			await imported;
			// The pending correction does not occupy its requested interval; committed work does.
			expect(await stagedRow(batch.rowId)).toMatchObject({ row_status: "committed" });
			const committed = await snapshot();

			await expect(approve(await pendingApprovalId(work.id))).rejects.toMatchObject({
				conflictType: "work_interval_occupied",
			});
			expect(await snapshot()).toEqual(committed);
			expect(await overlaps()).toEqual([]);
		});

		it("refuses a correction submission that arrives while an import commits into its interval", async () => {
			const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
			const batch = await importBatch("2026-07-22T10:30:00Z", "2026-07-22T11:30:00Z");
			const park = await parkNextEntryInsert();
			const imported = batch.commit();
			await waitForAdvisoryWaiters(1);
			const correction = requestEdit(work.id, { clockIn: "08:00", clockOut: "11:00" });
			await waitForAdvisoryWaiters(2);
			await park.release();

			await imported;
			expect(await stagedRow(batch.rowId)).toMatchObject({ row_status: "committed" });
			await expect(correction).resolves.toMatchObject({
				success: false,
				error: "The time range overlaps other recorded work",
			});
			expect(await corrections(work.id)).toEqual([]);
			expect(await overlaps()).toEqual([]);
		});

		it("holds an import over the interval a correction already moved work into", async () => {
			const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
			await expect(
				requestEdit(work.id, { clockIn: "08:00", clockOut: "11:00" }),
			).resolves.toMatchObject({ success: true });
			await approve(await pendingApprovalId(work.id));
			const batch = await importBatch("2026-07-22T10:30:00Z", "2026-07-22T11:30:00Z");

			// The final attempt reports the held row instead of retrying it.
			await expect(batch.commit()).rejects.toThrow("Held for review: occupancy_conflict");

			expect(await stagedRow(batch.rowId)).toMatchObject({
				commit_hold: {
					reason: "occupancy_conflict",
					occupants: [{ kind: "work_period", id: work.id }],
				},
			});
			expect(await overlaps()).toEqual([]);
		});
	});

	it("refuses an overlapping correction at submission, changing nothing", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await recordWork(at("2026-07-22T10:15:00Z"), at("2026-07-22T10:45:00Z"));
		const committed = await snapshot();

		await expect(
			requestEdit(work.id, { clockIn: "08:00", clockOut: "10:30" }),
		).resolves.toMatchObject({
			success: false,
			error: "The time range overlaps other recorded work",
		});
		expect(await snapshot()).toEqual(committed);
	});

	it("refuses to finalize over a changed or deleted source, changing nothing", async () => {
		const changed = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(changed.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		await admin.query("update work_period set duration_minutes = 119 where id = $1", [changed.id]);
		let committed = await snapshot();
		await expect(approve(await pendingApprovalId(changed.id))).rejects.toBeDefined();
		expect(await snapshot()).toEqual(committed);

		const removed = await recordWork(at("2026-07-22T12:00:00Z"), at("2026-07-22T13:00:00Z"));
		await expect(
			requestEdit(removed.id, { clockIn: "12:30", clockOut: "13:00" }),
		).resolves.toMatchObject({ success: true });
		await admin.query("update work_period set deleted_at = now() where id = $1", [removed.id]);
		committed = await snapshot();
		await expect(approve(await pendingApprovalId(removed.id))).rejects.toBeDefined();
		expect(await snapshot()).toEqual(committed);
	});

	it.each([
		["submission", "submit_time_correction"],
		["approval", "finalize_time_correction"],
		["cancellation", "cancel_time_correction"],
	] as const)("rolls the whole %s back when its receipt cannot be written", async (stage, kind) => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		if (stage !== "submission") {
			await expect(
				requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
			).resolves.toMatchObject({ success: true });
		}
		const approvalId = stage === "approval" ? await pendingApprovalId(work.id) : null;
		await admin.query(`create or replace function t301_fail() returns trigger language plpgsql as $$
			begin
				if new.kind = '${kind}' then raise exception 't301 injected receipt failure'; end if;
				return new;
			end $$`);
		await admin.query(
			`create trigger t301_fail before insert on completed_work_operation
			 for each row execute function t301_fail()`,
		);
		const committed = await snapshot();

		if (stage === "submission") {
			await expect(
				requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
			).resolves.toMatchObject({ success: false });
		} else if (stage === "approval" && approvalId) {
			await expect(approve(approvalId)).rejects.toBeDefined();
		} else {
			await expect(cancel(work.id)).resolves.toMatchObject({ success: false });
		}
		expect(await snapshot()).toEqual(committed);
		await admin.query("drop function if exists t301_fail() cascade");
	});

	it("lets exactly one of a concurrent approval and cancellation commit", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const approvalId = await pendingApprovalId(work.id);

		// The two actions share one harness session; run them with their own actors.
		actAs(ids.managerUser);
		const approval = approveApprovalInboxItem({
			approvalId,
			actorEmployeeId: ids.manager,
			organizationId: ids.organization,
		}).then(
			() => "approved" as const,
			() => "refused" as const,
		);
		const cancellation = (async () => {
			const { cancelPendingTimeCorrection } = await import(
				"@/lib/approvals/server/time-correction-cancellation"
			);
			return cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.requester,
				requesterUserId: ids.requesterUser,
				workPeriodId: work.id,
			}).then(
				() => "cancelled" as const,
				() => "refused" as const,
			);
		})();
		const outcomes = await Promise.all([approval, cancellation]);

		expect(outcomes.filter((outcome) => outcome !== "refused")).toHaveLength(1);
		const finalized = await receipts("finalize_time_correction");
		const cancelled = await receipts("cancel_time_correction");
		expect(finalized.length + cancelled.length).toBe(1);
		const { rows } = await admin.query<{ status: string }>(
			"select status from approval_request where organization_id = $1 and entity_id = $2",
			[ids.organization, work.id],
		);
		expect(rows.every(({ status }) => status !== "pending")).toBe(true);
	});

	it("runs the canonical engine path inside the coordinated transaction", async () => {
		await setCorrectionRollout("canonical");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
		const [submission] = await receipts("submit_time_correction");
		expect(submission?.result).toMatchObject({
			approval: { lifecycle: { authority: "canonical" } },
		});

		const { workflowId } = (
			submission?.result.approval as { lifecycle: { workflowId: string } } | undefined
		)?.lifecycle ?? { workflowId: "missing" };

		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		const [finalized] = await receipts("finalize_time_correction");
		expect(finalized?.result).toMatchObject({
			transition: "approved",
			lifecycle: { authority: "canonical", workflowId },
			result: { kind: "amended", segment: { durationMinutes: 90 } },
		});
	});

	it("keeps legacy writes for organizations that have not adopted", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await setAdmission("inactive");
		const { graph_revision: revision } = await period(work.id);
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const [pending] = await corrections(work.id);
		expect(pending).toBeDefined();
		expect((await period(work.id)).graph_revision).toBe(revision);

		await expect(cancel(work.id)).resolves.toEqual({ success: true });

		// Legacy cancellation still deletes the pending rows; nothing is receipted.
		expect(await corrections(work.id)).toHaveLength(0);
		expect((await period(work.id)).graph_revision).toBe(revision);
		const { rows } = await admin.query(
			`select kind from completed_work_operation
			 where organization_id = $1 and kind like '%time_correction'`,
			[ids.organization],
		);
		expect(rows).toHaveLength(0);
	});

	it("captures no correction evidence while capture is inactive", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		expect(await revisions()).toHaveLength(0);
		expect(await decisions()).toHaveLength(0);
	});

	it("captures the submitted baseline and records the decision with its resulting graph", async () => {
		await setEvidenceCapture("capture");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:40Z"));
		await expect(
			requestEdit(work.id, { clockIn: "09:00", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const [pending] = await corrections(work.id);
		const approvalId = await pendingApprovalId(work.id);

		const [revision] = await revisions();
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: approvalId,
			submitter_user_id: ids.requesterUser,
			labels: { subjectName: ids.requesterUser, submitterName: ids.requesterUser },
			facts: {
				kind: "time_correction",
				intent: "edit",
				canonicalRecordId: expect.any(String),
				baseline: {
					clockIn: { entryId: work.clock_in_id, at: "2026-07-22T08:00:00Z", utcOffsetMinutes: 0 },
					clockOut: { entryId: work.clock_out_id, at: "2026-07-22T10:00:40Z" },
					storedDurationMinutes: 121,
					elapsedSeconds: 7240,
				},
				requested: {
					clockIn: {
						originalEntryId: work.clock_in_id,
						correctionEntryId: pending?.id,
						at: "2026-07-22T09:00:00Z",
					},
					clockOut: null,
					workLocationType: { kind: "set", value: "office" },
					workCategoryId: { kind: "set", value: null },
				},
				changeMask: { clockIn: true, clockOut: false, workLocation: false, workCategory: false },
			},
		});
		expect(revision?.material_fingerprint).toMatch(/^time_correction:v1:/);
		expect(JSON.stringify(revision)).not.toContain("Forgot to clock correctly");

		await expect(approve(approvalId)).resolves.toBeDefined();

		const [decision] = await decisions();
		expect(decision).toMatchObject({
			submitted_revision_id: revision?.id,
			operation_kind: "command",
			action: "approve",
			request_outcome: "approved",
			actor_user_id: ids.managerUser,
			legacy_approval_request_id: approvalId,
			result: {
				legacyRequestStatus: "approved",
				decidedAtSource: "approval_request.approved_at",
				actorAuthority: "assigned_approver",
				terminal: {
					transition: "approved",
					kind: "amended",
					segment: {
						clockIn: { entryId: pending?.id, at: "2026-07-22T09:00:00Z" },
						storedDurationMinutes: 61,
						elapsedSeconds: 3640,
					},
				},
			},
		});
	});

	it("records a business deletion decision with the canonical sentinel", async () => {
		await setEvidenceCapture("capture");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		actAs(ids.requesterUser);
		await expect(
			requestTimeEntryDeletion({
				workPeriodId: work.id,
				submissionId: randomUUID(),
				reason: "Recorded by mistake",
			}),
		).resolves.toMatchObject({ success: true });
		expect((await revisions())[0]?.facts).toMatchObject({
			intent: "delete",
			changeMask: { clockIn: true, clockOut: true },
		});

		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		expect((await decisions())[0]?.result).toMatchObject({
			terminal: { kind: "deleted", sentinel: { durationMinutes: 0 } },
		});
	});

	it("holds a decision whose submitted baseline changed, changing nothing", async () => {
		await setEvidenceCapture("capture");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const approvalId = await pendingApprovalId(work.id);
		await admin.query("update work_period set work_location_type = 'home' where id = $1", [
			work.id,
		]);
		const committed = await snapshot();

		await expect(approve(approvalId)).rejects.toMatchObject({
			conflictType: "approval_evidence",
			details: { code: "material_change" },
		});
		expect(await snapshot()).toEqual(committed);
		expect(await decisions()).toHaveLength(0);
	});

	it("holds a lifecycle submitted before capture was enabled", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		await setEvidenceCapture("capture");
		const approvalId = await pendingApprovalId(work.id);
		const committed = await snapshot();

		await expect(approve(approvalId)).rejects.toMatchObject({
			conflictType: "approval_evidence",
			details: { code: "evidence_required" },
		});
		expect(await snapshot()).toEqual(committed);
	});

	it("captures and decides a canonical lifecycle through the engine hooks", async () => {
		await setCorrectionRollout("canonical");
		await setEvidenceCapture("capture");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		const [revision] = await revisions();
		expect(revision).toMatchObject({
			authority: "canonical",
			workflow_id: expect.any(String),
			legacy_approval_request_id: null,
		});

		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();

		const [decision] = await decisions();
		expect(decision).toMatchObject({
			submitted_revision_id: revision?.id,
			operation_kind: "command",
			action: "approve",
			request_outcome: "approved",
			actor_user_id: ids.managerUser,
			stage_id: expect.any(String),
			result: { terminal: { kind: "amended", segment: { storedDurationMinutes: 90 } } },
		});
	});

	it("removes correction evidence with the organization's time data", async () => {
		await setEvidenceCapture("capture");
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		await expect(approve(await pendingApprovalId(work.id))).resolves.toBeDefined();
		expect(await revisions()).toHaveLength(1);
		expect(await decisions()).toHaveLength(1);

		await clearOrganizationTimeData(ids.organization);

		expect(await revisions()).toHaveLength(0);
		expect(await decisions()).toHaveLength(0);
	});

	it("removes correction lifecycle receipts with the organization's time data", async () => {
		const work = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));
		await expect(
			requestEdit(work.id, { clockIn: "08:30", clockOut: "10:00" }),
		).resolves.toMatchObject({ success: true });
		await expect(cancel(work.id)).resolves.toEqual({ success: true });
		expect(await receipts("cancel_time_correction")).toHaveLength(1);

		await clearOrganizationTimeData(ids.organization);

		const { rows } = await admin.query(
			"select id from completed_work_operation where organization_id = $1",
			[ids.organization],
		);
		expect(rows).toHaveLength(0);
	});
});
