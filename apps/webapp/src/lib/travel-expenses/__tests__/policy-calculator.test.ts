import { describe, expect, it } from "vitest";
import {
	calculateMileageAmount,
	calculatePerDiemAmount,
} from "@/lib/travel-expenses/policy-calculator";

describe("travel-expense policy calculators", () => {
	it("calculates mileage amount from configured rate", () => {
		expect(calculateMileageAmount({ kilometers: 120, ratePerKm: 0.42 })).toBe(50.4);
	});

	it("rounds mileage amount to 2 decimals", () => {
		expect(calculateMileageAmount({ kilometers: 12.5, ratePerKm: 0.333 })).toBe(4.16);
	});

	it("calculates per diem from trip day count and daily rate", () => {
		expect(calculatePerDiemAmount({ dayCount: 3, dailyRate: 28 })).toBe(84);
	});

	it("rounds per diem amount to 2 decimals", () => {
		expect(calculatePerDiemAmount({ dayCount: 7, dailyRate: 33.335 })).toBe(233.35);
	});
});
