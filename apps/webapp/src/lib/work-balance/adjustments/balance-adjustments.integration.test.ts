/**
 * #993: recording and cancelling overtime payouts through the employee
 * settings server actions, and the work-balance projection that adds them in,
 * on PostgreSQL. Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate, plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
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
								id: `t993-session-${harness.userId}`,
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

const actions = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
const workBalance = await import("@/lib/work-balance/service");
const { refreshEmployeeTimeBalances } = await import("@/app/[locale]/(app)/team/team-time-balance");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const workDay = today.subtract({ days: 3 });
const payoutDay = today.subtract({ days: 2 });

describe("overtime payouts on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let employeeId: string;
	let owner: { userId: string; employeeId: string };
	let admin: SeededEmployee;
	let manager: SeededEmployee;
	let member: SeededEmployee;
	let foreignOwner: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		employeeId = fixture.employeeId;
		owner = { userId: fixture.ownerUserId, employeeId: fixture.ownerEmployeeId };
		admin = await fixture.seedEmployee({ role: "admin" });
		manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[employeeId, manager.employeeId, owner.userId],
		);
		member = await fixture.seedEmployee();
		otherOrganizationId = await fixture.createOrganization();
		foreignOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = any($1)`, [
			[organizationId, otherOrganizationId],
		]);
		// The employee started a week ago and worked 12 hours three days ago; with
		// no work policy nothing is required, so the balance is +12:00h.
		await fixture.pool.query(`update employee set start_date = $2 where id = $1`, [
			employeeId,
			`${today.subtract({ days: 7 }).toString()}T00:00:00Z`,
		]);
		await seedCompletedWork(`${workDay.toString()}T08:00:00Z`, `${workDay.toString()}T20:00:00Z`);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		// The trigger lets only an erased employee's adjustments go; tests start clean
		// by cancelling instead, so each test reads the balance it expects.
		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2,
			 cancellation_reason = 'test reset'
			 where organization_id = $1 and cancelled_at is null`,
			[organizationId, owner.userId],
		);
		await refresh();
	});

	async function seedCompletedWork(start: string, end: string) {
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
				[entryId, employeeId, organizationId, type, timestamp, owner.userId, entryId],
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

	function actAs(userId: string, activeOrganizationId: string = organizationId) {
		harness.userId = userId;
		harness.organizationId = activeOrganizationId;
	}

	async function refresh() {
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			employeeId,
			organizationId,
			forceFullRebuild: true,
		});
	}

	async function balanceMinutes() {
		const card = await workBalance.getEmployeeWorkBalance({ employeeId, organizationId });
		const badge = (
			await workBalance.getEmployeeWorkBalances({ employeeIds: [employeeId], organizationId })
		).get(employeeId);
		expect(badge?.balanceMinutes).toBe(card?.balanceMinutes);
		return card?.balanceMinutes;
	}

	async function recordPayout(
		input: Partial<{ day: string; hours: number; minutes: number; reason: string }> = {},
		asUser = admin.userId,
	) {
		actAs(asUser);
		return actions.recordOvertimePayoutAction({
			employeeId,
			day: input.day ?? payoutDay.toString(),
			hours: input.hours ?? 5,
			minutes: input.minutes ?? 0,
			reason: input.reason ?? "Paid with the October payroll",
		});
	}

	async function auditActions(entityId: string) {
		const rows = await fixture.pool.query<{ action: string; performed_by: string }>(
			`select action, performed_by from audit_log
			 where organization_id = $1 and entity_id = $2 order by timestamp`,
			[organizationId, entityId],
		);
		return rows.rows;
	}

	it("records a payout that lowers every balance view, and a full rebuild keeps it", async () => {
		expect(await balanceMinutes()).toBe(720);
		const yearlyBefore = (
			await refreshEmployeeTimeBalances({ employeeIds: [employeeId], organizationId })
		).get(employeeId);

		const recorded = await recordPayout();
		expect(recorded).toMatchObject({ success: true });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		// The action refreshed the projection: card and team badge read 12h - 5h.
		expect(await balanceMinutes()).toBe(420);
		const card = await workBalance.getEmployeeWorkBalance({ employeeId, organizationId });
		expect(card).toMatchObject({ actualMinutes: 720, requiredMinutes: 0, adjustmentMinutes: -300 });

		// The yearly team balance (its own calculation, no screen yet) subtracts the
		// payout too; worked time stays as worked.
		const yearly = (
			await refreshEmployeeTimeBalances({ employeeIds: [employeeId], organizationId })
		).get(employeeId);
		if (payoutDay.year === today.year && workDay.year === today.year) {
			expect(yearly).toMatchObject({
				actualMinutes: 720,
				balanceMinutes: (yearlyBefore?.balanceMinutes ?? 0) - 300,
			});
		}

		actAs(admin.userId);
		const section = await actions.getEmployeeWorkBalanceSectionAction({ employeeId });
		expect(section.success && section.data.balance?.balanceMinutes).toBe(420);
		expect(section.success && section.data.adjustments).toEqual([
			expect.objectContaining({
				id: adjustmentId,
				kind: "overtime_payout",
				day: payoutDay.toString(),
				minutes: -300,
				reason: "Paid with the October payroll",
				recordedBy: expect.objectContaining({ userId: admin.userId }),
				cancellation: null,
			}),
		]);

		expect(await auditActions(adjustmentId)).toEqual([
			{ action: "balance_adjustment.recorded", performed_by: admin.userId },
		]);

		// A full rebuild deletes and recomputes the stored rows; the payout still counts.
		await workBalance.requestEmployeeWorkBalanceFullRebuild({ employeeId, organizationId });
		expect(await workBalance.getEmployeeWorkBalance({ employeeId, organizationId })).toBeNull();
		await refresh();
		expect(await balanceMinutes()).toBe(420);
	});

	it("refuses a payout over the balance, of zero, dated after today or without a reason", async () => {
		expect(await recordPayout({ hours: 20 })).toMatchObject({
			success: false,
			code: "exceeds_balance",
		});
		// The balance at the end of the work day is 12h; the day before it is nothing.
		expect(
			await recordPayout({ day: workDay.subtract({ days: 1 }).toString(), hours: 1 }),
		).toMatchObject({ success: false, code: "exceeds_balance" });
		expect(await recordPayout({ hours: 0, minutes: 0 })).toMatchObject({
			success: false,
			code: "amount_not_positive",
		});
		expect(await recordPayout({ day: today.add({ days: 1 }).toString() })).toMatchObject({
			success: false,
			code: "future_day",
		});
		expect(await recordPayout({ reason: "   " })).toMatchObject({
			success: false,
			code: "reason_required",
		});
		expect(await recordPayout({ day: "not-a-day" })).toMatchObject({
			success: false,
			code: "invalid_input",
		});

		// A second payout counts the first: 12h - 5h leaves 7h.
		expect(await recordPayout({ hours: 5 })).toMatchObject({ success: true });
		expect(await recordPayout({ hours: 7, minutes: 1 })).toMatchObject({
			success: false,
			code: "exceeds_balance",
		});
		expect(await recordPayout({ hours: 7 })).toMatchObject({ success: true });
		expect(await balanceMinutes()).toBe(0);
	});

	it("cancels a payout, which restores the balance and stays in the history as cancelled", async () => {
		const recorded = await recordPayout();
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";
		expect(await balanceMinutes()).toBe(420);

		actAs(owner.userId);
		expect(
			await actions.cancelBalanceAdjustmentAction({ employeeId, adjustmentId, reason: "" }),
		).toMatchObject({ success: false, code: "reason_required" });
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId,
				adjustmentId,
				reason: "Recorded for the wrong month",
			}),
		).toMatchObject({ success: true });
		expect(await balanceMinutes()).toBe(720);

		const section = await actions.getEmployeeWorkBalanceSectionAction({ employeeId });
		const row = section.success
			? section.data.adjustments.find((adjustment) => adjustment.id === adjustmentId)
			: undefined;
		expect(row?.cancellation).toEqual({
			cancelledAt: expect.any(String),
			cancelledBy: expect.objectContaining({ userId: owner.userId }),
			reason: "Recorded for the wrong month",
		});

		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId,
				adjustmentId,
				reason: "Again",
			}),
		).toMatchObject({ success: false, code: "already_cancelled" });
		expect(await auditActions(adjustmentId)).toEqual([
			{ action: "balance_adjustment.recorded", performed_by: admin.userId },
			{ action: "balance_adjustment.cancelled", performed_by: owner.userId },
		]);
	});

	it("refuses managers and employees to record or cancel", async () => {
		const recorded = await recordPayout({ hours: 1 });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		for (const userId of [manager.userId, member.userId]) {
			expect(await recordPayout({ hours: 1 }, userId)).toMatchObject({
				success: false,
				code: "not_permitted",
			});
			actAs(userId);
			expect(
				await actions.cancelBalanceAdjustmentAction({ employeeId, adjustmentId, reason: "No" }),
			).toMatchObject({ success: false, code: "not_permitted" });
		}
		// The direct manager sees the history read-only (#996); an unrelated member does not.
		actAs(manager.userId);
		expect(await actions.getEmployeeWorkBalanceSectionAction({ employeeId })).toMatchObject({
			success: true,
			data: { canManage: false },
		});
		actAs(member.userId);
		expect(await actions.getEmployeeWorkBalanceSectionAction({ employeeId })).toMatchObject({
			success: false,
			code: "not_permitted",
		});
		expect(await balanceMinutes()).toBe(660);
	});

	it("keeps every read and write inside the actor's organization", async () => {
		const recorded = await recordPayout({ hours: 1 });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		actAs(foreignOwner.userId, otherOrganizationId);
		expect(
			await actions.recordOvertimePayoutAction({
				employeeId,
				day: payoutDay.toString(),
				hours: 1,
				minutes: 0,
				reason: "Foreign",
			}),
		).toMatchObject({ success: false, code: "employee_not_found" });
		expect(await actions.getEmployeeWorkBalanceSectionAction({ employeeId })).toMatchObject({
			success: false,
			code: "employee_not_found",
		});
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId: foreignOwner.employeeId,
				adjustmentId,
				reason: "Foreign",
			}),
		).toMatchObject({ success: false, code: "adjustment_not_found" });

		// The database refuses an adjustment for another organization's employee.
		await expect(
			fixture.pool.query(
				`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
				 values ($1, $2, 'overtime_payout', $3, -60, 'Foreign', $4)`,
				[otherOrganizationId, employeeId, payoutDay.toString(), foreignOwner.userId],
			),
		).rejects.toMatchObject({ code: "23503" });
		expect(await balanceMinutes()).toBe(660);
	});

	it("dates a payout in the employee's timezone and refreshes an employee who has left", async () => {
		const zone = "Pacific/Kiritimati";
		const leaver = await fixture.seedEmployee({
			isActive: false,
			startDate: new Date(`${today.subtract({ days: 7 }).toString()}T00:00:00Z`),
		});
		await fixture.pool.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, $2, now())`,
			[leaver.userId, zone],
		);
		const clockInId = randomUUID();
		await fixture.pool.query(
			`insert into time_entry
			 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
			  timezone_source, hash, created_by)
			 values ($1, $2, $3, 'clock_in', $4, 840, $5, 'user_setting', $6, $7)`,
			[
				clockInId,
				leaver.employeeId,
				organizationId,
				`${workDay.toString()}T00:00:00Z`,
				zone,
				clockInId,
				owner.userId,
			],
		);
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, start_time, end_time, duration_minutes,
			  is_active, updated_at)
			 values ($1, $2, $3, $4, $5, 600, false, now())`,
			[
				leaver.employeeId,
				organizationId,
				clockInId,
				`${workDay.toString()}T00:00:00Z`,
				`${workDay.toString()}T10:00:00Z`,
			],
		);
		const localToday = plainDateAt(systemClock.nowInstant(), zone);

		actAs(admin.userId);
		const payout = (day: string, hours = 1) =>
			actions.recordOvertimePayoutAction({
				employeeId: leaver.employeeId,
				day,
				hours,
				minutes: 0,
				reason: "Final payout",
			});
		expect(await payout(localToday.add({ days: 1 }).toString())).toMatchObject({
			success: false,
			code: "future_day",
		});
		// Today in Kiritimati is accepted even when it is still yesterday in UTC.
		expect(await payout(localToday.toString(), 10)).toMatchObject({ success: true });

		const section = await actions.getEmployeeWorkBalanceSectionAction({
			employeeId: leaver.employeeId,
		});
		expect(section.success && section.data.today).toBe(localToday.toString());
		expect(section.success && section.data.timezone).toBe(zone);

		// The balance worker skips inactive employees; recording refreshed the
		// projection directly. It runs through yesterday, so a payout dated today
		// counts from tomorrow.
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			employeeId: leaver.employeeId,
			organizationId,
			forceFullRebuild: true,
		});
		const balance = await workBalance.getEmployeeWorkBalance({
			employeeId: leaver.employeeId,
			organizationId,
		});
		expect(balance).toMatchObject({
			actualMinutes: 600,
			adjustmentMinutes: 0,
			balanceMinutes: 600,
		});

		const earlier = await payout(workDay.add({ days: 1 }).toString(), 0);
		expect(earlier).toMatchObject({ success: false, code: "amount_not_positive" });
		const cancelled = section.success ? section.data.adjustments[0]?.id : undefined;
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId: leaver.employeeId,
				adjustmentId: cancelled ?? "",
				reason: "Paid next month instead",
			}),
		).toMatchObject({ success: true });
		expect(await payout(workDay.add({ days: 1 }).toString(), 4)).toMatchObject({ success: true });
		expect(
			await workBalance.getEmployeeWorkBalance({ employeeId: leaver.employeeId, organizationId }),
		).toMatchObject({ actualMinutes: 600, adjustmentMinutes: -240, balanceMinutes: 360 });
	});

	it("never edits or deletes an adjustment in the database", async () => {
		const recorded = await recordPayout({ hours: 1 });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		await expect(
			fixture.pool.query(`update balance_adjustment set minutes = -30 where id = $1`, [
				adjustmentId,
			]),
		).rejects.toMatchObject({ code: "55000" });
		await expect(
			fixture.pool.query(`delete from balance_adjustment where id = $1`, [adjustmentId]),
		).rejects.toMatchObject({ code: "55000" });
		await expect(
			fixture.pool.query(
				`insert into balance_adjustment (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
				 values ($1, $2, 'overtime_payout', $3, 60, 'Positive payout', $4)`,
				[organizationId, employeeId, payoutDay.toString(), owner.userId],
			),
		).rejects.toMatchObject({ code: "23514" });

		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2, cancellation_reason = 'Once'
			 where id = $1`,
			[adjustmentId, owner.userId],
		);
		await expect(
			fixture.pool.query(
				`update balance_adjustment set cancellation_reason = 'Twice' where id = $1`,
				[adjustmentId],
			),
		).rejects.toMatchObject({ code: "55000" });
		expect(parsePlainDate(payoutDay.toString()).equals(payoutDay)).toBe(true);
	});
});
