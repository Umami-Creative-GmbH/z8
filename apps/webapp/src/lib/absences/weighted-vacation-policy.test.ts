import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolveVacationAllowance } from "./prorated-allowance";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import type { VacationPolicy } from "./vacation-policy-store";
import { resolveWeightedVacationPolicy } from "./weighted-vacation-policy";
import type { WorkingWeekPeriod } from "./working-days";

const policy = (days: string, minimum = "20"): VacationPolicy => ({
	id: days,
	organizationId: "org",
	name: days,
	startDate: "2026-01-01",
	validUntil: null,
	isCompanyDefault: false,
	isActive: true,
	defaultAnnualDays: days,
	statutoryMinimumDays: minimum,
	accrualType: "annual",
	accrualStartMonth: 1,
	allowCarryover: false,
	maxCarryoverDays: null,
	carryoverExpiryMonths: null,
	prorateInStartAndExitYear: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "actor",
});
const period = (
	startDate: string,
	endDate: string,
	days: string,
	minimum = "20",
): EmployeeVacationPolicyPeriod => ({
	startDate,
	endDate,
	resolution: {
		status: "resolved",
		source: "employee",
		policy: policy(days, minimum),
	},
});
const weighted = (periods: EmployeeVacationPolicyPeriod[], year = 2027) =>
	resolveWeightedVacationPolicy(periods, { year });
describe("weighted employee vacation policy", () => {
	it("combines January to June at 30 and July to December at 24 into 27 days", () => {
		expect(
			weighted([
				period("2027-01-01", "2027-06-30", "30"),
				period("2027-07-01", "2027-12-31", "24"),
			]),
		).toMatchObject({
			policy: { defaultAnnualDays: "27.00", statutoryMinimumDays: "20.00" },
			configuration: { status: "resolved" },
		});
	});
	it("uses actual leap February days and rounds only the combined allowance", () => {
		expect(
			weighted(
				[
					period("2028-01-01", "2028-02-14", "30"),
					period("2028-02-15", "2028-12-31", "24"),
				],
				2028,
			),
		).toMatchObject({ policy: { defaultAnnualDays: "24.74" } });
	});
	it("does not let a partial policy coverage invent an allowance", () => {
		expect(
			weighted([
				period("2027-01-01", "2027-06-30", "30"),
				period("2027-08-01", "2027-12-31", "24"),
			]),
		).toEqual({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2027-07-01", endDate: "2027-07-31" }],
			},
		});
	});
	it("keeps team conflicts explicit rather than selecting a policy", () => {
		expect(
			weighted([
				{
					startDate: "2027-01-01",
					endDate: "2027-12-31",
					resolution: { status: "conflict", policyIds: ["a", "b"] },
				},
			]),
		).toEqual({
			configuration: {
				status: "conflict",
				periods: [
					{
						startDate: "2027-01-01",
						endDate: "2027-12-31",
						policyIds: ["a", "b"],
						reason: undefined,
					},
				],
			},
		});
	});
	it("is independent of the viewer timezone", () => {
		const previous = process.env.TZ;
		try {
			for (const zone of [
				"Pacific/Honolulu",
				"Pacific/Kiritimati",
				"Europe/Berlin",
			]) {
				process.env.TZ = zone;
				expect(
					weighted([
						period("2027-01-01", "2027-01-15", "30"),
						period("2027-01-16", "2027-12-31", "24"),
					]),
				).toMatchObject({ policy: { defaultAnnualDays: "24.24" } });
			}
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
	it("weights the statutory floor before applying the unchanged employment waiting clock", () => {
		const { policy: combined } = weighted([
			period("2027-01-01", "2027-06-30", "30", "20"),
			period("2027-07-01", "2027-12-31", "24", "16"),
		]);
		if (!combined) throw new Error("Expected covered policy");
		expect(
			resolveVacationAllowance({
				policy: combined,
				employments: [
					{
						startDate: parsePlainDate("2027-02-01"),
						lastWorkingDay: parsePlainDate("2027-08-31"),
					},
				],
				year: 2027,
			}),
		).toMatchObject({
			// The rates average over the employed February to August (Absences ADR 0003):
			// (30 × 5 + 24 × 2) / 7 = 28.29, and the floor (20 × 5 + 16 × 2) / 7 = 18.86 beats the
			// 28.29 × 7/12 = 16.5 → 17 earned days.
			fullAllowance: 28.29,
			days: 18.86,
			reason: {
				kind: "prorated",
				employments: [{ employmentMonths: 7, floorApplied: true }],
			},
		});
		expect(
			resolveVacationAllowance({
				policy: combined,
				customAnnualDays: "12.34",
				employments: [
					{ startDate: parsePlainDate("2027-10-01"), lastWorkingDay: null },
				],
				year: 2027,
			}),
		).toMatchObject({
			fullAllowance: 12.34,
			days: 12.34,
			reason: { kind: "none", cause: "custom_allowance" },
		});
		expect(
			resolveVacationAllowance({
				policy: combined,
				employments: [{ startDate: null, lastWorkingDay: null }],
				year: 2027,
			}),
		).toMatchObject({
			days: 27,
			reason: { kind: "none", cause: "no_known_start" },
		});
	});
});

const week = (
	startDate: string,
	endDate: string,
	workingDaysPerWeek: number,
	workPolicyId: string | null = `wp-${workingDaysPerWeek}`,
): WorkingWeekPeriod => ({ startDate, endDate, workingDaysPerWeek, workPolicyId });
const stint = (startDate: string | null, lastWorkingDay: string | null = null) => ({
	startDate: startDate ? parsePlainDate(startDate) : null,
	lastWorkingDay: lastWorkingDay ? parsePlainDate(lastWorkingDay) : null,
});
function allowance(input: {
	periods: EmployeeVacationPolicyPeriod[];
	workingWeeks: WorkingWeekPeriod[];
	employments?: ReturnType<typeof stint>[];
	customAnnualDays?: string | null;
	year?: number;
	prorate?: boolean;
}) {
	const year = input.year ?? 2027;
	const { policy: combined, configuration } = resolveWeightedVacationPolicy(input.periods, {
		year,
		workingWeeks: input.workingWeeks,
	});
	if (!combined) throw new Error(`Expected covered policy, got ${configuration.status}`);
	return resolveVacationAllowance({
		policy: { ...combined, prorateInStartAndExitYear: input.prorate ?? true },
		customAnnualDays: input.customAnnualDays,
		employments: input.employments ?? [stint(`${year - 5}-01-01`)],
		year,
	});
}
const fullYear = (days = "30", minimum = "20") => [
	period("2027-01-01", "2027-12-31", days, minimum),
];

describe("working-week conversion (Absences ADR 0003)", () => {
	it.each([
		[4, 24],
		[5, 30],
		[6, 36],
	])("converts 30 reference days for %i scheduled days to %i", (days, expected) => {
		expect(
			allowance({ periods: fullYear(), workingWeeks: [week("2027-01-01", "2027-12-31", days)] }),
		).toMatchObject({ fullAllowance: expected, days: expected });
	});

	it("explains the reference allowance and the working week it was converted for", () => {
		expect(
			allowance({ periods: fullYear(), workingWeeks: [week("2027-01-01", "2027-12-31", 4)] }),
		).toMatchObject({
			reason: { kind: "none", cause: "full_year" },
			workingWeek: {
				referenceAllowance: 30,
				periods: [{ startDate: "2027-01-01", endDate: "2027-12-31", workingDaysPerWeek: 4 }],
			},
		});
		expect(
			allowance({ periods: fullYear(), workingWeeks: [week("2027-01-01", "2027-12-31", 5)] })
				.workingWeek,
		).toBeUndefined();
	});

	it("weights a 1 July change from five to four days by calendar month: 27 days", () => {
		expect(
			allowance({
				periods: fullYear(),
				workingWeeks: [week("2027-01-01", "2027-06-30", 5), week("2027-07-01", "2027-12-31", 4)],
			}),
		).toMatchObject({ fullAllowance: 27, days: 27 });
	});

	it("weights a mid-month change by the actual days of a leap February", () => {
		expect(
			allowance({
				year: 2028,
				periods: [period("2028-01-01", "2028-12-31", "30")],
				workingWeeks: [week("2028-01-01", "2028-02-14", 5), week("2028-02-15", "2028-12-31", 4)],
			}),
		).toMatchObject({ fullAllowance: 24.74 });
	});

	it("combines coincident policy and schedule changes period by period: 24.6 days", () => {
		expect(
			allowance({
				periods: [
					period("2027-01-01", "2027-06-30", "30"),
					period("2027-07-01", "2027-12-31", "24"),
				],
				workingWeeks: [week("2027-01-01", "2027-06-30", 5), week("2027-07-01", "2027-12-31", 4)],
			}),
		).toMatchObject({ fullAllowance: 24.6, days: 24.6 });
	});

	it("converts the statutory minimum: 20 reference days become 16 on four days", () => {
		// Seven employment months earn 14 days on four days; the converted floor raises them to 16.
		expect(
			allowance({
				periods: fullYear("30", "20"),
				workingWeeks: [week("2027-01-01", "2027-12-31", 4)],
				employments: [stint("2027-06-01")],
			}),
		).toMatchObject({
			fullAllowance: 24,
			days: 16,
			reason: { kind: "prorated", employments: [{ employmentMonths: 7, floorApplied: true }] },
		});
	});

	it("gives a four-day 1 October joiner 6 days without a second employment reduction", () => {
		for (const workingWeeks of [
			[week("2027-01-01", "2027-12-31", 4)],
			// The schedule before the employment starts does not matter.
			[week("2027-01-01", "2027-09-30", 5), week("2027-10-01", "2027-12-31", 4)],
		]) {
			expect(
				allowance({ periods: fullYear(), workingWeeks, employments: [stint("2027-10-01")] }),
			).toMatchObject({ fullAllowance: 24, days: 6 });
		}
	});

	it("averages a schedule change within a stint over its employed dates", () => {
		// 1 July to 31 December: 30 × 3/12 + 24 × 3/12 over 6/12 = 27; 27 × 6/12 = 13.5 → 14.
		expect(
			allowance({
				periods: fullYear("30", "0"),
				workingWeeks: [week("2027-01-01", "2027-09-30", 5), week("2027-10-01", "2027-12-31", 4)],
				employments: [stint("2027-07-01")],
			}),
		).toMatchObject({
			fullAllowance: 27,
			days: 14,
			reason: { kind: "prorated", employments: [{ employmentMonths: 6, days: 14 }] },
		});
	});

	it("prorates rehire stints at their own rates and caps them at the employed-dates rate", () => {
		// 3 months at 30 → 7.5 → 8; 9 months at 24 → 18; the cap is 30 × 3/12 + 24 × 9/12 = 25.5.
		expect(
			allowance({
				periods: fullYear(),
				workingWeeks: [week("2027-01-01", "2027-03-31", 5), week("2027-04-01", "2027-12-31", 4)],
				employments: [stint("2020-01-01", "2027-03-31"), stint("2027-04-01")],
			}),
		).toMatchObject({
			fullAllowance: 25.5,
			days: 25.5,
			reason: {
				kind: "prorated",
				cappedAtFullAllowance: true,
				employments: [{ days: 8 }, { days: 18 }],
			},
		});
	});

	it("converts without proration, without a known start and on an accrual policy", () => {
		const workingWeeks = [week("2027-01-01", "2027-12-31", 4)];
		expect(
			allowance({
				periods: fullYear(),
				workingWeeks,
				employments: [stint("2027-10-01")],
				prorate: false,
			}),
		).toMatchObject({ days: 24, reason: { kind: "none", cause: "proration_off" } });
		expect(
			allowance({ periods: fullYear(), workingWeeks, employments: [stint(null)] }),
		).toMatchObject({ days: 24, reason: { kind: "none", cause: "no_known_start" } });
	});

	it("keeps custom allowances final, zero and manually reduced part-time values included", () => {
		for (const custom of ["0", "24"]) {
			const result = allowance({
				periods: fullYear(),
				workingWeeks: [week("2027-01-01", "2027-12-31", 4)],
				employments: [stint("2027-10-01")],
				customAnnualDays: custom,
			});
			expect(result).toMatchObject({
				fullAllowance: Number(custom),
				days: Number(custom),
				reason: { kind: "none", cause: "custom_allowance" },
			});
			expect(result.workingWeek).toBeUndefined();
		}
	});

	it("does not convert years before 2026", () => {
		expect(
			allowance({
				year: 2025,
				periods: [period("2025-01-01", "2025-12-31", "30")],
				workingWeeks: [week("2025-01-01", "2025-12-31", 4)],
			}),
		).toMatchObject({ fullAllowance: 30, days: 30, reason: { cause: "before_rollout" } });
	});

	it("reports an explicit schedule without working days as a configuration error", () => {
		expect(
			resolveWeightedVacationPolicy(fullYear(), {
				year: 2027,
				workingWeeks: [
					week("2027-01-01", "2027-03-31", 5),
					week("2027-04-01", "2027-04-30", 0, "empty"),
					week("2027-05-01", "2027-12-31", 5),
				],
			}),
		).toEqual({
			configuration: {
				status: "conflict",
				periods: [
					{
						startDate: "2027-04-01",
						endDate: "2027-04-30",
						reason: "zero_working_days",
						workPolicyId: "empty",
					},
				],
			},
		});
	});

	it("does not depend on the viewer timezone", () => {
		const previous = process.env.TZ;
		try {
			for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati", "Europe/Berlin"]) {
				process.env.TZ = zone;
				expect(
					allowance({
						periods: fullYear(),
						workingWeeks: [
							week("2027-01-01", "2027-06-30", 5),
							week("2027-07-01", "2027-12-31", 4),
						],
					}).fullAllowance,
				).toBe(27);
			}
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
});
