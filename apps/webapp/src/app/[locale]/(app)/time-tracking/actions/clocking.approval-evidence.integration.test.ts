/**
 * #302 / T38 runtime evidence: manual time submission and policy clock-out
 * approval lifecycles capture immutable submitted and decision evidence.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn`/`clockOut`/`createManualTimeEntry` server actions and the
 * real inbox decision service run against that database. Only the
 * request/session, billing provisioning, notification delivery and Next cache
 * boundaries are replaced. Evidence capture, append admission and rollout modes
 * are enabled per test organization by inserting their control rows directly:
 * production has no setter. Live clock-outs never route approval (#361), so a
 * policy clock-out is a historical one: a real clock-out, then its policy
 * submission seeded through the real ordinary submission. Manual approval depends
 * on the change policy, so manual scenarios force only that decision and keep the
 * real routing, approval and evidence collaborators. Append admission is active, so
 * manual entries are strict version-2 commands (#308) through the public action;
 * their approval comes from a real change policy.
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
	forceManualApproval: false,
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

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => false,
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
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

vi.mock("./policy-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("./policy-helpers")>();
	return {
		...original,
		getEditCapabilityForPeriod: async (
			params: Parameters<typeof original.getEditCapabilityForPeriod>[0],
		) =>
			harness.forceManualApproval
				? { type: "approval_required" as const }
				: await original.getEditCapabilityForPeriod(params),
	};
});

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
const { createManualTimeEntry } = await import("../actions");
// The inbox API route registers the approval type handlers the same way.
await import("@/lib/approvals/init");
const { approveApprovalInboxItem, rejectApprovalInboxItem } = await import(
	"@/lib/approvals/inbox/decision-service"
);
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");
const { deleteApproval, deleteWorkPeriodApprovalEvidence } = await import(
	"@/lib/approvals/maintenance"
);
const { workPeriodReceiptKeyDigest } = await import(
	"@/lib/approvals/evidence/work-period-evidence"
);
const { submitHistoricalPolicyClockOut } = await import(
	"@/lib/time-tracking/__tests__/historical-policy-clock-out"
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
	describe.skip(`approval lifecycle evidence PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t302-approval-evidence-org",
	requesterUser: "t302-requester-user",
	managerUser: "t302-manager-user",
	requester: "f1000000-0000-4000-8000-000000000001",
	manager: "f1000000-0000-4000-8000-000000000002",
	managerLink: "f2000000-0000-4000-8000-000000000001",
	policy: "f3000000-0000-4000-8000-000000000001",
	regulation: "f3000000-0000-4000-8000-000000000002",
	breakRule: "f3000000-0000-4000-8000-000000000003",
	policyAssignment: "f3000000-0000-4000-8000-000000000004",
	changePolicy: "f3000000-0000-4000-8000-000000000005",
	changePolicyAssignment: "f3000000-0000-4000-8000-000000000006",
} as const;
const clockInAt = parseInstant("2026-07-22T08:00:00Z");
const materialChange =
	"This time entry changed after it was submitted for approval. No decision was recorded; the entry needs review.";
const evidenceRequired =
	"The times submitted for this entry were not captured. Review is required before a decision can be recorded.";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

type RevisionRow = {
	id: string;
	authority: string;
	workflow_id: string | null;
	legacy_approval_request_id: string | null;
	legacy_chain_instance_id: string | null;
	observed_workflow_id: string | null;
	workflow_type: string;
	source_type: string;
	source_id: string;
	request_cycle_key: string;
	subject_employee_id: string;
	requester_employee_id: string;
	submitter_actor_kind: string;
	submitter_employee_id: string | null;
	submitter_user_id: string | null;
	material_fingerprint: string;
	facts: Record<string, unknown>;
	labels: Record<string, unknown>;
	submitted_at: Date;
};

type DecisionRow = {
	id: string;
	authority: string;
	workflow_id: string | null;
	legacy_approval_request_id: string | null;
	submitted_revision_id: string;
	operation_kind: string;
	receipt_idempotency_key: string;
	action: string;
	stage_id: string | null;
	assignment_id: string | null;
	assignment_outcome: string | null;
	request_outcome: string;
	actor_kind: string;
	actor_employee_id: string | null;
	actor_user_id: string | null;
	decided_at: Date;
	event_ids: string[];
	result: Record<string, unknown>;
	labels: Record<string, unknown>;
};

describeIntegration("manual and policy clock-out approval lifecycle evidence on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setCapture(
		kind: "policy_clock_out" | "manual_time_submission",
		mode: "capture" | "inactive",
	) {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode) values ($1, $2, $3)
			 on conflict (organization_id, workflow_type) do update set mode = excluded.mode`,
			[ids.organization, kind, mode],
		);
	}

	async function setRollout(
		kind: "policy_clock_out" | "manual_time_submission",
		mode: "legacy" | "canonical",
	) {
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, $2, $3, $4, now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = excluded.lifecycle_mode,
			   side_effect_mode = excluded.side_effect_mode, updated_at = now()`,
			[ids.organization, kind, mode, mode === "canonical" ? "canonical" : "legacy"],
		);
	}

	async function linkManager() {
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
	}

	async function seedBreakPolicy() {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T302 break', false, true, true, $3, $4)`,
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
	}

	/**
	 * A real clock-out, submitted as a historical policy clock-out. A break policy
	 * takes effect only after the clock-out, so its break is still owed at approval.
	 */
	async function policyClockOut(
		clockOutAt: Instant = clockInAt.add({ minutes: 60, seconds: 40 }),
		startAt: Instant = clockInAt,
		options: { breakPolicy?: boolean } = {},
	) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: startAt, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			`select id, clock_in_id from work_period where employee_id = $1 and end_time is null`,
			[ids.requester],
		);
		const period = only(rows);
		const submissionId = randomUUID();
		const result = await clockOut(undefined, undefined, {
			submissionId,
			instant: clockOutAt,
			browserTimezone: "UTC",
		});
		expect(result).toMatchObject({ success: true });
		if (options.breakPolicy) await seedBreakPolicy();
		const submission = await submitPolicyClockOut(period.id);
		return { period, submissionId, result, submission };
	}

	function submitPolicyClockOut(workPeriodId: string) {
		return submitHistoricalPolicyClockOut({
			organizationId: ids.organization,
			employeeId: ids.requester,
			userId: ids.requesterUser,
			workPeriodId,
		});
	}

	/** Approval for any past manual entry, through the real change policy. */
	async function requireManualApproval() {
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T302 manual approval', 0, 3650, $3, now()) on conflict do nothing`,
			[ids.changePolicy, ids.organization, ids.managerUser],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, now()) on conflict do nothing`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.managerUser],
		);
	}

	async function submitManual(submissionId = randomUUID()) {
		actAs(ids.requesterUser);
		if (harness.forceManualApproval) await requireManualApproval();
		// Continued once in the Berlin browser zone; the saved zone is UTC.
		return createManualTimeEntry({
			version: 2,
			submissionId,
			targetEmployeeId: ids.requester,
			date: "2026-07-20",
			clockIn: { time: "09:00", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "17:30", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "browser", timezone: "Europe/Berlin" },
			browserTimezone: "Europe/Berlin",
			reason: "Forgot to clock",
			projectId: null,
			workCategoryId: null,
		});
	}

	async function revisions(): Promise<RevisionRow[]> {
		const { rows } = await admin.query<RevisionRow>(
			"select * from approval_submitted_revision where organization_id = $1 order by created_at, id",
			[ids.organization],
		);
		return rows;
	}

	async function decisions(): Promise<DecisionRow[]> {
		const { rows } = await admin.query<DecisionRow>(
			"select * from approval_decision_evidence where organization_id = $1 order by decided_at, id",
			[ids.organization],
		);
		return rows;
	}

	async function request(workPeriodId: string) {
		const { rows } = await admin.query<{
			id: string;
			status: string;
			approved_at: Date | null;
			updated_at: Date;
			created_at: Date;
		}>(
			`select id, status, approved_at, updated_at, created_at from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	/** Every row a submission or decision can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from approval_workflow t where organization_id = $1) as workflows,
			   (select json_agg(row_to_json(t) order by t.id) from approval_submitted_revision t where organization_id = $1) as revisions,
			   (select json_agg(row_to_json(t) order by t.id) from approval_decision_evidence t where organization_id = $1) as decisions`,
			[ids.organization],
		);
		return only(rows);
	}

	async function approveAs(approvalId: string) {
		return approveApprovalInboxItem({
			approvalId,
			actorEmployeeId: ids.manager,
			organizationId: ids.organization,
		});
	}

	async function cleanup() {
		await admin.query("drop function if exists t302_fail() cascade");
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [
			ids.requesterUser,
			ids.managerUser,
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T302 evidence', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't302-requester@example.test', $3, $3),
			 ($2, 'Manager', 't302-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't302-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.requesterUser, ids.managerUser], timestamp],
		);
		await setRollout("policy_clock_out", "legacy");
		await setRollout("manual_time_submission", "legacy");
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
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
			throw new Error("Approval lifecycle evidence PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.forceManualApproval = false;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("captures the submitted policy clock-out interval and replays nothing", async () => {
		await setCapture("policy_clock_out", "capture");
		await linkManager();

		const { period, submissionId, submission } = await policyClockOut(undefined, undefined, {
			breakPolicy: true,
		});

		expect(submission).toMatchObject({
			disposition: "executed",
			result: { kind: "default_created" },
		});
		const pending = await request(period.id);
		const revision = only(await revisions());
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: pending.id,
			legacy_chain_instance_id: null,
			observed_workflow_id: null,
			workflow_type: "policy_clock_out",
			source_type: "time_entry",
			source_id: period.id,
			subject_employee_id: ids.requester,
			requester_employee_id: ids.requester,
			submitter_actor_kind: "employee",
			submitter_employee_id: ids.requester,
			submitter_user_id: ids.requesterUser,
			material_fingerprint: expect.stringMatching(/^work_period:v1:[0-9a-f]{64}$/),
			// Persisted creation of the request routing created, not a clock read.
			submitted_at: pending.created_at,
		});
		expect(revision.facts).toMatchObject({
			kind: "policy_clock_out",
			workPeriodId: period.id,
			interval: {
				clockIn: {
					entryId: period.clock_in_id,
					at: "2026-07-22T08:00:00Z",
					utcOffsetMinutes: 0,
					timezone: "UTC",
				},
				clockOut: {
					entryId: submissionId,
					at: "2026-07-22T09:00:40Z",
					utcOffsetMinutes: 0,
					timezone: "UTC",
				},
				// Stored minutes (61, half up) and UTC elapsed time (3640 s) stay apart.
				storedDurationMinutes: 61,
				elapsedSeconds: 3640,
			},
			policy: {
				kind: "policy_clock_out",
				breakAdjustment: "may_apply",
				breakPolicySnapshot: {
					resolution: "work_policy",
					breakRules: [
						{ id: ids.breakRule, workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
					],
				},
			},
		});
		expect(revision.facts).not.toHaveProperty("before");
		expect(revision.labels).toEqual({
			subjectName: "Requester",
			requesterName: "Requester",
			submitterName: "Requester",
		});
		expect(submission.evidence).toEqual({ submittedRevisionId: revision.id });
		expect(await decisions()).toEqual([]);

		// The exact resubmission matches the committed request and writes nothing.
		const before = await snapshot();
		await expect(submitPolicyClockOut(period.id)).resolves.toMatchObject({
			disposition: "replayed",
			result: { kind: "default_created", approvalRequestId: pending.id },
		});
		expect(await snapshot()).toEqual(before);
	});

	it("captures nothing while capture is inactive", async () => {
		await linkManager();

		const { submission } = await policyClockOut();

		expect(submission.result.kind).toBe("default_created");
		expect(submission.evidence).toBeUndefined();
		expect(await revisions()).toEqual([]);
	});

	it("records the approval and every resulting break segment without rewriting the submission", async () => {
		await setCapture("policy_clock_out", "capture");
		await linkManager();
		// 7h 0m 40s without a break: the policy inserts 30 minutes at 6h.
		const { period, submissionId } = await policyClockOut(
			clockInAt.add({ hours: 7, seconds: 40 }),
			clockInAt,
			{ breakPolicy: true },
		);
		const pending = await request(period.id);
		const revisionBefore = only(await revisions());

		await expect(approveAs(pending.id)).resolves.toMatchObject({ status: "approved" });

		const approved = await request(period.id);
		const decision = only(await decisions());
		expect(decision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: pending.id,
			submitted_revision_id: revisionBefore.id,
			operation_kind: "command",
			receipt_idempotency_key: workPeriodReceiptKeyDigest(
				`ordinary-decision:${ids.organization}:${period.id}:${pending.id}:approve:`,
			),
			action: "approve",
			stage_id: null,
			assignment_id: null,
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_kind: "employee",
			actor_employee_id: ids.manager,
			actor_user_id: ids.managerUser,
			// Persisted legacy decision time.
			decided_at: approved.approved_at,
			event_ids: [],
			labels: { actorName: "Manager" },
		});
		const { rows: segments } = await admin.query<{
			id: string;
			clock_in_id: string;
			clock_out_id: string;
			canonical_record_id: string;
		}>(
			"select id, clock_in_id, clock_out_id, canonical_record_id from work_period where employee_id = $1 order by start_time",
			[ids.requester],
		);
		expect(segments).toHaveLength(2);
		const [first, second] = segments;
		expect(decision.result).toEqual({
			workPeriodStatus: "approved",
			legacyRequestStatus: "approved",
			decidedAtSource: "approval_request.approved_at",
			actorAuthority: "assigned_approver",
			terminal: {
				status: "approved",
				adjustment: { kind: "break_enforced", breakMinutes: 30 },
				segments: [
					{
						workPeriodId: period.id,
						canonicalRecordId: first?.canonical_record_id,
						approvalStatus: "approved",
						clockIn: expect.objectContaining({
							entryId: period.clock_in_id,
							at: "2026-07-22T08:00:00Z",
						}),
						clockOut: expect.objectContaining({
							entryId: first?.clock_out_id,
							at: "2026-07-22T14:00:00Z",
							utcOffsetMinutes: 0,
							timezoneSource: "historical_inference",
						}),
						storedDurationMinutes: 360,
						elapsedSeconds: 21600,
					},
					{
						workPeriodId: second?.id,
						canonicalRecordId: second?.canonical_record_id,
						approvalStatus: "approved",
						clockIn: expect.objectContaining({
							entryId: second?.clock_in_id,
							at: "2026-07-22T14:30:00Z",
						}),
						clockOut: expect.objectContaining({
							entryId: submissionId,
							at: "2026-07-22T15:00:40Z",
						}),
						storedDurationMinutes: 31,
						elapsedSeconds: 1840,
					},
				],
				followUps: {
					delivery: "post_commit_owner",
					workBalanceDirtyFromDate: "2026-07-22",
					surchargePeriodIds: [period.id, second?.id],
					staleSurchargePeriodIds: [],
				},
			},
		});
		// The submitted interval is immutable evidence, not the mutated period.
		expect(only(await revisions())).toEqual(revisionBefore);
		expect(revisionBefore.facts).toMatchObject({
			interval: { clockOut: { at: "2026-07-22T15:00:40Z" }, storedDurationMinutes: 421 },
		});
		await expect(
			admin.query("update approval_submitted_revision set labels = '{}' where id = $1", [
				revisionBefore.id,
			]),
		).rejects.toThrow();

		// The established replay repeats the committed decision and writes nothing.
		const after = await snapshot();
		await expect(approveAs(pending.id)).resolves.toMatchObject({ status: "approved" });
		expect(await snapshot()).toEqual(after);
	});

	it("records a rejection at its persisted time with the unchanged segment", async () => {
		await setCapture("policy_clock_out", "capture");
		await linkManager();
		const { period, submissionId } = await policyClockOut();
		const pending = await request(period.id);

		await expect(
			rejectApprovalInboxItem({
				approvalId: pending.id,
				actorEmployeeId: ids.manager,
				organizationId: ids.organization,
				reason: "Not agreed",
			}),
		).resolves.toMatchObject({ status: "rejected" });

		const rejected = await request(period.id);
		const decision = only(await decisions());
		expect(decision).toMatchObject({
			action: "reject",
			assignment_outcome: "rejected",
			request_outcome: "rejected",
			decided_at: rejected.updated_at,
		});
		expect(JSON.stringify(decision)).not.toContain("Not agreed");
		expect(decision.result).toMatchObject({
			workPeriodStatus: "rejected",
			decidedAtSource: "approval_request.updated_at",
			terminal: {
				status: "rejected",
				adjustment: { kind: "none" },
				segments: [
					{
						workPeriodId: period.id,
						approvalStatus: "rejected",
						clockOut: expect.objectContaining({ entryId: submissionId }),
						storedDurationMinutes: 61,
					},
				],
				followUps: { staleSurchargePeriodIds: [period.id], surchargePeriodIds: [] },
			},
		});
	});

	it("holds decisions on changed or unevidenced submissions and rolls back failed evidence", async () => {
		await linkManager();
		// Submitted while capture was inactive: held once capture is active.
		const unevidenced = await policyClockOut();
		const unevidencedRequest = await request(unevidenced.period.id);
		await setCapture("policy_clock_out", "capture");
		const beforeRequired = await snapshot();
		await expect(approveAs(unevidencedRequest.id)).rejects.toMatchObject({
			message: evidenceRequired,
		});
		expect(await snapshot()).toEqual(beforeRequired);

		const nextDay = parseInstant("2026-07-23T08:00:00Z");
		const evidenced = await policyClockOut(nextDay.add({ minutes: 61 }), nextDay);
		const pending = await request(evidenced.period.id);

		// A consistent edit to the pending entry after submission is a material change.
		await admin.query(
			"update work_period set duration_minutes = duration_minutes + 5 where id = $1",
			[evidenced.period.id],
		);
		await admin.query(
			`update time_record set duration_minutes = duration_minutes + 5
			 where id = (select canonical_record_id from work_period where id = $1)`,
			[evidenced.period.id],
		);
		const beforeChanged = await snapshot();
		await expect(approveAs(pending.id)).rejects.toMatchObject({ message: materialChange });
		expect(await snapshot()).toEqual(beforeChanged);
		await admin.query(
			"update work_period set duration_minutes = duration_minutes - 5 where id = $1",
			[evidenced.period.id],
		);
		await admin.query(
			`update time_record set duration_minutes = duration_minutes - 5
			 where id = (select canonical_record_id from work_period where id = $1)`,
			[evidenced.period.id],
		);

		// A failed evidence write rolls the whole decision back.
		const beforeFailure = await snapshot();
		await admin.query(
			`create function t302_fail() returns trigger language plpgsql as $$
			 begin raise exception 't302 injected decision evidence failure'; end $$`,
		);
		await admin.query(
			"create trigger t302_fail before insert on approval_decision_evidence for each row execute function t302_fail()",
		);
		await expect(approveAs(pending.id)).rejects.toBeDefined();
		await admin.query("drop function t302_fail() cascade");
		expect(await snapshot()).toEqual(beforeFailure);

		// The same decision then commits freshly.
		await expect(approveAs(pending.id)).resolves.toMatchObject({ status: "approved" });
		expect(only(await decisions())).toMatchObject({ request_outcome: "approved" });
	});

	it("captures and decides a canonical policy clock-out lifecycle", async () => {
		await setRollout("policy_clock_out", "canonical");
		await setCapture("policy_clock_out", "capture");
		await linkManager();

		const { period, submission } = await policyClockOut();

		expect(submission.result.kind).toMatch(/_created$/);
		const { rows: workflows } = await admin.query<{ id: string; submitted_at: Date }>(
			"select id, submitted_at from approval_workflow where organization_id = $1 and source_id = $2",
			[ids.organization, period.id],
		);
		const workflow = only(workflows);
		const revision = only(await revisions());
		expect(revision).toMatchObject({
			authority: "canonical",
			workflow_id: workflow.id,
			legacy_approval_request_id: null,
			submitted_at: workflow.submitted_at,
		});
		const { rows: assignments } = await admin.query<{ id: string; stage_id: string }>(
			"select id, stage_id from approval_stage_assignment where workflow_id = $1",
			[workflow.id],
		);
		const assignment = only(assignments);
		const pending = await request(period.id);

		await expect(approveAs(pending.id)).resolves.toMatchObject({ status: "approved" });

		const { rows: resolved } = await admin.query<{ resolved_at: Date }>(
			"select resolved_at from approval_stage_assignment where id = $1",
			[assignment.id],
		);
		const decision = only(await decisions());
		expect(decision).toMatchObject({
			authority: "canonical",
			workflow_id: workflow.id,
			submitted_revision_id: revision.id,
			operation_kind: "command",
			stage_id: assignment.stage_id,
			assignment_id: assignment.id,
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_employee_id: ids.manager,
			decided_at: only(resolved).resolved_at,
		});
		expect(decision.event_ids.length).toBeGreaterThan(0);
		expect(decision.result).toMatchObject({
			workPeriodStatus: "approved",
			terminal: {
				status: "approved",
				adjustment: { kind: "break_not_required" },
				segments: [{ workPeriodId: period.id, storedDurationMinutes: 61 }],
			},
		});
	});

	it("captures a manual submission without a before state and decides it", async () => {
		harness.forceManualApproval = true;
		await setCapture("manual_time_submission", "capture");
		await linkManager();
		const submissionId = randomUUID();

		const result = await submitManual(submissionId);

		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		const pending = await request(submissionId);
		const revision = only(await revisions());
		expect(revision).toMatchObject({
			authority: "legacy",
			legacy_approval_request_id: pending.id,
			workflow_type: "manual_time_submission",
			source_id: submissionId,
			submitter_user_id: ids.requesterUser,
			submitted_at: pending.created_at,
		});
		expect(revision.facts).toMatchObject({
			kind: "manual_time_submission",
			interval: {
				// 09:00-17:30 Europe/Berlin in July, each endpoint with its capture.
				clockIn: {
					at: "2026-07-20T07:00:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
				},
				clockOut: {
					at: "2026-07-20T15:30:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
				},
				storedDurationMinutes: 510,
				elapsedSeconds: 30600,
			},
			policy: { kind: "manual_time_submission" },
		});
		expect(revision.facts).not.toHaveProperty("before");
		expect(JSON.stringify(revision)).not.toContain("Forgot to clock");

		// The exact retry replays without new evidence.
		const before = await snapshot();
		await expect(submitManual(submissionId)).resolves.toEqual({
			success: true,
			data: { ...(result.success ? result.data : {}), disposition: "replayed" },
		});
		expect(await snapshot()).toEqual(before);

		await expect(approveAs(pending.id)).resolves.toMatchObject({ status: "approved" });
		expect(only(await decisions())).toMatchObject({
			submitted_revision_id: revision.id,
			request_outcome: "approved",
			result: {
				terminal: {
					adjustment: { kind: "none" },
					segments: [{ workPeriodId: submissionId, storedDurationMinutes: 510 }],
				},
			},
		});
	});

	it("removes lifecycle evidence with privileged cleanup and with the organization's history", async () => {
		harness.forceManualApproval = true;
		await setCapture("policy_clock_out", "capture");
		await setCapture("manual_time_submission", "capture");
		await linkManager();
		const { period } = await policyClockOut();
		const policyRequest = await request(period.id);
		await approveAs(policyRequest.id);
		const manualId = randomUUID();
		await expect(submitManual(manualId)).resolves.toMatchObject({ success: true });
		expect(await revisions()).toHaveLength(2);

		const { db } = await import("@/db");
		const deleted = await deleteApproval(db as never, ids.organization, policyRequest.id);

		// Exactly the policy lifecycle; the manual cycle and the work stay.
		expect(deleted.evidence.submittedRevisions).toHaveLength(1);
		expect(deleted.evidence.decisionEvidence).toHaveLength(1);
		expect((await revisions()).map((row) => row.source_id)).toEqual([manualId]);

		await clearOrganizationTimeData(ids.organization);
		expect(await revisions()).toEqual([]);
		expect(await decisions()).toEqual([]);
	});

	it("removes evidence a deleted employee decided even when its subject stays", async () => {
		await setCapture("policy_clock_out", "capture");
		await linkManager();
		const { period } = await policyClockOut();
		await approveAs((await request(period.id)).id);
		expect(only(await decisions())).toMatchObject({ actor_employee_id: ids.manager });

		// Deleting only the deciding manager's history-bearing references.
		const { db } = await import("@/db");
		const deleted = await deleteWorkPeriodApprovalEvidence(db as never, {
			organizationId: ids.organization,
			employeeIds: [ids.manager],
		});

		expect(deleted.submittedRevisions).toHaveLength(1);
		expect(deleted.decisionEvidence).toHaveLength(1);
		expect(await revisions()).toEqual([]);
		expect(await decisions()).toEqual([]);
	});
});
