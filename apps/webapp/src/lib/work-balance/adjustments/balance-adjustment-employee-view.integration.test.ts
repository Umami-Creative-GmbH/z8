/**
 * #996: employees and their managers see balance adjustments, and the
 * employee is notified when one is recorded or cancelled. Runs the employee
 * settings server actions and the real notification service on PostgreSQL;
 * only the session is mocked and email is captured instead of sent.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
								id: `t996-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/email/email-service", async (importOriginal) =>
	(await import("@/test/integration-harness")).emailService(importOriginal),
);

const actions = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
const { sendEmail } = await import("@/lib/email/email-service");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const workDay = today.subtract({ days: 3 });
const payoutDay = today.subtract({ days: 2 });

describe("balance adjustments seen by employees and managers (#996)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let employee: { userId: string; employeeId: string };
	let admin: SeededEmployee;
	let manager: SeededEmployee;
	let colleague: SeededEmployee;
	let colleaguesManager: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		const [employeeUser] = (
			await fixture.pool.query<{ user_id: string }>(`select user_id from employee where id = $1`, [
				fixture.employeeId,
			])
		).rows;
		employee = { userId: employeeUser?.user_id ?? "", employeeId: fixture.employeeId };
		admin = await fixture.seedEmployee({ role: "admin" });
		manager = await fixture.seedEmployee();
		colleague = await fixture.seedEmployee();
		colleaguesManager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = any($1)`, [
			[manager.employeeId, colleaguesManager.employeeId],
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $5), ($3, $4, true, $5)`,
			[
				employee.employeeId,
				manager.employeeId,
				colleague.employeeId,
				colleaguesManager.employeeId,
				fixture.ownerUserId,
			],
		);
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			organizationId,
		]);
		for (const subject of [employee.employeeId, colleague.employeeId]) {
			await startedAWeekAgoWithTwelveHours(subject);
		}
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2,
			 cancellation_reason = 'test reset'
			 where organization_id = $1 and cancelled_at is null`,
			[organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(`delete from notification where organization_id = $1`, [
			organizationId,
		]);
		await fixture.pool.query(`delete from notification_preference where user_id = $1`, [
			employee.userId,
		]);
		vi.mocked(sendEmail).mockClear();
	});

	/** Started a week ago and worked 12 hours three days ago: a +12:00h balance. */
	async function startedAWeekAgoWithTwelveHours(employeeId: string) {
		await fixture.pool.query(`update employee set start_date = $2 where id = $1`, [
			employeeId,
			`${today.subtract({ days: 7 }).toString()}T00:00:00Z`,
		]);
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		const start = `${workDay.toString()}T08:00:00Z`;
		const end = `${workDay.toString()}T20:00:00Z`;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", start],
			[clockOutId, "clock_out", end],
		]) {
			await fixture.pool.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $7, $6)`,
				[entryId, employeeId, organizationId, type, timestamp, fixture.ownerUserId, entryId],
			);
		}
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 720, false, now())`,
			[employeeId, organizationId, clockInId, clockOutId, start, end],
		);
	}

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function recordPayout(employeeId = employee.employeeId, hours = 5) {
		actAs(admin.userId);
		const result = await actions.recordOvertimePayoutAction({
			employeeId,
			day: payoutDay.toString(),
			hours,
			minutes: 0,
			reason: "Paid with the October payroll",
		});
		if (!result.success) throw new Error(`Payout refused: ${result.code}`);
		return result.data.adjustmentId;
	}

	async function cancel(adjustmentId: string, employeeId = employee.employeeId) {
		actAs(admin.userId);
		const result = await actions.cancelBalanceAdjustmentAction({
			employeeId,
			adjustmentId,
			reason: "Recorded for the wrong month",
		});
		if (!result.success) throw new Error(`Cancel refused: ${result.code}`);
	}

	async function notifications() {
		const rows = await fixture.pool.query<{
			user_id: string;
			type: string;
			title: string;
			message: string;
			entity_id: string;
			action_url: string;
		}>(
			`select user_id, type, title, message, entity_id, action_url from notification
			 where organization_id = $1 order by created_at`,
			[organizationId],
		);
		return rows.rows;
	}

	function emailsTo(userId: string) {
		return vi
			.mocked(sendEmail)
			.mock.calls.map(([email]) => email)
			.filter((email) => email.to === `${userId}@lifecycle.test`);
	}

	it("notifies the employee once in-app and once by email on record and again on cancel", async () => {
		const adjustmentId = await recordPayout();

		expect(await notifications()).toEqual([
			{
				user_id: employee.userId,
				type: "work_balance_adjustment_recorded",
				title: "Overtime payout recorded",
				message: expect.stringMatching(/^An overtime payout of 5:00h for .+ was recorded/u),
				entity_id: adjustmentId,
				action_url: "/time-tracking",
			},
		]);
		await vi.waitFor(() => expect(emailsTo(employee.userId)).toHaveLength(1));
		expect(emailsTo(employee.userId)[0]).toMatchObject({ subject: "Overtime payout recorded" });

		await cancel(adjustmentId);

		const rows = await notifications();
		expect(rows.map((row) => [row.user_id, row.type, row.entity_id])).toEqual([
			[employee.userId, "work_balance_adjustment_recorded", adjustmentId],
			[employee.userId, "work_balance_adjustment_cancelled", adjustmentId],
		]);
		expect(rows[1]?.message).toMatch(
			/^The overtime payout of 5:00h for .+ was cancelled\. Reason: Recorded for the wrong month$/u,
		);
		await vi.waitFor(() => expect(emailsTo(employee.userId)).toHaveLength(2));
		expect(emailsTo(employee.userId)[1]).toMatchObject({ subject: "Overtime payout cancelled" });
		expect(emailsTo(employee.userId)[1]?.html).toContain("Reason: Recorded for the wrong month");
		// Nobody else hears about it, the admin who recorded it included.
		expect(vi.mocked(sendEmail).mock.calls).toHaveLength(2);
	});

	it("follows the employee's notification preferences per channel", async () => {
		await fixture.pool.query(
			`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
			 values ($1, 'work_balance_adjustment_recorded', 'email', false, now()),
			        ($1, 'work_balance_adjustment_cancelled', 'in_app', false, now())`,
			[employee.userId],
		);

		const adjustmentId = await recordPayout();
		await cancel(adjustmentId);

		// In-app only for the record, email only for the cancellation.
		expect((await notifications()).map((row) => row.type)).toEqual([
			"work_balance_adjustment_recorded",
		]);
		await vi.waitFor(() => expect(emailsTo(employee.userId)).toHaveLength(1));
		expect(emailsTo(employee.userId)[0]).toMatchObject({ subject: "Overtime payout cancelled" });
	});

	it("emails an employee who has left, without an in-app notification, per their preference", async () => {
		const leaver = await fixture.seedEmployee({ isActive: false });
		await startedAWeekAgoWithTwelveHours(leaver.employeeId);

		await cancel(await recordPayout(leaver.employeeId), leaver.employeeId);

		expect(await notifications()).toEqual([]);
		await vi.waitFor(() => expect(emailsTo(leaver.userId)).toHaveLength(2));
		expect(emailsTo(leaver.userId).map((email) => email.subject)).toEqual([
			"Overtime payout recorded",
			"Overtime payout cancelled",
		]);
		expect(emailsTo(leaver.userId)[1]?.html).toContain("Reason: Recorded for the wrong month");

		// With email turned off for payouts, nothing reaches them.
		await fixture.pool.query(
			`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
			 values ($1, 'work_balance_adjustment_recorded', 'email', false, now())`,
			[leaver.userId],
		);
		vi.mocked(sendEmail).mockClear();
		await recordPayout(leaver.employeeId, 1);
		expect(emailsTo(leaver.userId)).toEqual([]);
	});

	it("shows employees their own history, cancelled adjustments with reasons, and no one else's", async () => {
		const cancelled = await recordPayout(employee.employeeId, 2);
		await cancel(cancelled);
		const kept = await recordPayout(employee.employeeId, 3);
		await recordPayout(colleague.employeeId, 1);

		actAs(employee.userId);
		const own = await actions.getEmployeeWorkBalanceSectionAction({
			employeeId: employee.employeeId,
		});
		expect(own).toMatchObject({ success: true, data: { canManage: false } });
		const history = own.success ? own.data.adjustments : [];
		expect(history.find((row) => row.id === kept)).toMatchObject({
			kind: "overtime_payout",
			day: payoutDay.toString(),
			minutes: -180,
			reason: "Paid with the October payroll",
			recordedBy: { userId: admin.userId },
			cancellation: null,
		});
		expect(history.find((row) => row.id === cancelled)).toMatchObject({
			minutes: -120,
			cancellation: {
				cancelledBy: { userId: admin.userId },
				reason: "Recorded for the wrong month",
			},
		});

		expect(
			await actions.getEmployeeWorkBalanceSectionAction({ employeeId: colleague.employeeId }),
		).toMatchObject({ success: false, code: "not_permitted" });
	});

	it("shows managers the history of employees they manage, and of no one else", async () => {
		const teamMembers = await recordPayout(employee.employeeId, 1);
		const someoneElses = await recordPayout(colleague.employeeId, 1);

		actAs(manager.userId);
		const managed = await actions.getEmployeeWorkBalanceSectionAction({
			employeeId: employee.employeeId,
		});
		expect(managed).toMatchObject({ success: true, data: { canManage: false } });
		const seen = managed.success ? managed.data.adjustments.map((row) => row.id) : [];
		expect(seen).toContain(teamMembers);
		expect(seen).not.toContain(someoneElses);
		expect(
			await actions.getEmployeeWorkBalanceSectionAction({ employeeId: colleague.employeeId }),
		).toMatchObject({ success: false, code: "not_permitted" });

		// Seeing is not recording.
		expect(
			await actions.recordOvertimePayoutAction({
				employeeId: employee.employeeId,
				day: payoutDay.toString(),
				hours: 1,
				minutes: 0,
				reason: "Manager",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });

		actAs(admin.userId);
		expect(
			await actions.getEmployeeWorkBalanceSectionAction({ employeeId: colleague.employeeId }),
		).toMatchObject({ success: true, data: { canManage: true } });
	});
});
