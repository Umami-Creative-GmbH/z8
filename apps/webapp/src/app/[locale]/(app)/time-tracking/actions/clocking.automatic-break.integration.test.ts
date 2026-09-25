/**
 * #305 / T41 runtime evidence: ordinary automatic break adjustment through the
 * completed-work operation, its durable intent, deferral under unresolved review and
 * recovery across dates, process loss and duplicate workers.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real server actions and job run against that database: `clockIn`/`clockOut`
 * (the closure and its immediate adjustment), `requestTimeCorrection`,
 * `requestTimeEntryDeletion`, `cancelMyTimeCorrectionRequest`, the inbox
 * `approveApprovalInboxItem`/`rejectApprovalInboxItem` (the blockers) and
 * `runBreakEnforcementCheck` (the `cron:break-enforcement` processor). Only the
 * request/session, billing, notification delivery, the Next cache and the edit-policy
 * capability are replaced. Adoption is enabled per test organization by inserting its
 * append control row directly: production has no activation setter.
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
	forceClockOutApproval: false,
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
	// A terminated backend (the process-loss scenario) must not crash the test process.
	pool.on("error", () => {});
	pool.on("connect", (client) => client.on("error", () => {}));
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
	isOrgAdminCasl: async () => false,
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
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendClockOutApprovalNotifications: async () => undefined,
	sendClockOutApprovedNotification: async () => undefined,
}));

vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	checkClockOutNeedsApproval: async () => harness.forceClockOutApproval,
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

const { clockIn, clockOut } = await import("./clocking");
const { requestTimeCorrection, requestTimeEntryDeletion } = await import("./corrections");
await import("@/lib/approvals/init");
const { approveApprovalInboxItem, rejectApprovalInboxItem } = await import(
	"@/lib/approvals/inbox/decision-service"
);
const { cancelMyTimeCorrectionRequest } = await import("../../my-requests/actions");
const { runBreakEnforcementCheck } = await import(
	"@/lib/effect/services/break-enforcement.service"
);
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");
const { deriveAutomaticBreakIntentId, deriveAutomaticBreakOperationId } = await import(
	"@/lib/time-tracking/automatic-break-adjustment"
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
	describe.skip(`automatic break adjustment PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t305-auto-break-org",
	requesterUser: "t305-requester-user",
	managerUser: "t305-manager-user",
	requester: "f3050000-0000-4000-8000-000000000001",
	manager: "f3050000-0000-4000-8000-000000000002",
	managerLink: "f3051000-0000-4000-8000-000000000001",
	policy: "f3052000-0000-4000-8000-000000000001",
	regulation: "f3052000-0000-4000-8000-000000000002",
	breakRule: "f3052000-0000-4000-8000-000000000003",
	policyAssignment: "f3052000-0000-4000-8000-000000000004",
} as const;
// 6h 59m 51s without a break (420 stored minutes): the policy owes 30 minutes after 6h.
const clockInAt = parseInstant("2026-07-22T08:00:40Z");
const clockOutAt = parseInstant("2026-07-22T15:00:31Z");
// The work's date is long past: only the committed intent can recover it.
const laterRunDate = new Date("2026-09-30T12:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type PeriodRow = {
	id: string;
	clock_in_id: string;
	clock_out_id: string;
	canonical_record_id: string | null;
	approval_status: string;
	start_time: Date;
	end_time: Date;
	duration_minutes: number;
	was_auto_adjusted: boolean;
	original_end_time: Date | null;
	original_duration_minutes: number | null;
	graph_revision: number;
	deleted_at: Date | null;
};

type IntentRow = {
	id: string;
	work_period_id: string;
	closure_entry_id: string | null;
	triggered_by_user_id: string | null;
	status: string;
	blocker: string | null;
	observed_graph_revision: number | null;
	deferred_at: Date | null;
	attempts: number;
	last_error: string | null;
};

describeIntegration("automatic break adjustment on PostgreSQL", () => {
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

	async function recordWork(end: Instant = clockOutAt, submissionId: string = randomUUID()) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: clockInAt, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const result = await clockOut(undefined, undefined, {
			submissionId,
			instant: end,
			browserTimezone: "UTC",
		});
		expect(result).toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			"select id, clock_in_id from work_period where employee_id = $1 and start_time = $2",
			[ids.requester, new Date(clockInAt.epochMilliseconds)],
		);
		return { ...only(rows), submissionId, result };
	}

	/** Fails the adjustment's own receipt, so the closure commits and the intent stays. */
	async function failAdjustments() {
		await admin.query(
			`create or replace function t305_fail_receipt() returns trigger language plpgsql as $$
			 begin
			   if NEW.kind = 'automatic_break_adjustment' then
			     raise exception 't305 injected adjustment failure';
			   end if;
			   return NEW;
			 end $$`,
		);
		await admin.query(
			"create trigger t305_fail_receipt before insert on completed_work_operation for each row execute function t305_fail_receipt()",
		);
	}

	async function allowAdjustments() {
		await admin.query("drop function if exists t305_fail_receipt() cascade");
	}

	/** Committed ordinary work whose immediate adjustment was lost. */
	async function workWithLostAdjustment(end: Instant = clockOutAt) {
		await failAdjustments();
		const work = await recordWork(end);
		await allowAdjustments();
		return work;
	}

	function recover(date?: Date) {
		return runBreakEnforcementCheck({ organizationId: ids.organization, date });
	}

	async function periods(): Promise<PeriodRow[]> {
		const { rows } = await admin.query<PeriodRow>(
			`select id, clock_in_id, clock_out_id, canonical_record_id, approval_status, start_time,
			        end_time, duration_minutes, was_auto_adjusted, original_end_time,
			        original_duration_minutes, graph_revision, deleted_at
			 from work_period where organization_id = $1 order by start_time, id`,
			[ids.organization],
		);
		return rows;
	}

	async function intents(): Promise<IntentRow[]> {
		const { rows } = await admin.query<IntentRow>(
			`select id, work_period_id, closure_entry_id, triggered_by_user_id, status, blocker,
			        observed_graph_revision, deferred_at, attempts, last_error
			 from work_break_adjustment_intent where organization_id = $1`,
			[ids.organization],
		);
		return rows;
	}

	async function receipts(kind = "automatic_break_adjustment") {
		const { rows } = await admin.query<{
			id: string;
			kind: string;
			writer: string;
			actor_kind: string;
			actor_user_id: string | null;
			append_admission: string;
			work_period_id: string;
			command: Record<string, unknown>;
			result: Record<string, unknown>;
		}>(
			"select * from completed_work_operation where organization_id = $1 and kind = $2 order by created_at",
			[ids.organization, kind],
		);
		return rows;
	}

	/** Every row an adjustment can write, to prove "no writes" by equality. */
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
			   (select json_agg(row_to_json(t) order by t.id) from work_break_adjustment_intent t where organization_id = $1) as intents`,
			[ids.organization],
		);
		return only(rows);
	}

	function requestEdit(workPeriodId: string, values: { clockIn: string; clockOut: string }) {
		actAs(ids.requesterUser);
		return requestTimeCorrection({
			workPeriodId,
			submissionId: randomUUID(),
			newClockInDate: "2026-07-22",
			newClockInTime: values.clockIn,
			newClockOutDate: "2026-07-22",
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

	async function cleanup() {
		await allowAdjustments();
		await admin.query("drop function if exists t305_fail() cascade");
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
			"insert into organization (id, name, slug, created_at) values ($1, 'T305 breaks', $1, $2)",
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
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't305-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T305 break', false, true, true, $3, $4)`,
			[ids.policy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into work_policy_regulation (id, policy_id, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, 360, $3)`,
			[ids.regulation, ids.policy, timestamp],
		);
		await admin.query(
			`insert into work_policy_break_rule
			 (id, regulation_id, working_minutes_threshold, required_break_minutes, updated_at)
			 values ($1, $2, 360, 30, $3)`,
			[ids.breakRule, ids.regulation, timestamp],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (id, policy_id, organization_id, assignment_type, employee_id, priority, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'employee', $4, 2, true, $5, $6)`,
			[
				ids.policyAssignment,
				ids.policy,
				ids.organization,
				ids.requester,
				ids.managerUser,
				timestamp,
			],
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
		if (enabled.status !== "enabled") {
			throw new Error("Automatic break adjustment PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.forceClockOutApproval = false;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	/** The adjusted graph of the standard work, checked in both representations. */
	async function expectStandardAdjustment(periodId: string) {
		const [retained, generated] = await periods();
		expect(await periods()).toHaveLength(2);
		if (!retained || !generated) throw new Error("the work was not adjusted");
		expect(retained).toMatchObject({
			id: periodId,
			start_time: new Date("2026-07-22T08:00:40Z"),
			end_time: new Date("2026-07-22T14:00:40Z"),
			duration_minutes: 360,
			was_auto_adjusted: true,
			original_end_time: new Date("2026-07-22T15:00:31Z"),
			original_duration_minutes: 420,
		});
		// 14:30:40 to 15:00:31 is 29m51s: rounded half up on its own.
		expect(generated).toMatchObject({
			start_time: new Date("2026-07-22T14:30:40Z"),
			end_time: new Date("2026-07-22T15:00:31Z"),
			duration_minutes: 30,
			approval_status: "approved",
			was_auto_adjusted: true,
			graph_revision: 1,
		});
		const { rows: records } = await admin.query<{
			id: string;
			start_at: Date;
			end_at: Date;
			duration_minutes: number;
			approval_state: string;
		}>(
			`select id, start_at, end_at, duration_minutes, approval_state from time_record
			 where organization_id = $1 order by start_at`,
			[ids.organization],
		);
		expect(records).toEqual([
			{
				id: retained.canonical_record_id,
				start_at: retained.start_time,
				end_at: retained.end_time,
				duration_minutes: 360,
				approval_state: "approved",
			},
			{
				id: generated.canonical_record_id,
				start_at: generated.start_time,
				end_at: generated.end_time,
				duration_minutes: 30,
				approval_state: "approved",
			},
		]);
		return { retained, generated };
	}

	it("adjusts an adopted ordinary clock-out atomically after its closure and names the lineage", async () => {
		const submissionId = randomUUID();
		const {
			id: periodId,
			clock_in_id: clockInId,
			result,
		} = await recordWork(clockOutAt, submissionId);
		expect(result).toMatchObject({
			success: true,
			data: {
				breakAdjustment: {
					breakMinutes: 30,
					breakInsertedAt: "2026-07-22T14:00:40Z",
					regulationName: "T305 break",
					originalDurationMinutes: 420,
					adjustedDurationMinutes: 390,
				},
			},
		});
		const { retained, generated } = await expectStandardAdjustment(periodId);

		// The closure committed its intent with the work; the adjustment resolved it.
		const closure = only(await receipts("close_active_work"));
		const intentId = deriveAutomaticBreakIntentId({
			organizationId: ids.organization,
			workPeriodId: periodId,
		});
		expect(closure.result.followUps).toContainEqual({
			kind: "break_enforcement",
			delivery: "committed_intent",
			intentId,
		});
		expect(await intents()).toEqual([]);

		// Both break entries follow the append position from the closure's entry.
		const { rows: entries } = await admin.query<{
			id: string;
			type: string;
			timestamp: Date;
			previous_entry_id: string;
			previous_hash: string;
			hash: string;
			created_by: string;
			device_info: string;
		}>(
			`select id, type, timestamp, previous_entry_id, previous_hash, hash, created_by, device_info
			 from time_entry where organization_id = $1 and id in ($2, $3)`,
			[ids.organization, retained.clock_out_id, generated.clock_in_id],
		);
		const breakStart = entries.find((entry) => entry.id === retained.clock_out_id);
		const breakEnd = entries.find((entry) => entry.id === generated.clock_in_id);
		const { rows: closureEntry } = await admin.query<{ hash: string }>(
			"select hash from time_entry where id = $1",
			[submissionId],
		);
		expect(breakStart).toMatchObject({
			type: "clock_out",
			timestamp: new Date("2026-07-22T14:00:40Z"),
			previous_entry_id: submissionId,
			previous_hash: only(closureEntry).hash,
			created_by: ids.requesterUser,
			device_info: "break-enforcement",
		});
		expect(breakEnd).toMatchObject({
			type: "clock_in",
			timestamp: new Date("2026-07-22T14:30:40Z"),
			previous_entry_id: retained.clock_out_id,
			previous_hash: breakStart?.hash,
		});
		const { rows: positions } = await admin.query<{ tip_entry_id: string; last_operation: string }>(
			"select tip_entry_id, last_operation from time_entry_append_position where organization_id = $1",
			[ids.organization],
		);
		expect(only(positions)).toEqual({
			tip_entry_id: generated.clock_in_id,
			last_operation: "automatic_break_adjustment",
		});
		const { rows: balances } = await admin.query<{ is_dirty: boolean; dirty_from_date: string }>(
			"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
			[ids.requester],
		);
		expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });

		const receipt = only(await receipts());
		expect(receipt).toMatchObject({
			id: deriveAutomaticBreakOperationId({
				organizationId: ids.organization,
				workPeriodId: periodId,
			}),
			writer: "automatic_break_enforcement",
			append_admission: "append",
			// A system process adjusted the work; the clocking human only triggered it.
			actor_kind: "system",
			actor_user_id: null,
			work_period_id: periodId,
			command: {
				version: 1,
				workPeriodId: periodId,
				sourceRevision: 1,
				intent: { id: intentId, closureEntryId: submissionId },
			},
		});
		const attribution = {
			projectId: null,
			workCategoryId: null,
			workLocationType: "office",
			allocations: [],
		};
		expect(receipt.result).toEqual({
			version: 1,
			operationId: receipt.id,
			owner: { employeeId: ids.requester },
			actors: {
				executing: { kind: "system", process: "automatic_break_adjustment" },
				triggeredBy: { kind: "human", userId: ids.requesterUser, closureEntryId: submissionId },
			},
			originatingWork: {
				workPeriodId: periodId,
				canonicalRecordId: retained.canonical_record_id,
				clockInEntryId: clockInId,
				clockOutEntryId: submissionId,
				startAt: "2026-07-22T08:00:40Z",
				endAt: "2026-07-22T15:00:31Z",
				durationMinutes: 420,
				startUtcOffsetMinutes: 0,
				endUtcOffsetMinutes: 0,
				attribution,
				approvalState: "approved",
				recordCreatedBy: ids.requesterUser,
			},
			deferral: null,
			policy: {
				evaluatedAt: "2026-07-22T15:00:31Z",
				policyId: ids.policy,
				regulationId: ids.regulation,
				regulationName: "T305 break",
				rule: { workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
			},
			adjustment: {
				breakMinutes: 30,
				alreadyTakenBreakMinutes: 0,
				breakStartAt: "2026-07-22T14:00:40Z",
				breakEndAt: "2026-07-22T14:30:40Z",
				timezone: "UTC",
			},
			segments: [
				{
					role: "retained",
					workPeriodId: periodId,
					canonicalRecordId: retained.canonical_record_id,
					clockInEntryId: clockInId,
					clockOutEntryId: retained.clock_out_id,
					startAt: "2026-07-22T08:00:40Z",
					endAt: "2026-07-22T14:00:40Z",
					durationMinutes: 360,
					startUtcOffsetMinutes: 0,
					endUtcOffsetMinutes: 0,
					attribution,
				},
				{
					role: "generated",
					workPeriodId: generated.id,
					canonicalRecordId: generated.canonical_record_id,
					clockInEntryId: generated.clock_in_id,
					clockOutEntryId: submissionId,
					startAt: "2026-07-22T14:30:40Z",
					endAt: "2026-07-22T15:00:31Z",
					durationMinutes: 30,
					startUtcOffsetMinutes: 0,
					endUtcOffsetMinutes: 0,
					attribution,
					origin: { workPeriodId: periodId, canonicalRecordId: retained.canonical_record_id },
					approval: { state: "approved", basis: "originating_work", sourceDecisionIds: [] },
				},
			],
			append: {
				admission: "append",
				clockOut: {
					entryId: retained.clock_out_id,
					previousEntryId: submissionId,
					previousHash: only(closureEntry).hash,
				},
				clockIn: {
					entryId: generated.clock_in_id,
					previousEntryId: retained.clock_out_id,
					previousHash: breakStart?.hash,
				},
			},
			revisions: { originating: { source: 1, result: 2 }, generated: { source: null, result: 1 } },
			followUps: [
				{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate: "2026-07-22" },
				{ kind: "surcharge_calculation", delivery: "post_commit_best_effort" },
			],
		});
		expect(retained.graph_revision).toBe(2);
	});

	it("replays the committed clock-out without regenerating the adjustment", async () => {
		const { submissionId } = await recordWork();
		const before = await snapshot();

		actAs(ids.requesterUser);
		await expect(
			clockOut(undefined, undefined, { submissionId, instant: clockOutAt, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 0, errors: [] });
		expect(await snapshot()).toEqual(before);
	});

	it("keeps the committed closure when the adjustment fails and recovers it from the intent", async () => {
		await failAdjustments();
		const { id: periodId, submissionId, result } = await recordWork();
		// The clock-out succeeded; the whole consistent closure stands.
		expect(result).toMatchObject({ success: true });
		expect(
			(result as { data?: { breakAdjustment?: unknown } }).data?.breakAdjustment,
		).toBeUndefined();
		expect(await periods()).toMatchObject([
			{ id: periodId, duration_minutes: 420, was_auto_adjusted: false, graph_revision: 1 },
		]);
		expect(await intents()).toMatchObject([
			{
				work_period_id: periodId,
				closure_entry_id: submissionId,
				triggered_by_user_id: ids.requesterUser,
				status: "pending",
				attempts: 1,
				last_error: expect.stringContaining("t305 injected adjustment failure"),
			},
		]);
		await expect(recover(laterRunDate)).resolves.toMatchObject({
			adjustedCount: 0,
			errors: [{ workPeriodId: periodId, error: expect.stringContaining("t305") }],
		});
		expect(only(await intents()).attempts).toBe(2);

		await allowAdjustments();
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		await expectStandardAdjustment(periodId);
		expect(await intents()).toEqual([]);
		expect(await receipts()).toHaveLength(1);
	});

	it.each([
		["time_entry", "insert"],
		["time_entry_append_position", "update"],
		["work_period", "update"],
		["time_record", "update"],
		["time_record", "insert"],
		["time_record_work", "insert"],
		["work_period", "insert"],
		["employee_work_balance", "update"],
		["work_break_adjustment_intent", "delete"],
	])("rolls the whole adjustment back when its %s %s fails", async (table, operation) => {
		const { id: periodId } = await workWithLostAdjustment();
		const before = await snapshot();
		await admin.query(
			`create function t305_fail() returns trigger language plpgsql as $$
			 begin raise exception 't305 injected write failure'; end $$`,
		);
		await admin.query(
			`create trigger t305_fail before ${operation} on ${table} for each row execute function t305_fail()`,
		);
		await expect(recover(laterRunDate)).resolves.toMatchObject({
			adjustedCount: 0,
			errors: [{ workPeriodId: periodId }],
		});
		await admin.query("drop function t305_fail() cascade");
		const after = (await snapshot()) as { intents: IntentRow[] };
		// Only the failure evidence on the intent changed.
		expect({ ...after, intents: null }).toEqual({ ...before, intents: null });
		expect(after.intents).toMatchObject([{ status: "pending", attempts: 2 }]);

		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		await expectStandardAdjustment(periodId);
	});

	it("survives a lost worker process and serializes duplicate workers to one adjustment", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		const holder = await admin.connect();
		try {
			await holder.query("begin");
			await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ids.requester]);
			const lost = recover(laterRunDate);
			let waiting: number | undefined;
			for (let attempt = 0; attempt < 100 && waiting === undefined; attempt += 1) {
				const { rows } = await admin.query<{ pid: number }>(
					`select pid from pg_stat_activity
					 where datname = current_database() and wait_event_type = 'Lock'
					   and wait_event = 'advisory' and pid <> $1`,
					[(await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid],
				);
				waiting = rows[0]?.pid;
				if (waiting === undefined) await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (waiting === undefined) throw new Error("the worker never waited for the employee");
			await admin.query("select pg_terminate_backend($1)", [waiting]);
			await expect(lost).resolves.toMatchObject({
				adjustedCount: 0,
				errors: [{ workPeriodId: periodId }],
			});
		} finally {
			await holder.query("rollback");
			holder.release();
		}
		// The lost worker wrote nothing but its failure evidence.
		expect(await periods()).toMatchObject([{ id: periodId, duration_minutes: 420 }]);
		expect(await intents()).toMatchObject([{ status: "pending", attempts: 2 }]);

		const [first, second] = await Promise.all([recover(laterRunDate), recover(laterRunDate)]);
		expect(first.errors).toEqual([]);
		expect(second.errors).toEqual([]);
		expect(first.adjustedCount + second.adjustedCount).toBe(1);
		await expectStandardAdjustment(periodId);
		expect(await receipts()).toHaveLength(1);
		expect(await intents()).toEqual([]);
	});

	it("defers under a pending correction across dates and applies once the correction is rejected", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await expect(
			requestEdit(periodId, { clockIn: "08:00", clockOut: "16:00" }),
		).resolves.toMatchObject({ success: true, data: { status: "pending" } });
		const [submitted] = await periods();
		const workBefore = await snapshot();

		await expect(recover(laterRunDate)).resolves.toMatchObject({
			adjustedCount: 0,
			deferredCount: 1,
			errors: [],
		});
		const deferred = only(await intents());
		expect(deferred).toMatchObject({
			status: "deferred",
			blocker: "pending_time_correction_approval",
			observed_graph_revision: submitted?.graph_revision,
		});
		// Deferral writes nothing but the intent.
		const afterDeferral = (await snapshot()) as Record<string, unknown>;
		expect({ ...afterDeferral, intents: null }).toEqual({ ...workBefore, intents: null });

		// A later run on another date keeps the same deferral.
		await expect(recover(new Date("2026-10-15T12:00:00Z"))).resolves.toMatchObject({
			deferredCount: 1,
		});
		expect(only(await intents()).deferred_at).toEqual(deferred.deferred_at);

		await expect(reject(await pendingApprovalId(periodId))).resolves.toMatchObject({
			status: "rejected",
		});
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		await expectStandardAdjustment(periodId);
		const receipt = only(await receipts());
		expect(receipt.result.deferral).toEqual({
			blocker: "pending_time_correction_approval",
			observedGraphRevision: deferred.observed_graph_revision,
			deferredAt: deferred.deferred_at?.toISOString().replace(".000Z", "Z"),
		});
		expect(await intents()).toEqual([]);
	});

	it("applies to the original work once the correction is cancelled", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await requestEdit(periodId, { clockIn: "08:00", clockOut: "16:00" });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });

		actAs(ids.requesterUser);
		await expect(cancelMyTimeCorrectionRequest(periodId)).resolves.toMatchObject({
			success: true,
		});
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		await expectStandardAdjustment(periodId);
	});

	it("re-plans from the approved correction instead of the formerly planned split", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await requestEdit(periodId, { clockIn: "07:30", clockOut: "16:00" });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });
		const deferred = only(await intents());

		await expect(approve(await pendingApprovalId(periodId))).resolves.toMatchObject({
			status: "approved",
		});
		const [corrected] = await periods();
		expect(corrected?.graph_revision).toBeGreaterThan(deferred.observed_graph_revision ?? 0);
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });

		// The break follows the corrected 07:30-16:00 work, not the original 08:00:40 start.
		expect(await periods()).toMatchObject([
			{
				id: periodId,
				start_time: new Date("2026-07-22T07:30:00Z"),
				end_time: new Date("2026-07-22T13:30:00Z"),
				duration_minutes: 360,
				original_duration_minutes: 510,
			},
			{
				start_time: new Date("2026-07-22T14:00:00Z"),
				end_time: new Date("2026-07-22T16:00:00Z"),
				duration_minutes: 120,
			},
		]);
		const receipt = only(await receipts());
		expect(receipt.command).toMatchObject({ sourceRevision: corrected?.graph_revision });
		expect(receipt.result.deferral).toMatchObject({
			observedGraphRevision: deferred.observed_graph_revision,
		});
	});

	it("drops the intent when the approved correction removes the owed break", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await requestEdit(periodId, { clockIn: "08:00", clockOut: "13:00" });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });
		await approve(await pendingApprovalId(periodId));
		const before = await snapshot();

		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 0, errors: [] });
		expect(await intents()).toEqual([]);
		expect(await receipts()).toEqual([]);
		const after = (await snapshot()) as Record<string, unknown>;
		expect({ ...after, intents: null }).toEqual({ ...before, intents: null });
	});

	it("drops the intent of work deleted while the adjustment was deferred", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		actAs(ids.requesterUser);
		await expect(
			requestTimeEntryDeletion({
				workPeriodId: periodId,
				submissionId: randomUUID(),
				reason: "Duplicate",
			}),
		).resolves.toMatchObject({ success: true });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });
		await approve(await pendingApprovalId(periodId));
		expect((await periods())[0]?.deleted_at).not.toBeNull();

		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 0, errors: [] });
		expect(await intents()).toEqual([]);
		expect(await receipts()).toEqual([]);
	});

	it("defers while other recorded work overlaps and applies once the overlap is gone", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		// Canonical work without a period link occupies its own interval.
		const occupant = randomUUID();
		await admin.query(
			`insert into time_record
			 (id, organization_id, employee_id, record_kind, start_at, end_at, duration_minutes,
			  approval_state, origin, created_by, updated_at)
			 values ($1, $2, $3, 'work', '2026-07-22T10:00:00Z', '2026-07-22T11:00:00Z', 60,
			         'approved', 'manual', $4, now())`,
			[occupant, ids.organization, ids.requester, ids.requesterUser],
		);
		const before = await snapshot();

		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1, errors: [] });
		expect(only(await intents())).toMatchObject({
			status: "deferred",
			blocker: "work_occupancy_conflict",
		});
		const after = (await snapshot()) as Record<string, unknown>;
		expect({ ...after, intents: null }).toEqual({ ...before, intents: null });

		await admin.query("delete from time_record where id = $1", [occupant]);
		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		await expectStandardAdjustment(periodId);
	});

	it("applies the regulation as it stands when the deferral clears, not as first planned", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await requestEdit(periodId, { clockIn: "08:00", clockOut: "16:00" });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });
		// The policy stops requiring the break while the adjustment waits.
		await admin.query("delete from work_policy_break_rule where id = $1", [ids.breakRule]);
		actAs(ids.requesterUser);
		await cancelMyTimeCorrectionRequest(periodId);
		const before = await snapshot();

		await expect(recover(laterRunDate)).resolves.toMatchObject({ adjustedCount: 0, errors: [] });
		expect(await intents()).toEqual([]);
		expect(await receipts()).toEqual([]);
		const after = (await snapshot()) as Record<string, unknown>;
		expect({ ...after, intents: null }).toEqual({ ...before, intents: null });
	});

	it("removes deferred intents with the organization's time data", async () => {
		const { id: periodId } = await workWithLostAdjustment();
		await requestEdit(periodId, { clockIn: "08:00", clockOut: "16:00" });
		await expect(recover(laterRunDate)).resolves.toMatchObject({ deferredCount: 1 });
		expect(await intents()).toHaveLength(1);

		await clearOrganizationTimeData(ids.organization);

		expect(await intents()).toEqual([]);
		expect(await periods()).toEqual([]);
	});

	it("commits no ordinary intent for an approval-routed closure", async () => {
		harness.forceClockOutApproval = true;
		await recordWork();
		expect(await intents()).toEqual([]);
		expect(await periods()).toMatchObject([{ approval_status: "pending", duration_minutes: 420 }]);
		expect(only(await receipts("close_active_work")).result.followUps).not.toContainEqual(
			expect.objectContaining({ kind: "break_enforcement" }),
		);
	});

	it("keeps a legacy organization's established writes, now atomic and without an intent", async () => {
		await setAdmission("inactive");
		const { id: periodId, result } = await recordWork();
		expect(result).toMatchObject({
			success: true,
			data: { breakAdjustment: { breakMinutes: 30 } },
		});
		const [retained, generated] = await periods();
		expect(retained).toMatchObject({
			id: periodId,
			end_time: new Date("2026-07-22T14:00:40Z"),
			duration_minutes: 360,
			was_auto_adjusted: true,
			graph_revision: 0,
		});
		// Established arithmetic: whole minutes, floored.
		expect(generated).toMatchObject({
			start_time: new Date("2026-07-22T14:30:40Z"),
			duration_minutes: 29,
			was_auto_adjusted: true,
		});
		const { rows: breakStart } = await admin.query<{ previous_hash: string; created_by: string }>(
			"select previous_hash, created_by from time_entry where id = $1",
			[retained?.clock_out_id],
		);
		const { rows: closure } = await admin.query<{ hash: string }>(
			"select hash from time_entry where id = $1",
			[generated?.clock_out_id],
		);
		expect(only(breakStart)).toEqual({
			previous_hash: only(closure).hash,
			created_by: ids.requesterUser,
		});
		expect(await intents()).toEqual([]);
		expect(await receipts()).toEqual([]);
	});

	it("leaves a legacy organization's closure whole when an established write fails", async () => {
		await setAdmission("inactive");
		await admin.query(
			`create function t305_fail() returns trigger language plpgsql as $$
			 begin
			   if NEW.was_auto_adjusted then raise exception 't305 injected legacy failure'; end if;
			   return NEW;
			 end $$`,
		);
		await admin.query(
			"create trigger t305_fail before insert on work_period for each row execute function t305_fail()",
		);
		const { id: periodId, result } = await recordWork();
		expect(result).toMatchObject({ success: true });
		// Before #305 the break entries and the shortened period stayed behind.
		expect(await periods()).toMatchObject([
			{ id: periodId, duration_minutes: 420, was_auto_adjusted: false },
		]);
		const { rows } = await admin.query(
			"select id from time_entry where organization_id = $1 and device_info = 'break-enforcement'",
			[ids.organization],
		);
		expect(rows).toEqual([]);
	});

	it("refuses a legacy adjustment under a pending correction and applies it after cancellation", async () => {
		await setAdmission("inactive");
		await admin.query(
			`create function t305_fail() returns trigger language plpgsql as $$
			 begin
			   if NEW.was_auto_adjusted then raise exception 't305 injected legacy failure'; end if;
			   return NEW;
			 end $$`,
		);
		await admin.query(
			"create trigger t305_fail before insert on work_period for each row execute function t305_fail()",
		);
		const { id: periodId } = await recordWork();
		await admin.query("drop function t305_fail() cascade");
		await requestEdit(periodId, { clockIn: "08:00", clockOut: "16:00" });
		const before = await snapshot();

		// The legacy daily check of the work's own day finds the period and is refused.
		const workDay = new Date("2026-07-22T12:00:00Z");
		await expect(recover(workDay)).resolves.toMatchObject({ adjustedCount: 0, errors: [] });
		expect(await snapshot()).toEqual(before);

		actAs(ids.requesterUser);
		await cancelMyTimeCorrectionRequest(periodId);
		await expect(recover(workDay)).resolves.toMatchObject({ adjustedCount: 1, errors: [] });
		expect((await periods()).map((period) => period.duration_minutes)).toEqual([360, 29]);
	});
});
