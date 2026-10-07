import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import { localizedTextFallback } from "../inbox/localized-text";
import { mileageReviewRows } from "./travel-expense-report-mileage";

const item: TravelExpenseReportSubmittedItem = {
	itemId: "drive",
	position: 0,
	type: "mileage",
	expenseDate: "2026-09-15",
	category: "transport",
	description: "Berlin – Potsdam – back",
	original: { amount: "37.04", currency: "EUR" },
	paidBy: "employee",
	accountingReference: null,
	receipts: [],
	mileage: {
		route: "Berlin – Potsdam – back",
		distanceKm: "123.45",
		vehicle: "car",
		ratePerKm: "0.3000",
		currency: "EUR",
		exactAmount: "37.035000",
		amount: "37.04",
		rounding: "half_up",
		policy: {
			policyId: "policy-1",
			versionId: "version-1",
			effectiveFrom: "2026-01-01",
			source: {
				kind: "statutory_default",
				reference: "§ 9 Abs. 1 Satz 3 Nr. 4a Satz 2 EStG",
				version: "LStH 2026, Anhang 25 III",
				defaultKey: "de-mileage-estg-9-1-4a",
			},
		},
	},
};

describe("mileageReviewRows", () => {
	it("shows the reviewer the frozen route, calculation and applied policy version with its source", () => {
		const rows = mileageReviewRows(item);
		// Localized texts with English defaults (spec #598 review).
		expect(
			rows.map((row) =>
				typeof row.value === "object" && "kind" in row.value
					? row.value
					: localizedTextFallback(row.value),
			),
		).toEqual([
			"Berlin – Potsdam – back",
			"123.45 km",
			"Car",
			"123.45 km × 0.3000 EUR/km = 37.035000 → 37.04 EUR (rounded half up)",
			"Version version-1, valid from 2026-01-01",
			"Statutory default: § 9 Abs. 1 Satz 3 Nr. 4a Satz 2 EStG (LStH 2026, Anhang 25 III)",
		]);
	});

	it("adds nothing for receipt items", () => {
		const { mileage: _mileage, ...receipt } = item;
		expect(mileageReviewRows({ ...receipt, type: "receipt" })).toEqual([]);
	});
});
