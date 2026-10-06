import { describe, expect, it } from "vitest";
import type { ItemConversion } from "../currency-conversion";
import { reportItemMissingRequirements } from "../item-requirements";
import { receiptExceptionContext } from "../receipt-exception";
import type { ReceiptItemDraft } from "../receipt-report";

/** Per-type requirement dispatch (#606) keeps #604's and #607's receipt checks. */

const draft: ReceiptItemDraft = {
	expenseDate: "2026-09-14",
	category: "transport",
	description: "Taxi",
	amount: "100.00",
	currency: "USD",
	paidBy: "employee",
	accountingReference: null,
};

const cardCharge: ItemConversion = {
	basis: "card_charge",
	sourceCurrency: "USD",
	targetCurrency: "EUR",
	chargedAmount: "92.17",
	evidenceReceiptId: "r-1",
};

const context = { reimbursementCurrency: "EUR" };

describe("reportItemMissingRequirements for receipt items", () => {
	it("requires a conversion of a foreign receipt and accepts a saved one (#607)", () => {
		expect(
			reportItemMissingRequirements({ type: "receipt", draft, receiptCount: 1 }, context),
		).toContain("conversion_missing");
		expect(
			reportItemMissingRequirements(
				{ type: "receipt", draft, receiptCount: 1, conversion: cardCharge },
				context,
			),
		).toEqual([]);
	});

	it("accepts a missing-receipt exception instead of a receipt (#604)", () => {
		const sameCurrency = { ...draft, currency: "EUR" };
		expect(
			reportItemMissingRequirements({ draft: sameCurrency, receiptCount: 0 }, context),
		).toEqual(["receipt"]);
		expect(
			reportItemMissingRequirements(
				{
					draft: sameCurrency,
					receiptCount: 0,
					receiptException: receiptExceptionContext("The printer was broken", true),
				},
				context,
			),
		).toEqual([]);
	});

	it("never asks a mileage item for a receipt or a conversion (#606)", () => {
		const missing = reportItemMissingRequirements(
			{ type: "mileage", draft, receiptCount: 0, mileage: null },
			context,
		);
		expect(missing).not.toContain("receipt");
		expect(missing).not.toContain("conversion_missing");
	});
});
