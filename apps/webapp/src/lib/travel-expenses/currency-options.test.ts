import { describe, expect, it } from "vitest";
import { isReimbursementCurrencySupported } from "./currency-conversion";
import { currencyOptions } from "./currency-options";
import { isSupportedCurrency } from "./receipt-report";

describe("currencyOptions", () => {
	it("labels each currency with its code and localized name, searchable by both", () => {
		const options = currencyOptions("en", isSupportedCurrency);
		expect(options.find((option) => option.code === "EUR")).toEqual({
			code: "EUR",
			name: "EUR – Euro",
			keywords: ["EUR", "Euro"],
		});
		expect(currencyOptions("de", isSupportedCurrency).find((o) => o.code === "CHF")?.name).toBe(
			"CHF – Schweizer Franken",
		);
	});

	it("offers exactly what the server accepts, sorted by code", () => {
		const reimbursement = currencyOptions("en", isReimbursementCurrencySupported);
		expect(reimbursement.every((option) => isReimbursementCurrencySupported(option.code))).toBe(
			true,
		);
		expect(reimbursement.map((option) => option.code)).not.toContain("KWD");
		expect(currencyOptions("en", isSupportedCurrency).map((option) => option.code)).toContain(
			"KWD",
		);
		const codes = reimbursement.map((option) => option.code);
		expect(codes).toEqual([...codes].sort());
	});

	it("still shows a stored value that is no longer offered", () => {
		const options = currencyOptions("en", isReimbursementCurrencySupported, "KWD");
		expect(options.filter((option) => option.code === "KWD")).toHaveLength(1);
		expect(
			currencyOptions("en", isSupportedCurrency, "EUR").filter((o) => o.code === "EUR"),
		).toHaveLength(1);
		expect(currencyOptions("en", isSupportedCurrency, "").some((o) => o.code === "")).toBe(false);
	});
});
