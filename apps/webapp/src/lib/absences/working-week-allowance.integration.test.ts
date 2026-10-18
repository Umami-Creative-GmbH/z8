/**
 * #990 (Absences ADR 0003): vacation allowances convert from the five-day reference week to each
 * employee's scheduled working days, against PostgreSQL, for balances, accrual postings and the
 * one-time working-week notice.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { WeekdayName } from "./working-days";

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
	employeeVacationAllowance,
	vacationAdjustment,
	vacationAllowance,
	vacationPolicyAssignment,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
} = await import("@/db/schema");
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
const { accrueVacationPeriods } = await import("./vacation-accrual");
const { loadVacationBalances } = await import("./vacation-balance-store");
const { dismissWorkingWeekNotice, loadWorkingWeekNotice } = await import(
	"./working-week-notice-store"
);

const ALL_WEEKDAYS: WeekdayName[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];
const MONDAY_TO_THURSDAY = ALL_WEEKDAYS.slice(0, 4);
const MONDAY_TO_SATURDAY = ALL_WEEKDAYS.slice(0, 6);
const utcDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("working-week vacation allowances (#990)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeEach(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			"update vacation_policy_rollout set baseline_date=DATE '2026-01-01' where organization_id=$1",
			[fixture.organizationId],
		);
	});
	afterEach(async () => {
		await fixture?.close();
	});

	async function admit() {
		await fixture.pool.query(
			"update vacation_policy_rollout set calculations_enabled=true where organization_id=$1",
			[fixture.organizationId],
		);
	}

	async function vacationPolicy(input: {
		days: string;
		method?: "annual" | "monthly";
		start?: string;
		companyDefault?: boolean;
	}) {
		const [created] = await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: `Vacation ${crypto.randomUUID()}`,
				startDate: input.start ?? "2027-01-01",
				isCompanyDefault: input.companyDefault ?? false,
				defaultAnnualDays: input.days,
				statutoryMinimumDays: "20",
				accrualType: input.method ?? "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		return created.id;
	}

	async function assignVacation(employeeId: string, policyId: string) {
		await fixture.db.insert(vacationPolicyAssignment).values({
			organizationId: fixture.organizationId,
			policyId,
			assignmentType: "employee",
			employeeId,
			effectiveStartDate: "2027-01-01",
			createdBy: fixture.ownerUserId,
		});
	}

	/** A work policy with a detailed schedule working `workDays`, 8 hours each. */
	async function workSchedule(workDays: WeekdayName[], organizationId = fixture.organizationId) {
		const [policy] = await fixture.db
			.insert(workPolicy)
			.values({
				organizationId,
				name: `Schedule ${crypto.randomUUID()}`,
				scheduleEnabled: true,
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [schedule] = await fixture.db
			.insert(workPolicySchedule)
			.values({
				policyId: policy.id,
				scheduleType: "detailed",
				workingDaysPreset: "custom",
				scheduleCycle: "weekly",
			})
			.returning();
		await fixture.db.insert(workPolicyScheduleDay).values(
			ALL_WEEKDAYS.map((dayOfWeek) => ({
				scheduleId: schedule.id,
				dayOfWeek,
				hoursPerDay: "6",
				isWorkDay: workDays.includes(dayOfWeek),
			})),
		);
		return policy.id;
	}

	async function assignWork(
		policyId: string,
		target: { employeeId: string } | { organizationId: string },
		window: { effectiveFrom?: Date; effectiveUntil?: Date } = {},
	) {
		await fixture.db.insert(workPolicyAssignment).values({
			policyId,
			...("employeeId" in target
				? {
						organizationId: fixture.organizationId,
						assignmentType: "employee" as const,
						employeeId: target.employeeId,
						priority: 2,
					}
				: {
						organizationId: target.organizationId,
						assignmentType: "organization" as const,
						priority: 0,
					}),
			effectiveFrom: window.effectiveFrom ?? null,
			effectiveUntil: window.effectiveUntil ?? null,
			createdBy: fixture.ownerUserId,
		});
	}

	it("converts each employee's balance with the schedule in effect on each day, isolated per organization", async () => {
		const policyId = await vacationPolicy({ days: "30" });
		const sixDays = await fixture.seedEmployee();
		const custom = await fixture.seedEmployee();
		for (const employeeId of [
			fixture.employeeId,
			fixture.ownerEmployeeId,
			sixDays.employeeId,
			custom.employeeId,
		])
			await assignVacation(employeeId, policyId);
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: custom.employeeId,
			year: 2027,
			customAnnualDays: "24",
		});

		// Five days through June, four from 1 July: 30 × 6/12 + 24 × 6/12 = 27.
		const fourDays = await workSchedule(MONDAY_TO_THURSDAY);
		await assignWork(
			fourDays,
			{ employeeId: fixture.employeeId },
			{
				effectiveFrom: utcDate("2027-07-01"),
			},
		);
		await assignWork(await workSchedule(MONDAY_TO_SATURDAY), { employeeId: sixDays.employeeId });
		// A manually reduced part-time allowance is final and never converted again.
		await assignWork(fourDays, { employeeId: custom.employeeId });
		// Another organization's schedule for everyone cannot reach this organization.
		const foreignOrganizationId = await fixture.createOrganization();
		await assignWork(await workSchedule(["monday"], foreignOrganizationId), {
			organizationId: foreignOrganizationId,
		});
		await admit();

		const { balances, configurations } = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [
				fixture.employeeId,
				fixture.ownerEmployeeId,
				sixDays.employeeId,
				custom.employeeId,
			],
			year: 2027,
			timezone: "UTC",
		});

		expect(balances.get(fixture.employeeId)).toMatchObject({
			allowanceDays: 27,
			totalDays: 27,
			allowance: {
				fullAllowance: 27,
				workingWeek: {
					referenceAllowance: 30,
					periods: [
						{ startDate: "2027-01-01", endDate: "2027-06-30", workingDaysPerWeek: 5 },
						{ startDate: "2027-07-01", endDate: "2027-12-31", workingDaysPerWeek: 4 },
					],
				},
			},
		});
		expect(balances.get(fixture.ownerEmployeeId)).toMatchObject({ allowanceDays: 30 });
		expect(balances.get(fixture.ownerEmployeeId)?.allowance?.workingWeek).toBeUndefined();
		expect(balances.get(sixDays.employeeId)).toMatchObject({ allowanceDays: 36 });
		expect(balances.get(custom.employeeId)).toMatchObject({
			allowanceDays: 24,
			allowance: { reason: { kind: "none", cause: "custom_allowance" } },
		});
		expect(configurations.get(fixture.employeeId)).toEqual({ status: "resolved" });
	});

	it("skips a schedule without working days for review and accrues the others idempotently", async () => {
		const monthly = await vacationPolicy({ days: "30", method: "monthly" });
		await assignVacation(fixture.employeeId, monthly);
		await assignVacation(fixture.ownerEmployeeId, monthly);
		await assignWork(await workSchedule(MONDAY_TO_THURSDAY), { employeeId: fixture.employeeId });
		const empty = await workSchedule([]);
		await assignWork(empty, { employeeId: fixture.ownerEmployeeId });
		await admit();

		const result = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [1, 2],
		});
		// 24 converted days a year: 2 days a month.
		expect(result).toMatchObject({ rowsWritten: 2, totalDaysAccrued: 4 });
		expect(result.skippedEmployees).toEqual([
			{
				employeeId: fixture.ownerEmployeeId,
				configuration: {
					status: "conflict",
					periods: expect.arrayContaining([
						expect.objectContaining({
							startDate: "2027-01-01",
							endDate: "2027-01-31",
							reason: "zero_working_days",
							workPolicyId: empty,
						}),
					]),
				},
			},
		]);
		const retry = await accrueVacationPeriods(fixture.organizationId, {
			year: 2027,
			months: [1, 2],
		});
		expect(retry).toMatchObject({ rowsWritten: 0, totalDaysAccrued: 0 });

		const { balances, configurations } = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, fixture.ownerEmployeeId],
			year: 2027,
			timezone: "UTC",
		});
		expect(balances.get(fixture.employeeId)).toMatchObject({ totalDays: 4 });
		expect(balances.has(fixture.ownerEmployeeId)).toBe(false);
		expect(configurations.get(fixture.ownerEmployeeId)).toMatchObject({
			status: "conflict",
			periods: [{ reason: "zero_working_days", workPolicyId: empty }],
		});
		const posted = await fixture.db
			.select({ employeeId: vacationAdjustment.employeeId })
			.from(vacationAdjustment);
		expect(posted.filter((row) => row.employeeId === fixture.ownerEmployeeId)).toEqual([]);
	});

	it("converts a legacy organization's company default from 2026 and lists the reductions once", async () => {
		await vacationPolicy({ days: "30", start: "2025-01-01", companyDefault: true });
		const fourDays = await workSchedule(MONDAY_TO_THURSDAY);
		// Joined on 1 October on four days: 24 × 3/12 = 6 days, and took two weeks: 8 days.
		const joiner = await fixture.seedEmployee({
			startDate: utcDate("2026-10-01"),
			withPeriod: false,
		});
		await assignWork(fourDays, { employeeId: joiner.employeeId });
		await assignWork(fourDays, { employeeId: fixture.employeeId });
		const custom = await fixture.seedEmployee();
		await assignWork(fourDays, { employeeId: custom.employeeId });
		await fixture.db.insert(employeeVacationAllowance).values({
			employeeId: custom.employeeId,
			year: 2026,
			customAnnualDays: "20",
		});
		const [vacation] = await fixture.db
			.insert(absenceCategory)
			.values({ organizationId: fixture.organizationId, name: "Vacation", type: "vacation" })
			.returning();
		await fixture.db.insert(absenceEntry).values({
			organizationId: fixture.organizationId,
			employeeId: joiner.employeeId,
			categoryId: vacation.id,
			startDate: "2026-10-05",
			endDate: "2026-10-16",
			status: "approved",
		});

		const { balances } = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId, joiner.employeeId, custom.employeeId],
			year: 2026,
			timezone: "UTC",
		});
		expect(balances.get(fixture.employeeId)).toMatchObject({ allowanceDays: 24 });
		expect(balances.get(joiner.employeeId)).toMatchObject({
			allowanceDays: 6,
			usedDays: 8,
			overdrawnDays: 2,
			allowance: { fullAllowance: 24 },
		});
		expect(balances.get(custom.employeeId)).toMatchObject({ allowanceDays: 20 });

		const earlier = await loadVacationBalances(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [fixture.employeeId],
			year: 2025,
			timezone: "UTC",
		});
		expect(earlier.balances.get(fixture.employeeId)).toMatchObject({ allowanceDays: 30 });

		const rows = await loadWorkingWeekNotice(fixture.db, {
			organizationId: fixture.organizationId,
		});
		expect(
			rows?.map((row) => [
				row.employeeId,
				row.referenceAllowance,
				row.convertedAllowance,
				row.overdrawnDays,
			]),
		).toEqual(
			expect.arrayContaining([
				[fixture.employeeId, 30, 24, 0],
				[joiner.employeeId, 30, 24, 2],
			]),
		);
		expect(rows).toHaveLength(2);

		await dismissWorkingWeekNotice(fixture.db, {
			organizationId: fixture.organizationId,
			actorUserId: fixture.ownerUserId,
		});
		expect(
			await loadWorkingWeekNotice(fixture.db, { organizationId: fixture.organizationId }),
		).toBeNull();
	});
});
