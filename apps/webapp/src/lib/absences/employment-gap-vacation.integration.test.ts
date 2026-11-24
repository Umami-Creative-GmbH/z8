/**
 * #2009: days without an employment period are not employment. They earn no allowance and never
 * make the year's vacation configuration a zero-working-days conflict, so a rehire after a gap
 * still has a prorated balance for the year, against PostgreSQL.
 *
 * The organization runs on UTC with a company default of 24 days a year (no statutory minimum),
 * prorated in a start or exit year. Nobody has a work policy, so every employed day is a
 * five-day week.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

const {
	absenceCategory,
	absenceEntry,
	vacationAllowance,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyVersion,
} = await import("@/db/schema");
const { createLifecycleDatabaseFixture } =
	await import("@/lib/employee-lifecycle/testing/database.test.fixture");
const { loadProratedVacationAllowances } = await import("./prorated-allowance-store");
const { calculateAnnualCarryover } = await import("./vacation.service");
const { loadVacationBalances } = await import("./vacation-balance-store");

const instant = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Inclusive date ranges, oldest first, with adjacent ranges joined. */
function joinedRanges(ranges: ReadonlyArray<{ startDate: string; endDate: string }>) {
	const joined: Array<{ startDate: string; endDate: string }> = [];
	for (const { startDate, endDate } of ranges.toSorted((a, b) =>
		a.startDate.localeCompare(b.startDate),
	)) {
		const last = joined.at(-1);
		if (last && Temporal.PlainDate.from(last.endDate).add({ days: 1 }).toString() === startDate)
			last.endDate = endDate;
		else joined.push({ startDate, endDate });
	}
	return joined;
}

describe("vacation across a gap without employment (#2009)", () => {
	let fixture: LifecycleDatabaseFixture;
	let oneDayGapId: string;
	let quarterGapId: string;
	let lateStarterId: string;
	let noWorkingDaysId: string;
	let noWorkingDaysPolicyId: string;

	/**
	 * An employee with recorded employment periods, each from its first day through its last
	 * working day; a period without a last day is still open.
	 */
	async function employeeWithStints(stints: ReadonlyArray<{ from: string; through?: string }>) {
		const { employeeId } = await fixture.seedEmployee({
			startDate: instant(stints[0]?.from ?? "2026-01-01"),
			withPeriod: false,
		});
		for (const stint of stints) {
			const endedAt = stint.through
				? new Date(instant(stint.through).getTime() + 24 * 60 * 60 * 1000)
				: null;
			await fixture.pool.query(
				`insert into employee_employment_period
				 (id, organization_id, employee_id, status, started_at, ended_at, start_provenance)
				 values ($1, $2, $3, $4, $5, $6, 'recorded')`,
				[
					randomUUID(),
					fixture.organizationId,
					employeeId,
					endedAt ? "closed" : "open",
					instant(stint.from),
					endedAt,
				],
			);
		}
		return employeeId;
	}

	/** A work policy whose schedule has no working days, assigned to the employee all year. */
	async function assignScheduleWithoutWorkingDays(employeeId: string) {
		const [policy] = await fixture.db
			.insert(workPolicy)
			.values({
				organizationId: fixture.organizationId,
				name: "No working days",
				scheduleEnabled: true,
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [version] = await fixture.db
			.insert(workPolicyVersion)
			.values({
				policyId: policy.id,
				organizationId: fixture.organizationId,
				versionNumber: 1,
				effectiveFromDate: "1970-01-01",
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				isLegacyBaseline: true,
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [schedule] = await fixture.db
			.insert(workPolicySchedule)
			.values({
				policyId: policy.id,
				policyVersionId: version.id,
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				scheduleCycle: "weekly",
			})
			.returning();
		await fixture.db.insert(workPolicyScheduleDay).values(
			(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const).map(
				(dayOfWeek) => ({
					scheduleId: schedule.id,
					policyVersionId: version.id,
					dayOfWeek,
					hoursPerDay: "0",
					isWorkDay: false,
				}),
			),
		);
		await fixture.db.insert(workPolicyAssignment).values({
			policyId: policy.id,
			organizationId: fixture.organizationId,
			assignmentType: "employee",
			employeeId,
			priority: 2,
			effectiveFromDate: "1970-01-01",
			createdBy: fixture.ownerUserId,
		});
		return policy.id;
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			fixture.organizationId,
		]);
		await fixture.db.insert(vacationAllowance).values({
			organizationId: fixture.organizationId,
			name: "Company",
			startDate: "2025-01-01",
			isCompanyDefault: true,
			defaultAnnualDays: "24",
			statutoryMinimumDays: "0",
			accrualType: "annual",
			allowCarryover: true,
			prorateInStartAndExitYear: true,
			createdBy: fixture.ownerUserId,
		});

		// Leaves on Tuesday 31 March, rehired on Thursday 2 April: 1 April has no employment.
		oneDayGapId = await employeeWithStints([
			{ from: "2026-01-01", through: "2026-03-31" },
			{ from: "2026-04-02" },
		]);
		// Leaves on 31 March, rehired on 1 July: April to June have no employment.
		quarterGapId = await employeeWithStints([
			{ from: "2026-01-01", through: "2026-03-31" },
			{ from: "2026-07-01" },
		]);
		// Joins on 1 July: the days before the recorded first start have no employment.
		lateStarterId = await employeeWithStints([{ from: "2026-07-01" }]);
		// The same quarter gap, but working under a schedule without working days.
		noWorkingDaysId = await employeeWithStints([
			{ from: "2026-01-01", through: "2026-03-31" },
			{ from: "2026-07-01" },
		]);
		noWorkingDaysPolicyId = await assignScheduleWithoutWorkingDays(noWorkingDaysId);

		// Vacation from Monday 30 March to Friday 3 April, across the departure.
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId: fixture.organizationId, name: "Vacation", type: "vacation" })
			.returning();
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId: quarterGapId,
			categoryId: vacation.id,
			startDate: "2026-03-30",
			endDate: "2026-04-03",
			status: "approved",
		});
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function balances(employeeIds: string[]) {
		return loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds,
			year: 2026,
			timezone: "UTC",
		});
	}

	it("prorates the balance over the employed days around a one-day gap", async () => {
		const { balances: byEmployee, configurations } = await balances([oneDayGapId]);

		expect(configurations.get(oneDayGapId)?.status).not.toBe("conflict");
		// January to March: 3 months, 6 days. 2 April to 31 December: 8 full months, 16 days.
		expect(byEmployee.get(oneDayGapId)).toMatchObject({
			allowanceDays: 22,
			allowance: { fullAllowance: 24, days: 22, reason: { kind: "prorated" } },
		});
	});

	it("prorates the balance over the employed days around a gap of several months", async () => {
		const { balances: byEmployee, configurations } = await balances([quarterGapId]);

		expect(configurations.get(quarterGapId)?.status).not.toBe("conflict");
		// January to March: 6 days. July to December: 6 months, 12 days.
		expect(byEmployee.get(quarterGapId)).toMatchObject({
			allowanceDays: 18,
			allowance: { fullAllowance: 24, days: 18, reason: { kind: "prorated" } },
		});
	});

	it("counts no absence days on the days without employment", async () => {
		const { balances: byEmployee } = await balances([quarterGapId]);

		// Only Monday 30 and Tuesday 31 March are employed working days.
		expect(byEmployee.get(quarterGapId)?.usedDays).toBe(2);
	});

	it("prorates the balance of a mid-year joiner over the days from the recorded start", async () => {
		const { balances: byEmployee, configurations } = await balances([lateStarterId]);

		expect(configurations.get(lateStarterId)?.status).not.toBe("conflict");
		expect(byEmployee.get(lateStarterId)).toMatchObject({
			allowanceDays: 12,
			allowance: { fullAllowance: 24, days: 12, reason: { kind: "prorated" } },
		});
	});

	it("still reports a schedule without working days, on the employed days only", async () => {
		const { balances: byEmployee, configurations } = await balances([noWorkingDaysId]);

		expect(byEmployee.has(noWorkingDaysId)).toBe(false);
		const configuration = configurations.get(noWorkingDaysId);
		expect(configuration?.status).toBe("conflict");
		const periods = configuration?.status === "conflict" ? configuration.periods : [];
		for (const period of periods)
			expect(period).toMatchObject({
				reason: "zero_working_days",
				workPolicyId: noWorkingDaysPolicyId,
			});
		// Policy periods may slice the conflict further; together they cover the employed days.
		expect(joinedRanges(periods)).toEqual([
			{ startDate: "2026-01-01", endDate: "2026-03-31" },
			{ startDate: "2026-07-01", endDate: "2026-12-31" },
		]);
	});

	it("gives the shared policy's allowance to everyone employed with working days", async () => {
		const allowances = await loadProratedVacationAllowances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [oneDayGapId, quarterGapId, lateStarterId, noWorkingDaysId],
			year: 2026,
			policy: {
				defaultAnnualDays: "24",
				statutoryMinimumDays: "0",
				accrualType: "annual",
				prorateInStartAndExitYear: true,
			},
		});

		expect(
			Object.fromEntries([...allowances].map(([id, allowance]) => [id, allowance.days])),
		).toEqual({ [oneDayGapId]: 22, [quarterGapId]: 18, [lateStarterId]: 12 });
	});

	it("carries over the shared policy's year of everyone employed with working days", async () => {
		// An organization not yet calculating with dated policies carries over the shared policy.
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled = false where organization_id = $1",
			[fixture.organizationId],
		);
		const summary = await calculateAnnualCarryover(
			fixture.organizationId,
			2026,
			fixture.ownerUserId,
		);
		const remaining = (employeeId: string) =>
			summary.results.find((result) => result.employeeId === employeeId)?.previousYearRemaining;

		expect(remaining(oneDayGapId)).toBe(22);
		expect(remaining(quarterGapId)).toBe(16);
		expect(remaining(lateStarterId)).toBe(12);
		expect(summary.errors.map((error) => error.employeeId)).toEqual([noWorkingDaysId]);
	});
});
