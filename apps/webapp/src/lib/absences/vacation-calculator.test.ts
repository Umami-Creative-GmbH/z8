import { describe, expect, it } from "vitest";
import type { AbsenceWithCategory } from "./types";
import { calculateVacationBalance } from "./vacation-calculator";

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
