/**
 * #794: the employee report (work hours, home office hours and hourly earnings)
 * counts only completed, non-deleted work. #1175: earnings follow the confirmed
 * employment terms in force when the work was done. Runs against PostgreSQL;
 * only the schedule-based expected hours are stubbed.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: async () => ({ totalMinutes: 0, workDays: 0, scheduleInfo: null }),
	},
}));
vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHoursForEmployee: () => null,
}));

const { generateEmployeeReport } = await import("./report-generator");

const ids = {
	organization: "t794-employee-report-org",
	user: "t794-employee-report-user",
	employee: "d7940000-0000-4000-8000-000000000011",
	homeOffice: "d7940000-0000-4000-8000-0000000000c1",
} as const;
const march = { startDate: "2026-03-01", endDate: "2026-03-31", timezone: "UTC" };

describe("employee report on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from work_period where organization_id = $1", [ids.organization]);
		await admin.query("delete from time_entry where organization_id = $1", [ids.organization]);
		await admin.query("delete from absence_entry where organization_id = $1", [ids.organization]);
		await admin.query("delete from employee_employment_history where organization_id = $1", [
			ids.organization,
		]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function workPeriod(options: {
		start: string;
		end?: string;
		minutes?: number;
		deleted?: boolean;
		offsetMinutes?: number;
	}) {
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			...(clockOutId ? [[clockOutId, "clock_out", options.end]] : []),
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, $8, null, 'user_setting', $7, $6)`,
				[
					entryId,
					ids.employee,
					ids.organization,
					type,
					timestamp,
					ids.user,
					entryId,
					options.offsetMinutes ?? 0,
				],
			);
		}
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`insert into work_period
				 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
				  duration_minutes, is_active, deleted_at, deleted_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
				[
					ids.employee,
					ids.organization,
					clockInId,
					clockOutId,
					options.start,
					options.end ?? null,
					options.minutes ?? null,
					!options.end,
					options.deleted ? "2026-04-01T00:00:00Z" : null,
					options.deleted ? ids.user : null,
				],
			),
		);
	}

	/** Terms dates are calendar dates, stored as UTC midnight as the card does. */
	async function terms(options: {
		from: string;
		until?: string;
		contractType?: "fixed" | "hourly";
		wage?: string | null;
		reviewState?: "draft" | "pending" | "confirmed";
	}) {
		await admin.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, valid_from, valid_until, contract_type,
			  weekly_contract_minutes, hourly_rate, currency, review_state, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, 2400, $6, 'EUR', $7, $8, now())`,
			[
				ids.employee,
				ids.organization,
				`${options.from}T00:00:00Z`,
				options.until ? `${options.until}T00:00:00Z` : null,
				options.contractType ?? "hourly",
				options.wage === undefined ? "20.00" : options.wage,
				options.reviewState ?? "confirmed",
				ids.user,
			],
		);
	}

	function report(range = march) {
		return generateEmployeeReport(
			ids.employee,
			ids.organization,
			new Date(`${range.startDate}T00:00:00Z`),
			new Date(`${range.endDate}T23:59:59Z`),
			range,
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T794 employee report', $1, 'UTC', now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Hourly Worker', 't794-employee-report@example.test', now(), now())`,
			[ids.user],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, contract_type, updated_at)
			 values ($1, $2, $3, 'employee', 'hourly', now())`,
			[ids.employee, ids.user, ids.organization],
		);
		await admin.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'home_office', 'Home office', now())`,
			[ids.homeOffice, ids.organization],
		);
	});
	afterAll(cleanup);

	it("excludes deleted and live work from work hours, home office hours and earnings", async () => {
		await terms({ from: "2026-01-01" });
		await admin.query(
			`insert into absence_entry
			 (employee_id, category_id, organization_id, start_date, end_date, status, updated_at)
			 values ($1, $2, $3, '2026-03-10', '2026-03-11', 'approved', now())`,
			[ids.employee, ids.homeOffice, ids.organization],
		);
		// Counted: 2h of completed work on the first home office day.
		await workPeriod({ start: "2026-03-10T08:00:00Z", end: "2026-03-10T10:00:00Z", minutes: 120 });
		// Not counted: 3h deleted by an approved correction on the second home office day.
		await workPeriod({
			start: "2026-03-11T08:00:00Z",
			end: "2026-03-11T11:00:00Z",
			minutes: 180,
			deleted: true,
		});
		// Not counted: live work.
		await workPeriod({ start: "2026-03-12T08:00:00Z" });

		const result = await report();

		expect(result.workHours).toMatchObject({ totalMinutes: 120, totalHours: 2, workDays: 1 });
		expect(result.absences.homeOffice).toEqual({
			days: 2,
			hoursWorked: 2,
			dateDetails: [
				{ date: "2026-03-10", hours: 2 },
				{ date: "2026-03-11", hours: 0 },
			],
		});
		expect(result.hourlyEarnings).toMatchObject({
			totalHours: 2,
			totalEarnings: 40,
			currency: "EUR",
		});
		expect(result.employee).not.toHaveProperty("currentHourlyRate");
	});

	it("pays a confirmed wage change from its date and ignores draft and pending terms", async () => {
		await terms({ from: "2026-01-01", until: "2026-03-11", wage: "20.00" });
		await terms({ from: "2026-03-11", wage: "30.00" });
		await terms({ from: "2026-03-01", wage: "99.00", reviewState: "draft" });
		await terms({ from: "2026-03-05", wage: "77.00", reviewState: "pending" });
		await workPeriod({ start: "2026-03-10T08:00:00Z", end: "2026-03-10T10:00:00Z", minutes: 120 });
		await workPeriod({ start: "2026-03-12T08:00:00Z", end: "2026-03-12T09:00:00Z", minutes: 60 });

		const result = await report();

		expect(result.hourlyEarnings).toEqual({
			totalHours: 3,
			totalEarnings: 70,
			currency: "EUR",
			byRatePeriod: [
				{
					rate: 20,
					currency: "EUR",
					periodStart: "2026-03-01",
					periodEnd: "2026-03-10",
					hours: 2,
					earnings: 40,
				},
				{
					rate: 30,
					currency: "EUR",
					periodStart: "2026-03-11",
					periodEnd: "2026-03-31",
					hours: 1,
					earnings: 30,
				},
			],
		});
	});

	it("pays hourly work up to the 14th for an employee who is fixed from the 15th", async () => {
		await admin.query("update employee set contract_type = 'fixed' where id = $1", [ids.employee]);
		await terms({ from: "2026-01-01", until: "2026-03-15", wage: "25.00" });
		await terms({ from: "2026-03-15", contractType: "fixed", wage: null });
		await workPeriod({ start: "2026-03-14T08:00:00Z", end: "2026-03-14T12:00:00Z", minutes: 240 });
		await workPeriod({ start: "2026-03-16T08:00:00Z", end: "2026-03-16T12:00:00Z", minutes: 240 });

		const result = await report();

		expect(result.hourlyEarnings).toMatchObject({
			totalHours: 4,
			totalEarnings: 100,
			byRatePeriod: [expect.objectContaining({ periodEnd: "2026-03-14", earnings: 100 })],
		});
	});

	it("reports no earnings for an employee under fixed terms only", async () => {
		await terms({ from: "2026-01-01", contractType: "fixed", wage: null });
		await workPeriod({ start: "2026-03-10T08:00:00Z", end: "2026-03-10T10:00:00Z", minutes: 120 });

		expect((await report()).hourlyEarnings).toBeUndefined();
	});

	it("splits a Berlin night shift at local midnight of the wage change, by the recorded offsets", async () => {
		await terms({ from: "2026-01-01", until: "2026-03-11", wage: "20.00" });
		await terms({ from: "2026-03-11", wage: "30.00" });
		// 22:00 on 10 March to 02:00 on 11 March, Berlin time (UTC+1).
		await workPeriod({
			start: "2026-03-10T21:00:00Z",
			end: "2026-03-11T01:00:00Z",
			minutes: 240,
			offsetMinutes: 60,
		});

		const result = await report({ ...march, timezone: "Europe/Berlin" });

		expect(result.hourlyEarnings?.byRatePeriod).toEqual([
			expect.objectContaining({ rate: 20, hours: 2, earnings: 40 }),
			expect.objectContaining({ rate: 30, hours: 2, earnings: 60 }),
		]);
	});

	it("rejects hourly work under terms without a wage", async () => {
		await terms({ from: "2026-01-01", wage: null });
		await workPeriod({ start: "2026-03-10T08:00:00Z", end: "2026-03-10T10:00:00Z", minutes: 120 });

		await expect(report()).rejects.toMatchObject({ code: "missing_rate" });
	});
});
