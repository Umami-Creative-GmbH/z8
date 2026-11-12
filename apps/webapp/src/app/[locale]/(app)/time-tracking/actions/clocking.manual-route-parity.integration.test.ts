/**
 * #1602 parity: manual work's submit paths and the approval route preview share the owner/admin
 * self-recording rule and the change-policy skip. For each case the preview and both manual
 * submit paths (legacy admission and append admission) agree on whether a request is written,
 * and on who decides it, under legacy and under canonical approval authority.
 *
 * The real `createManualTimeEntry` runs against the disposable PostgreSQL database, as in
 * `clocking.manual-command.integration.test.ts`; only the request/session, billing,
 * notification delivery and Next cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { readOnlyTransaction } from "@/db/read-only-transaction";
import { previewApprovalRoutes } from "@/lib/approvals/route-preview/preview";
import type { ApprovalRoute } from "@/lib/approvals/route-preview/types";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

// getRequestSession awaits connection(), which throws outside a Next request scope.
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
							user: { id: harness.userId, role: "user" },
							session: {
								id: `integration-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		// The real loader on the test database, without Better Auth's session store.
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

vi.mock("./approvals", async (importOriginal) => ({
	...(await importOriginal<typeof import("./approvals")>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
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

const { createManualTimeEntry } = await import("../actions");

const ids = {
	organization: "t1602-manual-parity-org",
	employeeUser: "t1602-employee-user",
	managerUser: "t1602-manager-user",
	ownerUser: "t1602-owner-user",
	adminUser: "t1602-admin-user",
	employee: "e1602000-0000-4000-8000-000000000001",
	manager: "e1602000-0000-4000-8000-000000000002",
	owner: "e1602000-0000-4000-8000-000000000003",
	admin: "e1602000-0000-4000-8000-000000000004",
	changePolicy: "e1602000-0000-4000-8000-000000000030",
	changePolicyAssignment: "e1602000-0000-4000-8000-000000000031",
} as const;
const users = [ids.employeeUser, ids.managerUser, ids.ownerUser, ids.adminUser];
const employeeOf: Record<string, string> = {
	[ids.employeeUser]: ids.employee,
	[ids.managerUser]: ids.manager,
	[ids.ownerUser]: ids.owner,
	[ids.adminUser]: ids.admin,
};

type Path = "legacy admission" | "append admission";
type Authority = "legacy" | "canonical";

describe("manual work route parity (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let day = 0;

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed(authority: Authority, path: Path) {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1602 parity', $1, 'Europe/Berlin', $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1602-m-employee', $1, $2, 'member', 'approved', $6),
			 ('t1602-m-manager', $1, $3, 'member', 'approved', $6),
			 ('t1602-m-owner', $1, $4, 'owner', 'approved', $6),
			 ('t1602-m-admin', $1, $5, 'admin', 'approved', $6)`,
			[
				ids.organization,
				ids.employeeUser,
				ids.managerUser,
				ids.ownerUser,
				ids.adminUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'employee', $10), ($7, $8, $9, 'employee', $10)`,
			[
				ids.employee,
				ids.employeeUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		// Everyone but the manager reports to the manager.
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 select gen_random_uuid(), employee_id, $2, true, $3, now(), now() from unnest($1::uuid[]) as employee_id`,
			[[ids.employee, ids.owner, ids.admin], ids.manager, ids.managerUser],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', $2, $3, now(), now())`,
			[ids.organization, authority, authority],
		);
		if (path === "append admission") {
			await admin.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
				[ids.organization],
			);
		}
	}

	async function changePolicy(terms: { noApprovalRequired: boolean; approvalDays?: number }) {
		await admin.query(
			`insert into change_policy
			 (id, organization_id, name, self_service_days, approval_days, no_approval_required, created_by, updated_at)
			 values ($1, $2, 'T1602 policy', 0, $5, $3, $4, now())`,
			[
				ids.changePolicy,
				ids.organization,
				terms.noApprovalRequired,
				ids.ownerUser,
				terms.approvalDays ?? 365,
			],
		);
		await admin.query(
			`insert into change_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, $4, now())`,
			[ids.changePolicyAssignment, ids.changePolicy, ids.organization, ids.ownerUser],
		);
	}

	beforeEach(() => {
		day = 0;
	});

	afterAll(async () => {
		await cleanup();
	});

	/** Submits a September entry, days back from today, through the chosen manual path. */
	async function submit(path: Path, by: string, forEmployee: string) {
		day += 1;
		const date = `2026-09-${String(day).padStart(2, "0")}`;
		const submissionId = randomUUID();
		harness.userId = by;
		harness.organizationId = ids.organization;
		const input =
			path === "legacy admission"
				? {
						submissionId,
						employeeId: forEmployee,
						date,
						clockInTime: "08:00",
						clockOutTime: "12:00",
						reason: "Forgot to clock in",
						timezone: "Europe/Berlin",
					}
				: {
						version: 2 as const,
						submissionId,
						targetEmployeeId: forEmployee,
						date,
						clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
						clockOut: { time: "12:00", occurrence: null, displayedOffsetMinutes: 120 },
						zone: { basis: "target" as const, timezone: "Europe/Berlin" },
						browserTimezone: null,
						reason: "Forgot to clock in",
						projectId: null,
						workCategoryId: null,
					};
		const result = await createManualTimeEntry(input as never);
		expect(result).toMatchObject({ success: true });
		const approvers = await admin.query<{ approver: string }>(
			`select approver_id as approver from approval_request
			 where organization_id = $1 and entity_id = $2
			 union
			 select a.approver_employee_id from approval_stage_assignment a
			 join approval_workflow w on w.id = a.workflow_id
			 where w.organization_id = $1 and w.source_id = $2`,
			[ids.organization, submissionId],
		);
		return {
			requiresApproval: result.success ? Boolean(result.data?.requiresApproval) : null,
			approvers: new Set(approvers.rows.map((row) => row.approver)),
		};
	}

	async function preview(employeeId: string): Promise<ApprovalRoute | undefined> {
		const found = await readOnlyTransaction(db as unknown as DatabaseClient, (reader) =>
			previewApprovalRoutes(reader, {
				organizationId: ids.organization,
				at: parseInstant(new Date().toISOString()),
				requesters: [{ kind: "employee", employeeId }],
			}),
		);
		return found.routes.get(`employee:${employeeId}`)?.get("manual_time_submission");
	}

	const approversOf = (route: ApprovalRoute | undefined) =>
		new Set(
			(route?.variants ?? []).flatMap(({ outcome }) =>
				outcome.kind === "routed"
					? outcome.stages.flatMap((stage) => stage.approverEmployeeIds)
					: [],
			),
		);

	async function expectSkippedAlike(path: Path, user: string, reason: string) {
		const employeeId = employeeOf[user] as string;
		expect(await preview(employeeId)).toMatchObject({ kind: "skipped", reason });
		expect(await submit(path, user, employeeId)).toEqual({
			requiresApproval: false,
			approvers: new Set(),
		});
	}

	describe.each([
		["legacy", "legacy admission"],
		["legacy", "append admission"],
		["canonical", "legacy admission"],
		["canonical", "append admission"],
	] as const)("%s authority, %s", (authority, path) => {
		beforeEach(async () => {
			await seed(authority, path);
		});

		it("skips an owner's and an admin's own entries", async () => {
			await changePolicy({ noApprovalRequired: false });
			await expectSkippedAlike(path, ids.ownerUser, "owner_admin_self");
			await expectSkippedAlike(path, ids.adminUser, "owner_admin_self");
		});

		it("skips a member's own entries when a custom role lets them manage the organization's settings", async () => {
			await changePolicy({ noApprovalRequired: false });
			const { rows } = await admin.query<{ id: string }>(
				`insert into custom_role (organization_id, name, created_by, updated_at)
				 values ($1, 'Settings managers', $2, now()) returning id`,
				[ids.organization, ids.ownerUser],
			);
			const roleId = rows[0]?.id;
			await admin.query(
				`insert into custom_role_permission (custom_role_id, action, subject)
				 values ($1, 'manage', 'OrgSettings')`,
				[roleId],
			);
			await admin.query(
				`insert into employee_custom_role (employee_id, custom_role_id, assigned_by)
				 values ($1, $2, $3)`,
				[ids.employee, roleId, ids.ownerUser],
			);

			await expectSkippedAlike(path, ids.employeeUser, "owner_admin_self");
		});

		it("skips without a change policy", async () => {
			await expectSkippedAlike(path, ids.employeeUser, "change_policy_no_policy");
		});

		it("skips in trust mode", async () => {
			await changePolicy({ noApprovalRequired: true });
			await expectSkippedAlike(path, ids.employeeUser, "change_policy_trust_mode");
		});

		it("routes to the same approver when the change policy requires approval", async () => {
			await changePolicy({ noApprovalRequired: false });
			const route = await preview(ids.employee);
			const submitted = await submit(path, ids.employeeUser, ids.employee);

			expect(route).toMatchObject({ kind: "routed", autoCompleted: false });
			expect(submitted.requiresApproval).toBe(true);
			expect(submitted.approvers).toEqual(approversOf(route));
			expect(approversOf(route)).toEqual(new Set([ids.manager]));
		});

		it("routes alike when the approval window is closed: a manual entry beyond it still goes to approval", async () => {
			await changePolicy({ noApprovalRequired: false, approvalDays: 0 });
			const route = await preview(ids.employee);
			const submitted = await submit(path, ids.employeeUser, ids.employee);

			expect(route).toMatchObject({ kind: "routed" });
			expect(submitted.requiresApproval).toBe(true);
			expect(submitted.approvers).toEqual(approversOf(route));
		});

		it("exempts an entry made on someone's behalf, which the preview of their own entries routes", async () => {
			await changePolicy({ noApprovalRequired: false });
			expect(await preview(ids.employee)).toMatchObject({ kind: "routed" });

			const submitted = await submit(path, ids.managerUser, ids.employee);

			expect(submitted).toEqual({ requiresApproval: false, approvers: new Set() });
		});
	});
});
