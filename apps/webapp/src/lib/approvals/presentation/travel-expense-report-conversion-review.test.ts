import { describe, expect, it } from "vitest";
import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import { conversionReviewRows } from "./travel-expense-report-conversion-review";

const item: TravelExpenseReportSubmittedItem = {
	itemId: "taxi",
	position: 0,
	type: "receipt",
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Taxi",
	original: { amount: "100.00", currency: "USD" },
	paidBy: "employee",
	accountingReference: null,
	receipts: [],
};

const values = (rows: ReturnType<typeof conversionReviewRows>) =>
	rows.map((row) => [
		row.label.fallback,
		typeof row.value === "string" ? row.value : row.value.fallback,
	]);

describe("conversionReviewRows (#607)", () => {
	it("adds nothing for an expense in the reimbursement currency", () => {
		expect(conversionReviewRows(item, {})).toEqual([]);
	});

	it("shows a card charge with its evidence file", () => {
		const rows = conversionReviewRows(
			{
				...item,
				conversion: {
					basis: "card_charge",
					evidenceReceiptId: "r-statement",
					reimbursement: { amount: "92.17", currency: "EUR" },
				},
			},
			{ "r-statement": "card-statement.pdf" },
		);
		expect(values(rows)).toEqual([
			["Reimbursed as", "92.17 EUR"],
			["Conversion basis", "Actual card charge (evidenced)"],
			["Charge evidence", "card-statement.pdf"],
		]);
	});

	it("shows an authorized rate distinctly, with its date, rounding, authorizer and reason", () => {
		const rows = conversionReviewRows(
			{
				...item,
				conversion: {
					basis: "manual_rate",
					rate: { base: "EUR", quote: "USD", value: "1.085" },
					rateDate: "2026-09-13",
					reason: "Bank statement rate",
					authorizedBy: { employeeId: "admin-1", name: "Alex Admin" },
					authorizedAt: "2026-09-20T08:00:00Z",
					rounding: { mode: "half_up", minorUnitDigits: 2 },
					reimbursement: { amount: "92.17", currency: "EUR" },
				},
			},
			{},
		);
		expect(values(rows)).toEqual([
			["Reimbursed as", "92.17 EUR"],
			["Conversion basis", "Authorized manual rate"],
			["Rate", "1 EUR = 1.085 USD"],
			["Rate date", "2026-09-13"],
			["Rounding", "Half up, once, to the currency's minor units"],
			["Authorized by", "Alex Admin"],
			["Documentation", "Bank statement rate"],
		]);
	});
});
