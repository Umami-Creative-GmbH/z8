/**
 * #439 runtime evidence: escalation transfers legacy-authoritative manual time
 * submissions, policy clock-outs and time corrections under `legacy`, `shadow`
 * and `ready`, mirrors each transfer into the shadow observation, and the
 * legacy decision owners refuse replaced approvers.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: the time submission actions
 * (`clockIn`/`clockOut`, `createManualTimeEntry`, `requestTimeCorrection`),
 * `processDueEscalations`, the escalation settings actions, the inbox
 * approve/reject routes with the real CASL abilities, the web approvals
 * actions, the requester's correction cancellation and approval maintenance,
 * with the real write gate, legacy captures, shadow mirror, journal and
 * attention store. Only the request/session, billing, notification fan-out,
 * the Next cache and the delivery fast path are replaced. Live clock-outs
 * never route approval (#361), so a policy clock-out is a historical one
 * seeded through the real ordinary submission. Every control row is inserted
 * directly: production has no setter.
 */

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
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
							user: {
								id: harness.userId,
								role: "user",
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
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

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t439.example.test",
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

vi.mock("@/app/[locale]/(app)/time-tracking/actions/policy-helpers", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@/app/[locale]/(app)/time-tracking/actions/policy-helpers")
		>();
	return {
		...original,
		getEditCapabilityForPeriod: async () => ({ type: "approval_required" as const }),
	};
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/app/[locale]/(app)/time-tracking/actions/shared")>();
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

// The best-effort fast path only runs the owner sooner.
vi.mock("@/lib/approvals/delivery/kick", () => ({ kickApprovalDelivery: () => undefined }));

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { requestTimeCorrection } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
const { approveTimeCorrection: approveOnWeb } = await import(
	"@/app/[locale]/(app)/approvals/actions"
);
const { cancelMyTimeCorrectionRequest } = await import("@/app/[locale]/(app)/my-requests/actions");
await import("@/lib/approvals/init");
const { POST: approveRoute } = await import("@/app/api/approvals/inbox/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/approvals/inbox/[id]/reject/route");
const { listApprovalEscalationCandidates, transferApprovalEscalationAssignment } = await import(
	"@/app/[locale]/(app)/settings/approval-escalation/actions"
);
const { processDueEscalations } = await import("./transfer");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { submitHistoricalPolicyClockOut } = await import(
	"@/lib/time-tracking/__tests__/historical-policy-clock-out"
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
	describe.skip(`legacy time transfer PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;
type TimeKind = (typeof TIME_KINDS)[number];
const MODES = ["legacy", "shadow", "ready"] as const;
type Mode = (typeof MODES)[number];

const ids = {
	organization: "t439-legacy-time-org",
	requesterUser: "t439-requester-user",
	managerUser: "t439-manager-user",
	backupUser: "t439-backup-user",
	thirdUser: "t439-third-user",
	adminUser: "t439-admin-user",
	requester: "e4390000-0000-4000-8000-000000000001",
	manager: "e4390000-0000-4000-8000-000000000002",
	backup: "e4390000-0000-4000-8000-000000000003",
	third: "e4390000-0000-4000-8000-000000000004",
	admin: "e4390000-0000-4000-8000-000000000005",
	managerLink: "e4391000-0000-4000-8000-000000000001",
	backupLink: "e4391000-0000-4000-8000-000000000002",
	thirdLink: "e4391000-0000-4000-8000-000000000003",
	changePolicy: "e4392000-0000-4000-8000-000000000001",
	changePolicyAssignment: "e4392000-0000-4000-8000-000000000002",
	chainPolicy: "e4393000-0000-4000-8000-000000000001",
	chainFirstStage: "e4393000-0000-4000-8000-000000000002",
	chainSecondStage: "e4393000-0000-4000-8000-000000000003",
} as const;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("escalated legacy time approvals (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string | null) {
		harness.userId = userId;
		harness.organizationId = userId ? ids.organization : null;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
		]);
	}

	async function setMode(mode: Mode | "canonical") {
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = $2, side_effect_mode = $3
			 where organization_id = $1`,
			[ids.organization, mode, mode === "canonical" ? "canonical" : "legacy"],
		);
	}

	async function seed(options: { mode?: Mode; twoStageChain?: boolean } = {}) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const mode = options.mode ?? "legacy";
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T439 time', $1, $2)`,
			[ids.organization, timestamp],
		);
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, 'legacy', $4, $4)`,
				[ids.organization, kind, mode, timestamp],
			);
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, $2, 'capture')`,
				[ids.organization, kind],
			);
		}
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t439"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't439-requester@example.test', $6, $6),
			 ($2, 'Morgan Manager', 't439-manager@example.test', $6, $6),
			 ($3, 'Blake Backup', 't439-backup@example.test', $6, $6),
			 ($4, 'Taylor Third', 't439-third@example.test', $6, $6),
			 ($5, 'Ada Admin', 't439-admin@example.test', $6, $6)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
			[
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
				timestamp,
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't439-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.thirdUser, ids.adminUser],
				ids.adminUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'employee', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'manager', $12),
			 ($9, $10, $11, 'admin', $12)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.backup,
				ids.backupUser,
				ids.third,
				ids.thirdUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		// All three are direct managers: the former holder stays eligible, the
		// backup is the first candidate, and the third never holds anything.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
			 ($1, $4, $5, true, $8, $9, $9),
			 ($2, $4, $6, false, $8, $9, $9),
			 ($3, $4, $7, false, $8, $10, $10)`,
			[
				ids.managerLink,
				ids.backupLink,
				ids.thirdLink,
				ids.requester,
				ids.manager,
				ids.backup,
				ids.third,
				ids.managerUser,
				timestamp,
				new Date("2026-07-02T00:00:00Z"),
			],
		);
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
		);
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T439 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.managerUser, timestamp],
		);
		if (options.twoStageChain) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T439 two stages', true, 1, $3, $4)`,
				[ids.chainPolicy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Second', 'specific_employee', $5, 'fail', $6)`,
				[
					ids.chainFirstStage,
					ids.chainSecondStage,
					ids.organization,
					ids.chainPolicy,
					ids.admin,
					timestamp,
				],
			);
		}
	}

	/** Real clock-in and clock-out; with approval, a historical policy clock-out. */
	async function recordWork(start: Instant, end: Instant, options: { approval: boolean }) {
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
		actAs(null);
		const { rows } = await admin.query<{ id: string }>(
			`select id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date(start.epochMilliseconds)],
		);
		const workPeriodId = only(rows).id;
		if (options.approval) {
			await submitHistoricalPolicyClockOut({
				organizationId: ids.organization,
				employeeId: ids.requester,
				userId: ids.requesterUser,
				workPeriodId,
			});
		}
		return workPeriodId;
	}

	async function submitManual(): Promise<string> {
		actAs(ids.requesterUser);
		const result = await createManualTimeEntry({
			version: 2,
			submissionId: randomUUID(),
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
		actAs(null);
		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		const { rows } = await admin.query<{ id: string }>(
			`select entity_id as id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and status = 'pending'
			 order by created_at desc limit 1`,
			[ids.organization],
		);
		return only(rows).id;
	}

	async function requestEdit(workPeriodId: string) {
		actAs(ids.requesterUser);
		const result = await requestTimeCorrection({
			workPeriodId,
			submissionId: randomUUID(),
			newClockInDate: "2026-07-22",
			newClockInTime: "07:30",
			newClockOutDate: "2026-07-22",
			newClockOutTime: "15:00",
			reason: "Started earlier",
			workLocationType: "office",
			workCategoryId: null,
		});
		actAs(null);
		expect(result).toMatchObject({ success: true });
	}

	/** Submissions of each kind through the real actions; returns the work period. */
	async function submit(kind: TimeKind): Promise<string> {
		switch (kind) {
			case "manual_time_submission":
				return submitManual();
			case "policy_clock_out":
				return recordWork(
					parseInstant("2026-07-21T08:00:00Z"),
					parseInstant("2026-07-21T12:00:00Z"),
					{ approval: true },
				);
			case "time_correction": {
				const workPeriodId = await recordWork(
					parseInstant("2026-07-22T08:00:00Z"),
					parseInstant("2026-07-22T16:00:00Z"),
					{ approval: false },
				);
				await requestEdit(workPeriodId);
				return workPeriodId;
			}
		}
	}

	async function pendingRequest(workPeriodId: string) {
		const { rows } = await admin.query<{
			id: string;
			created_at: Date;
			approver_id: string;
			metadata: Record<string, unknown> | null;
		}>(
			`select id, created_at at time zone 'UTC' as created_at, approver_id, metadata
			 from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	async function requestRow(requestId: string) {
		const { rows } = await admin.query<{
			approver_id: string;
			status: string;
			metadata: Record<string, unknown> | null;
		}>("select approver_id, status, metadata from approval_request where id = $1", [requestId]);
		return only(rows);
	}

	/** The observation the work period is bound to, with its holders in order. */
	async function observation(workPeriodId: string) {
		const { rows } = await admin.query<{ id: string; status: string; version: number }>(
			`select workflow.id, workflow.status, workflow.version
			 from work_period period
			 join approval_workflow workflow on workflow.id = period.approval_workflow_id
			 where period.id = $1`,
			[workPeriodId],
		);
		const workflow = only(rows);
		const { rows: assignments } = await admin.query<{
			id: string;
			approver_employee_id: string;
			status: string;
			assigned_at: Date;
			resolved_by_actor_kind: string | null;
			reassigned_from_assignment_id: string | null;
			reassignment_metadata: unknown;
		}>(
			`select id, approver_employee_id, status, assigned_at, resolved_by_actor_kind,
			   reassigned_from_assignment_id, reassignment_metadata
			 from approval_stage_assignment where workflow_id = $1 order by assignment_sequence`,
			[workflow.id],
		);
		return { ...workflow, assignments };
	}

	function escalateAt(from: Date, plusMinutes: number) {
		return processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(from.getTime() + plusMinutes * 60_000).toISOString()),
		});
	}

	async function journal() {
		const { rows } = await admin.query(
			`select * from approval_escalation_transfer
			 where organization_id = $1 order by created_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function openAttention() {
		const { rows } = await admin.query(
			`select reason, approval_type, evidence from approval_escalation_attention
			 where organization_id = $1 and status = 'open' order by first_raised_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function periodStatus(workPeriodId: string) {
		const { rows } = await admin.query<{ approval_status: string }>(
			"select approval_status from work_period where id = $1",
			[workPeriodId],
		);
		return only(rows).approval_status;
	}

	async function decideAs(userId: string, approvalId: string, action: "approve" | "reject") {
		actAs(userId);
		const url = `http://t439.example.test/api/approvals/inbox/${approvalId}/${action}`;
		const context = { params: Promise.resolve({ id: approvalId }) };
		const response =
			action === "approve"
				? await approveRoute(new NextRequest(url, { method: "POST" }), context)
				: await rejectRoute(
						new NextRequest(url, {
							method: "POST",
							body: JSON.stringify({ reason: "Not this week" }),
							headers: { "content-type": "application/json" },
						}),
						context,
					);
		actAs(null);
		return { status: response.status, body: (await response.json()) as Record<string, unknown> };
	}

	async function approveOnWebAs(userId: string, approvalId: string) {
		actAs(userId);
		const result = await approveOnWeb(approvalId);
		actAs(null);
		return result;
	}

	/** Submits one kind under a mode and transfers it at its deadline. */
	async function transferred(kind: TimeKind, mode: Mode = "legacy") {
		await seed({ mode });
		const workPeriodId = await submit(kind);
		const request = await pendingRequest(workPeriodId);
		expect(await escalateAt(request.created_at, 60)).toMatchObject({ transferred: 1 });
		return { workPeriodId, request, transfer: only(await journal()) };
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
			throw new Error("Legacy time transfer PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		actAs(null);
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe.each(MODES)("under %s authority", (mode) => {
		it.each(TIME_KINDS)(
			"transfers a due %s exactly at its deadline; only the replacement decides it",
			async (kind) => {
				await seed({ mode });
				const workPeriodId = await submit(kind);
				const request = await pendingRequest(workPeriodId);
				expect(request.approver_id).toBe(ids.manager);
				const before = mode === "legacy" ? null : await observation(workPeriodId);

				// Not even discovered one minute before the deadline.
				const early = await escalateAt(request.created_at, 59);
				expect(early).toMatchObject({ examined: 0, transferred: 0 });
				expect(early.authorities).toMatchObject({ [kind]: "legacy" });
				expect(await journal()).toEqual([]);

				const due = await escalateAt(request.created_at, 60);
				expect(due).toMatchObject({ status: "processed", transferred: 1, failed: 0 });
				const transfer = only(await journal());
				expect(transfer).toMatchObject({
					authority_mode: "legacy",
					initiator: "scheduled",
					workflow_type: kind,
					workflow_id: null,
					legacy_approval_request_id: request.id,
					legacy_source_sequence: 0,
					source_approver_employee_id: ids.manager,
					replacement_approver_employee_id: ids.backup,
					requester_employee_id: ids.requester,
					actionable_evidence: "legacy_request_created_at",
					policy_revision: 1,
					actor_kind: "system",
					actor_user_id: null,
				});
				expect(transfer.receipt_command_fingerprint).toMatch(
					new RegExp(`^${kind}-legacy-transfer:v1:[0-9a-f]{64}$`),
				);
				expect(transfer.deadline_at.getTime()).toBe(request.created_at.getTime() + 3_600_000);
				const moved = await requestRow(request.id);
				expect(moved).toMatchObject({ approver_id: ids.backup, status: "pending" });
				// Only the lineage is added; every key other owners read is kept.
				const { escalation: _lineage, ...kept } = moved.metadata ?? {};
				expect(kept).toEqual(request.metadata);
				expect(moved.metadata?.escalation).toMatchObject({
					version: 1,
					transfers: [
						{
							sequence: 0,
							fromApproverEmployeeId: ids.manager,
							toApproverEmployeeId: ids.backup,
							initiator: "scheduled",
							actorEmployeeId: null,
						},
					],
				});

				if (before) {
					// The observation shows the transfer in the same transaction.
					expect(transfer.observed_workflow_id).toBe(before.id);
					const mirrored = await observation(workPeriodId);
					expect(mirrored.version).toBe(before.version + 1);
					expect(mirrored.assignments).toMatchObject([
						{
							id: before.assignments[0]?.id,
							approver_employee_id: ids.manager,
							status: "cancelled",
							resolved_by_actor_kind: "system",
							reassigned_from_assignment_id: null,
						},
						{
							approver_employee_id: ids.backup,
							status: "pending",
							reassigned_from_assignment_id: before.assignments[0]?.id,
							reassignment_metadata: { kind: "escalation" },
						},
					]);
					expect(mirrored.assignments[0]?.assigned_at.toISOString()).toBe(
						before.assignments[0]?.assigned_at.toISOString(),
					);
					const { rows: events } = await admin.query(
						`select id, actor_kind from approval_workflow_event
						 where workflow_id = $1 and event_type = 'assignment.escalated'`,
						[before.id],
					);
					expect(only(events)).toMatchObject({
						id: transfer.observed_event_id,
						actor_kind: "system",
					});
				} else {
					expect(transfer.observed_workflow_id).toBeNull();
				}

				// The former holder is still an eligible manager of the requester, but
				// eligibility never bypasses the replacement: not on the web, not in
				// the inbox. Neither does another eligible manager who never held it.
				const web = await approveOnWebAs(ids.managerUser, request.id);
				expect(web.success).toBe(false);
				expect(JSON.stringify(web)).toContain("reassigned");
				for (const userId of [ids.managerUser, ids.thirdUser]) {
					const stale = await decideAs(userId, request.id, "approve");
					expect(stale.status).toBe(409);
					expect(String(stale.body.error)).toContain("reassigned");
				}
				expect((await requestRow(request.id)).status).toBe("pending");

				const decided = await decideAs(ids.backupUser, request.id, "approve");
				expect(decided).toMatchObject({ status: 200, body: { success: true } });
				expect(await requestRow(request.id)).toMatchObject({
					approver_id: ids.backup,
					status: "approved",
				});
				expect(await periodStatus(workPeriodId)).toBe("approved");
				if (before) {
					// The shadow history stays intact through the decision.
					const decidedObservation = await observation(workPeriodId);
					expect(decidedObservation.status).toBe("approved");
					expect(decidedObservation.assignments).toMatchObject([
						{ approver_employee_id: ids.manager, status: "cancelled" },
						{ approver_employee_id: ids.backup, status: "approved" },
					]);
				}
			},
		);
	});

	it.each(TIME_KINDS)(
		"keeps the shadow history through the replacement's rejection of a %s",
		async (kind) => {
			const { workPeriodId, request } = await transferred(kind, "shadow");

			const rejected = await decideAs(ids.backupUser, request.id, "reject");

			expect(rejected).toMatchObject({ status: 200 });
			expect((await requestRow(request.id)).status).toBe("rejected");
			const decided = await observation(workPeriodId);
			expect(decided.status).toBe("rejected");
			expect(decided.assignments).toMatchObject([
				{ approver_employee_id: ids.manager, status: "cancelled" },
				{ approver_employee_id: ids.backup, status: "rejected" },
			]);
		},
	);

	it.each(MODES)(
		"lets the requester cancel a transferred correction under %s and keeps its lineage",
		async (mode) => {
			const { workPeriodId, request, transfer } = await transferred("time_correction", mode);
			const before = mode === "legacy" ? null : await observation(workPeriodId);

			actAs(ids.requesterUser);
			expect(await cancelMyTimeCorrectionRequest(workPeriodId)).toEqual({ success: true });
			actAs(null);

			// The retained tombstone still names the holders the journal replaced.
			const cancelled = await requestRow(request.id);
			expect(cancelled.metadata).toMatchObject({
				timeCorrectionOriginalWorkMetadata: request.metadata?.timeCorrectionOriginalWorkMetadata,
				cancellation: { kind: "requester" },
				escalation: {
					transfers: [{ fromApproverEmployeeId: ids.manager, toApproverEmployeeId: ids.backup }],
				},
			});
			if (before) {
				// The observation closes with the former holder's history intact.
				const closed = await observation(workPeriodId);
				expect(closed).toMatchObject({ id: before.id, status: "cancelled" });
				expect(closed.version).toBe(before.version + 1);
				expect(closed.assignments).toMatchObject([
					{
						id: before.assignments[0]?.id,
						approver_employee_id: ids.manager,
						status: "cancelled",
						resolved_by_actor_kind: "system",
					},
					{
						id: before.assignments[1]?.id,
						approver_employee_id: ids.backup,
						status: "cancelled",
						resolved_by_actor_kind: "employee",
						reassigned_from_assignment_id: before.assignments[0]?.id,
					},
				]);
			}
			expect(only(await journal()).id).toBe(transfer.id);
			expect(await escalateAt(transfer.transferred_at, 180)).toMatchObject({ examined: 0 });

			// A replay changes nothing, not even the closed observation.
			actAs(ids.requesterUser);
			expect(await cancelMyTimeCorrectionRequest(workPeriodId)).toEqual({ success: true });
			actAs(null);
			expect(await requestRow(request.id)).toEqual(cancelled);
			if (before) {
				expect((await observation(workPeriodId)).version).toBe(before.version + 1);
			}
		},
	);

	it("lets explicit organization management decide a transferred legacy approval", async () => {
		const { workPeriodId, request } = await transferred("time_correction");

		const managed = await decideAs(ids.adminUser, request.id, "approve");

		expect(managed).toMatchObject({ status: 200, body: { success: true } });
		expect((await requestRow(request.id)).status).toBe("approved");
		expect(await periodStatus(workPeriodId)).toBe("approved");
	});

	it("never transfers a lineage twice automatically and replays nothing on later runs", async () => {
		const { request, transfer } = await transferred("policy_clock_out");

		const rerun = await escalateAt(transfer.transferred_at, 61);
		expect(rerun).toMatchObject({ transferred: 0, held: { replacement_overdue: 1 } });
		expect(await journal()).toHaveLength(1);
		expect(only(await openAttention())).toMatchObject({
			reason: "replacement_overdue",
			approval_type: "policy_clock_out",
		});
		expect((await requestRow(request.id)).approver_id).toBe(ids.backup);
	});

	it("serializes simultaneous scheduled attempts into one committed transfer", async () => {
		await seed({ mode: "shadow" });
		const workPeriodId = await submit("manual_time_submission");
		const request = await pendingRequest(workPeriodId);

		const results = await Promise.all([
			escalateAt(request.created_at, 60),
			escalateAt(request.created_at, 60),
		]);

		expect(results.reduce((total, result) => total + result.transferred, 0)).toBe(1);
		expect(results.every((result) => result.failed === 0)).toBe(true);
		expect(await journal()).toHaveLength(1);
		expect((await requestRow(request.id)).approver_id).toBe(ids.backup);
		expect((await observation(workPeriodId)).assignments).toHaveLength(2);
	});

	it.each(MODES)(
		"lets exactly one of a transfer and a concurrent decision by the current holder win (%s)",
		async (mode) => {
			await seed({ mode });
			const workPeriodId = await submit("time_correction");
			const request = await pendingRequest(workPeriodId);

			const [processed, decision] = await Promise.all([
				escalateAt(request.created_at, 60),
				decideAs(ids.managerUser, request.id, "approve"),
			]);

			const transfers = await journal();
			const row = await requestRow(request.id);
			if (decision.status === 200) {
				expect(row).toMatchObject({ status: "approved", approver_id: ids.manager });
				expect(transfers).toEqual([]);
			} else {
				expect(row).toMatchObject({ status: "pending", approver_id: ids.backup });
				expect(transfers).toHaveLength(1);
				expect(processed.transferred).toBe(1);
			}
			expect(processed.failed).toBe(0);
		},
	);

	it("serializes an eligible non-holder's decision behind an in-flight transfer and then refuses it", async () => {
		await seed();
		const workPeriodId = await submit("manual_time_submission");
		const request = await pendingRequest(workPeriodId);

		// Play the transfer's transaction by hand and keep its row lock open.
		const transferring = await admin.connect();
		let decisionSettled = false;
		try {
			await transferring.query("begin");
			await transferring.query("select id from approval_request where id = $1 for update", [
				request.id,
			]);
			await transferring.query("update approval_request set approver_id = $2 where id = $1", [
				request.id,
				ids.backup,
			]);
			await transferring.query(
				`insert into approval_escalation_transfer
				 (organization_id, operation_key, initiator, authority_mode, workflow_type,
				  legacy_approval_request_id, legacy_source_sequence,
				  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
				  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
				  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
				 values ($1, 't439-in-flight', 'human', 'legacy', 'manual_time_submission', $2, 0,
				  $3, $4, $5, 't439-in-flight', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
				[
					ids.organization,
					request.id,
					ids.manager,
					ids.backup,
					ids.requester,
					ids.adminUser,
					ids.admin,
				],
			);

			const decision = decideAs(ids.thirdUser, request.id, "approve").finally(() => {
				decisionSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			// The decision waits on the transfer instead of deciding around it.
			expect(decisionSettled).toBe(false);

			await transferring.query("commit");
			const refused = await decision;
			expect(refused.status).toBe(409);
			expect(String(refused.body.error)).toContain("reassigned");
		} finally {
			await transferring.query("rollback").catch(() => undefined);
			transferring.release();
		}
		expect(await requestRow(request.id)).toMatchObject({
			status: "pending",
			approver_id: ids.backup,
		});
	});

	it("transfers through the management action with audit and exact replay; the allowance stays unused", async () => {
		await seed({ mode: "shadow" });
		const workPeriodId = await submit("time_correction");
		const request = await pendingRequest(workPeriodId);

		actAs(ids.adminUser);
		const candidates = await listApprovalEscalationCandidates({ approvalRequestId: request.id });
		expect(candidates).toMatchObject({
			success: true,
			data: {
				currentApprover: { employeeId: ids.manager, name: "Morgan Manager" },
				candidates: [
					{ employeeId: ids.backup, recommended: true },
					{ employeeId: ids.third, recommended: false },
				],
			},
		});
		const transfer = {
			approvalRequestId: request.id,
			recipientEmployeeId: ids.third,
			idempotencyKey: "e4394000-0000-4000-8000-000000000001",
			reason: "Morgan is on leave",
		};
		expect(await transferApprovalEscalationAssignment(transfer)).toEqual({
			success: true,
			data: { replayed: false },
		});
		expect(await transferApprovalEscalationAssignment(transfer)).toEqual({
			success: true,
			data: { replayed: true },
		});
		expect(
			await transferApprovalEscalationAssignment({ ...transfer, recipientEmployeeId: ids.backup }),
		).toMatchObject({ success: false });
		actAs(null);

		const human = only(await journal());
		expect(human).toMatchObject({
			initiator: "human",
			authority_mode: "legacy",
			workflow_type: "time_correction",
			actor_kind: "user",
			actor_user_id: ids.adminUser,
			actor_employee_id: ids.admin,
			replacement_approver_employee_id: ids.third,
			actionable_at: null,
			deadline_at: null,
		});
		expect(human.observed_workflow_id).not.toBeNull();
		const { rows: audits } = await admin.query(
			"select action from audit_log where organization_id = $1 and entity_id = $2",
			[ids.organization, human.id],
		);
		expect(only(audits)).toMatchObject({ action: "approval_escalation.transferred" });

		// A human transfer does not consume the automatic allowance: the
		// requester's primary manager is the first eligible candidate again.
		const later = await escalateAt(human.transferred_at, 60);
		expect(later).toMatchObject({ transferred: 1 });
		const automatic = (await journal()).find((row) => row.initiator === "scheduled");
		expect(automatic).toMatchObject({
			legacy_source_sequence: 1,
			source_approver_employee_id: ids.third,
			replacement_approver_employee_id: ids.manager,
		});
		expect((await observation(workPeriodId)).assignments).toMatchObject([
			{ approver_employee_id: ids.manager, status: "cancelled" },
			{ approver_employee_id: ids.third, status: "cancelled" },
			{ approver_employee_id: ids.manager, status: "pending" },
		]);
	});

	it("re-evaluates a #326 legacy time authority hold and resolves it by the transfer", async () => {
		await seed();
		const workPeriodId = await submit("manual_time_submission");
		const request = await pendingRequest(workPeriodId);
		// The hold #326 committed for this request once it was due.
		const { raiseEscalationAttention } = await import("./attention-store");
		await raiseEscalationAttention(db as never, {
			organizationId: ids.organization,
			reason: "unsupported_route",
			subject: {
				kind: "legacy_assignment",
				approvalRequestId: request.id,
				approverEmployeeId: ids.manager,
			},
			approvalType: "manual_time_submission",
			approvalRequestId: request.id,
			policyRevision: 1,
			evidence: { route: "legacy_time_authority" },
		});

		expect(await escalateAt(request.created_at, 60)).toMatchObject({
			examined: 1,
			transferred: 1,
		});
		expect(await openAttention()).toEqual([]);
		expect((await requestRow(request.id)).approver_id).toBe(ids.backup);
	});

	describe("holds without partial writes", () => {
		async function expectUntouched(
			request: { id: string },
			workPeriodId: string,
			observed: { version: number } | null,
		) {
			expect(await journal()).toEqual([]);
			const row = await requestRow(request.id);
			expect(row).toMatchObject({ approver_id: ids.manager, status: "pending" });
			expect(row.metadata).not.toHaveProperty("escalation");
			if (observed) {
				expect((await observation(workPeriodId)).version).toBe(observed.version);
			}
		}

		it.each(["manual_time_submission", "time_correction"] as const)(
			"holds a %s chain stage as an unsupported route once due",
			async (kind) => {
				await seed({ twoStageChain: true });
				const workPeriodId = await submit(kind);
				const request = await pendingRequest(workPeriodId);

				expect(await escalateAt(request.created_at, 30)).toMatchObject({
					transferred: 0,
					held: {},
				});
				expect(await escalateAt(request.created_at, 60)).toMatchObject({
					transferred: 0,
					held: { unsupported_route: 1 },
				});
				expect(only(await openAttention())).toMatchObject({
					approval_type: kind,
					evidence: { route: "legacy_chain_stage" },
				});
				await expectUntouched(request, workPeriodId, null);
			},
		);

		it("holds a request whose verified capture contradicts its row as unverifiable", async () => {
			await seed();
			const workPeriodId = await submit("manual_time_submission");
			const request = await pendingRequest(workPeriodId);
			await admin.query(
				`update approval_request
				 set metadata = jsonb_set(metadata, '{surchargeSnapshot,version}', '99'::jsonb)
				 where id = $1`,
				[request.id],
			);

			expect(await escalateAt(request.created_at, 60)).toMatchObject({
				transferred: 0,
				held: { ambiguous_history: 1 },
			});
			expect(only(await openAttention())).toMatchObject({
				reason: "ambiguous_history",
				approval_type: "manual_time_submission",
				evidence: { cause: "legacy_state_unverifiable" },
			});
			await expectUntouched(request, workPeriodId, null);
		});

		it("holds a mirroring mode without a pending observation", async () => {
			await seed();
			const workPeriodId = await submit("time_correction");
			const request = await pendingRequest(workPeriodId);
			// Submitted before shadowing: nothing observed the request.
			await setMode("shadow");

			expect(await escalateAt(request.created_at, 60)).toMatchObject({
				transferred: 0,
				held: { unsupported_route: 1 },
			});
			expect(only(await openAttention())).toMatchObject({
				approval_type: "time_correction",
				evidence: { route: "legacy_observation_missing" },
			});
			await expectUntouched(request, workPeriodId, null);
		});

		it("holds a transfer the shadow observation contradicts", async () => {
			await seed({ mode: "shadow" });
			const workPeriodId = await submit("policy_clock_out");
			const request = await pendingRequest(workPeriodId);
			const observed = await observation(workPeriodId);
			// The observation names another holder than the legacy request.
			await admin.query(
				`update approval_stage_assignment set approver_employee_id = $2 where id = $1`,
				[observed.assignments[0]?.id, ids.third],
			);

			expect(await escalateAt(request.created_at, 60)).toMatchObject({
				transferred: 0,
				held: { ambiguous_history: 1 },
			});
			expect(only(await openAttention())).toMatchObject({
				reason: "ambiguous_history",
				approval_type: "policy_clock_out",
				evidence: { cause: "legacy_observation_contradicted" },
			});
			await expectUntouched(request, workPeriodId, observed);
		});

		it("holds a time request of a kind decided canonically without a canonical assignment", async () => {
			await seed();
			const workPeriodId = await submit("manual_time_submission");
			const request = await pendingRequest(workPeriodId);
			await admin.query(
				`update approval_workflow_rollout set lifecycle_mode = 'canonical',
				   side_effect_mode = 'canonical'
				 where organization_id = $1 and workflow_type = 'manual_time_submission'`,
				[ids.organization],
			);

			expect(await escalateAt(request.created_at, 60)).toMatchObject({
				transferred: 0,
				held: { unsupported_route: 1 },
			});
			expect(only(await openAttention())).toMatchObject({
				evidence: { route: "legacy_time_without_legacy_authority" },
			});
			await expectUntouched(request, workPeriodId, null);
			// A permanently held request no longer takes a place in later batches.
			expect(await escalateAt(request.created_at, 180)).toMatchObject({ examined: 0 });
		});
	});

	it("removes a legacy time lifecycle's journal through approval maintenance", async () => {
		const { request, transfer } = await transferred("manual_time_submission");

		const deleted = await deleteApproval(db as never, ids.organization, request.id);

		expect(deleted.legacyRequests).toEqual([request.id]);
		expect(deleted.escalationTransfers).toEqual([transfer.id]);
		expect(await journal()).toEqual([]);
		const { rows: events } = await admin.query(
			"select id from approval_escalation_transfer_event where transfer_id = $1",
			[transfer.id],
		);
		expect(events).toEqual([]);
	});
});
