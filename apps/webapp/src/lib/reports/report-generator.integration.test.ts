/**
 * #794: the employee report (work hours, home office hours and hourly earnings)
 * counts only completed, non-deleted work. Runs against PostgreSQL; only the
 * schedule-based expected hours are stubbed.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function workPeriod(options: {
		start: string;
		end?: string;
		minutes?: number;
		deleted?: boolean;
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
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $7, $6)`,
				[entryId, ids.employee, ids.organization, type, timestamp, ids.user, entryId],
			);
		}
		await admin.query(
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
			`insert into employee_rate_history
			 (employee_id, organization_id, hourly_rate, currency, effective_from, created_by)
			 values ($1, $2, 20.00, 'EUR', '2026-01-01T00:00:00Z', $3)`,
			[ids.employee, ids.organization, ids.user],
		);
		await admin.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'home_office', 'Home office', now())`,
			[ids.homeOffice, ids.organization],
		);
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
	});
	afterAll(cleanup);

	it("excludes deleted and live work from work hours, home office hours and earnings", async () => {
		const report = await generateEmployeeReport(
			ids.employee,
			ids.organization,
			new Date("2026-03-01T00:00:00Z"),
			new Date("2026-03-31T23:59:59Z"),
			march,
		);

		expect(report.workHours).toMatchObject({ totalMinutes: 120, totalHours: 2, workDays: 1 });
		expect(report.absences.homeOffice).toEqual({
			days: 2,
			hoursWorked: 2,
			dateDetails: [
				{ date: "2026-03-10", hours: 2 },
				{ date: "2026-03-11", hours: 0 },
			],
		});
		expect(report.hourlyEarnings).toMatchObject({
			totalHours: 2,
			totalEarnings: 40,
			currency: "EUR",
		});
	});
});
