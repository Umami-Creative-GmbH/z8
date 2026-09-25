/**
 * #303 / T39 runtime evidence: a final policy clock-out approval that owes a
 * required break splits the approved period inside the approval transaction,
 * under the owner's coordinated work transaction, exempting only its own
 * resolving lifecycle from the unresolved-review guard.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `clockIn`/`clockOut` server actions and the real inbox decision
 * service run against that database. Only the request/session, billing
 * provisioning, notification delivery and Next cache boundaries are replaced.
 * Append admission, evidence capture and rollout modes are enabled per test
 * organization by inserting their control rows directly: production has no
 * setter. Live clock-out approval is production-false today
 * (`checkClockOutNeedsApproval`), so only that decision is forced; routing,
 * approval, split and evidence collaborators are real.
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
	sendClockOutApprovalNotifications: async () => undefined,
	sendClockOutApprovedNotification: async () => undefined,
}));

vi.mock("./policy-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("./policy-helpers")>();
	return {
		...original,
		checkClockOutNeedsApproval: async (employeeId: string) =>
			harness.forceClockOutApproval || (await original.checkClockOutNeedsApproval(employeeId)),
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
// The inbox API route registers the approval type handlers the same way.
await import("@/lib/approvals/init");
const { approveApprovalInboxItem } = await import("@/lib/approvals/inbox/decision-service");
const { derivePolicyClockOutBreakOperationId } = await import(
	"@/lib/time-tracking/policy-clock-out-terminal-break"
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
	describe.skip(`policy clock-out break split PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t303-break-split-org",
	requesterUser: "t303-requester-user",
	managerUser: "t303-manager-user",
	requester: "f3030000-0000-4000-8000-000000000001",
	manager: "f3030000-0000-4000-8000-000000000002",
	managerLink: "f3031000-0000-4000-8000-000000000001",
	policy: "f3032000-0000-4000-8000-000000000001",
	regulation: "f3032000-0000-4000-8000-000000000002",
	breakRule: "f3032000-0000-4000-8000-000000000003",
	policyAssignment: "f3032000-0000-4000-8000-000000000004",
	approvalPolicy: "f3033000-0000-4000-8000-000000000001",
	approvalCondition: "f3033000-0000-4000-8000-000000000002",
	approvalStageOne: "f3033000-0000-4000-8000-000000000003",
	approvalStageTwo: "f3033000-0000-4000-8000-000000000004",
	blocker: "f3034000-0000-4000-8000-000000000001",
} as const;
const clockInAt = parseInstant("2026-07-22T08:00:00Z");
// 7h 0m 40s without a break: the policy inserts 30 minutes after 6h.
const clockOutAt = clockInAt.add({ hours: 7, seconds: 40 });
const pendingReview = "Another approval for this work period is still pending";

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
	canonical_record_id: string;
	approval_workflow_id: string | null;
	approval_status: string;
	start_time: Date;
	end_time: Date;
	duration_minutes: number;
	was_auto_adjusted: boolean;
	graph_revision: number;
};

type ReceiptRow = {
	id: string;
	kind: string;
	writer: string;
	actor_kind: string;
	actor_user_id: string | null;
	append_admission: string;
	work_period_id: string;
	command: Record<string, unknown>;
	result: Record<string, unknown>;
};

describeIntegration("policy clock-out terminal break splits on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setRollout(mode: "legacy" | "canonical") {
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', $2, $3, now(), now())
			 on conflict (organization_id, workflow_type)
			 do update set lifecycle_mode = excluded.lifecycle_mode,
			   side_effect_mode = excluded.side_effect_mode, updated_at = now()`,
			[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy"],
		);
	}

	async function setAppend(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode`,
			[ids.organization, mode],
		);
	}

	async function setCapture() {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'policy_clock_out', 'capture')`,
			[ids.organization],
		);
	}

	async function seedTwoStageChain() {
		await admin.query(
			`insert into approval_policy (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'T303 two-stage', true, 1, $3, now())`,
			[ids.approvalPolicy, ids.organization, ids.managerUser],
		);
		await admin.query(
			`insert into approval_policy_condition
			 (id, organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, $3, 'approval_type', 'in', $4::jsonb, now())`,
			[ids.approvalCondition, ids.organization, ids.approvalPolicy, JSON.stringify(["time_entry"])],
		);
		await admin.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type, fallback_behavior, updated_at)
			 values ($1, $3, $4, 1, 'Manager one', 'direct_manager', 'fail', now()),
			        ($2, $3, $4, 2, 'Manager two', 'direct_manager', 'fail', now())`,
			[ids.approvalStageOne, ids.approvalStageTwo, ids.organization, ids.approvalPolicy],
		);
	}

	async function policyClockOut(endAt: Instant = clockOutAt) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: clockInAt, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			"select id, clock_in_id from work_period where employee_id = $1 and end_time is null",
			[ids.requester],
		);
		const period = only(rows);
		const submissionId = randomUUID();
		const result = await clockOut(undefined, undefined, {
			submissionId,
			instant: endAt,
			browserTimezone: "UTC",
		});
		expect(result).toMatchObject({ success: true, data: { pendingApproval: true } });
		return { periodId: period.id, clockInId: period.clock_in_id, submissionId };
	}

	async function pendingRequest(workPeriodId: string) {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2 and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows).id;
	}

	async function approve(approvalId: string) {
		return approveApprovalInboxItem({
			approvalId,
			actorEmployeeId: ids.manager,
			organizationId: ids.organization,
		});
	}

	async function periods(): Promise<PeriodRow[]> {
		const { rows } = await admin.query<PeriodRow>(
			`select id, clock_in_id, clock_out_id, canonical_record_id, approval_workflow_id,
			 approval_status, start_time, end_time, duration_minutes, was_auto_adjusted, graph_revision
			 from work_period where organization_id = $1 order by start_time, id`,
			[ids.organization],
		);
		return rows;
	}

	async function receipts(kind = "split_policy_clock_out_break"): Promise<ReceiptRow[]> {
		const { rows } = await admin.query<ReceiptRow>(
			"select * from completed_work_operation where organization_id = $1 and kind = $2",
			[ids.organization, kind],
		);
		return rows;
	}

	/** Every row a decision or split can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as work,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_approval_decision t where organization_id = $1) as decisions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from approval_workflow t where organization_id = $1) as workflows,
			   (select json_agg(row_to_json(t) order by t.id) from approval_decision_evidence t where organization_id = $1) as evidence`,
			[ids.organization],
		);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("drop function if exists t303_fail() cascade");
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
			"insert into organization (id, name, slug, created_at) values ($1, 'T303 split', $1, $2)",
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Requester', 't303-requester@example.test', $3, $3),
			 ($2, 'Manager', 't303-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't303-member-' || user_id, $1, user_id, 'member', 'approved', $2
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
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, now(), now())`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser],
		);
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T303 break', false, true, true, $3, $4)`,
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
		await setRollout("legacy");
		await setAppend("active");
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
			throw new Error("Policy clock-out break split PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.forceClockOutApproval = true;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("commits every segment with its own rounding, revision, append link and decision lineage", async () => {
		await setCapture();
		const { periodId, clockInId, submissionId } = await policyClockOut();
		const requestId = await pendingRequest(periodId);
		const [submitted] = await periods();
		if (!submitted) throw new Error("missing submitted period");

		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });

		const [retained, generated] = await periods();
		if (!retained || !generated) throw new Error("the approval did not split the period");
		expect(await periods()).toHaveLength(2);
		// Each segment rounds its own exact UTC elapsed time, half up.
		expect(retained).toMatchObject({
			id: periodId,
			clock_in_id: clockInId,
			approval_status: "approved",
			start_time: new Date("2026-07-22T08:00:00Z"),
			end_time: new Date("2026-07-22T14:00:00Z"),
			duration_minutes: 360,
			graph_revision: submitted.graph_revision + 1,
		});
		expect(generated).toMatchObject({
			clock_out_id: submissionId,
			approval_status: "approved",
			approval_workflow_id: null,
			start_time: new Date("2026-07-22T14:30:00Z"),
			end_time: new Date("2026-07-22T15:00:40Z"),
			duration_minutes: 31,
			was_auto_adjusted: true,
			graph_revision: 1,
		});

		// The generated entries follow the append position, not the latest-created row.
		const { rows: entries } = await admin.query<{
			id: string;
			type: string;
			previous_entry_id: string;
			previous_hash: string;
			hash: string;
			utc_offset_minutes: number;
		}>(
			`select id, type, previous_entry_id, previous_hash, hash, utc_offset_minutes from time_entry
			 where organization_id = $1 and id in ($2, $3)`,
			[ids.organization, retained.clock_out_id, generated.clock_in_id],
		);
		const breakStart = entries.find((entry) => entry.id === retained.clock_out_id);
		const breakEnd = entries.find((entry) => entry.id === generated.clock_in_id);
		const { rows: submittedEntry } = await admin.query<{ hash: string }>(
			"select hash from time_entry where id = $1",
			[submissionId],
		);
		expect(breakStart).toMatchObject({
			type: "clock_out",
			previous_entry_id: submissionId,
			previous_hash: only(submittedEntry).hash,
			utc_offset_minutes: 0,
		});
		expect(breakEnd).toMatchObject({
			type: "clock_in",
			previous_entry_id: retained.clock_out_id,
			previous_hash: breakStart?.hash,
			utc_offset_minutes: 0,
		});
		const { rows: positions } = await admin.query<{ tip_entry_id: string; last_operation: string }>(
			"select tip_entry_id, last_operation from time_entry_append_position where organization_id = $1",
			[ids.organization],
		);
		expect(only(positions)).toEqual({
			tip_entry_id: generated.clock_in_id,
			last_operation: "policy_clock_out_break",
		});

		// The human decision exists once, on the originating record; the generated
		// record is approved through that decision, not a fabricated second one.
		const { rows: decisionRows } = await admin.query<{ id: string; record_id: string }>(
			"select id, record_id from time_record_approval_decision where organization_id = $1",
			[ids.organization],
		);
		const decision = only(decisionRows);
		expect(decision.record_id).toBe(retained.canonical_record_id);
		const { rows: records } = await admin.query<{
			id: string;
			approval_state: string;
			duration_minutes: number;
		}>(
			"select id, approval_state, duration_minutes from time_record where organization_id = $1 order by start_at",
			[ids.organization],
		);
		expect(records).toEqual([
			{ id: retained.canonical_record_id, approval_state: "approved", duration_minutes: 360 },
			{ id: generated.canonical_record_id, approval_state: "approved", duration_minutes: 31 },
		]);

		const receipt = only(await receipts());
		expect(receipt).toMatchObject({
			id: derivePolicyClockOutBreakOperationId({
				organizationId: ids.organization,
				lifecycle: {
					authority: "legacy",
					approvalRequestId: requestId,
					observedWorkflowId: null,
				},
			}),
			kind: "split_policy_clock_out_break",
			writer: "policy_clock_out_decision",
			append_admission: "append",
			// The split is a system adjustment; the approver only triggered it.
			actor_kind: "system",
			actor_user_id: null,
			work_period_id: periodId,
		});
		expect(receipt.result).toEqual({
			version: 1,
			operationId: receipt.id,
			owner: { employeeId: ids.requester },
			actors: {
				executing: { kind: "system", process: "policy_clock_out_break" },
				triggeredBy: { kind: "human", userId: ids.managerUser, employeeId: ids.manager },
			},
			originatingWork: {
				workPeriodId: periodId,
				canonicalRecordId: retained.canonical_record_id,
				clockInEntryId: clockInId,
				clockOutEntryId: submissionId,
				startAt: "2026-07-22T08:00:00Z",
				endAt: "2026-07-22T15:00:40Z",
				durationMinutes: 421,
				startUtcOffsetMinutes: 0,
				endUtcOffsetMinutes: 0,
				attribution: {
					projectId: null,
					workCategoryId: null,
					workLocationType: "office",
					allocations: [],
				},
			},
			decision: {
				lifecycle: { authority: "legacy", approvalRequestId: requestId, observedWorkflowId: null },
				recordDecisionId: decision.id,
				action: "approved",
			},
			adjustment: {
				regulationId: ids.regulation,
				regulationName: "T303 break",
				breakMinutes: 30,
				breakStartAt: "2026-07-22T14:00:00Z",
				breakEndAt: "2026-07-22T14:30:00Z",
			},
			segments: [
				expect.objectContaining({
					role: "retained",
					workPeriodId: periodId,
					canonicalRecordId: retained.canonical_record_id,
					clockInEntryId: clockInId,
					clockOutEntryId: retained.clock_out_id,
					startAt: "2026-07-22T08:00:00Z",
					endAt: "2026-07-22T14:00:00Z",
					durationMinutes: 360,
				}),
				expect.objectContaining({
					role: "generated",
					workPeriodId: generated.id,
					canonicalRecordId: generated.canonical_record_id,
					clockInEntryId: generated.clock_in_id,
					clockOutEntryId: submissionId,
					startAt: "2026-07-22T14:30:00Z",
					endAt: "2026-07-22T15:00:40Z",
					durationMinutes: 31,
					origin: { workPeriodId: periodId, canonicalRecordId: retained.canonical_record_id },
					approval: { state: "approved", basis: "originating_decision" },
				}),
			],
			append: {
				clockOut: {
					entryId: retained.clock_out_id,
					previousEntryId: submissionId,
					previousHash: only(submittedEntry).hash,
				},
				clockIn: {
					entryId: generated.clock_in_id,
					previousEntryId: retained.clock_out_id,
					previousHash: breakStart?.hash,
				},
			},
			revisions: {
				originating: { source: submitted.graph_revision, result: submitted.graph_revision + 1 },
				generated: { source: null, result: 1 },
			},
			followUps: {
				workBalanceDirtyFromDate: "2026-07-22",
				surchargePeriodIds: [periodId, generated.id],
			},
		});
		// Receipts are committed evidence; an update is refused like any other.
		expect(receipt.command).toEqual({
			version: 1,
			workPeriodId: periodId,
			lifecycle: { authority: "legacy", approvalRequestId: requestId, observedWorkflowId: null },
			sourceRevision: submitted.graph_revision,
		});

		// Exact replay returns the committed decision and writes nothing.
		const committed = await snapshot();
		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });
		expect(await snapshot()).toEqual(committed);

		// A later source mutation leaves the committed split and decision evidence
		// unchanged: presentation reads what the approval committed, not the current rows.
		const { rows: evidenceBefore } = await admin.query(
			"select result from approval_decision_evidence where organization_id = $1",
			[ids.organization],
		);
		await admin.query(
			"update work_period set end_time = end_time - interval '5 minutes', duration_minutes = 355 where id = $1",
			[periodId],
		);
		await admin.query(
			"update time_record set end_at = end_at - interval '5 minutes', duration_minutes = 355 where id = $1",
			[retained.canonical_record_id],
		);
		expect(only(await receipts())).toEqual(receipt);
		const { rows: evidenceAfter } = await admin.query(
			"select result from approval_decision_evidence where organization_id = $1",
			[ids.organization],
		);
		expect(evidenceAfter).toEqual(evidenceBefore);
		expect(only(evidenceAfter).result).toMatchObject({
			terminal: {
				adjustment: { kind: "break_enforced", breakMinutes: 30 },
				segments: [
					expect.objectContaining({ workPeriodId: periodId, storedDurationMinutes: 360 }),
					expect.objectContaining({ workPeriodId: generated.id, storedDurationMinutes: 31 }),
				],
			},
		});
	});

	it("keeps the established writes in an organization that has not adopted append", async () => {
		await setAppend("inactive");
		const { periodId } = await policyClockOut();
		const requestId = await pendingRequest(periodId);

		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });

		const split = await periods();
		expect(split.map((period) => [period.duration_minutes, period.graph_revision])).toEqual([
			[360, 0],
			[31, 0],
		]);
		expect(await receipts()).toEqual([]);
		const { rows: positions } = await admin.query(
			"select 1 from time_entry_append_position where organization_id = $1",
			[ids.organization],
		);
		expect(positions).toEqual([]);
	});

	it("blocks the split while an unrelated correction review is pending and rolls everything back", async () => {
		const { periodId } = await policyClockOut();
		const requestId = await pendingRequest(periodId);
		// An unrelated pending time correction for the same period.
		await admin.query(
			`insert into approval_workflow
			 (id, organization_id, workflow_type, source_type, source_id, requester_employee_id,
			  status, version, policy_snapshot, context_snapshot, display_snapshot, updated_at)
			 values ($1, $2, 'time_correction', 'time_entry', $3, $4, 'pending', 1, '{}', '{}', '{}', now())`,
			[ids.blocker, ids.organization, periodId, ids.requester],
		);
		const before = await snapshot();

		await expect(approve(requestId)).rejects.toMatchObject({ message: pendingReview });
		// Nothing was approved or split: the original pending graph is intact.
		expect(await snapshot()).toEqual(before);

		// Once that review resolves, the policy clock-out's own transition is exempt.
		await admin.query("update approval_workflow set status = 'cancelled' where id = $1", [
			ids.blocker,
		]);
		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });
		expect(await periods()).toHaveLength(2);
		expect(await receipts()).toHaveLength(1);
	});

	it("rolls back the whole approval when the split's lineage cannot be committed", async () => {
		const { periodId } = await policyClockOut();
		const requestId = await pendingRequest(periodId);
		const before = await snapshot();
		await admin.query(
			`create function t303_fail() returns trigger language plpgsql as $$
			 begin
			   if NEW.kind = 'split_policy_clock_out_break' then
			     raise exception 't303 injected split receipt failure';
			   end if;
			   return NEW;
			 end $$`,
		);
		await admin.query(
			"create trigger t303_fail before insert on completed_work_operation for each row execute function t303_fail()",
		);

		await expect(approve(requestId)).rejects.toBeDefined();
		await admin.query("drop function t303_fail() cascade");
		// Entries, periods, canonical work, append position, decision and request: all original.
		expect(await snapshot()).toEqual(before);

		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });
		expect(await receipts()).toHaveLength(1);
	});

	it("splits only on the final approval of a multi-stage lifecycle", async () => {
		await seedTwoStageChain();
		const { periodId } = await policyClockOut();
		const firstStage = await pendingRequest(periodId);

		await expect(approve(firstStage)).resolves.toMatchObject({ status: "approved" });
		// The intermediate approval leaves one pending period and no split.
		expect((await periods()).map((period) => period.approval_status)).toEqual(["pending"]);
		expect(await receipts()).toEqual([]);

		const secondStage = await pendingRequest(periodId);
		expect(secondStage).not.toBe(firstStage);
		await expect(approve(secondStage)).resolves.toMatchObject({ status: "approved" });
		expect((await periods()).map((period) => period.duration_minutes)).toEqual([360, 31]);
		const receipt = only(await receipts());
		expect(receipt.result).toMatchObject({
			decision: { lifecycle: { authority: "legacy", approvalRequestId: secondStage } },
		});
	});

	it("exempts the canonical lifecycle's own transition and its compatibility mirror", async () => {
		await setRollout("canonical");
		const { periodId } = await policyClockOut();
		const { rows: workflows } = await admin.query<{ id: string }>(
			"select id from approval_workflow where organization_id = $1 and source_id = $2",
			[ids.organization, periodId],
		);
		const workflow = only(workflows);
		const requestId = await pendingRequest(periodId);

		await expect(approve(requestId)).resolves.toMatchObject({ status: "approved" });

		const [retained, generated] = await periods();
		expect(retained).toMatchObject({ approval_workflow_id: workflow.id, duration_minutes: 360 });
		expect(generated).toMatchObject({ approval_workflow_id: null, duration_minutes: 31 });
		expect(only(await receipts()).result).toMatchObject({
			decision: { lifecycle: { authority: "canonical", workflowId: workflow.id } },
		});
	});
});
