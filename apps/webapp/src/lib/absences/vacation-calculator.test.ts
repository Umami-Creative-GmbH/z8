import { describe, expect, it } from "vitest";
import type { AbsenceWithCategory } from "./types";
import { calculateVacationBalance } from "./vacation-calculator";
import { workingDaysFrom } from "./working-days";

function vacationAbsence(
	id: string,
	startDate: string,
	status: AbsenceWithCategory["status"] = "approved",
	endDate = startDate,
): AbsenceWithCategory {
	return {
		id,
		employeeId: "employee-1",
		startDate,
		startPeriod: "full_day",
		endDate,
		endPeriod: "full_day",
		status,
		notes: null,
		category: {
			id: "vacation",
			name: "Vacation",
			type: "vacation",
			color: null,
			countsAgainstVacation: true,
		},
		approvedBy: null,
		approvedAt: null,
		rejectionReason: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

describe("calculateVacationBalance calendar year ranges", () => {
	it("counts January to December absences in the requested calendar year", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [
				vacationAbsence("in-calendar-year", "2026-03-17"),
				vacationAbsence("outside-calendar-year", "2027-01-01"),
				vacationAbsence("pending-in-calendar-year", "2026-03-18", "pending"),
			],
			currentDate: new Date("2027-02-01T00:00:00.000Z"),
			year: 2026,
		});

		expect(balance.usedDays).toBe(1);
		expect(balance.pendingDays).toBe(1);
		expect(balance.remainingDays).toBe(28);
	});

	it("calculates carryover expiry from the calendar year start", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: true,
				maxCarryoverDays: "10",
				carryoverExpiryMonths: 3,
			},
			employeeAllowance: {
				customAnnualDays: null,
				customCarryoverDays: "5",
			},
			absences: [],
			currentDate: new Date("2026-03-15T00:00:00.000Z"),
			year: 2026,
		});

		expect(balance.carryoverDays).toBe(5);
		expect(balance.totalDays).toBe(35);
		expect(balance.carryoverExpiryDate?.toISOString()).toBe("2026-03-31T23:59:59.999Z");
	});

	it("calculates carryover expiry in the organization timezone", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: true,
				maxCarryoverDays: "10",
				carryoverExpiryMonths: 3,
			},
			employeeAllowance: {
				customAnnualDays: null,
				customCarryoverDays: "5",
			},
			absences: [],
			currentDate: new Date("2026-03-15T00:00:00.000Z"),
			year: 2026,
			timezone: "Europe/Berlin",
		});

		expect(balance.carryoverExpiryDate?.toISOString()).toBe("2026-03-31T21:59:59.999Z");
	});

	it("clips boundary-spanning absences to the calendar year range", () => {
		const spanningAbsence = vacationAbsence(
			"boundary-spanning",
			"2025-12-30",
			"approved",
			"2026-01-02",
		);

		const previousCalendarYear = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [spanningAbsence],
			currentDate: new Date("2025-12-31T00:00:00.000Z"),
			year: 2025,
		});

		const nextCalendarYear = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [spanningAbsence],
			currentDate: new Date("2026-01-01T00:00:00.000Z"),
			year: 2026,
		});

		expect(previousCalendarYear.usedDays).toBe(2);
		expect(nextCalendarYear.usedDays).toBe(2);
	});

	it("counts legacy-compatible explicit overnight partial-day entries as a half day", () => {
		const overnightPartial = vacationAbsence("overnight-partial", "2026-05-15");
		overnightPartial.startPeriod = "am";
		overnightPartial.endPeriod = "am";

		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [overnightPartial],
			currentDate: new Date("2026-05-01T00:00:00.000Z"),
			year: 2026,
			fiscalYearStartMonth: 1,
		});

		expect(balance.usedDays).toBe(0.5);
		expect(balance.remainingDays).toBe(29.5);
	});
});

describe("vacation balance with assigned holidays", () => {
	it.each(["approved", "pending"] as const)(
		"recalculates an existing %s request and restores the holiday day",
		(status) => {
			const balance = calculateVacationBalance({
				organizationAllowance: {
					defaultAnnualDays: "30",
					accrualType: "annual",
					allowCarryover: false,
					maxCarryoverDays: null,
					carryoverExpiryMonths: null,
				},
				absences: [vacationAbsence("existing-request", "2026-12-28", status, "2026-12-31")],
				isWorkingDay: workingDaysFrom({
					assignments: [],
					holidays: [
						{
							id: "silvester",
							name: "Silvester",
							categoryId: "company-holiday",
							startDate: new Date("2026-12-31T00:00:00Z"),
							endDate: new Date("2026-12-31T00:00:00Z"),
						},
					],
				}),
				currentDate: new Date("2026-10-05T00:00:00Z"),
				year: 2026,
			});
			expect(balance.usedDays).toBe(status === "approved" ? 3 : 0);
			expect(balance.pendingDays).toBe(status === "pending" ? 3 : 0);
			expect(balance.remainingDays).toBe(27);
		},
	);
});

describe("vacation balance on the employee's working days", () => {
	const allowance = {
		defaultAnnualDays: "30",
		accrualType: "annual",
		allowCarryover: false,
		maxCarryoverDays: null,
		carryoverExpiryMonths: null,
	};

	it("charges a Monday-to-Thursday employee four days for a Monday-to-Friday vacation", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: allowance,
			absences: [vacationAbsence("week", "2026-10-12", "approved", "2026-10-16")],
			isWorkingDay: (day) => day.dayOfWeek <= 4,
			currentDate: new Date("2026-10-05T00:00:00Z"),
			year: 2026,
		});
		expect(balance.usedDays).toBe(4);
		expect(balance.remainingDays).toBe(26);
	});

	it("charges a Monday-to-Saturday employee for a Saturday", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: allowance,
			absences: [vacationAbsence("saturday", "2026-10-17", "pending")],
			isWorkingDay: (day) => day.dayOfWeek <= 6,
			currentDate: new Date("2026-10-05T00:00:00Z"),
			year: 2026,
		});
		expect(balance.pendingDays).toBe(1);
		expect(balance.remainingDays).toBe(29);
	});
});

describe("calculateVacationBalance with a prorated allowance", () => {
	it("starts from the prorated allowance and reports it with the balance", () => {
		const allowance = {
			fullAllowance: 30,
			days: 8,
			reason: {
				kind: "prorated" as const,
				employments: [
					{
						kind: "start" as const,
						startDate: "2026-10-01",
						lastWorkingDay: null,
						employmentMonths: 3,
						days: 8,
						floorApplied: false,
					},
				],
				cappedAtFullAllowance: false,
			},
		};
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			allowance,
			absences: [vacationAbsence("october", "2026-10-12")],
			currentDate: new Date("2026-10-05T00:00:00Z"),
			year: 2026,
			adjustmentTotal: 1,
		});

		expect(balance.totalDays).toBe(9);
		expect(balance.remainingDays).toBe(8);
		expect(balance.allowance).toEqual(allowance);
	});

	it("still starts an accrual policy at 0, whose accrual adjustments carry the allowance", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				accrualType: "monthly",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			allowance: {
				fullAllowance: 30,
				days: 30,
				reason: { kind: "none", cause: "accrual_policy" },
			},
			absences: [],
			currentDate: new Date("2026-04-01T00:00:00Z"),
			year: 2026,
			adjustmentTotal: 7.5,
		});

		expect(balance.totalDays).toBe(7.5);
	});
});

describe("vacation balance on an accrual policy (#1106)", () => {
	const policy = (accrualType: string) => ({
		defaultAnnualDays: "24",
		accrualType,
		allowCarryover: false,
		maxCarryoverDays: null,
		carryoverExpiryMonths: null,
	});

	it.each(["monthly", "biweekly"])(
		"starts a %s policy at 0, so three accruals of +2 give 6 days",
		(accrualType) => {
			const balance = calculateVacationBalance({
				organizationAllowance: policy(accrualType),
				absences: [],
				currentDate: new Date("2026-04-01T00:00:00Z"),
				year: 2026,
				adjustmentTotal: 6,
			});
			expect(balance.totalDays).toBe(6);
			expect(balance.remainingDays).toBe(6);
		},
	);

	it("ignores a custom annual allowance as the starting balance, since accrual is based on it", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: policy("monthly"),
			employeeAllowance: { customAnnualDays: "36", customCarryoverDays: null },
			absences: [],
			currentDate: new Date("2026-04-01T00:00:00Z"),
			year: 2026,
			adjustmentTotal: 9,
		});
		expect(balance.totalDays).toBe(9);
	});

	it("still starts an annual policy from the full allowance", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: policy("annual"),
			absences: [],
			currentDate: new Date("2026-04-01T00:00:00Z"),
			year: 2026,
		});
		expect(balance.totalDays).toBe(24);
	});
});

describe("overdrawn vacation (#1111)", () => {
	const policy = {
		defaultAnnualDays: "30",
		accrualType: "annual",
		allowCarryover: false,
		maxCarryoverDays: null,
		carryoverExpiryMonths: null,
	};
	const prorated = {
		fullAllowance: 30,
		days: 2,
		reason: {
			kind: "prorated" as const,
			employments: [
				{
					kind: "exit" as const,
					startDate: null,
					lastWorkingDay: "2026-01-31",
					employmentMonths: 1,
					days: 2.5,
					floorApplied: false,
				},
			],
			cappedAtFullAllowance: false,
		},
	};

	it("shows vacation taken beyond the prorated allowance, while the remaining days stay at 0", () => {
		// Mon 2 to Thu 5 March 2026: 4 approved days against a prorated allowance of 2.
		const balance = calculateVacationBalance({
			organizationAllowance: policy,
			allowance: prorated,
			absences: [vacationAbsence("taken", "2026-03-02", "approved", "2026-03-05")],
			currentDate: new Date("2026-03-10T00:00:00Z"),
			year: 2026,
		});

		expect(balance.usedDays).toBe(4);
		expect(balance.remainingDays).toBe(0);
		expect(balance.overdrawnDays).toBe(2);
	});

	it("counts only vacation already taken, not pending requests", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: policy,
			allowance: prorated,
			absences: [
				vacationAbsence("taken", "2026-03-02"),
				vacationAbsence("requested", "2026-03-03", "pending", "2026-03-05"),
			],
			currentDate: new Date("2026-03-10T00:00:00Z"),
			year: 2026,
		});

		expect(balance.remainingDays).toBe(0);
		expect(balance.overdrawnDays).toBe(0);
	});

	it("is 0 within the allowance and counts carryover and adjustments as available", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: policy,
			allowance: prorated,
			absences: [vacationAbsence("taken", "2026-03-02", "approved", "2026-03-05")],
			currentDate: new Date("2026-03-10T00:00:00Z"),
			year: 2026,
			adjustmentTotal: 1.5,
		});

		expect(balance.overdrawnDays).toBe(0.5);
	});
});