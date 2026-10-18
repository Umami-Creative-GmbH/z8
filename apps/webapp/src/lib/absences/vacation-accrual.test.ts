import { describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import type { VacationPolicy } from "./vacation-policy-store";
import type { WorkingWeekPeriod } from "./working-days";

vi.mock("@/db", () => ({ db: {} }));

const { policyPeriodMonthlyAccrualDays, requiredAccrualConfiguration } = await import(
	"./vacation-accrual"
);

const monthly = {
	id: "monthly",
	defaultAnnualDays: "30",
	statutoryMinimumDays: "20",
	accrualType: "monthly",
	prorateInStartAndExitYear: true,
} as VacationPolicy;
const periods: EmployeeVacationPolicyPeriod[] = [
	{
		startDate: "2027-01-01",
		endDate: "2027-12-31",
		resolution: { status: "resolved", source: "organization", policy: monthly },
	},
];
const week = (
	startDate: string,
	endDate: string,
	workingDaysPerWeek: number,
): WorkingWeekPeriod => ({
	startDate,
	endDate,
	workingDaysPerWeek,
	workPolicyId: `wp-${workingDaysPerWeek}`,
});
const employments = [{ startDate: parsePlainDate("2020-01-01"), lastWorkingDay: null }];
const accrual = (
	month: number,
	workingWeeks: WorkingWeekPeriod[],
	input: { customAnnualDays?: string; year?: number } = {},
) =>
	policyPeriodMonthlyAccrualDays({
		periods,
		workingWeeks,
		customAnnualDays: input.customAnnualDays,
		year: input.year ?? 2027,
		month,
		employments,
	});

describe("working-week conversion of accrual (Absences ADR 0003)", () => {
	it("accrues each month at the working week in effect in that month", () => {
		const workingWeeks = [week("2027-01-01", "2027-06-30", 5), week("2027-07-01", "2027-12-31", 4)];
		// A later schedule change never reaches an earlier month.
		expect(accrual(6, workingWeeks)).toBeCloseTo(2.5, 10);
		expect(accrual(7, workingWeeks)).toBeCloseTo(2, 10);
	});

	it("splits a month at a schedule change by its calendar days", () => {
		// April has 30 days: 15 at 30/12 and 15 at 24/12.
		expect(
			accrual(4, [week("2027-01-01", "2027-04-15", 5), week("2027-04-16", "2027-12-31", 4)]),
		).toBeCloseTo(2.25, 10);
	});

	it("keeps a custom annual allowance final", () => {
		expect(accrual(7, [week("2027-01-01", "2027-12-31", 4)], { customAnnualDays: "24" })).toBe(2);
	});

	it("does not convert years before 2026", () => {
		expect(
			policyPeriodMonthlyAccrualDays({
				periods: [{ ...periods[0], startDate: "2025-01-01", endDate: "2025-12-31" }],
				workingWeeks: [week("2025-01-01", "2025-12-31", 4)],
				year: 2025,
				month: 3,
				employments,
			}),
		).toBe(2.5);
	});

	it("requires review instead of accruing over a schedule without working days", () => {
		const workingWeeks = [week("2027-01-01", "2027-04-09", 5), week("2027-04-10", "2027-12-31", 0)];
		expect(
			requiredAccrualConfiguration(periods, {
				year: 2027,
				month: 3,
				employments,
				workingWeeks,
			}),
		).toEqual({ status: "resolved" });
		expect(
			requiredAccrualConfiguration(periods, {
				year: 2027,
				month: 4,
				employments,
				workingWeeks,
			}),
		).toEqual({
			status: "conflict",
			periods: [
				{
					startDate: "2027-04-10",
					endDate: "2027-04-30",
					reason: "zero_working_days",
					workPolicyId: "wp-0",
				},
			],
		});
	});
});
