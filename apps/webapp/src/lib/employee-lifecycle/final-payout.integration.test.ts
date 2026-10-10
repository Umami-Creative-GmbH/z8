/**
 * #1002: the offboarding review shows the departing employee's work balance
 * and offers a final overtime payout, through the employee settings server
 * actions on PostgreSQL. Only the session and the release gate are mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	released: false,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

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
								id: `t1002-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

// The mocked session has no stored SSO provenance to admit.
vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/employee-lifecycle/release", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/employee-lifecycle/release")>();
	return {
		...original,
		get EMPLOYEE_OFFBOARDING_RELEASE_READY() {
			return harness.released;
		},
	};
});

const offboardingActions = await import(
	"@/app/[locale]/(app)/settings/employees/employee-offboarding.actions"
);
const workBalanceActions = await import(
	"@/app/[locale]/(app)/settings/employees/work-balance-actions"
);
const workBalance = await import("@/lib/work-balance/service");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const yesterday = today.subtract({ days: 1 });
const workDay = today.subtract({ days: 3 });

describe("final overtime payout in the offboarding review on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;
	let admin: SeededEmployee;
	let manager: SeededEmployee;
	let departing: SeededEmployee;
	let staying: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			fixture.organizationId,
		]);
		admin = await fixture.seedEmployee({ role: "admin" });
		manager = await fixture.seedEmployee();
		departing = await fixture.seedEmployee({
			startDate: new Date(`${today.subtract({ days: 7 }).toString()}T00:00:00Z`),
		});
		staying = await fixture.seedEmployee({
			startDate: new Date(`${today.subtract({ days: 7 }).toString()}T00:00:00Z`),
		});
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		for (const subject of [departing, staying]) {
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[subject.employeeId, manager.employeeId, fixture.ownerUserId],
			);
			// Six hours three days ago; with no work policy nothing is required: +6:00h.
			await seedCompletedWork(subject.employeeId, "08:00", "14:00");
		}
		await createDepartureCommands({
			db: fixture.db,
			clock: systemClock,
			clockOut: { close: async () => ({ kind: "not_running" }) },
		}).offboardNow(
			{ userId: fixture.ownerUserId, organizationId: fixture.organizationId },
			{
				employeeId: departing.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			},
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		harness.released = true;
		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2,
			 cancellation_reason = 'test reset'
			 where organization_id = $1 and cancelled_at is null`,
			[fixture.organizationId, fixture.ownerUserId],
		);
		for (const subject of [departing, staying]) {
			await workBalance.refreshEmployeeWorkBalanceFromPeriods({
				employeeId: subject.employeeId,
				organizationId: fixture.organizationId,
				forceFullRebuild: true,
			});
		}
	});

	async function seedCompletedWork(employeeId: string, from: string, to: string) {
		const start = `${workDay.toString()}T${from}:00Z`;
		const end = `${workDay.toString()}T${to}:00Z`;
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", start],
			[clockOutId, "clock_out", end],
		]) {
			await fixture.pool.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $7, $6)`,
				[
					entryId,
					employeeId,
					fixture.organizationId,
					type,
					timestamp,
					fixture.ownerUserId,
					entryId,
				],
			);
		}
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 360, false, now())`,
			[employeeId, fixture.organizationId, clockInId, clockOutId, start, end],
		);
	}

	async function review(asUserId: string, subject = departing) {
		harness.userId = asUserId;
		harness.organizationId = fixture.organizationId;
		const result = await offboardingActions.getEmployeeOffboardingViewAction({
			employeeId: subject.employeeId,
		});
		if (!result.success) throw new Error(`offboarding view failed: ${result.error}`);
		return result.data;
	}

	it("shows +6h with a final payout defaulting to the whole remaining balance", async () => {
		const view = await review(admin.userId);

		expect(view.state).toBe("offboarded");
		expect(view.workBalance).toEqual({
			balance: { balanceMinutes: 360, computedThroughDate: yesterday.toString() },
			finalPayout: {
				defaultDay: yesterday.toString(),
				defaultMinutes: 360,
				latestDay: today.toString(),
			},
		});
	});

	it("shows a manager the balance without the payout action", async () => {
		const view = await review(manager.userId);

		expect(view.workBalance).toEqual({
			balance: { balanceMinutes: 360, computedThroughDate: yesterday.toString() },
			finalPayout: null,
		});
	});

	it("records the final payout, which lowers the balance to zero and is audited like any payout", async () => {
		const before = await review(admin.userId);
		const finalPayout = before.workBalance?.finalPayout;
		if (!finalPayout) throw new Error("no final payout offered");

		const recorded = await workBalanceActions.recordOvertimePayoutAction({
			employeeId: departing.employeeId,
			day: finalPayout.defaultDay,
			hours: Math.floor(finalPayout.defaultMinutes / 60),
			minutes: finalPayout.defaultMinutes % 60,
			reason: "Final payout on leaving",
		});
		expect(recorded).toMatchObject({ success: true });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		const after = await review(admin.userId);
		expect(after.workBalance).toEqual({
			balance: { balanceMinutes: 0, computedThroughDate: yesterday.toString() },
			finalPayout: null,
		});
		expect(
			(
				await workBalance.getEmployeeWorkBalances({
					employeeIds: [departing.employeeId],
					organizationId: fixture.organizationId,
				})
			).get(departing.employeeId)?.balanceMinutes,
		).toBe(0);
		const audit = await fixture.pool.query<{ action: string; performed_by: string }>(
			`select action, performed_by from audit_log
			 where organization_id = $1 and entity_id = $2 order by timestamp`,
			[fixture.organizationId, adjustmentId],
		);
		expect(audit.rows).toEqual([
			{ action: "balance_adjustment.recorded", performed_by: admin.userId },
		]);

		// The balance is information only: the departure's state, follow-up and
		// capabilities are the same whatever it is.
		const { workBalance: _before, ...lifecycleBefore } = before;
		const { workBalance: _after, ...lifecycleAfter } = after;
		expect(lifecycleAfter).toEqual(lifecycleBefore);
	});

	it("offers the final payout to a manager whose payroll grant covers the employee who left", async () => {
		const payrollManager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			payrollManager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, false, $3)`,
			[departing.employeeId, payrollManager.employeeId, fixture.ownerUserId],
		);
		const grantId = randomUUID();
		await fixture.pool.query(
			`insert into payroll_access_grant
			 (id, organization_id, payroll_employee_id, scope, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'specific', true, $4, now())`,
			[grantId, fixture.organizationId, payrollManager.employeeId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
			 values ($1, $2, $3, $4)`,
			[fixture.organizationId, grantId, departing.employeeId, fixture.ownerUserId],
		);

		const view = await review(payrollManager.userId);
		const finalPayout = view.workBalance?.finalPayout;
		expect(finalPayout).toEqual({
			defaultDay: yesterday.toString(),
			defaultMinutes: 360,
			latestDay: today.toString(),
		});
		// Read-only for the departure itself: the grant only adds the payout.
		expect(view.capabilities).toEqual({
			schedule: false,
			cancel: false,
			offboardNow: false,
			rehire: false,
			resolve: false,
		});

		const recorded = await workBalanceActions.recordOvertimePayoutAction({
			employeeId: departing.employeeId,
			day: finalPayout?.defaultDay ?? "",
			hours: 6,
			minutes: 0,
			reason: "Final payout on leaving",
		});
		expect(recorded).toMatchObject({ success: true });
		const audit = await fixture.pool.query<{ performed_by: string; metadata: unknown }>(
			`select performed_by, metadata from audit_log where organization_id = $1 and entity_id = $2`,
			[fixture.organizationId, recorded.success ? recorded.data.adjustmentId : ""],
		);
		expect(audit.rows).toHaveLength(1);
		expect(audit.rows[0]?.performed_by).toBe(payrollManager.userId);
		const metadata = audit.rows[0]?.metadata;
		expect(typeof metadata === "string" ? JSON.parse(metadata) : metadata).toMatchObject({
			via: "payroll_access_grant",
			grantId,
		});
		expect((await review(payrollManager.userId)).workBalance?.balance?.balanceMinutes).toBe(0);
	});

	it("leaves the review of an employee who is not departing without a work balance", async () => {
		const view = await review(admin.userId, staying);

		expect(view.state).toBe("active");
		expect(view.workBalance).toBeNull();
	});

	it("shows nothing new while offboarding is not released, and the gate behaves as before", async () => {
		const released = await review(admin.userId, staying);
		harness.released = false;
		const closed = await review(admin.userId, staying);

		expect((await review(admin.userId)).workBalance).toBeNull();
		expect(closed.capabilities).toEqual({
			...released.capabilities,
			schedule: false,
			cancel: false,
			offboardNow: false,
			rehire: false,
		});
	});
});
