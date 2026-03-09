import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
	normalizePolicyFormValues,
	type TravelExpensePolicyFormValues,
} from "./travel-expense-policy-dialog";

describe("normalizePolicyFormValues", () => {
	it("converts empty optional fields to null/undefined", () => {
		const input: TravelExpensePolicyFormValues = {
			effectiveFrom: "2026-03-01",
			effectiveTo: "",
			currency: "eur",
			mileageRatePerKm: "",
			perDiemRatePerDay: "   ",
			isActive: true,
		};

		const normalized = normalizePolicyFormValues(input);

		expect(normalized.effectiveTo).toBeNull();
		expect(normalized.mileageRatePerKm).toBeUndefined();
		expect(normalized.perDiemRatePerDay).toBeUndefined();
		expect(normalized.currency).toBe("EUR");
		expect(DateTime.fromJSDate(normalized.effectiveFrom).toFormat("yyyy-LL-dd")).toBe(
			"2026-03-01",
		);
	});

	it("parses numeric fields and effectiveTo date", () => {
		const input: TravelExpensePolicyFormValues = {
			effectiveFrom: "2026-04-10",
			effectiveTo: "2026-04-30",
			currency: "USD",
			mileageRatePerKm: "0.47",
			perDiemRatePerDay: "35.5",
			isActive: false,
		};

		const normalized = normalizePolicyFormValues(input);

		expect(normalized.mileageRatePerKm).toBe(0.47);
		expect(normalized.perDiemRatePerDay).toBe(35.5);
		expect(normalized.effectiveTo).toBeInstanceOf(Date);
		expect(normalized.isActive).toBe(false);
	});
});
