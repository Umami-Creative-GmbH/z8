/**
 * #997: an opening balance replaces the work balance up to and including its
 * day (Time Tracking ADR-0008), through the employee settings server actions
 * and every balance read, on PostgreSQL. Only the session is mocked.
 *
 * The employee started on 1 January 2019, and so did their user account
 * (required time starts at the later of the two). Their work policy requires
 * one hour every Monday. They worked 10 hours on 5 March 2019 and 3 hours on
 * 4 November 2025.
 */

import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type PlainDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
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
								id: `t997-session-${harness.userId}`,
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
const yesterday = today.subtract({ days: 1 });
const start = parsePlainDate("2019-01-01");
const openingDay = parsePlainDate("2025-10-31");

/** Mondays from `from` through `through`, both included: one required hour each. */
function mondaysBetween(from: PlainDate, through: PlainDate) {
	let count = 0;
	for (let day = from; day.toString() <= through.toString(); day = day.add({ days: 1 })) {
		if (day.dayOfWeek === 1) count += 1;
	}
	return count;
}

/** 10h on 5 March 2019 and 3h on 4 November 2025, minus every Monday hour since 2019. */
const fullBalance = 600 + 180 - 60 * mondaysBetween(start, yesterday);
/** From 1 November 2025: the 3h on 4 November minus every Monday hour since then. */
const sinceOpeningDay = 180 - 60 * mondaysBetween(openingDay.add({ days: 1 }), yesterday);

describe("opening balances on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let employeeId: string;
	let owner: { userId: string; employeeId: string };
	let admin: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		owner = { userId: fixture.ownerUserId, employeeId: fixture.ownerEmployeeId };
		admin = await fixture.seedEmployee({ role: "admin" });
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			organizationId,
		]);
		// No recorded employment period: lifecycle coverage would clip 2019.
		const subject = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2019-01-01T00:00:00Z"),
		});
		employeeId = subject.employeeId;
		await fixture.pool.query(`update "user" set created_at = $2 where id = $1`, [
			subject.userId,
			new Date("2019-01-01T00:00:00Z"),
		]);
		await assignMondayHourPolicy();
		await seedCompletedWork("2019-03-05T08:00:00Z", "2019-03-05T18:00:00Z", 600);
		await seedCompletedWork("2025-11-04T08:00:00Z", "2025-11-04T11:00:00Z", 180);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		// The trigger lets only an erased employee's adjustments go; tests start clean
		// by cancelling instead.
		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2,
			 cancellation_reason = 'test reset'
			 where organization_id = $1 and cancelled_at is null`,
			[organizationId, owner.userId],
		);
		await refresh();
	});

	async function assignMondayHourPolicy() {
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values ($1, $2, 'Monday hour', true, false, $3, now())`,
			[policyId, organizationId, owner.userId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id, policy_id, schedule_cycle, schedule_type, working_days_preset, updated_at)
			 values ($1, $2, 'weekly', 'detailed', 'custom', now())`,
			[scheduleId, policyId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule_day (schedule_id, day_of_week, hours_per_day, is_work_day)
			 values ($1, 'monday', '1.00', true)`,
			[scheduleId],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, employee_id, priority, created_by, updated_at)
			 values ($1, $2, 'employee', $3, 2, $4, now())`,
			[policyId, organizationId, employeeId, owner.userId],
		);
	}

	async function seedCompletedWork(startTime: string, endTime: string, minutes: number) {
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", startTime],
			[clockOutId, "clock_out", endTime],
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
			 values ($1, $2, $3, $4, $5, $6, $7, false, now())`,
			[employeeId, organizationId, clockInId, clockOutId, startTime, endTime, minutes],
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

	async function fullRebuild() {
		await workBalance.requestEmployeeWorkBalanceFullRebuild({ employeeId, organizationId });
		expect(await workBalance.getEmployeeWorkBalance({ employeeId, organizationId })).toBeNull();
		await refresh();
	}

	/** The card's figure; the team list badge reads the same. */
	async function balanceMinutes() {
		const card = await workBalance.getEmployeeWorkBalance({ employeeId, organizationId });
		const badge = (
			await workBalance.getEmployeeWorkBalances({ employeeIds: [employeeId], organizationId })
		).get(employeeId);
		expect(badge?.balanceMinutes).toBe(card?.balanceMinutes);
		return card?.balanceMinutes;
	}

	async function setOpeningBalance(
		input: Partial<{
			day: string;
			negative: boolean;
			hours: number;
			minutes: number;
			reason: string;
		}> = {},
		asUser = admin.userId,
	) {
		actAs(asUser);
		return actions.setOpeningBalanceAction({
			employeeId,
			day: input.day ?? openingDay.toString(),
			negative: input.negative ?? false,
			hours: input.hours ?? 14,
			minutes: input.minutes ?? 0,
			reason: input.reason ?? "Balance carried over from the old system",
		});
	}

	it("replaces the balance through its day in every view, and a full rebuild keeps it", async () => {
		expect(await balanceMinutes()).toBe(fullBalance);

		const set = await setOpeningBalance();
		expect(set).toMatchObject({ success: true });

		// +14h, then only what is computed from 1 November counts.
		expect(await balanceMinutes()).toBe(840 + sinceOpeningDay);
		expect(await workBalance.getEmployeeWorkBalance({ employeeId, organizationId })).toMatchObject({
			adjustmentMinutes: 840,
			computedFromDate: "2025-11-01",
		});

		await fullRebuild();
		expect(await balanceMinutes()).toBe(840 + sinceOpeningDay);
	});

	it("restores the balance computed from 2019 when cancelled", async () => {
		const set = await setOpeningBalance();
		const adjustmentId = set.success ? set.data.adjustmentId : "";
		expect(await balanceMinutes()).toBe(840 + sinceOpeningDay);

		actAs(owner.userId);
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId,
				adjustmentId,
				reason: "Imported the full history instead",
			}),
		).toMatchObject({ success: true });
		expect(await balanceMinutes()).toBe(fullBalance);
		expect(await workBalance.getEmployeeWorkBalance({ employeeId, organizationId })).toMatchObject({
			adjustmentMinutes: 0,
			computedFromDate: "2019-01-01",
		});

		await fullRebuild();
		expect(await balanceMinutes()).toBe(fullBalance);
	});

	it("works the same way with a negative opening balance", async () => {
		expect(
			await setOpeningBalance({ negative: true, hours: 20, minutes: 30, reason: "Owed hours" }),
		).toMatchObject({ success: true });
		expect(await balanceMinutes()).toBe(-1230 + sinceOpeningDay);

		// A refresh from a dirty day (not a full rebuild) keeps counting from 1 November.
		await workBalance.markEmployeeWorkBalanceDirty({
			employeeId,
			organizationId,
			dirtyFromDate: "2019-03-05",
		});
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			employeeId,
			organizationId,
			dirtyFromDate: "2019-03-05",
		});
		expect(await balanceMinutes()).toBe(-1230 + sinceOpeningDay);

		await fullRebuild();
		expect(await balanceMinutes()).toBe(-1230 + sinceOpeningDay);
	});

	it("cancels the opening balance in effect with the new one's reason, so one is in effect", async () => {
		const first = await setOpeningBalance({ hours: 10 });
		const firstId = first.success ? first.data.adjustmentId : "";
		const second = await setOpeningBalance(
			{ day: "2025-12-31", hours: 2, reason: "Corrected carry-over" },
			owner.userId,
		);
		expect(second).toMatchObject({ success: true, data: { cancelledAdjustmentId: firstId } });
		const secondId = second.success ? second.data.adjustmentId : "";

		const inEffect = await fixture.pool.query<{ id: string }>(
			`select id from balance_adjustment
			 where employee_id = $1 and kind = 'opening_balance' and cancelled_at is null`,
			[employeeId],
		);
		expect(inEffect.rows).toEqual([{ id: secondId }]);

		actAs(admin.userId);
		const section = await actions.getEmployeeWorkBalanceSectionAction({ employeeId });
		const history = section.success ? section.data.adjustments : [];
		expect(history.find((row) => row.id === firstId)).toMatchObject({
			kind: "opening_balance",
			minutes: 600,
			cancellation: {
				cancelledBy: expect.objectContaining({ userId: owner.userId }),
				reason: "Corrected carry-over",
			},
		});
		expect(history.find((row) => row.id === secondId)).toMatchObject({
			kind: "opening_balance",
			day: "2025-12-31",
			minutes: 120,
			cancellation: null,
		});

		// The calculation now starts on 1 January 2026.
		expect(await balanceMinutes()).toBe(
			120 - 60 * mondaysBetween(parsePlainDate("2026-01-01"), yesterday),
		);

		const audit = await fixture.pool.query<{ entity_id: string; action: string }>(
			`select entity_id, action from audit_log
			 where organization_id = $1 and entity_id = any($2) order by timestamp, action desc`,
			[organizationId, [firstId, secondId]],
		);
		expect(audit.rows).toEqual([
			{ entity_id: firstId, action: "balance_adjustment.recorded" },
			{ entity_id: firstId, action: "balance_adjustment.cancelled" },
			{ entity_id: secondId, action: "balance_adjustment.recorded" },
		]);
	});

	it("refuses a day after today in the employee's timezone", async () => {
		expect(await setOpeningBalance({ day: today.add({ days: 1 }).toString() })).toMatchObject({
			success: false,
			code: "future_day",
		});
		expect(await setOpeningBalance({ reason: " " })).toMatchObject({
			success: false,
			code: "reason_required",
		});
		expect(await setOpeningBalance({ minutes: 60 })).toMatchObject({
			success: false,
			code: "invalid_input",
		});
		// Today is allowed; the balance is then the opening balance alone.
		expect(await setOpeningBalance({ day: today.toString(), hours: 3 })).toMatchObject({
			success: true,
		});
		expect(await balanceMinutes()).toBe(180);
	});

	it("refuses a payout on or before its day, and itself on or after a payout's day", async () => {
		expect(await setOpeningBalance()).toMatchObject({ success: true });
		const payout = (day: string) =>
			actions.recordOvertimePayoutAction({
				employeeId,
				day,
				hours: 1,
				minutes: 0,
				reason: "Paid out",
			});

		actAs(admin.userId);
		for (const day of ["2025-10-31", "2025-06-30"]) {
			expect(await payout(day)).toMatchObject({
				success: false,
				code: "before_opening_balance",
			});
		}
		// The day after counts against the opening balance: 14h + 0h on 1 November.
		const first = await payout("2025-11-01");
		expect(first).toMatchObject({ success: true });
		const second = await payout("2025-11-05");
		expect(second).toMatchObject({ success: true });
		expect(await balanceMinutes()).toBe(840 + sinceOpeningDay - 120);

		const firstPayout = {
			id: first.success ? first.data.adjustmentId : "",
			day: "2025-11-01",
			minutes: -60,
		};
		const secondPayout = {
			id: second.success ? second.data.adjustmentId : "",
			day: "2025-11-05",
			minutes: -60,
		};
		// A new opening balance on or after a payout's day would make it stop counting.
		expect(await setOpeningBalance({ day: "2025-11-01", hours: 5 })).toEqual({
			success: false,
			error: expect.any(String),
			code: "conflicting_payouts",
			conflictingPayouts: [firstPayout],
		});
		expect(await setOpeningBalance({ day: "2025-11-20", hours: 5 })).toMatchObject({
			code: "conflicting_payouts",
			conflictingPayouts: [firstPayout, secondPayout],
		});
		expect(await balanceMinutes()).toBe(840 + sinceOpeningDay - 120);

		// An earlier day leaves both payouts counting.
		expect(await setOpeningBalance({ day: "2025-10-15", hours: 5 })).toMatchObject({
			success: true,
		});
		expect(await balanceMinutes()).toBe(
			300 + sinceOpeningDay - 60 * mondaysBetween(parsePlainDate("2025-10-16"), openingDay) - 120,
		);
	});

	it("refuses managers and employees, and other organizations", async () => {
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		const member = await fixture.seedEmployee();
		for (const userId of [manager.userId, member.userId]) {
			expect(await setOpeningBalance({}, userId)).toMatchObject({
				success: false,
				code: "not_permitted",
			});
		}

		const otherOrganizationId = await fixture.createOrganization();
		const foreignOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		actAs(foreignOwner.userId, otherOrganizationId);
		expect(
			await actions.setOpeningBalanceAction({
				employeeId,
				day: openingDay.toString(),
				negative: false,
				hours: 1,
				minutes: 0,
				reason: "Foreign",
			}),
		).toMatchObject({ success: false, code: "employee_not_found" });
		expect(await balanceMinutes()).toBe(fullBalance);
	});

	it("replaces the yearly team balance of the year it is dated in", async () => {
		// The yearly team balance covers one calendar year; 2025 contains 31 October.
		const in2025 = DateTime.fromISO("2025-12-15T12:00:00Z", { zone: "utc" });
		const yearly = async () =>
			(
				await refreshEmployeeTimeBalances({
					employeeIds: [employeeId],
					organizationId,
					now: in2025,
				})
			).get(employeeId)?.balanceMinutes;

		// Without it: the 3h on 4 November minus 52 Mondays in 2025.
		expect(await yearly()).toBe(180 - 52 * 60);

		expect(await setOpeningBalance()).toMatchObject({ success: true });
		// +14h, then 4 November's 3h minus the 9 Mondays from 1 November to 31 December.
		expect(await yearly()).toBe(840 + 180 - 9 * 60);
	});
});
