import { describe, expect, it } from "vitest";
import {
	formatEuroAmount,
	formatEuroCents,
	monthlyRecurringRevenueCents,
	seatCost,
} from "./seat-prices";

describe("seat prices", () => {
	it("prices 3 full and 5 kiosk monthly seats at €22 per month", () => {
		expect(seatCost({ interval: "month", fullSeats: 3, kioskSeats: 5 })).toEqual({
			lines: [
				{ type: "full", seats: 3, pricePerMonthCents: 400, subtotalPerMonthCents: 1200 },
				{ type: "kiosk", seats: 5, pricePerMonthCents: 200, subtotalPerMonthCents: 1000 },
			],
			totalPerMonthCents: 2200,
			totalPerYearCents: null,
		});
	});

	it("prices yearly seats per month and per year without rounding the kiosk half euro", () => {
		expect(seatCost({ interval: "year", fullSeats: 3, kioskSeats: 5 })).toEqual({
			lines: [
				{ type: "full", seats: 3, pricePerMonthCents: 300, subtotalPerMonthCents: 900 },
				{ type: "kiosk", seats: 5, pricePerMonthCents: 150, subtotalPerMonthCents: 750 },
			],
			totalPerMonthCents: 1650,
			totalPerYearCents: 19_800,
		});
	});

	it("shows only the full seat line while kiosk seats are off", () => {
		expect(seatCost({ interval: "month", fullSeats: 4, kioskSeats: null })).toEqual({
			lines: [{ type: "full", seats: 4, pricePerMonthCents: 400, subtotalPerMonthCents: 1600 }],
			totalPerMonthCents: 1600,
			totalPerYearCents: null,
		});
	});

	it("formats euro cents with two decimals", () => {
		expect(formatEuroCents(150)).toBe("1.50");
		expect(formatEuroCents(2200)).toBe("22.00");
	});

	describe("monthly recurring revenue", () => {
		it("is €22 for an organization with 3 full and 5 kiosk monthly seats", () => {
			expect(
				monthlyRecurringRevenueCents([
					{ billingInterval: "month", currentSeats: 8, currentKioskSeats: 5 },
				]),
			).toBe(2200);
		});

		it("keeps the yearly kiosk half euro and adds up every subscription", () => {
			expect(
				monthlyRecurringRevenueCents([
					{ billingInterval: "year", currentSeats: 8, currentKioskSeats: 5 },
					{ billingInterval: "month", currentSeats: 2, currentKioskSeats: 0 },
					{ billingInterval: null, currentSeats: 1, currentKioskSeats: 1 },
				]),
			).toBe(1650 + 800 + 200);
		});

		it("prices every seat as a full seat when no kiosk seats are recorded", () => {
			expect(
				monthlyRecurringRevenueCents([
					{ billingInterval: "month", currentSeats: 8, currentKioskSeats: 0 },
					{ billingInterval: "year", currentSeats: 10, currentKioskSeats: 0 },
				]),
			).toBe(3200 + 3000);
		});
	});

	it("formats euro amounts without decimals for whole euros and with two otherwise", () => {
		expect(formatEuroAmount(200)).toBe("2");
		expect(formatEuroAmount(150)).toBe("1.50");
		expect(formatEuroAmount(1_800)).toBe("18");
		expect(formatEuroAmount(123_450)).toBe("1,234.50");
		expect(formatEuroAmount(150, "de")).toBe("1,50");
	});
});
