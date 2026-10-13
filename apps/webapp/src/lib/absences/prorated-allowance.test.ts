import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type EmploymentStint,
	employmentStintsFromRecords,
	resolveVacationAllowance,
} from "./prorated-allowance";

const policy = {
	defaultAnnualDays: "30",
	accrualType: "annual",
	prorateInStartAndExitYear: true,
	statutoryMinimumDays: "20",
};

function stint(startDate: string | null, lastWorkingDay: string | null = null): EmploymentStint {
	return {
		startDate: startDate ? parsePlainDate(startDate) : null,
		lastWorkingDay: lastWorkingDay ? parsePlainDate(lastWorkingDay) : null,
	};
}

function allowanceFor(employments: EmploymentStint[], overrides: Partial<typeof policy> = {}) {
	return resolveVacationAllowance({
		policy: { ...policy, ...overrides },
		employments,
		year: 2026,
	});
}

describe("employmentStintsFromRecords", () => {
	const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);
	const legacyPeriod = {
		id: "period-1",
		startedAt: utcMidnight("2020-01-01"),
		endedAt: null,
		startProvenance: "legacy" as const,
	};
	const plain = (stints: EmploymentStint[]) =>
		stints.map((employment) => ({
			startDate: employment.startDate?.toString() ?? null,
			lastWorkingDay: employment.lastWorkingDay?.toString() ?? null,
		}));

	it("falls back to the employee start date when no employment period exists yet", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2026-10-01"),
					periods: [],
					departures: [],
					timezone: "America/Los_Angeles",
				}),
			),
		).toEqual([{ startDate: "2026-10-01", lastWorkingDay: null }]);
	});

	it("ends the employment on the employee end date when no employment period exists yet", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2020-01-01"),
					employeeEndDate: utcMidnight("2026-04-30"),
					periods: [],
					departures: [],
					timezone: "America/Los_Angeles",
				}),
			),
		).toEqual([{ startDate: "2020-01-01", lastWorkingDay: "2026-04-30" }]);
	});

	it("starts the legacy employment on the employee start date, which tracks admin edits", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2026-10-01"),
					periods: [legacyPeriod],
					departures: [],
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual([{ startDate: "2026-10-01", lastWorkingDay: null }]);
	});

	it("has no known start without an employee start date or for an unknown-start period", () => {
		const unknown = { ...legacyPeriod, startedAt: null, startProvenance: "unknown" as const };
		for (const input of [
			{ employeeStartDate: null, periods: [] },
			{ employeeStartDate: null, periods: [legacyPeriod] },
			{ employeeStartDate: utcMidnight("2020-01-01"), periods: [unknown] },
		]) {
			expect(
				plain(employmentStintsFromRecords({ ...input, departures: [], timezone: "UTC" })),
			).toEqual([{ startDate: null, lastWorkingDay: null }]);
		}
	});

	it("starts a recorded rehire on its start instant in the organization zone", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2020-01-01"),
					periods: [
						{ ...legacyPeriod, endedAt: utcMidnight("2026-03-31") },
						{
							id: "period-2",
							startedAt: new Date("2026-08-31T23:30:00.000Z"),
							endedAt: null,
							startProvenance: "recorded",
						},
					],
					departures: [
						{
							employmentPeriodId: "period-1",
							status: "effective",
							lastWorkingDay: "2026-03-30",
							cutoffAt: new Date("2026-03-30T22:00:00.000Z"),
							timezone: "Europe/Berlin",
							createdAt: utcMidnight("2026-02-01"),
						},
					],
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual([
			{ startDate: "2020-01-01", lastWorkingDay: "2026-03-30" },
			{ startDate: "2026-09-01", lastWorkingDay: null },
		]);
	});

	it("takes the last working day of the newest pending or effective departure, even in the future", () => {
		const departure = {
			employmentPeriodId: "period-1",
			lastWorkingDay: "2026-11-30",
			cutoffAt: new Date("2026-11-30T23:00:00.000Z"),
			timezone: "Europe/Berlin",
		};
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2020-01-01"),
					periods: [legacyPeriod],
					departures: [
						{ ...departure, status: "pending", createdAt: utcMidnight("2026-09-02") },
						{
							...departure,
							status: "canceled",
							lastWorkingDay: "2026-12-15",
							createdAt: utcMidnight("2026-09-03"),
						},
						{
							...departure,
							status: "blocked",
							lastWorkingDay: "2026-12-20",
							createdAt: utcMidnight("2026-09-04"),
						},
						{
							...departure,
							status: "pending",
							lastWorkingDay: "2026-10-31",
							createdAt: utcMidnight("2026-09-01"),
						},
					],
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual([{ startDate: "2020-01-01", lastWorkingDay: "2026-11-30" }]);
	});

	it("derives the last working day of an immediate departure from its cutoff", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2020-01-01"),
					periods: [{ ...legacyPeriod, endedAt: new Date("2026-08-14T13:00:00.000Z") }],
					departures: [
						{
							employmentPeriodId: "period-1",
							status: "effective",
							lastWorkingDay: null,
							cutoffAt: new Date("2026-08-14T13:00:00.000Z"),
							timezone: "Europe/Berlin",
							createdAt: new Date("2026-08-14T13:00:00.000Z"),
						},
					],
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual([{ startDate: "2020-01-01", lastWorkingDay: "2026-08-14" }]);
	});

	it("reads a legacy period's end as the employee's last day", () => {
		expect(
			plain(
				employmentStintsFromRecords({
					employeeStartDate: utcMidnight("2020-01-01"),
					periods: [{ ...legacyPeriod, endedAt: utcMidnight("2026-03-31") }],
					departures: [],
					timezone: "America/Los_Angeles",
				}),
			),
		).toEqual([{ startDate: "2020-01-01", lastWorkingDay: "2026-03-31" }]);
	});
});

describe("resolveVacationAllowance", () => {
	it("prorates a 1 October joiner to 8 of 30 days for 3 full employment months", () => {
		const result = allowanceFor([stint("2026-10-01")]);

		expect(result.fullAllowance).toBe(30);
		expect(result.allowance).toBe(8);
		expect(result.reason).toEqual({
			kind: "prorated",
			employments: [
				{
					kind: "start",
					startDate: "2026-10-01",
					lastWorkingDay: null,
					employmentMonths: 3,
					days: 8,
					floorApplied: false,
				},
			],
			cappedAtFullAllowance: false,
		});
	});

	it("counts employment months from the start date: 15 Oct gives 2 months and 5 days", () => {
		const result = allowanceFor([stint("2026-10-15")]);

		expect(result.allowance).toBe(5);
		expect(result.reason).toMatchObject({
			kind: "prorated",
			employments: [{ kind: "start", employmentMonths: 2, days: 5, floorApplied: false }],
		});
	});

	it("raises a 1 March joiner to the statutory minimum only when it is higher: max(25, 20)", () => {
		expect(allowanceFor([stint("2026-03-01")]).allowance).toBe(25);
		expect(allowanceFor([stint("2026-03-01")], { statutoryMinimumDays: "28" })).toMatchObject({
			allowance: 28,
			reason: { employments: [{ employmentMonths: 10, days: 28, floorApplied: true }] },
		});
	});

	it("applies the floor to a 1 July joiner, whose waiting period completes on 31 December", () => {
		const result = allowanceFor([stint("2026-07-01")]);

		expect(result.allowance).toBe(20);
		expect(result.reason).toMatchObject({
			employments: [{ kind: "start", employmentMonths: 6, days: 20, floorApplied: true }],
		});
	});

	it("applies no floor to a 2 July joiner, whose waiting period ends in the next year", () => {
		const result = allowanceFor([stint("2026-07-02")]);

		expect(result.allowance).toBe(13);
		expect(result.reason).toMatchObject({
			employments: [{ employmentMonths: 5, days: 13, floorApplied: false }],
		});
	});

	it("prorates a leaver on 31 March from 1 January, without the floor", () => {
		const result = allowanceFor([stint("2020-05-01", "2026-03-31")]);

		expect(result.allowance).toBe(8);
		expect(result.reason).toEqual({
			kind: "prorated",
			employments: [
				{
					kind: "exit",
					startDate: null,
					lastWorkingDay: "2026-03-31",
					employmentMonths: 3,
					days: 8,
					floorApplied: false,
				},
			],
			cappedAtFullAllowance: false,
		});
	});

	it("does not apply the floor to a leaver on 30 June", () => {
		expect(allowanceFor([stint("2020-05-01", "2026-06-30")]).allowance).toBe(15);
	});

	it("applies the floor to a leaver on 31 August after the waiting period", () => {
		const result = allowanceFor([stint("2020-05-01", "2026-08-31")], {
			statutoryMinimumDays: "24",
		});

		expect(result.allowance).toBe(24);
		expect(result.reason).toMatchObject({
			employments: [{ kind: "exit", employmentMonths: 8, days: 24, floorApplied: true }],
		});
		expect(allowanceFor([stint("2020-05-01", "2026-08-31")]).allowance).toBe(20);
	});

	it("prorates a joiner and leaver in the same year from start to last working day", () => {
		const result = allowanceFor([stint("2026-02-15", "2026-09-14")]);

		// 7 months give 17.5 → 18, but the waiting period ends on 14 August: the floor applies.
		expect(result.allowance).toBe(20);
		expect(result.reason).toMatchObject({
			employments: [
				{
					kind: "start_and_exit",
					startDate: "2026-02-15",
					lastWorkingDay: "2026-09-14",
					employmentMonths: 7,
					days: 20,
					floorApplied: true,
				},
			],
		});
	});

	it("prorates a short joiner-and-leaver stint without the floor", () => {
		expect(allowanceFor([stint("2026-02-01", "2026-05-31")])).toMatchObject({
			allowance: 10,
			reason: { employments: [{ employmentMonths: 4, days: 10, floorApplied: false }] },
		});
	});

	it("prorates each employment of a rehire separately and caps the sum at the full allowance", () => {
		// 24 (7 months, raised to the floor) + 10 (4 months) = 34, capped at 30.
		const capped = allowanceFor([stint("2026-09-01"), stint("2019-01-01", "2026-07-31")], {
			statutoryMinimumDays: "24",
		});

		expect(capped.allowance).toBe(30);
		expect(capped.reason).toMatchObject({
			kind: "prorated",
			employments: [
				{ kind: "exit", employmentMonths: 7, days: 24, floorApplied: true },
				{ kind: "start", startDate: "2026-09-01", employmentMonths: 4, days: 10 },
			],
			cappedAtFullAllowance: true,
		});

		const summed = allowanceFor([stint("2019-01-01", "2026-03-31"), stint("2026-11-01")]);
		expect(summed.allowance).toBe(13);
		expect(summed.reason).toMatchObject({ cappedAtFullAllowance: false });
	});

	it("rounds a fraction of ½ day or more up and keeps smaller fractions", () => {
		// 25 days × 2/12 = 4.1666… stays 4.17; 30 days × 3/12 = 7.5 becomes 8.
		expect(allowanceFor([stint("2026-11-01")], { defaultAnnualDays: "25" }).allowance).toBe(4.17);
		expect(allowanceFor([stint("2026-10-01")]).allowance).toBe(8);
	});

	it("ends an employment month on the last day of a shorter month", () => {
		// 31 Jan → 28 Feb is one month; 11 full months to 30 Dec, and 31 Dec starts the 12th.
		expect(allowanceFor([stint("2026-01-31")]).reason).toMatchObject({
			employments: [{ employmentMonths: 11 }],
		});
	});

	it("keeps the full allowance without a known start", () => {
		expect(allowanceFor([stint(null)])).toEqual({
			fullAllowance: 30,
			allowance: 30,
			reason: { kind: "none", cause: "no_known_start" },
		});
		expect(allowanceFor([stint(null, "2026-03-31")]).reason).toEqual({
			kind: "none",
			cause: "no_known_start",
		});
	});

	it("keeps the full allowance when the policy switch is off", () => {
		expect(allowanceFor([stint("2026-10-01")], { prorateInStartAndExitYear: false })).toMatchObject(
			{ allowance: 30, reason: { kind: "none", cause: "proration_off" } },
		);
	});

	it("keeps the full allowance for a policy that accrues monthly or biweekly", () => {
		for (const accrualType of ["monthly", "biweekly"]) {
			expect(allowanceFor([stint("2026-10-01")], { accrualType })).toMatchObject({
				allowance: 30,
				reason: { kind: "none", cause: "accrual_policy" },
			});
		}
	});

	it("keeps the full allowance in years before 2026", () => {
		const result = resolveVacationAllowance({
			policy,
			employments: [stint("2025-10-01")],
			year: 2025,
		});

		expect(result).toMatchObject({
			allowance: 30,
			reason: { kind: "none", cause: "before_rollout" },
		});
	});

	it("never prorates a custom allowance", () => {
		const result = resolveVacationAllowance({
			policy,
			customAnnualDays: "12",
			employments: [stint("2026-10-01")],
			year: 2026,
		});

		expect(result).toEqual({
			fullAllowance: 12,
			allowance: 12,
			reason: { kind: "none", cause: "custom_allowance" },
		});
		expect(
			resolveVacationAllowance({
				policy,
				customAnnualDays: "",
				employments: [stint("2026-10-01")],
				year: 2026,
			}).allowance,
		).toBe(8);
	});

	it("keeps the full allowance for a whole year and ignores employments outside the year", () => {
		expect(allowanceFor([stint("2026-01-01")]).reason).toEqual({
			kind: "none",
			cause: "full_year",
		});
		expect(allowanceFor([stint("2019-01-01", "2025-06-30"), stint("2025-08-01")]).reason).toEqual({
			kind: "none",
			cause: "full_year",
		});
	});

	it("gives no allowance in a year the employee is not employed", () => {
		expect(allowanceFor([stint("2027-02-01")])).toEqual({
			fullAllowance: 30,
			allowance: 0,
			reason: { kind: "not_employed" },
		});
	});
});
