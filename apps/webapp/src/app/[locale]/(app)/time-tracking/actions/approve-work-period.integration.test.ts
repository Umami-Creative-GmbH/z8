/**
 * Approving from the time-entries table (#1678) against PostgreSQL: the table
 * decides through the time approval decision as manager of approvals, so who
 * may approve follows the inbox's rule, verified from the database; and an
 * approval about another work period is refused before any decision.
 *
 * Only the request/session, billing, notification fan-out, the Next cache and
 * the delivery fast path are replaced.
 *
 * Run: pnpm --filter webapp test:integration "src/app/[locale]/(app)/time-tracking/actions/approve-work-period.integration.test.ts"
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
	getOrganizationBaseUrl: async () => "https://t1678.example.test",
}));
vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);
vi.mock("@/lib/time-tracking/change-policy/verdict", async (original) =>
	(
		await import("@/lib/time-tracking/change-policy/testing/verdict.test.fixture")
	).stubChangePolicyVerdict(original, () => ({ type: "approval_required" })),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { approveWorkPeriod } = await import("./mutations");
const { decideTimeApproval } = await import("@/lib/approvals/server/time-approval-decision");

const AUTHORITIES = ["legacy", "canonical"] as const;
type Authority = (typeof AUTHORITIES)[number];

const ids = {
	organization: "t1678-table-approval-org",
	otherOrganization: "t1678-table-approval-other-org",
	requesterUser: "t1678-requester-user",
	approverUser: "t1678-approver-user",
	adminUser: "t1678-admin-user",
	thirdUser: "t1678-third-user",
	requester: "e1678000-0000-4000-8000-000000000001",
	approver: "e1678000-0000-4000-8000-000000000002",
	admin: "e1678000-0000-4000-8000-000000000003",
	otherAdmin: "e1678000-0000-4000-8000-000000000004",
	third: "e1678000-0000-4000-8000-000000000005",
	changePolicy: "e1678200-0000-4000-8000-000000000001",
	changePolicyAssignment: "e1678200-0000-4000-8000-000000000002",
} as const;

const USERS = [ids.requesterUser, ids.approverUser, ids.adminUser, ids.thirdUser];

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("approving from the time-entries table (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = userId ? organizationId : null;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [USERS]);
	}

	async function seed(authority: Authority) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1678 table approval', $1, 'UTC', $3),
			        ($2, 'T1678 other organization', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', $2, $3, $4, $4)`,
			[ids.organization, authority, authority === "canonical" ? "canonical" : "legacy", timestamp],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'manual_time_submission', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't1678-requester@example.test', $5, $5),
			 ($2, 'Xavier Approver', 't1678-approver@example.test', $5, $5),
			 ($3, 'Ada Admin', 't1678-admin@example.test', $5, $5),
			 ($4, 'Taylor Third', 't1678-third@example.test', $5, $5)`,
			[...USERS, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, locale, timezone, time_format, updated_at)
			 select user_id, 'en', 'UTC', '24h', $2 from unnest($1::text[]) as user_id`,
			[USERS, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't1678-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, USERS, ids.adminUser],
		);
		// Ada also administers another organization.
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t1678-other-member', $1, $2, 'admin', 'approved', $3)`,
			[ids.otherOrganization, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $9), ($3, $4, $7, 'manager', $9), ($5, $6, $7, 'admin', $9),
			 ($10, $6, $8, 'admin', $9), ($11, $12, $7, 'manager', $9)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.approver,
				ids.approverUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
				ids.otherAdmin,
				ids.third,
				ids.thirdUser,
			],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[ids.requester, ids.approver, ids.approverUser, timestamp],
		);
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[ids.organization],
		);
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, $2, 'T1678 manual approval', 0, 3650, $3, $4)`,
			[ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, $5)`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.approverUser, timestamp],
		);
	}

	/** A manual entry the requester submits for approval; returns its work period. */
	async function submitManual(date: string): Promise<string> {
		actAs(ids.requesterUser);
		const result = await createManualTimeEntry({
			version: 2,
			submissionId: randomUUID(),
			targetEmployeeId: ids.requester,
			date,
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
			[ids.requester, new Date(`${date}T09:00:00Z`)],
		);
		return only(rows).id;
	}

	/** The id the table passes: the pending legacy request, or the canonical assignment. */
	async function pendingApprovalId(workPeriodId: string, authority: Authority) {
		const { rows } = await admin.query<{ id: string }>(
			authority === "canonical"
				? `select a.id from approval_stage_assignment a
				   join approval_workflow w on w.id = a.workflow_id
				   where w.organization_id = $1 and w.source_id = $2 and a.status = 'pending'`
				: `select id from approval_request
				   where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
				     and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows).id;
	}

	async function periodStatus(workPeriodId: string) {
		const { rows } = await admin.query<{ approval_status: string }>(
			"select approval_status from work_period where id = $1 and organization_id = $2",
			[workPeriodId, ids.organization],
		);
		return only(rows).approval_status;
	}

	async function approveAs(
		userId: string,
		input: { workPeriodId: string; approvalRequestId: string },
		organizationId?: string,
	) {
		actAs(userId, organizationId);
		try {
			return await approveWorkPeriod(input);
		} finally {
			actAs(null);
		}
	}

	beforeEach(() => {
		actAs(null);
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each(AUTHORITIES)("under %s authority", (authority) => {
		it("a manager of approvals approves a pending manual time submission", async () => {
			await seed(authority);
			const workPeriodId = await submitManual("2026-07-20");
			const approvalRequestId = await pendingApprovalId(workPeriodId, authority);

			expect(await approveAs(ids.adminUser, { workPeriodId, approvalRequestId })).toEqual({
				success: true,
				data: { workPeriodId },
			});
			expect(await periodStatus(workPeriodId)).toBe("approved");
		});

		it("someone who does not manage approvals is refused", async () => {
			await seed(authority);
			const workPeriodId = await submitManual("2026-07-20");
			const approvalRequestId = await pendingApprovalId(workPeriodId, authority);

			expect(await approveAs(ids.thirdUser, { workPeriodId, approvalRequestId })).toEqual({
				success: false,
				error: "Only admins and owners can approve time entries",
			});
			expect(await periodStatus(workPeriodId)).toBe("pending");
		});

		it("an approval about another work period is refused and decides nothing", async () => {
			await seed(authority);
			const shown = await submitManual("2026-07-20");
			const other = await submitManual("2026-07-21");
			const otherApproval = await pendingApprovalId(other, authority);

			expect(
				await approveAs(ids.adminUser, { workPeriodId: shown, approvalRequestId: otherApproval }),
			).toEqual({ success: false, error: "Work period not found" });
			expect(await periodStatus(shown)).toBe("pending");
			expect(await periodStatus(other)).toBe("pending");
		});

		it("an approval of another organization is refused and decides nothing", async () => {
			await seed(authority);
			const workPeriodId = await submitManual("2026-07-20");
			const approvalRequestId = await pendingApprovalId(workPeriodId, authority);

			expect(
				await approveAs(ids.adminUser, { workPeriodId, approvalRequestId }, ids.otherOrganization),
			).toEqual({ success: false, error: "Work period not found" });
			expect(await periodStatus(workPeriodId)).toBe("pending");
		});

		it("an entry its approver already decided is returned as the table's conflict", async () => {
			await seed(authority);
			const workPeriodId = await submitManual("2026-07-20");
			const approvalRequestId = await pendingApprovalId(workPeriodId, authority);
			await expect(
				decideTimeApproval({
					organizationId: ids.organization,
					approvalId: approvalRequestId,
					actor: { employeeId: ids.approver, userId: ids.approverUser },
					right: { as: "approver" },
					decision: { kind: "reject", reason: "Not this week" },
				}),
			).resolves.toMatchObject({ status: "decided", outcome: "rejected" });

			expect(await approveAs(ids.adminUser, { workPeriodId, approvalRequestId })).toEqual({
				success: false,
				error: "This approval has already been decided.",
				code: "ConflictError",
			});
		});
	});
});
