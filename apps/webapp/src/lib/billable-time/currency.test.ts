import { describe, expect, it } from "vitest";
import { BILLABLE_CURRENCIES, DEFAULT_BILLABLE_CURRENCY, isBillableCurrency } from "./currency";

describe("billable currency", () => {
	it("offers at least EUR, CHF, USD and GBP, with EUR as the default", () => {
		expect(BILLABLE_CURRENCIES).toEqual(expect.arrayContaining(["EUR", "CHF", "USD", "GBP"]));
		expect(DEFAULT_BILLABLE_CURRENCY).toBe("EUR");
	});

	it("accepts only the listed ISO-4217 codes, exactly as written", () => {
		expect(isBillableCurrency("CHF")).toBe(true);
		expect(isBillableCurrency("chf")).toBe(false);
		expect(isBillableCurrency("JPY")).toBe(false);
		expect(isBillableCurrency("")).toBe(false);
		expect(isBillableCurrency(null)).toBe(false);
	});
});
