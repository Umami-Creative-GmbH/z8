import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import { adjustmentReviewSections } from "./travel-expense-report-adjustment-review";

const facts = {
	totals: { currency: "EUR", reimbursable: "450.00", companyPaid: "0.00" },
	adjustment: {
		originalReportId: "11111111-1111-4111-8111-111111111111",
		reason: "The hotel refunded one night",
		baseline: { entitlement: "500.00", currency: "EUR", adjustments: [] },
		delta: { amount: "-50.00", currency: "EUR" },
	},
} as unknown as TravelExpenseReportSubmittedFacts;

describe("adjustment review sections", () => {
	it("links the corrected report instead of printing its id", () => {
		const [, details] = adjustmentReviewSections(facts);
		if (details?.type !== "key_value") throw new Error("expected key/value details");
		const original = details.rows[0];
		expect(original).toMatchObject({
			href: "/travel-expenses/reports/11111111-1111-4111-8111-111111111111",
		});
		expect(original?.value).not.toBe(facts.adjustment?.originalReportId);
		expect(details.rows.map((row) => row.value)).toContain("-50.00 EUR");
	});

	it("adds nothing for an ordinary report", () => {
		expect(adjustmentReviewSections({ ...facts, adjustment: undefined })).toEqual([]);
	});
});
