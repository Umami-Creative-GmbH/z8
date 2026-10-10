/**
 * Spec #804 with #762 (Time Tracking ADR-0004): a balance adjustment whose day
 * lies in a closed month of its employee is neither recorded nor cancelled.
 * The store refuses with the typed "month closed" refusal (the employee page,
 * replacing an opening balance, each bulk upload row), and the database refuses
 * any insert or cancellation behind it. Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { MONTH_CLOSED_SQLSTATE } from "@/lib/time-tracking/closed-months/refusal";

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
								id: `t804-closed-session-${harness.userId}`,
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
const uploadActions = await import(
	"@/app/[locale]/(app)/settings/employees/opening-balance-upload-actions"
);

const today = plainDateAt(systemClock.nowInstant(), "UTC");
// Last month in UTC: it has ended for every employee of this UTC organization.
const closedMonthStart = today.with({ day: 1 }).subtract({ months: 1 });
const closedMonth = closedMonthStart.toPlainYearMonth().toString();
const closedDay = closedMonthStart.add({ days: 9 });
const workDay = closedMonthStart.add({ days: 4 });
const monthClosedRefusal = { success: false, code: "month_closed", closedMonth };

describe("balance adjustments in closed months on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let owner: string;
	let admin: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		owner = fixture.ownerUserId;
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			organizationId,
		]);
		admin = await fixture.seedEmployee({ role: "admin" });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	/** An employee who started before last month and worked 12 hours early in it. */
	async function employeeWithOvertime(employeeNumber?: string) {
		const seeded = await fixture.seedEmployee({
			startDate: new Date(`${closedMonthStart.subtract({ days: 10 }).toString()}T00:00:00Z`),
		});
		if (employeeNumber) {
			await fixture.pool.query(`update employee set employee_number = $2 where id = $1`, [
				seeded.employeeId,
				employeeNumber,
			]);
		}
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
				[entryId, seeded.employeeId, organizationId, type, timestamp, owner, entryId],
			);
		}
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 720, false, now())`,
			[seeded.employeeId, organizationId, clockInId, clockOutId, start, end],
		);
		return seeded;
	}

	/** Closes last month for the employee, as a close fixes it: their UTC month. */
	async function closeLastMonth(employeeId: string) {
		const closedMonthId = randomUUID();
		const first = closedMonthStart.toString();
		const next = closedMonthStart.add({ months: 1 }).toString();
		await fixture.pool.query(
			`insert into closed_month (id, organization_id, month, scope, actor_kind, closed_by)
			 values ($1, $2, $3, 'organization', 'user', $4)`,
			[closedMonthId, organizationId, first, owner],
		);
		await fixture.pool.query(
			`insert into closed_month_employee
			 (organization_id, closed_month_id, employee_id, month, range_start, range_end, timezone)
			 values ($1, $2, $3, $4::date, $5::timestamp, $6::timestamp, 'UTC')`,
			[organizationId, closedMonthId, employeeId, first, first, next],
		);
	}

	async function reopenLastMonth(employeeId: string) {
		await fixture.pool.query(
			`update closed_month_employee set reopened_at = now()
			 where employee_id = $1 and reopened_at is null`,
			[employeeId],
		);
	}

	async function uncancelled(employeeId: string) {
		const result = await fixture.pool.query<{ kind: string; day: string }>(
			`select kind, to_char(day, 'YYYY-MM-DD') as day from balance_adjustment
			 where organization_id = $1 and employee_id = $2 and cancelled_at is null
			 order by day`,
			[organizationId, employeeId],
		);
		return result.rows;
	}

	function recordPayout(employeeId: string, day: string, hours = 2) {
		actAs(admin.userId);
		return actions.recordOvertimePayoutAction({
			employeeId,
			day,
			hours,
			minutes: 0,
			reason: "Paid with the payroll",
		});
	}

	it("refuses recording and cancelling a payout dated in a closed month", async () => {
		const person = await employeeWithOvertime();
		const recorded = await recordPayout(person.employeeId, closedDay.toString());
		expect(recorded).toMatchObject({ success: true });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";

		await closeLastMonth(person.employeeId);
		expect(await recordPayout(person.employeeId, closedDay.toString(), 1)).toEqual(
			expect.objectContaining(monthClosedRefusal),
		);
		actAs(admin.userId);
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId: person.employeeId,
				adjustmentId,
				reason: "Recorded twice",
			}),
		).toEqual(expect.objectContaining(monthClosedRefusal));
		expect(await uncancelled(person.employeeId)).toEqual([
			{ kind: "overtime_payout", day: closedDay.toString() },
		]);

		// Once reopened, the month takes changes again.
		await reopenLastMonth(person.employeeId);
		expect(
			await actions.cancelBalanceAdjustmentAction({
				employeeId: person.employeeId,
				adjustmentId,
				reason: "Recorded twice",
			}),
		).toMatchObject({ success: true });
	});

	it("refuses an opening balance in a closed month, and replacing one dated there", async () => {
		const person = await employeeWithOvertime();
		actAs(admin.userId);
		const setOpening = (day: string) =>
			actions.setOpeningBalanceAction({
				employeeId: person.employeeId,
				day,
				negative: false,
				hours: 3,
				minutes: 0,
				reason: "Balance from the old system",
			});
		expect(await setOpening(closedDay.toString())).toMatchObject({ success: true });

		await closeLastMonth(person.employeeId);
		expect(await setOpening(closedDay.add({ days: 1 }).toString())).toEqual(
			expect.objectContaining(monthClosedRefusal),
		);
		// A new opening balance in an open month would cancel the one in the closed month.
		expect(await setOpening(today.toString())).toEqual(expect.objectContaining(monthClosedRefusal));
		expect(await uncancelled(person.employeeId)).toEqual([
			{ kind: "opening_balance", day: closedDay.toString() },
		]);
	});

	it("reports a bulk upload row dated in a closed month and writes nothing", async () => {
		const closed = await employeeWithOvertime(`CM-${randomUUID().slice(0, 8)}`);
		const open = await employeeWithOvertime(`OP-${randomUUID().slice(0, 8)}`);
		await closeLastMonth(closed.employeeId);
		const numbers = await fixture.pool.query<{ id: string; employee_number: string }>(
			`select id, employee_number from employee where id = any($1)`,
			[[closed.employeeId, open.employeeId]],
		);
		const numberOf = (id: string) =>
			numbers.rows.find((row) => row.id === id)?.employee_number ?? "";
		const file = [
			"employee_number,day,balance,reason",
			`${numberOf(closed.employeeId)},${closedDay.toString()},4:00,Old system`,
			`${numberOf(open.employeeId)},${closedDay.toString()},4:00,Old system`,
		].join("\n");

		actAs(owner);
		for (const action of [
			uploadActions.previewOpeningBalanceUploadAction,
			uploadActions.commitOpeningBalanceUploadAction,
		]) {
			const outcome = await action({ csv: file });
			expect(outcome).toMatchObject({ success: true, data: { status: "has_errors" } });
			const rows = outcome.success && "rows" in outcome.data ? outcome.data.rows : [];
			expect(rows.map((row) => row.errors)).toEqual([[{ code: "month_closed", closedMonth }], []]);
		}
		expect(await uncancelled(closed.employeeId)).toEqual([]);
		expect(await uncancelled(open.employeeId)).toEqual([]);
	});

	it("refuses inserting or cancelling an adjustment in a closed month in the database", async () => {
		const person = await employeeWithOvertime();
		const inserted = await fixture.pool.query<{ id: string }>(
			`insert into balance_adjustment
			 (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
			 values ($1, $2, 'overtime_payout', $3, -60, 'Before the close', $4) returning id`,
			[organizationId, person.employeeId, closedDay.toString(), owner],
		);
		const adjustmentId = inserted.rows[0]?.id;
		await closeLastMonth(person.employeeId);
		const refusal = { code: MONTH_CLOSED_SQLSTATE, detail: closedMonth };

		await expect(
			fixture.pool.query(
				`insert into balance_adjustment
				 (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
				 values ($1, $2, 'overtime_payout', $3, -60, 'Raw insert', $4)`,
				[organizationId, person.employeeId, closedDay.toString(), owner],
			),
		).rejects.toMatchObject(refusal);
		await expect(
			fixture.pool.query(
				`update balance_adjustment set cancelled_at = now(), cancelled_by = $2,
				 cancellation_reason = 'Raw cancel' where id = $1`,
				[adjustmentId, owner],
			),
		).rejects.toMatchObject(refusal);
		// Days of an open month still pass.
		await expect(
			fixture.pool.query(
				`insert into balance_adjustment
				 (organization_id, employee_id, kind, day, minutes, reason, recorded_by)
				 values ($1, $2, 'overtime_payout', $3, -60, 'Raw insert', $4)`,
				[organizationId, person.employeeId, today.toString(), owner],
			),
		).resolves.toMatchObject({ rowCount: 1 });

		// Erasing the employee entirely is not a change to the closed month.
		await expect(
			fixture.pool.query(`delete from employee where id = $1`, [person.employeeId]),
		).resolves.toMatchObject({ rowCount: 1 });
	});
});
