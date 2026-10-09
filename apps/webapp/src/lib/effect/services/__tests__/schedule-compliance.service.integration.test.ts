/**
 * PostgreSQL contract (#944): schedule compliance judges only the half-open,
 * organization-local window `[start, endExclusive)`. Shifts and work periods on
 * the day after the window never count, and the 35-day work period lookback is
 * context only: it feeds weekly totals and the first rest gap, but its days get
 * no findings of their own.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { DatabaseServiceLive } from "../database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "../schedule-compliance.service";
import { WorkPolicyService } from "../work-policy.service";

// Wed 2026-03-04 up to (excluding) Mon 2026-03-09; the last day is Sun 2026-03-08.
const WINDOW = { start: "2026-03-04", endExclusive: "2026-03-09" };

const regulation = {
	maxDailyMinutes: 600,
	maxWeeklyMinutes: null,
	maxUninterruptedMinutes: null,
	breakRules: [],
	minRestPeriodMinutes: 660,
	restPeriodEnforcement: "warn",
	overtimeDailyThresholdMinutes: 600,
	overtimeWeeklyThresholdMinutes: 1500,
	overtimeMonthlyThresholdMinutes: null,
	alertBeforeLimitMinutes: null,
	alertThresholdPercent: null,
};

const workPolicyLayer = Layer.succeed(WorkPolicyService, {
	getEffectivePolicy: () =>
		Effect.succeed({
			policyId: "policy-944",
			policyName: "Default",
			assignmentType: "organization",
			assignedVia: "Organization Default",
			schedule: null,
			regulation,
		}),
} as never);

const serviceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(workPolicyLayer),
	Layer.provide(DatabaseServiceLive),
);

function at(date: string, time: string, timezone: string) {
	return Temporal.ZonedDateTime.from(`${date}T${time}[${timezone}]`);
}

describe.each(["Europe/Berlin", "UTC"])("schedule compliance window (%s)", (timezone) => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organization() {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [
			organizationId,
			timezone,
		]);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, creator.userId],
		);
		const person = await fixture.seedEmployee({ organizationId });
		return { organizationId, subareaId, creator, person };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	/** Inserts a shift the way `upsertShift` stores it: at the organization-local midnight. */
	async function shift(org: Org, date: string, startTime: string, endTime: string) {
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, 'published', $8, now())`,
			[
				randomUUID(),
				org.organizationId,
				org.person.employeeId,
				org.subareaId,
				shiftDateBounds(date, timezone).start,
				startTime,
				endTime,
				org.creator.userId,
			],
		);
	}

	/** Inserts a completed work period between two organization-local wall times of `date`. */
	async function workPeriod(org: Org, date: string, startTime: string, endTime: string) {
		const person: SeededEmployee = org.person;
		const start = at(date, startTime, timezone);
		const end = at(date, endTime, timezone);
		const clockInId = randomUUID();
		await fixture.pool.query(
			`insert into time_entry (
				id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone, timezone_source, hash, created_by, created_at
			 ) values ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
			[
				clockInId,
				person.employeeId,
				org.organizationId,
				dateFromInstant(start.toInstant()),
				start.offsetNanoseconds / 60_000_000_000,
				timezone,
				`t944-${clockInId}`,
				person.userId,
			],
		);
		await fixture.pool.query(
			`insert into work_period (
				id, employee_id, organization_id, clock_in_id,
				start_time, end_time, duration_minutes, is_active, updated_at
			 ) values ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
			[
				randomUUID(),
				person.employeeId,
				org.organizationId,
				clockInId,
				dateFromInstant(start.toInstant()),
				dateFromInstant(end.toInstant()),
				start.until(end).total("minutes"),
			],
		);
	}

	function evaluate(org: Org, window = WINDOW) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.organizationId,
					startDate: shiftDateBounds(window.start, timezone).start,
					endDateExclusive: shiftDateBounds(window.endExclusive, timezone).start,
					timezone,
				});
			}).pipe(Effect.provide(serviceLayer)),
		);
	}

	it("judges a shift on the last day and ignores one dated the day after the window", async () => {
		const org = await organization();
		await shift(org, "2026-03-08", "08:00", "19:00");

		const lastDayOnly = await evaluate(org);
		await shift(org, "2026-03-09", "08:00", "19:00");
		const withDayAfter = await evaluate(org);

		expect(lastDayOnly.findings).toEqual([
			expect.objectContaining({ type: "maxHours", day: "2026-03-08", totalMinutes: 660 }),
			expect.objectContaining({ type: "overtime", period: "daily", periodKey: "2026-03-08" }),
		]);
		expect(withDayAfter.findings).toEqual(lastDayOnly.findings);
		expect(withDayAfter.fingerprint).toBe(lastDayOnly.fingerprint);
	});

	it("keeps the window's org-local days across a daylight saving change", async () => {
		// Berlin springs forward on Sun 2026-03-29, the window's last day.
		const dstWindow = { start: "2026-03-26", endExclusive: "2026-03-30" };
		const org = await organization();
		await workPeriod(org, "2026-03-28", "15:00", "23:00");
		await shift(org, "2026-03-29", "08:00", "19:00");
		await shift(org, "2026-03-30", "08:00", "19:00");

		const result = await evaluate(org, dstWindow);

		expect(result.findings).toEqual([
			expect.objectContaining({
				type: "restTime",
				// 23:00 to 08:00 on the wall clock, one hour shorter in Berlin.
				restMinutes: timezone === "Europe/Berlin" ? 8 * 60 : 9 * 60,
			}),
			expect.objectContaining({ type: "maxHours", day: "2026-03-29", totalMinutes: 660 }),
			expect.objectContaining({ type: "overtime", period: "daily", periodKey: "2026-03-29" }),
		]);
	});

	it("ignores a work period on the day after the window", async () => {
		const org = await organization();
		await shift(org, "2026-03-04", "08:00", "12:00");
		await workPeriod(org, "2026-03-09", "06:00", "19:00");

		const result = await evaluate(org);

		expect(result.findings).toEqual([]);
	});

	it("gives lookback days no daily findings but counts them toward the window's week", async () => {
		const org = await organization();
		await workPeriod(org, "2026-02-25", "06:00", "19:00");
		await workPeriod(org, "2026-03-02", "07:00", "19:00");
		await workPeriod(org, "2026-03-03", "08:00", "14:00");
		await shift(org, "2026-03-04", "08:00", "16:00");

		const result = await evaluate(org);

		expect(result.findings).toEqual([
			{
				type: "overtime",
				employeeId: org.person.employeeId,
				period: "weekly",
				periodKey: "2026-03-02",
				totalMinutes: 720 + 360 + 480,
				thresholdMinutes: 1500,
			},
		]);
	});

	it("reports a short rest gap between a lookback work period and the first shift", async () => {
		const org = await organization();
		await workPeriod(org, "2026-03-03", "15:00", "23:00");
		await shift(org, "2026-03-04", "06:00", "10:00");

		const result = await evaluate(org);

		expect(result.findings).toEqual([
			expect.objectContaining({
				type: "restTime",
				employeeId: org.person.employeeId,
				restMinutes: 7 * 60,
				minRestPeriodMinutes: 660,
			}),
		]);
	});
});
