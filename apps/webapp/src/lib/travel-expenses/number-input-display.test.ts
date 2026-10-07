import { describe, expect, it } from "vitest";
import { parseMileageDistance } from "./mileage";
import { formatNumberInput } from "./number-input-display";
import { parseReceiptItemDraft } from "./receipt-report";

const eur = { kind: "amount", currency: "EUR" } as const;
const distance = { kind: "distance" } as const;

describe("formatNumberInput", () => {
	it.each([
		["de", "89,1", "89,10"],
		["en", "89,1", "89.10"],
		["de", "89.10", "89,10"],
		["en-US", "12", "12.00"],
		["fr", "0,5", "0,50"],
	])("shows an amount in %s with the currency's two decimals (%s → %s)", (locale, text, shown) => {
		expect(formatNumberInput(locale, text, eur)).toBe(shown);
	});

	it("uses the currency's own fraction digits", () => {
		expect(formatNumberInput("de", "1000.00", { kind: "amount", currency: "JPY" })).toBe("1000");
		expect(formatNumberInput("en", "12,5", { kind: "amount", currency: "KWD" })).toBe("12.50");
	});

	it("falls back to two decimals while the currency is missing or unknown", () => {
		expect(formatNumberInput("de", "7.5", { kind: "amount", currency: null })).toBe("7,50");
		expect(formatNumberInput("de", "7.5", { kind: "amount", currency: "XYZ" })).toBe("7,50");
	});

	it.each([
		["de", "289.70", "289,7"],
		["en", "289,70", "289.7"],
		["de", "61", "61"],
		["en", "12.05", "12.05"],
	])("shows a distance in %s with up to two decimals (%s → %s)", (locale, text, shown) => {
		expect(formatNumberInput(locale, text, distance)).toBe(shown);
	});

	it("never groups digits, so the parsers accept what is shown", () => {
		const amount = formatNumberInput("de", "1234567.5", eur);
		expect(amount).toBe("1234567,50");
		expect(parseReceiptItemDraft({ ...blankReceipt, amount, currency: "EUR" })).toMatchObject({
			ok: true,
			draft: { amount: "1234567.50" },
		});
		const km = formatNumberInput("en", "12345.6", distance);
		expect(km).toBe("12345.6");
		expect(parseMileageDistance(km)).toBe("12345.60");
	});

	it.each([
		["", ""],
		["   ", "   "],
		["abc", "abc"],
		["1.234,56", "1.234,56"],
		["-5", "-5"],
		["1,005", "1,005"],
	])("keeps malformed or empty text as typed (%j)", (text, shown) => {
		expect(formatNumberInput("de", text, eur)).toBe(shown);
	});
});

const blankReceipt = {
	expenseDate: null,
	category: null,
	description: null,
	amount: null,
	currency: null,
	paidBy: null,
	accountingReference: null,
};
