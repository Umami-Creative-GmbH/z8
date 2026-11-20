import { describe, expect, it } from "vitest";
import { payrollHoursFormat } from "./hours-format";

describe("payrollHoursFormat", () => {
	it("formats minutes as hours in the app locale, with up to two decimals", () => {
		expect(payrollHoursFormat("en").minutes(450)).toBe("7.5");
		expect(payrollHoursFormat("de").minutes(450)).toBe("7,5");
		expect(payrollHoursFormat("de").minutes(480)).toBe("8");
		expect(payrollHoursFormat("de").hours(1234.5)).toBe("1.234,5");
	});

	it("always shows two decimals when asked, as the PDF and the status strip do", () => {
		expect(payrollHoursFormat("en", { decimals: "two" }).minutes(480)).toBe("8.00");
		expect(payrollHoursFormat("de", { decimals: "two" }).hours(16)).toBe("16,00");
	});

	it("signs a difference and leaves zero unsigned", () => {
		const format = payrollHoursFormat("de");
		expect(format.signedMinutes(90)).toBe("+1,5");
		expect(format.signedMinutes(-480)).toBe("-8");
		expect(format.signedMinutes(0)).toBe("0");
	});

	it("rounds to hundredths as the summary rounds worked hours", () => {
		// 20 minutes is 0.3333… hours.
		expect(payrollHoursFormat("en").minutes(20)).toBe("0.33");
		expect(payrollHoursFormat("en", { decimals: "two" }).minutes(1)).toBe("0.02");
	});
});
