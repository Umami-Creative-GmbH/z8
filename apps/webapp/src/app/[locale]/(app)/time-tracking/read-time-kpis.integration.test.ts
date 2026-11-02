import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Clock, parseInstant } from "@/lib/datetime/temporal-core";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";
import { readTimeKpis } from "./read-time-kpis";

vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

function clockAt(instant: string): Clock {
	return { nowInstant: () => parseInstant(instant) };
}

describe("time KPI reads on disposable PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const org = "time-kpi-org";
	const foreignOrg = "time-kpi-foreign-org";
	const user = "time-kpi-user";
	const employeeId = "f5590000-0000-4000-8000-000000000001";
	const scope = { employeeId, organizationId: org };
	// Wednesday 2026-10-07, 14:00 in Berlin.
	const now = clockAt("2026-10-07T12:00:00Z");

	async function cleanup() {
		await admin.query("delete from work_period where organization_id = any($1)", [
			[org, foreignOrg],
		]);
		await admin.query("delete from time_record where organization_id = any($1)", [
			[org, foreignOrg],
		]);
		await admin.query("delete from work_policy where organization_id = any($1)", [
			[org, foreignOrg],
		]);
		await admin.query("delete from organization where id = any($1)", [[org, foreignOrg]]);
		await admin.query('delete from "user" where id = $1', [user]);
	}

	function period(start: string, end: string, organizationId = org) {
		return withCanonicalRecords(admin, async (client) => {
			const clockInId = randomUUID();
			const clockOutId = randomUUID();
			for (const [entryId, type, timestamp] of [
				[clockInId, "clock_in", start],
				[clockOutId, "clock_out", end],
			]) {
				await client.query(
					`insert into time_entry
					 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1, $2, $3, $4, $5, 120, 'Europe/Berlin', 'user_setting', $7, $6)`,
					[entryId, employeeId, organizationId, type, timestamp, user, entryId],
				);
			}
			await client.query(
				`insert into work_period
				 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time, duration_minutes, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, $6, 0, false, now())`,
				[employeeId, organizationId, clockInId, clockOutId, start, end],
			);
		});
	}

	/** Eight hours Monday to Friday, with the given working time limits. */
	async function weekdayPolicy(
		regulation: {
			maxDailyMinutes: number;
			maxWeeklyMinutes: number;
			alertBeforeLimitMinutes: number;
		} | null,
	) {
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await admin.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values ($1, $2, 'Weekdays', true, $3, $4, now())`,
			[policyId, org, regulation !== null, user],
		);
		await admin.query(
			`insert into work_policy_schedule (id, policy_id, schedule_cycle, schedule_type, working_days_preset, updated_at)
			 values ($1, $2, 'weekly', 'detailed', 'custom', now())`,
			[scheduleId, policyId],
		);
		for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
			await admin.query(
				`insert into work_policy_schedule_day (schedule_id, day_of_week, hours_per_day, is_work_day)
				 values ($1, $2, '8.00', true)`,
				[scheduleId, day],
			);
		}
		if (regulation) {
			await admin.query(
				`insert into work_policy_regulation
				 (policy_id, max_daily_minutes, max_weekly_minutes, alert_before_limit_minutes, updated_at)
				 values ($1, $2, $3, $4, now())`,
				[
					policyId,
					regulation.maxDailyMinutes,
					regulation.maxWeeklyMinutes,
					regulation.alertBeforeLimitMinutes,
				],
			);
		}
		await admin.query(
			`insert into work_policy_assignment (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, 'organization', 0, $3, now())`,
			[policyId, org, user],
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			"insert into organization (id, name, slug, timezone, created_at) select id, id, id, 'Europe/Berlin', now() from unnest($1::text[]) id",
			[[org, foreignOrg]],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, $2, '2026-01-01T00:00:00Z', now())`,
			[user, "time-kpi@example.test"],
		);
		await admin.query(
			"insert into member (id, organization_id, user_id, role, status, created_at) values ('time-kpi-member', $1, $2, 'member', 'approved', now())",
			[org, user],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, start_date, updated_at)
			 values ($1, $2, $3, 'employee', '2026-01-01T00:00:00Z', now())`,
			[employeeId, user, org],
		);
	});
	afterAll(cleanup);

	it("loads the previous week and month up to the same point, with required time and limits", async () => {
		await weekdayPolicy({
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			alertBeforeLimitMinutes: 45,
		});
		// Last month: 7 September 08:00–12:00 in Berlin, before 14:00.
		await period("2026-09-07T06:00:00Z", "2026-09-07T10:00:00Z");
		// Last week: Wednesday 08:00–16:00, cut at 14:00.
		await period("2026-09-30T06:00:00Z", "2026-09-30T14:00:00Z");
		// This week: Monday 08:00–16:00.
		await period("2026-10-05T06:00:00Z", "2026-10-05T14:00:00Z");
		// The same employee ID in another organization stays out.
		await period("2026-10-06T06:00:00Z", "2026-10-06T14:00:00Z", foreignOrg);

		const { kpis, basis } = await readTimeKpis(scope, "Europe/Berlin", "monday", now);

		expect(kpis.today).toMatchObject({ workedMinutes: 0, requiredMinutes: 480 });
		expect(kpis.week).toMatchObject({
			workedMinutes: 480,
			requiredMinutes: 5 * 480,
			requiredSoFarMinutes: 480 + 480 + 280,
			previous: { workedMinutes: 360, requiredMinutes: 480 + 480 + 280 },
		});
		expect(kpis.month).toMatchObject({
			workedMinutes: 480,
			requiredMinutes: 22 * 480,
			previous: { workedMinutes: 240 },
		});
		expect(basis.limits).toEqual({
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			alertBeforeLimitMinutes: 45,
		});
	});

	it("has no required time without a work policy, and no limits without a regulation", async () => {
		await period("2026-10-05T06:00:00Z", "2026-10-05T14:00:00Z");

		const withoutPolicy = await readTimeKpis(scope, "Europe/Berlin", "monday", now);
		expect(withoutPolicy.kpis.week).toMatchObject({ workedMinutes: 480, requiredMinutes: null });
		expect(withoutPolicy.basis.limits).toBeNull();

		await weekdayPolicy(null);
		const withoutRegulation = await readTimeKpis(scope, "Europe/Berlin", "monday", now);
		expect(withoutRegulation.kpis.week.requiredMinutes).toBe(5 * 480);
		expect(withoutRegulation.basis.limits).toBeNull();
	});
});
