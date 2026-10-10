/**
 * #1002: the work-balance worker brings the stored balance of an employee who
 * has left up to date through the end of their employment once, so the
 * offboarding review and its final payout read the right figure, and then
 * leaves them alone. Runs the real batch selection and refresh on PostgreSQL.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const workBalance = await import("@/lib/work-balance/service");
const { runWorkBalanceRefresh } = await import("@/lib/jobs/work-balance");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const day = (daysAgo: number) => today.subtract({ days: daysAgo }).toString();

describe("work balances of employees who have left on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			fixture.organizationId,
		]);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedWork(employee: SeededEmployee, date: string, minutes: number) {
		const start = `${date}T08:00:00Z`;
		const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
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
					employee.employeeId,
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
			 values ($1, $2, $3, $4, $5, $6, $7, false, now())`,
			[employee.employeeId, fixture.organizationId, clockInId, clockOutId, start, end, minutes],
		);
	}

	/**
	 * An employee whose stored balance was last refreshed four days ago (through
	 * five days ago), who worked six hours three days ago and two hours on their
	 * last working day, yesterday, and whose employment ended at today's start.
	 */
	async function seedDepartedWithStaleBalance(endedDaysAgo = 0) {
		const employee = await fixture.seedEmployee({
			startDate: new Date(`${day(10)}T00:00:00Z`),
		});
		await seedWork(employee, day(3), 360);
		await seedWork(employee, day(1), 120);
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			employeeId: employee.employeeId,
			organizationId: fixture.organizationId,
			forceFullRebuild: true,
			now: new Date(`${day(4)}T12:00:00Z`),
		});
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = $2 where id = $1`,
			[employee.employmentPeriodId, `${day(endedDaysAgo)}T00:00:00Z`],
		);
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			employee.employeeId,
		]);
		return employee;
	}

	async function storedBalance(employee: SeededEmployee) {
		return workBalance.getEmployeeWorkBalance({
			employeeId: employee.employeeId,
			organizationId: fixture.organizationId,
		});
	}

	async function inBatch(employee: SeededEmployee, now = new Date()) {
		const batch = await workBalance.listEmployeesForWorkBalanceBatch(100_000, now);
		return batch.some((row) => row.id === employee.employeeId);
	}

	it("brings a stale balance up to date through the last working day once, then leaves it", async () => {
		const departed = await seedDepartedWithStaleBalance();
		expect(await storedBalance(departed)).toMatchObject({
			balanceMinutes: 0,
			computedThroughDate: day(5),
		});

		expect(await inBatch(departed)).toBe(true);
		await runWorkBalanceRefresh();

		expect(await storedBalance(departed)).toMatchObject({
			balanceMinutes: 480,
			computedThroughDate: day(1),
		});
		// Caught up through the end of employment: later runs skip the employee.
		expect(await inBatch(departed)).toBe(false);
		expect(
			await inBatch(departed, new Date(`${today.add({ days: 30 }).toString()}T12:00:00Z`)),
		).toBe(false);
	});

	it("refreshes an employee who has left again when their balance is marked for recomputation", async () => {
		const departed = await seedDepartedWithStaleBalance();
		await runWorkBalanceRefresh();
		expect(await inBatch(departed)).toBe(false);

		// A correction to work before the departure marks the balance dirty.
		await seedWork(departed, day(2), 60);
		await workBalance.markEmployeeWorkBalanceDirty({
			employeeId: departed.employeeId,
			organizationId: fixture.organizationId,
			dirtyFromDate: day(2),
		});
		expect(await inBatch(departed)).toBe(true);
		await runWorkBalanceRefresh();

		expect(await storedBalance(departed)).toMatchObject({ balanceMinutes: 540 });
		expect(await inBatch(departed)).toBe(false);
	});

	it("leaves an inactive employee without a recorded employment end alone", async () => {
		const legacy = await fixture.seedEmployee({
			startDate: new Date(`${day(10)}T00:00:00Z`),
			withPeriod: false,
		});
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			employeeId: legacy.employeeId,
			organizationId: fixture.organizationId,
			forceFullRebuild: true,
			now: new Date(`${day(4)}T12:00:00Z`),
		});
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			legacy.employeeId,
		]);

		expect(await inBatch(legacy)).toBe(false);
	});
});
