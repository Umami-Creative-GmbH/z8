import { describe, expect, it } from "vitest";
import { formatEuroCurrency } from "./format-euro-currency";

describe("formatEuroCurrency", () => {
	it("formats whole euros without decimals in the locale's currency format", () => {
		expect(formatEuroCurrency(400, "en")).toBe("€4");
		expect(formatEuroCurrency(400, "de")).toBe("4 €");
	});

	it("keeps two decimals for partial euros", () => {
		expect(formatEuroCurrency(150, "en")).toBe("€1.50");
		expect(formatEuroCurrency(150, "de")).toBe("1,50 €");
	});
});
