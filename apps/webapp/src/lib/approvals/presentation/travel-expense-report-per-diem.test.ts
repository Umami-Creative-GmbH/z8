import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import { perDiemReviewRows } from "./travel-expense-report-per-diem";

const noMeal = { provided: false, employeePayment: null, deduction: "0.00" };

const item = {
	itemId: "pd",
	position: 0,
	type: "per_diem",
	expenseDate: "2026-09-14",
	category: "meals",
	description: "Per diem",
	original: { amount: "24.40", currency: "EUR" },
	paidBy: "employee",
	accountingReference: null,
	receipts: [],
	perDiem: {
		start: {
			date: "2026-09-14",
			time: "07:15",
			timeZone: "Europe/Berlin",
			at: "2026-09-14T05:15:00Z",
		},
		end: {
			date: "2026-09-15",
			time: "19:40",
			timeZone: "Europe/Berlin",
			at: "2026-09-15T17:40:00Z",
		},
		overnight: "away",
		absenceMinutes: 2185,
		meals: [],
		days: [
			{
				date: "2026-09-14",
				dayType: "arrival",
				absenceMinutes: 1005,
				allowance: "partial_day",
				basis: "travel_day_with_overnight",
				rate: "14.00",
				versionId: "v1",
				meals: { breakfast: noMeal, lunch: noMeal, dinner: noMeal },
				mealsCountToward: "2026-09-14",
				deductions: "0.00",
				amount: "14.00",
			},
			{
				date: "2026-09-15",
				dayType: "departure",
				absenceMinutes: 1180,
				allowance: "partial_day",
				basis: "travel_day_with_overnight",
				rate: "14.00",
				versionId: "v1",
				meals: {
					breakfast: { provided: true, employeePayment: "2.00", deduction: "3.60" },
					lunch: noMeal,
					dinner: noMeal,
				},
				mealsCountToward: "2026-09-15",
				deductions: "3.60",
				amount: "10.40",
			},
		],
		currency: "EUR",
		amount: "24.40",
		rules: { key: "de-2026", reference: "§ 9 Abs. 4a EStG", version: "LStH 2026" },
		policies: [
			{
				policyId: "p",
				versionId: "v1",
				effectiveFrom: "2026-01-01",
				source: {
					kind: "organization",
					reference: "Travel policy",
					version: null,
					defaultKey: null,
				},
				area: "DE",
				rates: {
					fullDay: "28.00",
					partialDay: "14.00",
					breakfastDeduction: "5.60",
					lunchDeduction: "11.20",
					dinnerDeduction: "11.20",
				},
			},
		],
	},
} satisfies TravelExpenseReportSubmittedItem;

describe("perDiemReviewRows", () => {
	it("shows the frozen travel times, one row per logical day and the applied rules and rates", () => {
		const rows = perDiemReviewRows(item);
		expect(rows.map((row) => row.label)).toEqual([
			expect.objectContaining({ fallback: "Left home or workplace" }),
			expect.objectContaining({ fallback: "Back home or at workplace" }),
			expect.objectContaining({ fallback: "Overnight" }),
			"2026-09-14",
			"2026-09-15",
			expect.objectContaining({ fallback: "Per diem" }),
			expect.objectContaining({ fallback: "Rules applied" }),
			expect.objectContaining({ fallback: "Applied rates" }),
		]);
		expect(rows[0]?.value).toBe("2026-09-14 07:15 (Europe/Berlin)");
		expect(rows[4]?.value).toBe(
			"travel day with overnight stay (19 h 40 min) — 14.00 − 3.60 [breakfast provided, paid 2.00 (−3.60)] = 10.40 EUR",
		);
		expect(rows[5]?.value).toBe("24.40 EUR");
	});

	it("adds nothing to other items", () => {
		const { perDiem: _perDiem, ...receipt } = item;
		expect(perDiemReviewRows({ ...receipt, type: "receipt" })).toEqual([]);
	});
});
