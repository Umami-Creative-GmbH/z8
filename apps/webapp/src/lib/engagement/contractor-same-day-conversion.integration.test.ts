/**
 * #1935 final review: a conversion at noon, in both directions, on PostgreSQL. Payroll and
 * contractor pricing split the conversion day at the exact instant (#1997, #1998); Work Balance
 * does too: its actual minutes on that day are only the employee time, so contractor work never
 * enters the balance and the employee part of the day never drops out. Required minutes follow
 * the stint in force at the end of the day, as the contract resolver decides a same-day rehire:
 * contractor -> employee requires the employee's day, employee -> contractor nothing. The
 * employee morning of an employee -> contractor day is credited, unless the employee stint was
 * trust-based: a trust-based day adds 0. Without a tracking start, the stored total balance reads
 * the days as the month rows do.
 *
 * Both people work on Wednesday 6 May 2026 (UTC) under an 8-hour Office policy, the
 * organization's default, and convert at 12:00.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const { db } = await import("@/db");
const { createLifecycleDatabaseFixture } =
	await import("@/lib/employee-lifecycle/testing/database.test.fixture");
const { createDepartureCommands } = await import("@/lib/employee-lifecycle/commands");
const { computeEmployeePeriodBalance } = await import("@/lib/work-balance/period-aggregation");
const { getEmployeeWorkBalance, refreshEmployeeWorkBalanceFromPeriods } =
	await import("@/lib/work-balance/service");
const { getMonthPeriodsBetween } = await import("@/lib/work-balance/periods");
const { createVersionedWorkPolicy } = await import("@/lib/work-policy/versioned-policy-writer");
type LifecycleDatabaseFixture =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").SeededEmployee;

const CONVERSION_DAY = "2026-05-06";
const CONVERSION = parseInstant("2026-05-06T12:00:00Z");

describe("Work Balance on a same-day conversion (#1935)", () => {
	let fixture: LifecycleDatabaseFixture;
	let policyId: string;
	let now: Instant = parseInstant("2026-05-01T08:00:00Z");
	const clock = { nowInstant: () => now };
	const commands = () =>
		createDepartureCommands({
			db: fixture.db,
			clock,
			clockOut: { close: async () => ({ kind: "not_running" }) },
		});
	const owner = () => ({ userId: fixture.ownerUserId, organizationId: fixture.organizationId });

	async function completedWork(person: SeededEmployee, start: string, end: string) {
		const clockIn = randomUUID();
		const clockOut = randomUUID();
		const minutes = Temporal.Instant.from(end).since(Temporal.Instant.from(start)).total("minutes");
		await withCanonicalRecords(fixture.pool, async (client) => {
			for (const [id, type, timestamp] of [
				[clockIn, "clock_in", start],
				[clockOut, "clock_out", end],
			]) {
				await client.query(
					`insert into time_entry (id, employee_id, organization_id, type, timestamp,
					 utc_offset_minutes, timezone, timezone_source, hash, created_by)
					 values ($1::uuid, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $1::uuid::text, $6)`,
					[id, person.employeeId, fixture.organizationId, type, timestamp, fixture.ownerUserId],
				);
			}
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id,
				 start_time, end_time, duration_minutes, is_active, approval_status, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, false, 'approved', now())`,
				[person.employeeId, fixture.organizationId, clockIn, clockOut, start, end, minutes],
			);
		});
	}

	/** The conversion day's balance; with a tracking start, by the tracked-work rule. */
	function balanceOfConversionDay(person: SeededEmployee, tracking: boolean) {
		return computeEmployeePeriodBalance({
			employeeId: person.employeeId,
			organizationId: fixture.organizationId,
			periodType: "month",
			periodStart: CONVERSION_DAY,
			periodEnd: CONVERSION_DAY,
			calculationStartDate: "2026-01-01",
			...(tracking ? { trackingStartDateOverride: "2026-01-01" } : {}),
			timezone: "UTC",
			isClosed: false,
			now: new Date("2026-05-31T20:00:00Z"),
		});
	}

	async function convertAtNoon(person: SeededEmployee, to: "employee" | "contractor") {
		now = CONVERSION;
		const departed = await commands().offboardNow(owner(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		if (departed.status !== "effective") throw new Error(`departure ${departed.status}`);
		await commands().rehireEmployee(owner(), {
			employeeId: person.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: person.employmentPeriodId,
			engagementKind: to,
			workPolicyId: to === "employee" ? policyId : null,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		});
	}

	let toEmployee: SeededEmployee;
	let toContractor: SeededEmployee;
	let trustToContractor: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		const organizationId = fixture.organizationId;
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			organizationId,
		]);
		const workDay = { hoursPerDay: "8.00", isWorkDay: true };
		const freeDay = { hoursPerDay: "0.00", isWorkDay: false };
		const policy = await createVersionedWorkPolicy(db, {
			organizationId,
			actorUserId: fixture.ownerUserId,
			data: {
				name: "Office",
				effectiveFromDate: "2026-01-01",
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "detailed",
					workingDaysPreset: "custom",
					days: [
						{ dayOfWeek: "monday", ...workDay },
						{ dayOfWeek: "tuesday", ...workDay },
						{ dayOfWeek: "wednesday", ...workDay },
						{ dayOfWeek: "thursday", ...workDay },
						{ dayOfWeek: "friday", ...workDay },
						{ dayOfWeek: "saturday", ...freeDay },
						{ dayOfWeek: "sunday", ...freeDay },
					],
				},
			},
		});
		policyId = policy.policy.id;
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, priority, is_active, created_by, updated_at)
			 values ($1, $2, 'organization', 0, true, $3, now())`,
			[policyId, organizationId, fixture.ownerUserId],
		);

		// Contractor -> employee at noon. 08:00-11:00 is contractor work; 11:00-15:00 crosses the
		// conversion: one hour as a contractor, three as an employee.
		toEmployee = await fixture.seedEmployee({ engagementKind: "contractor" });
		await completedWork(toEmployee, "2026-05-06T08:00:00Z", "2026-05-06T11:00:00Z");
		await completedWork(toEmployee, "2026-05-06T11:00:00Z", "2026-05-06T15:00:00Z");
		await convertAtNoon(toEmployee, "employee");

		// Employee -> contractor at noon: a morning as an employee, an afternoon as a contractor.
		now = parseInstant("2026-05-01T08:00:00Z");
		toContractor = await fixture.seedEmployee();
		await completedWork(toContractor, "2026-05-06T08:00:00Z", "2026-05-06T12:00:00Z");
		await completedWork(toContractor, "2026-05-06T13:00:00Z", "2026-05-06T16:00:00Z");
		await convertAtNoon(toContractor, "contractor");

		// The same under trust-based employee terms: the employee morning is a trust-based day's.
		now = parseInstant("2026-05-01T08:00:00Z");
		trustToContractor = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_employment_history
			 (employee_id, organization_id, employment_period_id, valid_from, valid_from_date, contract_type,
			  weekly_contract_minutes, balance_mode, review_state, created_by, updated_at)
			 values ($1, $2, $3, '2026-01-01T00:00:00Z', '2026-01-01', 'fixed', 2400, 'trust_based',
			         'confirmed', $4, now())`,
			[
				trustToContractor.employeeId,
				organizationId,
				trustToContractor.employmentPeriodId,
				fixture.ownerUserId,
			],
		);
		await completedWork(trustToContractor, "2026-05-06T08:00:00Z", "2026-05-06T12:00:00Z");
		await completedWork(trustToContractor, "2026-05-06T13:00:00Z", "2026-05-06T16:00:00Z");
		await convertAtNoon(trustToContractor, "contractor");
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each([
		["without", false],
		["with", true],
	])(
		"counts only the employee afternoon of a contractor -> employee day, against the employee's day (%s a tracking start)",
		async (_case, tracking) => {
			expect(await balanceOfConversionDay(toEmployee, tracking)).toMatchObject({
				actualMinutes: 180,
				requiredMinutes: 480,
				balanceMinutes: -300,
			});
		},
	);

	it.each([
		["without", false],
		["with", true],
	])(
		"keeps the employee morning of an employee -> contractor day, with no required time (%s a tracking start)",
		async (_case, tracking) => {
			expect(await balanceOfConversionDay(toContractor, tracking)).toMatchObject({
				actualMinutes: 240,
				requiredMinutes: 0,
				balanceMinutes: 240,
			});
		},
	);

	it.each([
		["without", false],
		["with", true],
	])(
		"adds nothing for the employee morning of an employee -> contractor day under trust-based terms (%s a tracking start)",
		async (_case, tracking) => {
			expect(await balanceOfConversionDay(trustToContractor, tracking)).toMatchObject({
				actualMinutes: 0,
				requiredMinutes: 0,
				balanceMinutes: 0,
			});
		},
	);

	// The total an organization without a tracking start stores is what the balance refresh
	// writes to `employee_work_balance`; it must read the conversion day as the month rows do.
	it.each([
		["contractor -> employee", () => toEmployee, 180],
		["employee -> contractor", () => toContractor, 240],
		["trust-based employee -> contractor", () => trustToContractor, 0],
	])(
		"stores a total balance for a %s day that equals its period rows (no tracking start)",
		async (_case, person, actualMinutes) => {
			const scope = { employeeId: person().employeeId, organizationId: fixture.organizationId };
			await refreshEmployeeWorkBalanceFromPeriods({
				...scope,
				forceFullRebuild: true,
				now: new Date("2026-05-07T08:00:00Z"),
			});
			const total = await getEmployeeWorkBalance(scope);
			if (!total) throw new Error("no stored total balance");
			expect(total.computedThroughDate).toBe(CONVERSION_DAY);

			const rows = [];
			for (const month of getMonthPeriodsBetween(
				total.computedFromDate,
				total.computedThroughDate,
			)) {
				rows.push(
					await computeEmployeePeriodBalance({
						employeeId: person().employeeId,
						organizationId: fixture.organizationId,
						periodType: "month",
						periodStart: month.periodStart,
						periodEnd:
							month.periodEnd < total.computedThroughDate
								? month.periodEnd
								: total.computedThroughDate,
						calculationStartDate: total.computedFromDate,
						timezone: "UTC",
						isClosed: true,
						now: new Date("2026-05-07T08:00:00Z"),
					}),
				);
			}
			const sum = (key: "actualMinutes" | "requiredMinutes") =>
				rows.reduce((total, row) => total + row[key], 0);

			expect(total.actualMinutes).toBe(actualMinutes);
			expect({ actual: total.actualMinutes, required: total.requiredMinutes }).toEqual({
				actual: sum("actualMinutes"),
				required: sum("requiredMinutes"),
			});
		},
	);
});
