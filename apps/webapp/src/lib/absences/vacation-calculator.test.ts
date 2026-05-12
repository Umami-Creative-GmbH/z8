import { describe, expect, it } from "vitest";
import type { AbsenceWithCategory } from "./types";
import { calculateVacationBalance } from "./vacation-calculator";

function vacationAbsence(
	id: string,
	startDate: string,
	status: AbsenceWithCategory["status"] = "approved",
): AbsenceWithCategory {
	return {
		id,
		employeeId: "employee-1",
		startDate,
		startPeriod: "full_day",
		endDate: startDate,
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

describe("calculateVacationBalance fiscal year ranges", () => {
	it("counts following-year January to March absences in an April fiscal year", () => {
		const balance = calculateVacationBalance({
			organizationAllowance: {
				defaultAnnualDays: "30",
				allowCarryover: false,
				maxCarryoverDays: null,
				carryoverExpiryMonths: null,
			},
			employeeAllowance: null,
			absences: [
				vacationAbsence("in-fiscal-year", "2027-03-15"),
				vacationAbsence("outside-fiscal-year", "2027-04-01"),
				vacationAbsence("pending-in-fiscal-year", "2027-03-16", "pending"),
			],
			currentDate: new Date("2027-02-01T00:00:00.000Z"),
			year: 2026,
			fiscalYearStartMonth: 4,
		});

		expect(balance.usedDays).toBe(1);
		expect(balance.pendingDays).toBe(1);
		expect(balance.remainingDays).toBe(28);
	});

	it("calculates carryover expiry from the fiscal year start", () => {
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
			currentDate: new Date("2026-06-15T00:00:00.000Z"),
			year: 2026,
			fiscalYearStartMonth: 4,
		});

		expect(balance.carryoverDays).toBe(5);
		expect(balance.totalDays).toBe(35);
		expect(balance.carryoverExpiryDate?.toISOString()).toBe("2026-06-30T23:59:59.999Z");
	});
});
