/**
 * #1996 (spec #1935): an External Contractor tracks time like everyone else, but no employee
 * labor rule applies to it. The real `clockIn`/`clockOut` and `createManualTimeEntry` server
 * actions run against PostgreSQL in an organization whose organization-wide work policy owes a
 * 30-minute break after 6 hours, caps the day at 6 hours and expects 8 hours a weekday. An
 * employee in the same organization is the control: the same work breaks the rules for them.
 *
 * Only the request/session, billing provisioning, notification delivery and the Next cache are
 * replaced. Append admission is enabled per organization by inserting its control row directly.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

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
const { clockIn, clockOut } = await import("./clocking");
const { computeEmployeeWorkBalanceSnapshotAtEndOfDay, loadWorkBalanceEmployee } =
	await import("@/lib/work-balance/service");

const ids = {
	organization: "t1996-contractor-clock-org",
	contractorUser: "t1996-contractor-user",
	employeeUser: "t1996-employee-user",
	ownerUser: "t1996-owner-user",
	contractor: "f1996000-0000-4000-8000-000000000001",
	employee: "f1996000-0000-4000-8000-000000000002",
	owner: "f1996000-0000-4000-8000-000000000003",
	policy: "f1996000-0000-4000-8000-000000000010",
	regulation: "f1996000-0000-4000-8000-000000000011",
	breakRule: "f1996000-0000-4000-8000-000000000012",
	policyAssignment: "f1996000-0000-4000-8000-000000000013",
	customer: "f1996000-0000-4000-8000-000000000020",
	project: "f1996000-0000-4000-8000-000000000021",
	projectAssignment: "f1996000-0000-4000-8000-000000000022",
} as const;
const users = [ids.contractorUser, ids.employeeUser, ids.ownerUser];

// A Wednesday: 6h 59m 51s without a break (420 stored minutes).
const clockInAt = parseInstant("2026-07-22T08:00:40Z");
const clockOutAt = parseInstant("2026-07-22T15:00:31Z");

describe("an External Contractor's time tracking on PostgreSQL (#1996)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function clockWork(userId: string) {
		actAs(userId);
		await expect(
			clockIn("office", { instant: clockInAt, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: clockOutAt,
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
	}

	async function periodsOf(employeeId: string) {
		const { rows } = await admin.query<{
			duration_minutes: number;
			was_auto_adjusted: boolean;
			approval_status: string;
			project_id: string | null;
			is_billable: boolean;
		}>(
			`select duration_minutes, was_auto_adjusted, approval_status, project_id, is_billable
			 from work_period where organization_id = $1 and employee_id = $2 and deleted_at is null
			 order by start_time`,
			[ids.organization, employeeId],
		);
		return rows;
	}

	async function violationsOf(employeeId: string) {
		const { rows } = await admin.query<{ violation_type: string }>(
			"select violation_type from work_policy_violation where organization_id = $1 and employee_id = $2",
			[ids.organization, employeeId],
		);
		return rows.map((row) => row.violation_type);
	}

	async function breakIntentsOf(employeeId: string) {
		const { rows } = await admin.query(
			`select intent.id from work_break_adjustment_intent intent
			 join work_period period on period.id = intent.work_period_id
			 where intent.organization_id = $1 and period.employee_id = $2`,
			[ids.organization, employeeId],
		);
		return rows;
	}

	/** The work balance at the end of July, computed from scratch as a full rebuild would. */
	async function balanceThroughJuly(employeeId: string) {
		const scope = { employeeId, organizationId: ids.organization };
		const subject = await loadWorkBalanceEmployee(scope);
		if (!subject) throw new Error("employee not found");
		return computeEmployeeWorkBalanceSnapshotAtEndOfDay({
			organizationId: ids.organization,
			employee: subject,
			day: "2026-07-31",
		});
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			"insert into organization (id, name, slug, timezone, created_at) values ($1, 'T1996 clocking', $1, 'UTC', $2)",
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'manual_time_submission', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t1996-m-contractor', $1, $2, 'member', 'approved', $5),
			 ('t1996-m-employee', $1, $3, 'member', 'approved', $5),
			 ('t1996-m-owner', $1, $4, 'owner', 'approved', $5)`,
			[ids.organization, ids.contractorUser, ids.employeeUser, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, start_date, engagement_kind, updated_at) values
			 ($1, $2, $7, 'employee', $8, 'contractor', $8),
			 ($3, $4, $7, 'employee', $8, 'employee', $8),
			 ($5, $6, $7, 'admin', $8, 'employee', $8)`,
			[
				ids.contractor,
				ids.contractorUser,
				ids.employee,
				ids.employeeUser,
				ids.owner,
				ids.ownerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
			 values ($1, $2, 'open', $4, 'recorded', 'contractor'),
			        ($1, $3, 'open', $4, 'recorded', 'employee')`,
			[ids.organization, ids.contractor, ids.employee, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into work_policy
			 (id, organization_id, name, schedule_enabled, regulation_enabled, is_active, created_by, updated_at)
			 values ($1, $2, 'T1996 policy', true, true, true, $3, $4)`,
			[ids.policy, ids.organization, ids.ownerUser, timestamp],
		);
		const {
			rows: [version],
		} = await admin.query<{ id: string }>(
			`insert into work_policy_version
			 (policy_id, organization_id, version_number, effective_from_date, schedule_enabled, regulation_enabled, presence_enabled, is_legacy_baseline, created_by)
			 values ($1, $2, 1, '1970-01-01', true, true, false, true, $3)
			 returning id`,
			[ids.policy, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into work_policy_schedule
			 (policy_id, policy_version_id, schedule_cycle, schedule_type, working_days_preset, hours_per_cycle, updated_at)
			 values ($1, $2, 'weekly', 'simple', 'weekdays', '40', $3)`,
			[ids.policy, version.id, timestamp],
		);
		await admin.query(
			`insert into work_policy_regulation
			 (id, policy_id, policy_version_id, max_daily_minutes, max_uninterrupted_minutes, updated_at)
			 values ($1, $2, $3, 360, 360, $4)`,
			[ids.regulation, ids.policy, version.id, timestamp],
		);
		await admin.query(
			`insert into work_policy_break_rule
			 (id, regulation_id, policy_version_id, working_minutes_threshold, required_break_minutes, updated_at)
			 values ($1, $2, $3, 360, 30, $4)`,
			[ids.breakRule, ids.regulation, version.id, timestamp],
		);
		await admin.query(
			`insert into work_policy_assignment
			 (id, policy_id, organization_id, assignment_type, priority, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'organization', 0, true, $4, $5)`,
			[ids.policyAssignment, ids.policy, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'T1996 customer', $3, now())`,
			[ids.customer, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into project
			 (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at)
			 values ($1, $2, 'T1996 project', 'active', true, $3, true, $4, now())`,
			[ids.project, ids.organization, ids.customer, ids.ownerUser],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.projectAssignment, ids.project, ids.organization, ids.contractor, ids.ownerUser],
		);
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		await admin.query(
			`insert into organization_tracking_settings (organization_id, tracking_start_date, activated_at)
			 values ($1, '2026-07-01', now())`,
			[ids.organization],
		);
	}

	beforeEach(async () => {
		harness.now = null;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("keeps a contractor's clocked work whole: no compliance violation, no automatic break", async () => {
		await clockWork(ids.employeeUser);
		// The control: the organization's policy judges an employee's same work.
		expect(await violationsOf(ids.employee)).not.toEqual([]);
		expect((await periodsOf(ids.employee)).some((period) => period.was_auto_adjusted)).toBe(true);

		await clockWork(ids.contractorUser);

		expect(await periodsOf(ids.contractor)).toEqual([
			{
				duration_minutes: 420,
				was_auto_adjusted: false,
				approval_status: "approved",
				project_id: null,
				is_billable: false,
			},
		]);
		expect(await violationsOf(ids.contractor)).toEqual([]);
		expect(await breakIntentsOf(ids.contractor)).toEqual([]);
	});

	it("accrues no required time and no work balance for a contractor", async () => {
		await clockWork(ids.employeeUser);
		await clockWork(ids.contractorUser);

		// The control: 8 hours every weekday of July for the employee.
		const employeeBalance = await balanceThroughJuly(ids.employee);
		expect(employeeBalance.requiredMinutes).toBeGreaterThanOrEqual(20 * 480);
		expect(employeeBalance.actualMinutes).toBeGreaterThan(0);
		expect(await balanceThroughJuly(ids.contractor)).toMatchObject({
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
		});
	});

	it("records a contractor's manual entry booked billable to an assigned project", async () => {
		actAs(ids.contractorUser);
		const command: ManualTimeEntryCommand = {
			version: 2,
			submissionId: randomUUID(),
			targetEmployeeId: ids.contractor,
			date: "2026-07-21",
			clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 0 },
			clockOut: { time: "17:00", occurrence: null, displayedOffsetMinutes: 0 },
			zone: { basis: "target", timezone: "UTC" },
			browserTimezone: "UTC",
			reason: "Workshop at the customer",
			projectId: ids.project,
			workCategoryId: null,
			billable: true,
		};

		await expect(createManualTimeEntry(command)).resolves.toMatchObject({ success: true });

		expect(await periodsOf(ids.contractor)).toEqual([
			{
				duration_minutes: 540,
				was_auto_adjusted: false,
				approval_status: "approved",
				project_id: ids.project,
				is_billable: true,
			},
		]);
		const { rows: allocations } = await admin.query(
			`select allocation.project_id, allocation.allocation_kind
			 from time_record_allocation allocation
			 join time_record record on record.id = allocation.record_id
			 where allocation.organization_id = $1 and record.employee_id = $2`,
			[ids.organization, ids.contractor],
		);
		expect(allocations).toEqual([{ project_id: ids.project, allocation_kind: "project" }]);
		expect(await violationsOf(ids.contractor)).toEqual([]);
		expect(await breakIntentsOf(ids.contractor)).toEqual([]);
	});

	it("still refuses a contractor's work in a closed month", async () => {
		harness.now = parseInstant("2026-08-10T10:00:00Z");
		const { db } = await import("@/db");
		const { closeMonth } = await import("@/lib/time-tracking/closed-months/store");
		await expect(
			closeMonth(db, {
				organizationId: ids.organization,
				month: "2026-07",
				scope: { kind: "organization" },
				actor: { kind: "user", userId: ids.ownerUser },
				now: harness.now,
			}),
		).resolves.toMatchObject({ kind: "closed" });

		actAs(ids.contractorUser);
		await expect(
			createManualTimeEntry({
				version: 2,
				submissionId: randomUUID(),
				targetEmployeeId: ids.contractor,
				date: "2026-07-21",
				clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 0 },
				clockOut: { time: "12:00", occurrence: null, displayedOffsetMinutes: 0 },
				zone: { basis: "target", timezone: "UTC" },
				browserTimezone: "UTC",
				reason: "Late entry",
				projectId: ids.project,
				workCategoryId: null,
			}),
		).resolves.toMatchObject({ success: false, code: "month_closed" });
		expect(await periodsOf(ids.contractor)).toEqual([]);
	});
});
