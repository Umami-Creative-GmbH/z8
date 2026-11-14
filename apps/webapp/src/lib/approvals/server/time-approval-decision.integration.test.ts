/**
 * The time approval decision (#1675, spec #1673) at its interface, against
 * PostgreSQL: kind × approval authority (legacy, shadow mirroring, canonical)
 * × decision right, every unbound refusal, replay, and the after-commit work
 * by its effects. Time requests are submitted through the real actions; the
 * decision reads no session, so none is signed in while deciding.
 *
 * Only the request/session, billing, notification fan-out (recorded), the
 * logger's errors (recorded), the Next cache and the delivery fast path
 * (recorded) are replaced.
 *
 * Run: pnpm --filter webapp test:integration src/lib/approvals/server/time-approval-decision.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	notifications: [] as Array<{ name: string; params: Record<string, unknown> }>,
	loggedErrors: [] as Array<{ component: string; message: unknown }>,
	kicks: [] as Array<{ organizationId: string }>,
	failingTriggers: new Set<string>(),
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

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
	// The decision never asks the session; a session that grants everything proves it.
	getAbility: async () => ({ can: () => true, cannot: () => false }),
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

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1675.example.test",
}));
// Every trigger is recorded instead of fanned out.
vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function"
				? async (params: Record<string, unknown>) => {
						harness.notifications.push({ name, params });
						if (harness.failingTriggers.has(name)) throw new Error(`${name} unavailable`);
					}
				: value,
		]),
	);
});
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	return {
		...original,
		createLogger: (component: string) => {
			const child = original.createLogger(component);
			const error = child.error.bind(child);
			child.error = ((...args: unknown[]) => {
				harness.loggedErrors.push({ component, message: args[1] });
				return (error as (...input: unknown[]) => void)(...args);
			}) as typeof child.error;
			return child;
		},
	};
});
vi.mock("@/lib/time-tracking/change-policy/verdict", async (original) =>
	(
		await import("@/lib/time-tracking/change-policy/testing/verdict.test.fixture")
	).stubChangePolicyVerdict(original, () => ({ type: "approval_required" })),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(harness.kicks),
);
vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));
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

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { requestTimeCorrection } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
const { submitHistoricalPolicyClockOut } = await import(
	"@/lib/time-tracking/__tests__/historical-policy-clock-out"
);
const { processDueEscalations } = await import("@/lib/approvals/escalation/transfer");
const { approvalRolloutLockScope } = await import("@/lib/approvals/authority/gate");
const { decideTimeApproval } = await import("./time-approval-decision");
type DecisionInput = Parameters<typeof decideTimeApproval>[0];

const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;
type TimeKind = (typeof TIME_KINDS)[number];
const AUTHORITIES = ["legacy", "shadow", "canonical"] as const;
type Authority = (typeof AUTHORITIES)[number];

const ids = {
	organization: "t1675-time-decision-org",
	requesterUser: "t1675-requester-user",
	approverUser: "t1675-approver-user",
	deputyUser: "t1675-deputy-user",
	thirdUser: "t1675-third-user",
	backupUser: "t1675-backup-user",
	adminUser: "t1675-admin-user",
	requester: "e1675000-0000-4000-8000-000000000001",
	approver: "e1675000-0000-4000-8000-000000000002",
	deputy: "e1675000-0000-4000-8000-000000000003",
	third: "e1675000-0000-4000-8000-000000000004",
	backup: "e1675000-0000-4000-8000-000000000005",
	admin: "e1675000-0000-4000-8000-000000000006",
	away: "e1675100-0000-4000-8000-000000000001",
	coveringAbsence: "e1675100-0000-4000-8000-000000000002",
	changePolicy: "e1675200-0000-4000-8000-000000000001",
	changePolicyAssignment: "e1675200-0000-4000-8000-000000000002",
	chainPolicy: "e1675300-0000-4000-8000-000000000001",
	chainFirstStage: "e1675300-0000-4000-8000-000000000002",
	chainSecondStage: "e1675300-0000-4000-8000-000000000003",
	surchargeModel: "e1675400-0000-4000-8000-000000000001",
	surchargeAssignment: "e1675400-0000-4000-8000-000000000002",
	closedMonth: "e1675500-0000-4000-8000-000000000001",
} as const;

const USERS = [
	ids.requesterUser,
	ids.approverUser,
	ids.deputyUser,
	ids.thirdUser,
	ids.backupUser,
	ids.adminUser,
];

const actors = {
	requester: { employeeId: ids.requester, userId: ids.requesterUser },
	approver: { employeeId: ids.approver, userId: ids.approverUser },
	deputy: { employeeId: ids.deputy, userId: ids.deputyUser },
	third: { employeeId: ids.third, userId: ids.thirdUser },
	backup: { employeeId: ids.backup, userId: ids.backupUser },
	admin: { employeeId: ids.admin, userId: ids.adminUser },
} as const;

const DECISION_TRIGGERS: Record<TimeKind, { approve: string; reject: string }> = {
	manual_time_submission: { approve: "onManualEntryApproved", reject: "onManualEntryRejected" },
	policy_clock_out: { approve: "onClockOutApproved", reject: "onClockOutRejected" },
	time_correction: { approve: "onTimeCorrectionApproved", reject: "onTimeCorrectionRejected" },
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** A UTC calendar date `days` from today. */
function utcDay(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("time approval decision (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string | null) {
		harness.userId = userId;
		harness.organizationId = userId ? ids.organization : null;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [USERS]);
	}

	async function setAuthority(authority: Authority) {
		const mode = authority === "canonical" ? "canonical" : authority;
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = $2, side_effect_mode = $3
			 where organization_id = $1`,
			[ids.organization, mode, authority === "canonical" ? "canonical" : "legacy"],
		);
	}

	async function seed(
		options: { authority?: Authority; evidenceCapture?: boolean; twoStageChain?: boolean } = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const authority = options.authority ?? "legacy";
		await admin.query(
			`insert into organization (id, name, slug, timezone, surcharges_enabled, created_at)
			 values ($1, 'T1675 time decision', $1, 'UTC', true, $2)`,
			[ids.organization, timestamp],
		);
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $5)`,
				[
					ids.organization,
					kind,
					authority,
					authority === "canonical" ? "canonical" : "legacy",
					timestamp,
				],
			);
			if (options.evidenceCapture !== false) {
				await admin.query(
					`insert into approval_evidence_control (organization_id, workflow_type, mode)
					 values ($1, $2, 'capture')`,
					[ids.organization, kind],
				);
			}
			// A delivery control makes a legacy decision record its delivery intent.
			await admin.query(
				`insert into approval_delivery_control (organization_id, workflow_type, provider)
				 values ($1, $2, 'telegram')`,
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
			 values ($1, true, 1, 1, '{"source":"t1675"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't1675-requester@example.test', $7, $7),
			 ($2, 'Xavier Approver', 't1675-approver@example.test', $7, $7),
			 ($3, 'Yara Deputy', 't1675-deputy@example.test', $7, $7),
			 ($4, 'Taylor Third', 't1675-third@example.test', $7, $7),
			 ($5, 'Blake Backup', 't1675-backup@example.test', $7, $7),
			 ($6, 'Ada Admin', 't1675-admin@example.test', $7, $7)`,
			[...USERS, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
			[USERS, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't1675-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, USERS, ids.adminUser],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $13, 'employee', $14), ($3, $4, $13, 'manager', $14),
			 ($5, $6, $13, 'manager', $14), ($7, $8, $13, 'manager', $14),
			 ($9, $10, $13, 'manager', $14), ($11, $12, $13, 'admin', $14)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.approver,
				ids.approverUser,
				ids.deputy,
				ids.deputyUser,
				ids.third,
				ids.thirdUser,
				ids.backup,
				ids.backupUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		// X is the primary manager and approver; B is the escalation backup; T is
		// an eligible manager who holds nothing. Y manages nobody.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at) values
			 (gen_random_uuid(), $1, $2, true, $5, $6, $6),
			 (gen_random_uuid(), $1, $3, false, $5, $6, $6),
			 (gen_random_uuid(), $1, $4, false, $5, $7, $7)`,
			[
				ids.requester,
				ids.approver,
				ids.backup,
				ids.third,
				ids.approverUser,
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
			 values ($1, $2, 'T1675 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
		// Monday and Tuesday work earns a surcharge, so maintenance is observable.
		await admin.query(
			`insert into surcharge_model
			 (id, organization_id, name, is_active, created_by, created_at, updated_at)
			 values ($1, $2, 'T1675 weekdays', true, $3, $4, $4)`,
			[ids.surchargeModel, ids.organization, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into surcharge_rule
			 (id, model_id, name, rule_type, percentage, day_of_week, priority, is_active, created_by, created_at)
			 values (gen_random_uuid(), $1, 'Monday 50%', 'day_of_week', 0.5, 'monday', 1, true, $2, $3),
			        (gen_random_uuid(), $1, 'Tuesday 50%', 'day_of_week', 0.5, 'tuesday', 1, true, $2, $3)`,
			[ids.surchargeModel, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into surcharge_model_assignment
			 (id, model_id, organization_id, assignment_type, priority, is_active, created_by, created_at, updated_at)
			 values ($1, $2, $3, 'organization', 0, true, $4, $5, $5)`,
			[ids.surchargeAssignment, ids.surchargeModel, ids.organization, ids.adminUser, timestamp],
		);
		if (options.twoStageChain) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T1675 two stages', true, 1, $3, $4)`,
				[ids.chainPolicy, ids.organization, ids.approverUser, timestamp],
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

	/** X is away around today and names Y as deputy; deputy decisions are on. */
	async function seedCover() {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, true)
			 on conflict (organization_id) do update set deputy_decisions_enabled = true`,
			[ids.organization],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time,
			  counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'vacation', 'Away', true, false, false, true, $3)`,
			[ids.away, ids.organization, timestamp],
		);
		await admin.query(
			`insert into absence_entry
			 (id, employee_id, category_id, start_date, end_date, status, organization_id,
			  deputy_employee_id, updated_at)
			 values ($1, $2, $3, $4, $5, 'approved', $6, $7, $8)`,
			[
				ids.coveringAbsence,
				ids.approver,
				ids.away,
				utcDay(-2),
				utcDay(2),
				ids.organization,
				ids.deputy,
				timestamp,
			],
		);
	}

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
			clockIn: { time: "09:00", occurrence: null, displayedOffsetMinutes: 0 },
			clockOut: { time: "17:00", occurrence: null, displayedOffsetMinutes: 0 },
			zone: { basis: "browser", timezone: "UTC" },
			browserTimezone: "UTC",
			reason: "Forgot to clock",
			projectId: null,
			workCategoryId: null,
		});
		actAs(null);
		expect(result).toMatchObject({ success: true, data: { requiresApproval: true } });
		const { rows } = await admin.query<{ id: string }>(
			`select id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
			[ids.requester, new Date("2026-07-20T09:00:00Z")],
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

	/** Submits one kind through the real actions; returns the work period. */
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

	/** The approval to decide: the pending legacy request, or under canonical authority the pending assignment. */
	async function pendingApproval(workPeriodId: string, authority: Authority) {
		if (authority === "canonical") {
			const { rows } = await admin.query<{ id: string; approver_id: string; workflow_id: string }>(
				`select a.id, a.approver_employee_id as approver_id, a.workflow_id
				 from approval_stage_assignment a
				 join approval_workflow w on w.id = a.workflow_id
				 where w.organization_id = $1 and w.source_id = $2 and w.status = 'pending'
				   and a.status = 'pending'`,
				[ids.organization, workPeriodId],
			);
			// Parallel reviewers: the stage's assignment of the approver.
			return rows.length > 1 ? only(rows.filter((row) => row.approver_id === ids.approver)) : only(rows);
		}
		const { rows } = await admin.query<{
			id: string;
			approver_id: string;
			created_at: Date;
		}>(
			`select id, approver_id, created_at at time zone 'UTC' as created_at from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	async function submitted(
		kind: TimeKind,
		authority: Authority,
		options: Parameters<typeof seed>[0] = {},
	) {
		await seed({ ...options, authority });
		const workPeriodId = await submit(kind);
		const approval = await pendingApproval(workPeriodId, authority);
		harness.notifications.length = 0;
		harness.kicks.length = 0;
		harness.loggedErrors.length = 0;
		return { workPeriodId, approval };
	}

	function decide(
		actor: { employeeId: string; userId: string },
		approvalId: string,
		right: DecisionInput["right"],
		extra: Partial<DecisionInput> = {},
	) {
		return decideTimeApproval({
			organizationId: ids.organization,
			approvalId,
			actor,
			right,
			decision: { kind: "approve" },
			...extra,
		});
	}

	async function periodStatus(workPeriodId: string) {
		const { rows } = await admin.query<{ approval_status: string }>(
			"select approval_status from work_period where id = $1 and organization_id = $2",
			[workPeriodId, ids.organization],
		);
		return only(rows).approval_status;
	}

	/** The decided approval's own status: its legacy request, else its canonical assignment. */
	async function approvalStatus(approvalId: string) {
		const { rows } = await admin.query<{ status: string }>(
			`select status::text as status from approval_request where id = $1 and organization_id = $2
			 union all
			 select status::text from approval_stage_assignment where id = $1 and organization_id = $2`,
			[approvalId, ids.organization],
		);
		return only(rows).status;
	}

	/** The work period's approval workflow (observed under shadow mirroring, else canonical). */
	async function workflowOf(workPeriodId: string) {
		const { rows } = await admin.query<{ status: string; display_snapshot: unknown }>(
			`select status::text as status, display_snapshot from approval_workflow
			 where organization_id = $1 and source_id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	/** Raises inside the decision whenever `table` is written as `event`. */
	async function failingWrites<T>(
		table: string,
		event: "insert" | "update",
		run: () => Promise<T>,
	): Promise<T> {
		await admin.query(`create or replace function t1681_fail_write() returns trigger as $$
			begin raise exception 't1681 injected write failure'; end;
			$$ language plpgsql`);
		await admin.query(
			`create trigger t1681_fail_write before ${event} on ${table}
			 for each row execute function t1681_fail_write()`,
		);
		try {
			return await run();
		} finally {
			await admin.query(`drop trigger if exists t1681_fail_write on ${table}`);
			await admin.query("drop function if exists t1681_fail_write()");
		}
	}

	async function surchargeCount(workPeriodId: string) {
		const { rows } = await admin.query<{ count: string }>(
			"select count(*)::text as count from surcharge_calculation where organization_id = $1 and work_period_id = $2",
			[ids.organization, workPeriodId],
		);
		return Number(only(rows).count);
	}

	async function deputyRecords() {
		const { rows } = await admin.query(
			`select deputy_employee_id, acting_for_employee_id, authority, entity_id, decision
			 from approval_deputy_decision where organization_id = $1 order by decided_at`,
			[ids.organization],
		);
		return rows;
	}

	function decisionNotifications() {
		const names = Object.values(DECISION_TRIGGERS).flatMap((trigger) => [
			trigger.approve,
			trigger.reject,
		]);
		return harness.notifications.filter((entry) => names.includes(entry.name));
	}

	async function escalate(approval: { created_at?: Date }) {
		if (!approval.created_at) throw new Error("Escalation needs a legacy request");
		const at = new Date(approval.created_at.getTime() + 60 * 60_000);
		expect(
			await processDueEscalations({
				organizationId: ids.organization,
				now: parseInstant(at.toISOString()),
			}),
		).toMatchObject({ transferred: 1 });
	}

	beforeEach(() => {
		actAs(null);
		harness.failingTriggers.clear();
		harness.notifications.length = 0;
		harness.kicks.length = 0;
		harness.loggedErrors.length = 0;
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each(AUTHORITIES)("under %s authority", (authority) => {
		const legacy = authority !== "canonical";

		it.each(TIME_KINDS)(
			"the approver approves a %s and the after-commit work follows",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, authority);

				const result = await decide(actors.approver, approval.id, { as: "approver" });

				expect(result).toEqual({
					status: "decided",
					kind,
					workPeriodId,
					outcome: "approved",
					replayed: false,
				});
				expect(await approvalStatus(approval.id)).toBe("approved");
				if (kind !== "time_correction") expect(await periodStatus(workPeriodId)).toBe("approved");
				// Shadow mirroring decides the observed workflow in the same transaction.
				if (authority !== "legacy") expect((await workflowOf(workPeriodId)).status).toBe("approved");
				// Legacy authority notifies from here; canonical authority through the outbox.
				expect(decisionNotifications().map((entry) => entry.name)).toEqual(
					legacy ? [DECISION_TRIGGERS[kind].approve] : [],
				);
				expect(harness.kicks).toHaveLength(legacy ? 1 : 0);
				// Surcharge maintenance runs for the ordinary kinds under either authority.
				if (kind !== "time_correction")
					expect(await surchargeCount(workPeriodId)).toBeGreaterThan(0);
				expect(harness.loggedErrors).toEqual([]);
			},
		);

		it.each(TIME_KINDS)("the approver rejects a %s", async (kind) => {
			const { workPeriodId, approval } = await submitted(kind, authority);

			const result = await decide(
				actors.approver,
				approval.id,
				{ as: "approver" },
				{
					decision: { kind: "reject", reason: "Not this week" },
				},
			);

			expect(result).toEqual({
				status: "decided",
				kind,
				workPeriodId,
				outcome: "rejected",
				replayed: false,
			});
			expect(await approvalStatus(approval.id)).toBe("rejected");
			if (kind !== "time_correction") expect(await periodStatus(workPeriodId)).toBe("rejected");
			if (authority !== "legacy") expect((await workflowOf(workPeriodId)).status).toBe("rejected");
			expect(decisionNotifications().map((entry) => entry.name)).toEqual(
				legacy ? [DECISION_TRIGGERS[kind].reject] : [],
			);
			if (kind !== "time_correction") expect(await surchargeCount(workPeriodId)).toBe(0);
		});

		it.each(TIME_KINDS)(
			"a manager of approvals decides a %s from the database, with no session",
			async (kind) => {
				const { approval } = await submitted(kind, authority);

				const result = await decide(actors.admin, approval.id, { as: "approval_manager" });

				expect(result).toMatchObject({ status: "decided", outcome: "approved" });
				expect(await approvalStatus(approval.id)).toBe("approved");
			},
		);

		it.each(TIME_KINDS)("an eligible manager decides a %s", async (kind) => {
			const { approval } = await submitted(kind, authority);

			const result = await decide(actors.third, approval.id, { as: "eligible_manager" });

			expect(result).toMatchObject({ status: "decided", outcome: "approved" });
			expect(await approvalStatus(approval.id)).toBe("approved");
		});

		it.each(TIME_KINDS)(
			"a covering deputy decides a %s for the absent approver and the record names both",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, authority);
				await seedCover();

				const result = await decide(actors.deputy, approval.id, {
					as: "covering_deputy",
					forEmployeeId: ids.approver,
				});

				expect(result).toMatchObject({ status: "decided", outcome: "approved" });
				expect(await deputyRecords()).toEqual([
					{
						deputy_employee_id: ids.deputy,
						acting_for_employee_id: ids.approver,
						authority: legacy ? "legacy" : "canonical",
						entity_id: workPeriodId,
						decision: "approved",
					},
				]);
			},
		);

		it.each(TIME_KINDS)(
			"no fallback: a manager of approvals who claims approver on another's %s is refused",
			async (kind) => {
				const { approval } = await submitted(kind, authority);

				const result = await decide(actors.admin, approval.id, { as: "approver" });

				expect(result).toEqual({ status: "refused", reason: "right_not_held" });
				expect(await approvalStatus(approval.id)).toBe("pending");
			},
		);

		it.each(TIME_KINDS)(
			"no fallback: the approver who claims management of approvals on a %s they do not manage is refused",
			async (kind) => {
				const { approval } = await submitted(kind, authority);

				const result = await decide(actors.approver, approval.id, { as: "approval_manager" });

				expect(result).toEqual({ status: "refused", reason: "right_not_held" });
				expect(await approvalStatus(approval.id)).toBe("pending");
			},
		);

		it.each(TIME_KINDS)(
			"no fallback: the approver who claims to cover for themselves on a %s is refused and no deputy decision is made",
			async (kind) => {
				const { approval } = await submitted(kind, authority);
				await seedCover();

				const result = await decide(actors.approver, approval.id, {
					as: "covering_deputy",
					forEmployeeId: ids.approver,
				});

				expect(result).toEqual({ status: "refused", reason: "right_not_held" });
				expect(await approvalStatus(approval.id)).toBe("pending");
				expect(await deputyRecords()).toEqual([]);
			},
		);

		it.each(TIME_KINDS)(
			"a platform administrator's session-wide access alone does not decide a %s",
			async (kind) => {
				const { approval } = await submitted(kind, authority);
				// Y is a plain member who manages nobody; only the platform role is raised.
				await admin.query(`update "user" set role = 'admin' where id = $1`, [ids.deputyUser]);
				actAs(ids.deputyUser);

				const result = await decide(actors.deputy, approval.id, { as: "approval_manager" });

				expect(result).toEqual({ status: "refused", reason: "right_not_held" });
				expect(await approvalStatus(approval.id)).toBe("pending");
			},
		);

		it.each(TIME_KINDS)("a requester's own %s is refused as their own request", async (kind) => {
			const { approval } = await submitted(kind, authority);

			expect(await decide(actors.requester, approval.id, { as: "approval_manager" })).toEqual({
				status: "refused",
				reason: "own_request",
			});
		});

		it.each(TIME_KINDS)("a second decision of a decided %s is not decided again", async (kind) => {
			const { approval } = await submitted(kind, authority);
			await decide(actors.approver, approval.id, { as: "approver" });
			harness.notifications.length = 0;
			harness.kicks.length = 0;

			const again = await decide(
				actors.admin,
				approval.id,
				{ as: "approval_manager" },
				{
					decision: { kind: "reject", reason: "Too late" },
				},
			);

			expect(again).toEqual({ status: "refused", reason: "already_decided" });
			expect(await approvalStatus(approval.id)).toBe("approved");
			expect(decisionNotifications()).toEqual([]);
			expect(harness.kicks).toEqual([]);
		});
	});

	describe("replay", () => {
		it.each(["manual_time_submission", "policy_clock_out"] as const)(
			"an exact repeat of a %s decision returns it as replayed and runs nothing after commit",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "legacy");
				await decide(actors.approver, approval.id, { as: "approver" });
				harness.notifications.length = 0;
				harness.kicks.length = 0;

				const repeat = await decide(actors.approver, approval.id, { as: "approver" });

				expect(repeat).toEqual({
					status: "decided",
					kind,
					workPeriodId,
					outcome: "approved",
					replayed: true,
				});
				expect(decisionNotifications()).toEqual([]);
				expect(harness.kicks).toEqual([]);
			},
		);

		it.each(TIME_KINDS)(
			"an exact repeat of a canonical %s decision replays its receipt and writes nothing more",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "canonical");
				await decide(actors.approver, approval.id, { as: "approver" });
				const decided = await workflowOf(workPeriodId);
				harness.kicks.length = 0;

				const repeat = await decide(actors.approver, approval.id, { as: "approver" });

				expect(repeat).toMatchObject({ status: "decided", kind, workPeriodId, outcome: "approved" });
				expect(await workflowOf(workPeriodId)).toEqual(decided);
				expect(harness.kicks).toEqual([]);
			},
		);

		it("replayOnly confirms a committed decision and never makes a fresh one", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");

			expect(
				await decide(actors.approver, approval.id, { as: "approver" }, { replayOnly: true }),
			).toMatchObject({ status: "refused" });
			expect(await periodStatus(workPeriodId)).toBe("pending");

			await decide(actors.approver, approval.id, { as: "approver" });
			expect(
				await decide(actors.approver, approval.id, { as: "approver" }, { replayOnly: true }),
			).toMatchObject({ status: "decided", replayed: true });
			expect(harness.kicks).toHaveLength(1);
		});

		it("replayOnly confirms a matching rejection and refuses a different one", async () => {
			const { approval } = await submitted("policy_clock_out", "legacy");
			const reject = (reason: string) =>
				decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{
						decision: { kind: "reject", reason },
						replayOnly: true,
					},
				);
			await decide(
				actors.approver,
				approval.id,
				{ as: "approver" },
				{
					decision: { kind: "reject", reason: "Rejected via Slack" },
				},
			);
			harness.notifications.length = 0;

			expect(await reject("Rejected via Slack")).toMatchObject({
				status: "decided",
				outcome: "rejected",
				replayed: true,
			});
			expect(await reject("A different decision")).toEqual({
				status: "refused",
				reason: "already_decided",
			});
			expect(await approvalStatus(approval.id)).toBe("rejected");
			expect(decisionNotifications()).toEqual([]);
		});

		it("replayOnly never decides a time correction, nor confirms one", async () => {
			const { workPeriodId, approval } = await submitted("time_correction", "legacy");
			const replay = () =>
				decide(actors.approver, approval.id, { as: "approver" }, { replayOnly: true });

			expect(await replay()).toMatchObject({ status: "refused" });
			expect(await approvalStatus(approval.id)).toBe("pending");

			await decide(actors.approver, approval.id, { as: "approver" });
			harness.notifications.length = 0;
			expect(await replay()).toMatchObject({ status: "refused" });
			expect(await periodStatus(workPeriodId)).not.toBe("pending");
			expect(decisionNotifications()).toEqual([]);
		});
	});

	describe("an unbound bot card (#1679)", () => {
		async function press(
			employeeId: string,
			approvalId: string,
			action: "approve" | "reject",
		) {
			const { attemptBotApproval } = await import("@/lib/bot-platform/approval-decision");
			return attemptBotApproval({
				approvalId,
				actorEmployeeId: employeeId,
				organizationId: ids.organization,
				action,
				platform: "telegram",
			});
		}

		it("confirms its approver's committed decision and makes no new one", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");

			expect(await press(ids.approver, approval.id, "approve")).toEqual({
				status: "review_required",
			});
			expect(await periodStatus(workPeriodId)).toBe("pending");

			await decide(
				actors.approver,
				approval.id,
				{ as: "approver" },
				{ decision: { kind: "reject", reason: "Rejected via Telegram" } },
			);
			harness.notifications.length = 0;
			harness.kicks.length = 0;

			expect(await press(ids.approver, approval.id, "reject")).toEqual({
				status: "historical",
				action: "reject",
			});
			expect(await press(ids.approver, approval.id, "approve")).toEqual({
				status: "review_required",
			});
			expect(await approvalStatus(approval.id)).toBe("rejected");
			expect(decisionNotifications()).toEqual([]);
			expect(harness.kicks).toEqual([]);
		});

		it("refuses someone who is not the approval's approver", async () => {
			const { workPeriodId, approval } = await submitted("policy_clock_out", "legacy");

			expect(await press(ids.third, approval.id, "approve")).toEqual({
				status: "unauthorized",
			});
			expect(await periodStatus(workPeriodId)).toBe("pending");
		});

		it("answers review required for a time correction, even one its approver decided", async () => {
			const { approval } = await submitted("time_correction", "legacy");

			expect(await press(ids.approver, approval.id, "approve")).toEqual({
				status: "review_required",
			});
			expect(await approvalStatus(approval.id)).toBe("pending");

			await decide(actors.approver, approval.id, { as: "approver" });
			expect(await press(ids.approver, approval.id, "approve")).toEqual({
				status: "review_required",
			});
		});
	});

	describe("a decision that only advances to the next stage", () => {
		it.each(TIME_KINDS)("reports %s as advanced and only kicks delivery", async (kind) => {
			const { workPeriodId, approval } = await submitted(kind, "legacy", { twoStageChain: true });

			const result = await decide(actors.approver, approval.id, { as: "approver" });

			expect(result).toMatchObject({ status: "decided", outcome: "advanced", replayed: false });
			expect(await approvalStatus(approval.id)).toBe("approved");
			expect((await pendingApproval(workPeriodId, "legacy")).id).not.toBe(approval.id);
			expect(decisionNotifications()).toEqual([]);
			expect(harness.kicks).toHaveLength(1);
		});
	});

	describe("refusals", () => {
		it("an unknown approval and a workflow id are not found", async () => {
			const { workPeriodId } = await submitted("time_correction", "shadow");
			const { rows } = await admin.query<{ id: string }>(
				"select id from approval_workflow where organization_id = $1 and source_id = $2",
				[ids.organization, workPeriodId],
			);

			expect(await decide(actors.approver, randomUUID(), { as: "approver" })).toEqual({
				status: "refused",
				reason: "not_found",
			});
			expect(await decide(actors.approver, only(rows).id, { as: "approver" })).toEqual({
				status: "refused",
				reason: "not_found",
			});
		});

		it("an actor who holds no right is refused", async () => {
			const { approval } = await submitted("manual_time_submission", "legacy");

			expect(
				await decide(actors.deputy, approval.id, {
					as: "covering_deputy",
					forEmployeeId: ids.approver,
				}),
			).toEqual({ status: "refused", reason: "right_not_held" });
		});

		it.each(TIME_KINDS)(
			"after escalation replaced the approver of a %s, the former approver and an eligible manager are told it was reassigned",
			async (kind) => {
				const { approval } = await submitted(kind, "legacy");
				await escalate(approval);

				expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
					status: "refused",
					reason: "reassigned",
				});
				expect(await decide(actors.third, approval.id, { as: "eligible_manager" })).toEqual({
					status: "refused",
					reason: "reassigned",
				});
				expect(await approvalStatus(approval.id)).toBe("pending");
				// The replacement decides as the approver.
				expect(await decide(actors.backup, approval.id, { as: "approver" })).toMatchObject({
					status: "decided",
				});
			},
		);

		it("a covering deputy for an approver the approval no longer belongs to is told it was reassigned", async () => {
			const { approval } = await submitted("time_correction", "legacy");
			await seedCover();
			await escalate(approval);

			expect(
				await decide(actors.deputy, approval.id, {
					as: "covering_deputy",
					forEmployeeId: ids.approver,
				}),
			).toEqual({ status: "refused", reason: "reassigned" });
			expect(await deputyRecords()).toEqual([]);
		});

		it("a legacy request that cannot be classified is refused as such", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");
			await admin.query(
				"update approval_request set metadata = null, reason = 'Unknown' where id = $1",
				[approval.id],
			);
			await admin.query("update work_period set pending_changes = null where id = $1", [
				workPeriodId,
			]);

			expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
				status: "refused",
				reason: "unclassified",
			});
		});

		it.each(["legacy", "canonical"] as const)(
			"a changed fast-lane assessment refuses the decision under %s authority and writes nothing",
			async (authority) => {
			for (const kind of TIME_KINDS) {
				const { approval } = await submitted(kind, authority);

				const result = await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{
						fastLaneGuard: async () => {
							throw new ConflictError({
								message: "This fast-lane assessment changed. Review the request again.",
								conflictType: "approval_triage",
							});
						},
					},
				);

				expect(result, kind).toEqual({ status: "refused", reason: "guard_failed" });
				// Nothing committed, so nothing runs after commit.
				expect(decisionNotifications(), kind).toEqual([]);
				expect(harness.kicks, kind).toEqual([]);
				expect(await approvalStatus(approval.id), kind).toBe("pending");
			}
		},
		);

		it("a request submitted before evidence capture is refused until it has evidence", async () => {
			const { approval } = await submitted("manual_time_submission", "legacy", {
				evidenceCapture: false,
			});
			await admin.query(
				`insert into approval_evidence_control (organization_id, workflow_type, mode)
				 values ($1, 'manual_time_submission', 'capture')`,
				[ids.organization],
			);

			expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
				status: "refused",
				reason: "evidence_required",
			});
		});

		it("a decision touching a closed month is refused as such", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");
			await admin.query(
				`insert into closed_month (id, organization_id, month, scope, actor_kind, closed_by)
				 values ($1, $2, '2026-07-01', 'organization', 'user', $3)`,
				[ids.closedMonth, ids.organization, ids.adminUser],
			);
			await admin.query(
				`insert into closed_month_employee
				 (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
				 values ($1, $2, $3, '2026-07-01'::date, '2026-07-01'::timestamp, '2026-08-01'::timestamp, 'UTC')`,
				[ids.organization, ids.closedMonth, ids.requester],
			);

			expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
				status: "refused",
				reason: "month_closed",
			});
			expect(await periodStatus(workPeriodId)).toBe("pending");
		});

		it("a time correction whose work period no longer names its workflow is refused as changed", async () => {
			const { workPeriodId, approval } = await submitted("time_correction", "canonical");
			await admin.query(
				"update work_period set approval_workflow_id = null where organization_id = $1 and id = $2",
				[ids.organization, workPeriodId],
			);

			expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
				status: "refused",
				reason: "changed",
			});
		});

		describe.each(AUTHORITIES)("under %s authority", (authority) => {
			it.each(TIME_KINDS)(
				"a %s whose work changed in place after submission is refused as changed",
				async (kind) => {
					const { workPeriodId, approval } = await submitted(kind, authority);
					// Someone edits the work behind the approval's back: the correction's
					// location, or the submitted work's end on both of its records.
					if (kind === "time_correction") {
						await admin.query(
							`update work_period set work_location_type = 'home'
							 where organization_id = $1 and id = $2`,
							[ids.organization, workPeriodId],
						);
					} else {
						await admin.query(
							`update work_period set end_time = end_time - interval '30 minutes',
							   duration_minutes = duration_minutes - 30
							 where organization_id = $1 and id = $2`,
							[ids.organization, workPeriodId],
						);
						await admin.query(
							`update time_record set end_at = end_at - interval '30 minutes',
							   duration_minutes = duration_minutes - 30
							 where organization_id = $1
							   and id = (select canonical_record_id from work_period where id = $2)`,
							[ids.organization, workPeriodId],
						);
					}

					expect(await decide(actors.approver, approval.id, { as: "approver" })).toEqual({
						status: "refused",
						reason: "changed",
					});
					expect(await approvalStatus(approval.id)).toBe("pending");
					expect(decisionNotifications()).toEqual([]);
					expect(harness.kicks).toEqual([]);
				},
			);
		});

		it("an approver whose employee was deactivated is not found and decides nothing", async () => {
			for (const authority of ["legacy", "canonical"] as const) {
				const { approval } = await submitted("time_correction", authority);
				await admin.query("update employee set is_active = false where id = $1", [ids.approver]);

				expect(await decide(actors.approver, approval.id, { as: "approver" }), authority).toEqual({
					status: "refused",
					reason: "not_found",
				});
				expect(await approvalStatus(approval.id), authority).toBe("pending");
			}
		});

		it("an approver who is no longer a member of the organization decides nothing", async () => {
			for (const authority of ["legacy", "shadow"] as const) {
				const { approval } = await submitted("time_correction", authority);
				await admin.query("delete from member where organization_id = $1 and user_id = $2", [
					ids.organization,
					ids.approverUser,
				]);

				expect(await decide(actors.approver, approval.id, { as: "approver" }), authority).toEqual({
					status: "refused",
					reason: "not_found",
				});
				expect(await approvalStatus(approval.id), authority).toBe("pending");
			}
		});

		it("a legacy request whose stored kind contradicts its evidence decides nothing", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");
			await admin.query(
				`update approval_request
				 set metadata = jsonb_set(metadata, '{timeRequest,kind}', '"policy_clock_out"')
				 where id = $1`,
				[approval.id],
			);

			expect(await decide(actors.approver, approval.id, { as: "approver" })).toMatchObject({
				status: "refused",
			});
			expect(await approvalStatus(approval.id)).toBe("pending");
			expect(await periodStatus(workPeriodId)).toBe("pending");
		});
	});

	describe("a failure inside the decision", () => {
		it.each(
			AUTHORITIES.flatMap((authority) => TIME_KINDS.map((kind) => ({ authority, kind }))),
		)(
			"rolls back every write of a $authority $kind decision and runs nothing after commit",
			async ({ authority, kind }) => {
				const { workPeriodId, approval } = await submitted(kind, authority);
				const before = {
					workflow: authority === "legacy" ? null : await workflowOf(workPeriodId),
					period: await periodStatus(workPeriodId),
					surcharges: await surchargeCount(workPeriodId),
				};

				// A failure is thrown, never a refusal: the injected one or its failed query.
				await expect(
					failingWrites("work_period", "update", () =>
						decide(actors.approver, approval.id, { as: "approver" }),
					),
				).rejects.toThrow();

				expect(await approvalStatus(approval.id)).toBe("pending");
				expect(await periodStatus(workPeriodId)).toBe(before.period);
				if (before.workflow) expect(await workflowOf(workPeriodId)).toEqual(before.workflow);
				expect(decisionNotifications()).toEqual([]);
				expect(harness.kicks).toEqual([]);
				expect(await surchargeCount(workPeriodId)).toBe(before.surcharges);
			},
		);

		it.each(TIME_KINDS)(
			"rolls back a legacy %s decision whose evidence cannot be recorded",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "legacy");
				const period = await periodStatus(workPeriodId);

				await expect(
					failingWrites("approval_decision_evidence", "insert", () =>
						decide(actors.approver, approval.id, { as: "approver" }),
					),
				).rejects.toThrow();

				expect(await approvalStatus(approval.id)).toBe("pending");
				expect(await periodStatus(workPeriodId)).toBe(period);
				expect(decisionNotifications()).toEqual([]);
			},
		);
	});

	describe("decision evidence", () => {
		it.each(TIME_KINDS)(
			"a legacy %s decision records its evidence with the finalized outcome",
			async (kind) => {
				const { approval } = await submitted(kind, "legacy");

				await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{ decision: { kind: "reject", reason: "Not this week" } },
				);

				const { rows } = await admin.query(
					`select action, request_outcome::text as request_outcome, actor_employee_id,
					   reviewed_binding_id
					 from approval_decision_evidence
					 where organization_id = $1 and authority = 'legacy' and legacy_approval_request_id = $2`,
					[ids.organization, approval.id],
				);
				expect(rows).toEqual([
					{
						action: "reject",
						request_outcome: "rejected",
						actor_employee_id: ids.approver,
						reviewed_binding_id: null,
					},
				]);
			},
		);
	});

	describe("two stages", () => {
		it.each(
			AUTHORITIES.flatMap((authority) => TIME_KINDS.map((kind) => ({ authority, kind }))),
		)(
			"a $authority $kind advances on its first stage and is decided on its second",
			async ({ authority, kind }) => {
				const { workPeriodId, approval } = await submitted(kind, authority, {
					twoStageChain: true,
				});

				expect(await decide(actors.approver, approval.id, { as: "approver" })).toMatchObject({
					status: "decided",
					outcome: "advanced",
				});
				if (kind !== "time_correction") expect(await periodStatus(workPeriodId)).toBe("pending");
				if (authority === "canonical") {
					// Parallel reviewers of the first stage: one decision settles the stage.
					const { rows: firstStage } = await admin.query<{ status: string }>(
						`select a.status::text as status from approval_stage_assignment a
						 where a.organization_id = $1 and a.stage_id =
						   (select stage_id from approval_stage_assignment where id = $2)
						   and a.id <> $2`,
						[ids.organization, approval.id],
					);
					expect(firstStage.every((row) => row.status === "cancelled")).toBe(true);
				}
				const next = await pendingApproval(workPeriodId, authority);
				expect(next.id).not.toBe(approval.id);
				expect(next.approver_id).toBe(ids.admin);

				expect(await decide(actors.admin, next.id, { as: "approver" })).toMatchObject({
					status: "decided",
					kind,
					outcome: "approved",
				});
				expect(await approvalStatus(next.id)).toBe("approved");
				if (kind !== "time_correction") expect(await periodStatus(workPeriodId)).toBe("approved");
				if (authority !== "legacy") expect((await workflowOf(workPeriodId)).status).toBe("approved");
			},
		);
	});

	describe("canonical compatibility requests", () => {
		/** Under canonical authority the stage's legacy request mirrors the assignment. */
		async function compatibilityRequest(workPeriodId: string) {
			const { rows } = await admin.query<{ id: string; metadata: Record<string, unknown> }>(
				`select id, metadata from approval_request
				 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
				   and status = 'pending'`,
				[ids.organization, workPeriodId],
			);
			return only(rows);
		}

		it.each(TIME_KINDS)(
			"a %s is decided through its compatibility request as through its assignment",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "canonical");
				const request = await compatibilityRequest(workPeriodId);

				expect(await decide(actors.approver, request.id, { as: "approver" })).toMatchObject({
					status: "decided",
					kind,
					workPeriodId,
					outcome: "approved",
				});
				expect(await approvalStatus(approval.id)).toBe("approved");
				expect((await workflowOf(workPeriodId)).status).toBe("approved");
			},
		);

		it("a compatibility request without its assignment id decides the approver's exact assignment", async () => {
			const { workPeriodId, approval } = await submitted("time_correction", "canonical");
			const request = await compatibilityRequest(workPeriodId);
			await admin.query("update approval_request set metadata = metadata #- '{stage,assignmentId}' where id = $1", [
				request.id,
			]);

			expect(await decide(actors.approver, request.id, { as: "approver" })).toMatchObject({
				status: "decided",
				outcome: "approved",
			});
			expect(await approvalStatus(approval.id)).toBe("approved");
		});

		it.each([
			["a foreign assignment", `jsonb_set(metadata, '{stage,assignmentId}', to_jsonb($2::text))`],
			["a foreign workflow", `jsonb_set(metadata, '{workflow,id}', to_jsonb($2::text))`],
			["a foreign stage", `jsonb_set(metadata, '{stage,id}', to_jsonb($2::text))`],
			["another stage sequence", `jsonb_set(metadata, '{stage,sequence}', '99') || jsonb_build_object('t1681', $2::text)`],
		] as const)(
			"a compatibility request naming %s decides nothing",
			async (_label, metadata) => {
				const { workPeriodId, approval } = await submitted("time_correction", "canonical");
				const request = await compatibilityRequest(workPeriodId);
				await admin.query(`update approval_request set metadata = ${metadata} where id = $1`, [
					request.id,
					randomUUID(),
				]);

				expect(await decide(actors.approver, request.id, { as: "approver" })).toMatchObject({
					status: "refused",
				});
				expect(await approvalStatus(approval.id)).toBe("pending");
				expect((await workflowOf(workPeriodId)).status).toBe("pending");
			},
		);

		it("a compatibility request whose approver matches no active assignment decides nothing", async () => {
			const { workPeriodId, approval } = await submitted("time_correction", "canonical");
			const request = await compatibilityRequest(workPeriodId);
			await admin.query(
				`update approval_request set approver_id = $2, metadata = metadata #- '{stage,assignmentId}'
				 where id = $1`,
				[request.id, ids.third],
			);

			expect(await decide(actors.approver, request.id, { as: "approver" })).toMatchObject({
				status: "refused",
			});
			expect(await decide(actors.third, request.id, { as: "approver" })).toMatchObject({
				status: "refused",
			});
			expect(await approvalStatus(approval.id)).toBe("pending");
		});
	});

	describe("after a decision", () => {
		it.each(AUTHORITIES)(
			"a rejected time correction under %s authority is followed by a new approval for the next correction",
			async (authority) => {
				const { workPeriodId, approval } = await submitted("time_correction", authority);
				await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{ decision: { kind: "reject", reason: "Not this week" } },
				);

				await requestEdit(workPeriodId);

				const next = await pendingApproval(workPeriodId, authority);
				expect(next.id).not.toBe(approval.id);
				expect(await approvalStatus(approval.id)).toBe("rejected");
				expect(await decide(actors.approver, next.id, { as: "approver" })).toMatchObject({
					status: "decided",
					outcome: "approved",
				});
			},
		);
	});

	describe("observed display evidence", () => {
		it("a shadow-mirrored time correction keeps its submitted labels and work metadata, marked approved", async () => {
			const { workPeriodId, approval } = await submitted("time_correction", "shadow");
			const pending = (await workflowOf(workPeriodId)).display_snapshot as Record<string, unknown>;

			await decide(actors.approver, approval.id, { as: "approver" });

			const decided = await workflowOf(workPeriodId);
			expect(decided.status).toBe("approved");
			expect(decided.display_snapshot).toMatchObject({
				labels: pending.labels,
				workMetadata: pending.workMetadata,
				status: "approved",
			});
		});
	});

	describe("shadow mirroring", () => {
		it.each(TIME_KINDS)(
			"late-mirrors a %s submitted before shadowing and decides its observed workflow",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "legacy");
				await setAuthority("shadow");

				const result = await decide(actors.approver, approval.id, { as: "approver" });

				expect(result).toMatchObject({ status: "decided", outcome: "approved" });
				const { rows } = await admin.query<{ status: string }>(
					`select status::text as status from approval_workflow
				 where organization_id = $1 and source_id = $2`,
					[ids.organization, workPeriodId],
				);
				expect(rows).toEqual([{ status: "approved" }]);
			},
		);
	});

	describe("intended behaviour changes", () => {
		it("a manual time submission or policy clock-out never opens a time correction work transaction", async () => {
			for (const kind of ["manual_time_submission", "policy_clock_out"] as const) {
				const { workPeriodId, approval } = await submitted(kind, "legacy");
				// Someone holds the time correction approval write gate exclusively.
				const holder = await admin.connect();
				try {
					await holder.query("begin");
					await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
						approvalRolloutLockScope(ids.organization, "time_correction"),
					]);
					const result = await Promise.race([
						decide(actors.approver, approval.id, { as: "approver" }),
						new Promise((resolve) => setTimeout(() => resolve("blocked"), 10_000)),
					]);
					expect(result, kind).toMatchObject({ status: "decided", kind, workPeriodId });
				} finally {
					await holder.query("rollback").catch(() => undefined);
					holder.release();
				}
			}
		});
	});

	describe("card presses", () => {
		/** Telegram cards are actionable for every time kind. */
		async function allowCards() {
			for (const kind of TIME_KINDS) {
				await admin.query(
					`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
					 values ($1, $2, 'telegram', 'actionable')`,
					[ids.organization, kind],
				);
			}
		}

		/** The review binding a card carries: the exact approval, for one recipient. */
		async function issueCard(
			workPeriodId: string,
			approvalId: string,
			authority: Authority,
			recipient: string = ids.approver,
			actingFor?: string,
		): Promise<string> {
			if (authority === "canonical") {
				const { rows } = await admin.query<{ id: string }>(
					`insert into approval_review_binding
					 (organization_id, authority, recipient_employee_id, workflow_id, stage_id, assignment_id,
					  submitted_revision_id, acting_for_employee_id)
					 select a.organization_id, 'canonical', $3, a.workflow_id, a.stage_id, a.id,
					   (select r.id from approval_submitted_revision r
					    where r.organization_id = a.organization_id and r.workflow_id = a.workflow_id
					    order by r.revision desc limit 1), $4
					 from approval_stage_assignment a where a.organization_id = $1 and a.id = $2
					 returning id`,
					[ids.organization, approvalId, recipient, actingFor ?? null],
				);
				return only(rows).id;
			}
			const { rows } = await admin.query<{ id: string }>(
				`insert into approval_review_binding
				 (organization_id, authority, recipient_employee_id, legacy_approval_request_id,
				  submitted_revision_id, acting_for_employee_id)
				 select $1, 'legacy', $3, $2,
				   (select r.id from approval_submitted_revision r
				    where r.organization_id = $1 and r.authority = 'legacy' and r.source_id = $4
				    order by r.created_at desc, r.revision desc limit 1), $5
				 returning id`,
				[ids.organization, approvalId, recipient, workPeriodId, actingFor ?? null],
			);
			return only(rows).id;
		}

		function card(bindingId: string, invocationId: string, providerActorId = "1681001") {
			return {
				reviewedBindingId: bindingId,
				invocation: {
					identity: {
						organizationId: ids.organization,
						scheme: "telegram_callback_query" as const,
						schemeVersion: 1 as const,
						receiverScope: "telegram-bot:1681",
						invocationId,
					},
					deliveryId: null,
					providerActorId,
				},
			};
		}

		describe.each(["legacy", "canonical"] as const)("under %s authority", (authority) => {
			const legacy = authority === "legacy";

			it.each(TIME_KINDS)(
				"the approver's card press decides a %s, returns its receipt, and its exact repeat replays it",
				async (kind) => {
					const { workPeriodId, approval } = await submitted(kind, authority);
					await allowCards();
					const bindingId = await issueCard(workPeriodId, approval.id, authority);
					const press = card(bindingId, `t1681-${authority}-${kind}`);

					const result = await decide(
						actors.approver,
						approval.id,
						{ as: "approver" },
						{ card: press },
					);

					expect(result).toMatchObject({
						status: "decided",
						kind,
						workPeriodId,
						outcome: "approved",
						replayed: false,
						receipt: { reviewedBindingId: bindingId },
					});
					expect(await approvalStatus(approval.id)).toBe("approved");
					expect(decisionNotifications().map((entry) => entry.name)).toEqual(
						legacy ? [DECISION_TRIGGERS[kind].approve] : [],
					);
					expect(harness.kicks).toHaveLength(legacy ? 1 : 0);
					if (kind !== "time_correction")
						expect(await surchargeCount(workPeriodId)).toBeGreaterThan(0);
					harness.notifications.length = 0;
					harness.kicks.length = 0;

					const repeat = await decide(
						actors.approver,
						approval.id,
						{ as: "approver" },
						{ card: press },
					);

					expect(repeat).toMatchObject({
						status: "decided",
						kind,
						workPeriodId,
						outcome: "approved",
						replayed: true,
					});
					expect(repeat.status === "decided" && repeat.receipt?.id).toBe(
						result.status === "decided" && result.receipt?.id,
					);
					expect(decisionNotifications()).toEqual([]);
					expect(harness.kicks).toEqual([]);
				},
			);

			it.each(["eligible_manager", "approval_manager"] as const)(
				"a card never conveys the %s right",
				async (as) => {
					const { workPeriodId, approval } = await submitted("manual_time_submission", authority);
					await allowCards();
					const bindingId = await issueCard(workPeriodId, approval.id, authority);

					const result = await decide(actors.approver, approval.id, { as } as never, {
						card: card(bindingId, `t1681-${authority}-${as}`),
					});

					expect(result).toEqual({ status: "refused", reason: "right_not_held" });
					expect(await approvalStatus(approval.id)).toBe("pending");
				},
			);

			it.each(TIME_KINDS)(
				"a deputy card decides a %s only while its recipient covers, and records whom they acted for",
				async (kind) => {
					const { workPeriodId, approval } = await submitted(kind, authority);
					await allowCards();
					await seedCover();
					const bindingId = await issueCard(
						workPeriodId,
						approval.id,
						authority,
						ids.deputy,
						ids.approver,
					);
					const deputyRight = { as: "covering_deputy", forEmployeeId: ids.approver } as const;
					// The absence ends before the press: the deputy no longer covers.
					await admin.query("update absence_entry set end_date = $2 where id = $1", [
						ids.coveringAbsence,
						utcDay(-1),
					]);

					const uncovered = await decide(actors.deputy, approval.id, deputyRight, {
						card: card(bindingId, `t1681-deputy-off-${authority}-${kind}`, "1681002"),
					});

					expect(uncovered).toMatchObject({ status: "refused" });
					expect(await approvalStatus(approval.id)).toBe("pending");

					await admin.query("update absence_entry set end_date = $2 where id = $1", [
						ids.coveringAbsence,
						utcDay(2),
					]);
					const covered = await decide(actors.deputy, approval.id, deputyRight, {
						card: card(bindingId, `t1681-deputy-on-${authority}-${kind}`, "1681002"),
					});

					expect(covered).toMatchObject({ status: "decided", outcome: "approved" });
					expect(await deputyRecords()).toEqual([
						{
							deputy_employee_id: ids.deputy,
							acting_for_employee_id: ids.approver,
							authority,
							entity_id: workPeriodId,
							decision: "approved",
						},
					]);
				},
			);

			it.each(TIME_KINDS)(
				"a press on a %s decided elsewhere after the card was sent decides nothing",
				async (kind) => {
					const { workPeriodId, approval } = await submitted(kind, authority);
					await allowCards();
					const bindingId = await issueCard(workPeriodId, approval.id, authority);
					await decide(actors.admin, approval.id, { as: "approval_manager" });
					harness.notifications.length = 0;
					harness.kicks.length = 0;

					const result = await decide(
						actors.approver,
						approval.id,
						{ as: "approver" },
						{
							card: card(bindingId, `t1681-late-${authority}-${kind}`),
							decision: { kind: "reject", reason: "Rejected via Telegram" },
						},
					);

					expect(result).toMatchObject({ status: "refused" });
					expect(await approvalStatus(approval.id)).toBe("approved");
					expect(decisionNotifications()).toEqual([]);
				},
			);

			it("a press for another approval than its binding names is a binding mismatch", async () => {
				const { workPeriodId, approval } = await submitted("manual_time_submission", authority);
				await allowCards();
				const bindingId = await issueCard(workPeriodId, approval.id, authority);
				const correctionPeriod = await submit("time_correction");
				const other = await pendingApproval(correctionPeriod, authority);

				const result = await decide(
					actors.approver,
					other.id,
					{ as: "approver" },
					{
						card: card(bindingId, `t1681-mismatch-${authority}`),
					},
				);

				expect(result).toEqual({ status: "refused", reason: "binding_mismatch" });
				expect(await approvalStatus(other.id)).toBe("pending");
			});

			it("a press from a provider that is not admitted for the kind is not admitted", async () => {
				const { workPeriodId, approval } = await submitted("policy_clock_out", authority);
				await allowCards();
				const bindingId = await issueCard(workPeriodId, approval.id, authority);
				await admin.query(
					`update approval_presentation_control set mode = 'review_only'
					 where organization_id = $1 and workflow_type = 'policy_clock_out'`,
					[ids.organization],
				);

				const result = await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{
						card: card(bindingId, `t1681-paused-${authority}`),
					},
				);

				expect(result).toEqual({ status: "refused", reason: "not_admitted" });
				expect(await approvalStatus(approval.id)).toBe("pending");
			});

			it("the same invocation with another decision is an invocation conflict", async () => {
				const { workPeriodId, approval } = await submitted("time_correction", authority);
				await allowCards();
				const bindingId = await issueCard(workPeriodId, approval.id, authority);
				const press = card(bindingId, `t1681-conflict-${authority}`);
				await decide(actors.approver, approval.id, { as: "approver" }, { card: press });

				const result = await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{
						card: press,
						decision: { kind: "reject", reason: "Rejected via Telegram" },
					},
				);

				expect(result).toEqual({ status: "refused", reason: "invocation_conflict" });
				expect(await approvalStatus(approval.id)).toBe("approved");
			});
		});

		it.each(TIME_KINDS)(
			"after escalation reassigned a %s, its former approver's card is told so, even when they manage approvals",
			async (kind) => {
				const { workPeriodId, approval } = await submitted(kind, "legacy");
				await allowCards();
				const bindingId = await issueCard(workPeriodId, approval.id, "legacy");
				await admin.query(
					"update member set role = 'admin' where organization_id = $1 and user_id = $2",
					[ids.organization, ids.approverUser],
				);
				await escalate(approval);

				const result = await decide(
					actors.approver,
					approval.id,
					{ as: "approver" },
					{
						card: card(bindingId, `t1681-reassigned-${kind}`),
					},
				);

				expect(result).toEqual({ status: "refused", reason: "reassigned" });
				expect(await approvalStatus(approval.id)).toBe("pending");
			},
		);
	});

	describe("after-commit work", () => {
		it("a failing time correction notification is logged and changes neither the result nor the delivery kick", async () => {
			const { approval } = await submitted("time_correction", "legacy");
			harness.failingTriggers.add("onTimeCorrectionApproved");

			const result = await decide(actors.approver, approval.id, { as: "approver" });

			expect(result).toMatchObject({ status: "decided", outcome: "approved" });
			expect(await approvalStatus(approval.id)).toBe("approved");
			expect(harness.loggedErrors).toContainEqual({
				component: "TimeApprovalDecision",
				message: "Time correction decision after-commit work failed",
			});
			expect(harness.kicks).toHaveLength(1);
		});

		it("a failing surcharge maintenance is logged and changes neither the result nor the notification", async () => {
			const { workPeriodId, approval } = await submitted("manual_time_submission", "legacy");
			await admin.query(`create or replace function t1675_fail_surcharge_insert() returns trigger as $$
				begin raise exception 't1675 surcharge reconciliation failure'; end;
				$$ language plpgsql`);
			await admin.query(
				`create trigger t1675_fail_surcharge_insert before insert on surcharge_calculation
				 for each row execute function t1675_fail_surcharge_insert()`,
			);
			let result: Awaited<ReturnType<typeof decideTimeApproval>>;
			try {
				result = await decide(actors.approver, approval.id, { as: "approver" });
			} finally {
				await admin.query(
					"drop trigger if exists t1675_fail_surcharge_insert on surcharge_calculation",
				);
				await admin.query("drop function if exists t1675_fail_surcharge_insert()");
			}

			expect(result).toMatchObject({ status: "decided", outcome: "approved" });
			expect(await periodStatus(workPeriodId)).toBe("approved");
			expect(harness.loggedErrors).toContainEqual({
				component: "TimeApprovalDecision",
				message: "Ordinary work-period maintenance after commit failed",
			});
			expect(decisionNotifications().map((entry) => entry.name)).toEqual(["onManualEntryApproved"]);
			expect(harness.kicks).toHaveLength(1);
		});
	});
});
