import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

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

const { runtime } = await import("@/lib/effect/runtime");
const { calculateExpectedWorkHoursForEmployee } = await import("@/lib/time-tracking/calculations");
const { getDailyWorkRequirementsForEmployee } = await import(
	"@/lib/calendar/work-policy-requirements"
);

describe("explicit tracking start across public balance readers", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let employeeId: string;
	let owner: { userId: string };
	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		owner = { userId: fixture.ownerUserId };
		const subject = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		employeeId = subject.employeeId;
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		await fixture.pool.query(
			`update "user" set created_at = '2026-06-01T00:00:00Z' where id = $1`,
			[subject.userId],
		);
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id, tracking_start_date, activated_at) values ($1, '2026-05-21', now())`,
			[organizationId],
		);
		await assignMondayHourPolicy();
		await seedCompletedWork("2026-05-20T21:00:00Z", "2026-05-20T23:00:00Z", 120);
		await seedCompletedWork("2026-05-01T08:00:00Z", "2026-05-01T18:00:00Z", 600);
	});
	afterAll(async () => {
		await fixture?.close();
		vi.useRealTimers();
	});
	beforeEach(async () => {
		harness.userId = owner.userId;
		harness.organizationId = organizationId;
		await fixture.pool.query(
			`update balance_adjustment set cancelled_at = now(), cancelled_by = $2, cancellation_reason = 'test reset' where organization_id = $1 and cancelled_at is null`,
			[organizationId, owner.userId],
		);
	});
	async function assignMondayHourPolicy(targetEmployeeId = employeeId) {
		const policyId = randomUUID();
		const scheduleId = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id, organization_id, name, schedule_enabled, regulation_enabled, created_by, updated_at)
			 values ($1, $2, 'Monday hour ' || $4, true, false, $3, now())`,
			[policyId, organizationId, owner.userId, targetEmployeeId],
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
			[policyId, organizationId, targetEmployeeId, owner.userId],
		);
	}

	async function seedCompletedWork(
		startTime: string,
		endTime: string,
		minutes: number,
		targetEmployeeId = employeeId,
	) {
		return withCanonicalRecords(fixture.pool, async (client) => {
			const clockInId = randomUUID();
			const clockOutId = randomUUID();
			for (const [entryId, type, timestamp] of [
				[clockInId, "clock_in", startTime],
				[clockOutId, "clock_out", endTime],
			]) {
				await client.query(
					`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $7, $6)`,
					[entryId, targetEmployeeId, organizationId, type, timestamp, owner.userId, entryId],
				);
			}
			await client.query(
				`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, false, now())`,
				[targetEmployeeId, organizationId, clockInId, clockOutId, startTime, endTime, minutes],
			);
		});
	}

	it("counts from rollout in the employee zone even when account creation is later and earlier work exists", async () => {
		const requirements = await getDailyWorkRequirementsForEmployee({
			organizationId,
			employeeId,
			startDate: new Date("2026-05-01T00:00:00Z"),
			endDate: new Date("2026-05-31T21:59:59Z"),
			timezone: "Europe/Berlin",
		});
		expect(requirements).toEqual({
			"2026-05-25": expect.objectContaining({ requiredMinutes: 60 }),
		});
		await workBalance.refreshEmployeeWorkBalanceFromPeriods({
			organizationId,
			employeeId,
			forceFullRebuild: true,
			now: new Date("2026-06-01T10:00:00Z"),
		});
		const result = await workBalance.getEmployeeWorkBalance({
			organizationId,
			employeeId,
		});
		expect(result).toMatchObject({
			actualMinutes: 60,
			requiredMinutes: 60,
			balanceMinutes: 0,
			computedFromDate: "2026-05-21",
		});
		const team = await refreshEmployeeTimeBalances({
			organizationId,
			employeeIds: [employeeId],
			now: DateTime.fromISO("2026-06-01T10:00:00Z"),
		});
		expect(team.get(employeeId)).toMatchObject({
			actualMinutes: 60,
			expectedMinutes: 60,
			balanceMinutes: 0,
		});
	});
	it("uses the same rollout requirement in report and analytics readers", async () => {
		const expected = await runtime.runPromise(
			calculateExpectedWorkHoursForEmployee(
				employeeId,
				organizationId,
				new Date("2026-05-01T00:00:00Z"),
				new Date("2026-05-31T21:59:59Z"),
				"America/New_York",
			),
		);
		expect(expected.totalMinutes).toBe(60);
	});

	it("previews a proposed rollout through the production balance reader without changing saved rules", async () => {
		const subject = await workBalance.loadWorkBalanceEmployee({ organizationId, employeeId });
		expect(subject).not.toBeNull();
		const proposed = await workBalance.computeEmployeeWorkBalanceAtEndOfDay({
			organizationId,
			employee: subject!,
			day: "2026-05-31",
			trackingStartDateOverride: "2026-05-22",
		});
		expect(proposed).toBe(-60);
		const saved = await workBalance.computeEmployeeWorkBalanceAtEndOfDay({
			organizationId,
			employee: subject!,
			day: "2026-05-31",
		});
		expect(saved).toBe(0);
	});
	it("starts a genuine joiner on their employment date and isolates another organization", async () => {
		const joiner = await fixture.seedEmployee({
			withPeriod: false,
			startDate: new Date("2026-05-26T00:00:00Z"),
		});
		await assignMondayHourPolicy(joiner.employeeId);
		const required = await getDailyWorkRequirementsForEmployee({
			organizationId,
			employeeId: joiner.employeeId,
			startDate: new Date("2026-05-01T00:00:00Z"),
			endDate: new Date("2026-05-31T21:59:59Z"),
			timezone: "Pacific/Auckland",
		});
		expect(required).toEqual({});
		const otherOrganizationId = await fixture.createOrganization();
		expect(
			await getDailyWorkRequirementsForEmployee({
				organizationId: otherOrganizationId,
				employeeId,
				startDate: new Date("2026-05-01T00:00:00Z"),
				endDate: new Date("2026-05-31T21:59:59Z"),
			}),
		).toEqual({});
		expect(
			await workBalance.getEmployeeWorkBalance({ organizationId: otherOrganizationId, employeeId }),
		).toBeNull();
	});
	it("preserves earlier work as readable report history", async () => {
		const { aggregateWorkHours, generateEmployeeReport } = await import(
			"@/lib/reports/report-generator"
		);
		const history = await aggregateWorkHours(
			employeeId,
			organizationId,
			new Date("2026-05-01T00:00:00Z"),
			new Date("2026-05-31T21:59:59Z"),
		);
		expect(history.totalMinutes).toBe(720);
		const report = await generateEmployeeReport(
			employeeId,
			organizationId,
			new Date("2026-05-01T00:00:00Z"),
			new Date("2026-05-31T21:59:59Z"),
		);
		expect(report.workHours.totalMinutes).toBe(720);
		expect(report.complianceMetrics).toMatchObject({
			overtimeMinutes: 0,
			underTimeMinutes: 0,
			expectedWorkMinutes: 60,
		});
	});
	it("keeps an existing organization's legacy requirements until activation, even with an unactivated chosen date", async () => {
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at = null where organization_id = $1`,
			[organizationId],
		);
		const required = await getDailyWorkRequirementsForEmployee({
			organizationId,
			employeeId,
			startDate: new Date("2026-05-01T00:00:00Z"),
			endDate: new Date("2026-05-31T21:59:59Z"),
			timezone: "Europe/Berlin",
		});
		// Legacy earliest historical work remains the lower bound: all four May Mondays.
		expect(Object.keys(required)).toEqual(["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"]);
		await fixture.pool.query(
			`update organization_tracking_settings set activated_at = now() where organization_id = $1`,
			[organizationId],
		);
	});

	it.each([240, -120, 0])(
		"keeps a signed opening balance of %i minutes once through rebuild and cancellation",
		async (minutes) => {
			const set = await actions.setOpeningBalanceAction({
				employeeId,
				day: "2026-05-20",
				negative: minutes < 0,
				hours: Math.abs(minutes) / 60,
				minutes: 0,
				reason: "Brought forward at rollout",
			});
			expect(set).toMatchObject({ success: true });
			const scope = { organizationId, employeeId };
			expect(await workBalance.getEmployeeWorkBalance(scope)).toMatchObject({
				balanceMinutes: minutes,
				adjustmentMinutes: minutes,
				computedFromDate: "2026-05-21",
			});
			await workBalance.requestEmployeeWorkBalanceFullRebuild(scope);
			await workBalance.refreshEmployeeWorkBalanceFromPeriods({
				...scope,
				forceFullRebuild: true,
				now: new Date("2026-06-01T10:00:00Z"),
			});
			expect(await workBalance.getEmployeeWorkBalance(scope)).toMatchObject({
				balanceMinutes: minutes,
				adjustmentMinutes: minutes,
			});
			expect(
				await actions.cancelBalanceAdjustmentAction({
					employeeId,
					adjustmentId: set.success ? set.data.adjustmentId : "",
					reason: "Restore calculated rollout balance",
				}),
			).toMatchObject({ success: true });
			expect(await workBalance.getEmployeeWorkBalance(scope)).toMatchObject({
				balanceMinutes: 0,
				adjustmentMinutes: 0,
			});
		},
	);
	it("preserves a later opening checkpoint as the replacement through its day", async () => {
		expect(
			await actions.setOpeningBalanceAction({
				employeeId,
				day: "2026-05-25",
				negative: false,
				hours: 2,
				minutes: 0,
				reason: "Later reviewed checkpoint",
			}),
		).toMatchObject({ success: true });
		expect(await workBalance.getEmployeeWorkBalance({ organizationId, employeeId })).toMatchObject({
			balanceMinutes: 120,
			adjustmentMinutes: 120,
			actualMinutes: 0,
			requiredMinutes: 0,
			computedFromDate: "2026-05-26",
		});
	});

	it("clips at the employee's DST midnight through the same production preview", async () => {
		await seedCompletedWork("2026-10-24T21:00:00Z", "2026-10-25T02:00:00Z", 300);
		const subject = await workBalance.loadWorkBalanceEmployee({ organizationId, employeeId });
		expect(
			await workBalance.computeEmployeeWorkBalanceAtEndOfDay({
				organizationId,
				employee: subject!,
				day: "2026-10-25",
				trackingStartDateOverride: "2026-10-25",
			}),
		).toBe(240);
	});
	it("uses transaction-bound policy inputs for the production impact preview", async () => {
		const subject = await workBalance.loadWorkBalanceEmployee({ organizationId, employeeId });
		await expect(
			fixture.db.transaction(async (tx) => {
				await tx.execute(
					sql`update work_policy_schedule_day set hours_per_day = '2.00' where schedule_id in (select s.id from work_policy_schedule s join work_policy p on p.id = s.policy_id where p.organization_id = ${organizationId})`,
				);
				expect(
					await workBalance.computeEmployeeWorkBalanceAtEndOfDay(
						{
							organizationId,
							employee: subject!,
							day: "2026-05-31",
							trackingStartDateOverride: "2026-05-22",
						},
						tx,
					),
				).toBe(-120);
				throw new Error("rollback preview fixture");
			}),
		).rejects.toThrow("rollback preview fixture");
	});
	it("keeps historical analytics work readable while tracking team variance and weekly overtime from rollout", async () => {
		const { AnalyticsService } = await import("@/lib/effect/services/analytics.service");
		const analytics = await runtime.runPromise(AnalyticsService);
		const dateRange = {
			start: new Date("2026-04-30T22:00:00Z"),
			end: new Date("2026-05-31T21:59:59.999Z"),
			startDate: "2026-05-01",
			endDate: "2026-05-31",
			timezone: "Europe/Berlin",
		};
		const performance = await runtime.runPromise(
			analytics.getTeamPerformance({ organizationId, dateRange }),
		);
		const subject = performance.teams
			.flatMap((team) => team.employees)
			.find((person) => person.employeeId === employeeId);
		expect(subject).toMatchObject({
			totalHours: 12,
			expectedHours: 1,
			variance: 0,
			percentageOfExpected: 100,
		});
		const burndown = await runtime.runPromise(
			analytics.getOvertimeBurnDown({ organizationId, dateRange, scope: { role: "admin" } }),
		);
		expect(
			burndown.weeklySeries.find((week) => week.weekStart === "2026-04-27")?.overtimeHours,
		).toBe(0);
		expect(
			burndown.weeklySeries.find((week) => week.weekStart === "2026-05-18")?.overtimeHours,
		).toBe(1);
		const hours = await runtime.runPromise(
			analytics.getWorkHoursAnalytics({ organizationId, dateRange, employeeId }),
		);
		expect(hours.summary).toMatchObject({ totalHours: 12, overtimeHours: 0, undertimeHours: 0 });
		expect(hours.distribution.find((day) => day.date === "2026-05-01")).toMatchObject({
			hours: 10,
			expectedHours: 0,
			isOvertime: false,
			isUndertime: false,
		});
		expect(hours.byEmployee.find((person) => person.employeeId === employeeId)).toMatchObject({
			totalHours: 12,
			overtimeHours: 0,
			undertimeHours: 0,
		});
	});
});
