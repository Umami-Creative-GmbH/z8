import { describe, expect, it } from "vitest";
import {
	parseReceiptItemDraft,
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "../receipt-report";

const empty = {
	expenseDate: null,
	category: null,
	description: null,
	amount: null,
	currency: null,
	paidBy: null,
	accountingReference: null,
};

function complete(overrides: Partial<ReceiptItemDraft> = {}): ReceiptItemDraft {
	return {
		expenseDate: "2026-09-14",
		category: "transport",
		description: "Train to Hamburg",
		amount: "89.90",
		currency: "EUR",
		paidBy: "employee",
		accountingReference: null,
		...overrides,
	};
}

describe("parseReceiptItemDraft", () => {
	it("accepts an entirely empty draft so incomplete work can be saved", () => {
		expect(parseReceiptItemDraft(empty)).toEqual({ ok: true, draft: empty });
	});

	it("normalizes entered values to their stored form", () => {
		const result = parseReceiptItemDraft({
			expenseDate: "2026-09-14",
			category: "meals",
			description: "  Team dinner  ",
			amount: "12,5",
			currency: "eur",
			paidBy: "company",
			accountingReference: "  KST-4711 ",
		});
		expect(result).toEqual({
			ok: true,
			draft: {
				expenseDate: "2026-09-14",
				category: "meals",
				description: "Team dinner",
				amount: "12.50",
				currency: "EUR",
				paidBy: "company",
				accountingReference: "KST-4711",
			},
		});
	});

	it("treats blank text as not entered", () => {
		const result = parseReceiptItemDraft({ ...empty, description: "   ", amount: " " });
		expect(result).toEqual({ ok: true, draft: empty });
	});

	it.each([
		["expenseDate", "2026-02-30", "invalid_date"],
		["expenseDate", "14.09.2026", "invalid_date"],
		["category", "bribes", "invalid_category"],
		["amount", "0", "invalid_amount"],
		["amount", "-5", "invalid_amount"],
		["amount", "12.345", "invalid_amount"],
		["amount", "1.000,00", "invalid_amount"],
		["amount", "12e3", "invalid_amount"],
		["amount", "10000000000.00", "invalid_amount"],
		["currency", "EU", "invalid_currency"],
		["currency", "XYZ", "invalid_currency"],
		["paidBy", "manager", "invalid_payer"],
		["description", "x".repeat(501), "too_long"],
		["accountingReference", "x".repeat(101), "too_long"],
	] as const)("rejects %s=%s as %s", (field, value, error) => {
		const result = parseReceiptItemDraft({ ...empty, [field]: value });
		expect(result).toEqual({ ok: false, errors: { [field]: error } });
	});

	it("rejects an amount with more decimals than its currency allows", () => {
		expect(parseReceiptItemDraft({ ...empty, amount: "1500.50", currency: "JPY" })).toEqual({
			ok: false,
			errors: { amount: "invalid_amount" },
		});
		expect(parseReceiptItemDraft({ ...empty, amount: "1500", currency: "JPY" })).toEqual({
			ok: true,
			draft: { ...empty, amount: "1500.00", currency: "JPY" },
		});
	});
});

describe("receiptItemMissingRequirements", () => {
	const context = { receiptCount: 1, reimbursementCurrency: "EUR" };

	it("reports nothing for a complete same-currency receipt item", () => {
		expect(receiptItemMissingRequirements(complete(), context)).toEqual([]);
	});

	it("lists every missing fact of an empty draft, including the receipt", () => {
		expect(receiptItemMissingRequirements(empty, { ...context, receiptCount: 0 })).toEqual([
			"expense_date",
			"category",
			"description",
			"amount",
			"payment_ownership",
			"receipt",
		]);
	});

	it("flags a foreign-currency receipt instead of guessing a conversion", () => {
		expect(receiptItemMissingRequirements(complete({ currency: "USD" }), context)).toEqual([
			"conversion_missing",
		]);
	});

	it("accepts a foreign-currency receipt with an evidenced card charge (#607)", () => {
		const conversion = {
			basis: "card_charge" as const,
			sourceCurrency: "USD",
			targetCurrency: "EUR",
			chargedAmount: "92.17",
			evidenceReceiptId: null,
		};
		expect(
			receiptItemMissingRequirements(complete({ currency: "USD" }), { ...context, conversion }),
		).toEqual(["conversion_evidence"]);
		expect(
			receiptItemMissingRequirements(complete({ currency: "USD" }), {
				...context,
				conversion: { ...conversion, evidenceReceiptId: "r1" },
			}),
		).toEqual([]);
	});

	it("does not ask for an optional accounting reference", () => {
		expect(
			receiptItemMissingRequirements(complete({ accountingReference: null }), context),
		).toEqual([]);
	});
});

describe("receiptReportTotals", () => {
	it("separates employee-paid reimbursement from company-paid costs", () => {
		const totals = receiptReportTotals(
			[
				complete({ amount: "89.90", paidBy: "employee" }),
				complete({ amount: "240.00", paidBy: "company" }),
				complete({ amount: "0.10", paidBy: "employee" }),
			],
			"EUR",
		);
		expect(totals).toEqual({
			currency: "EUR",
			reimbursable: "90.00",
			companyPaid: "240.00",
			excludedItemCount: 0,
		});
	});

	it("never counts a company-paid cost toward the employee entitlement", () => {
		const totals = receiptReportTotals([complete({ amount: "500.00", paidBy: "company" })], "EUR");
		expect(totals.reimbursable).toBe("0.00");
	});

	it("excludes items without an amount, payer or the reimbursement currency", () => {
		const totals = receiptReportTotals(
			[
				complete({ amount: null }),
				complete({ paidBy: null }),
				complete({ currency: "USD", amount: "10.00" }),
				complete({ amount: "5.00" }),
			],
			"EUR",
		);
		expect(totals).toEqual({
			currency: "EUR",
			reimbursable: "5.00",
			companyPaid: "0.00",
			excludedItemCount: 3,
		});
	});

	it("counts a converted foreign item at its reimbursement amount (#607)", () => {
		const totals = receiptReportTotals(
			[
				{
					...complete({ currency: "USD", amount: "100.00" }),
					conversion: {
						basis: "card_charge",
						sourceCurrency: "USD",
						targetCurrency: "EUR",
						chargedAmount: "92.17",
						evidenceReceiptId: "r1",
					},
				},
				complete({ amount: "7.83" }),
			],
			"EUR",
		);
		expect(totals).toEqual({
			currency: "EUR",
			reimbursable: "100.00",
			companyPaid: "0.00",
			excludedItemCount: 0,
		});
	});

	it("sums without floating point drift", () => {
		const items = Array.from({ length: 10 }, () => complete({ amount: "0.10" }));
		expect(receiptReportTotals(items, "EUR").reimbursable).toBe("1.00");
	});
});
