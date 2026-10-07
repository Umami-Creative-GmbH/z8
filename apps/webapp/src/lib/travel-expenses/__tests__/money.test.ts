import { describe, expect, it } from "vitest";
import {
	currencyMinorUnitDigits,
	divideToUnits,
	formatUnits,
	MAX_AMOUNT_UNITS,
	multiplyToUnits,
	parseUnits,
	roundToScale,
	STORED_AMOUNT_SCALE,
	signedAmount,
	sumUnits,
} from "../money";

describe("signedAmount / MAX_AMOUNT_UNITS (spec #598 review)", () => {
	it("signs only positive differences; zero has no sign", () => {
		expect(signedAmount("12.30")).toBe("+12.30");
		expect(signedAmount("-12.30")).toBe("-12.30");
		expect(signedAmount("0.00")).toBe("0.00");
		expect(signedAmount("-0.00")).toBe("-0.00");
		expect(signedAmount("not a number")).toBe("not a number");
	});

	it("bounds a single amount at 999 999 999.99", () => {
		expect(formatUnits(MAX_AMOUNT_UNITS, STORED_AMOUNT_SCALE)).toBe("999999999.99");
	});
});

const units = (value: string | number) => BigInt(value);

describe("parseUnits / formatUnits", () => {
	it("reads a decimal string as exact integer units of a scale", () => {
		expect(parseUnits("89.90", 2)).toBe(BigInt(8990));
		expect(parseUnits("89.9", 2)).toBe(BigInt(8990));
		expect(parseUnits("12", 2)).toBe(BigInt(1200));
		expect(parseUnits("-0.05", 2)).toBe(BigInt(-5));
		expect(parseUnits("1500", 0)).toBe(BigInt(1500));
	});

	it("accepts trailing zeros beyond the scale but never drops a significant digit", () => {
		expect(parseUnits("100.00", 0)).toBe(BigInt(100));
		expect(parseUnits("1.005", 2)).toBeNull();
		expect(parseUnits("100.50", 0)).toBeNull();
	});

	it("refuses anything that is not a plain decimal", () => {
		for (const value of ["", "-", ".5", "5.", "1,5", "1e3", "+1", " 1", "0x10", "1.2.3", "NaN"]) {
			expect(parseUnits(value, 2)).toBeNull();
		}
	});

	it("formats units back to a fixed-scale decimal string, signed", () => {
		expect(formatUnits(BigInt(8990), 2)).toBe("89.90");
		expect(formatUnits(BigInt(5), 2)).toBe("0.05");
		expect(formatUnits(BigInt(-5), 2)).toBe("-0.05");
		expect(formatUnits(BigInt(0), 2)).toBe("0.00");
		expect(formatUnits(BigInt(1500), 0)).toBe("1500");
		expect(formatUnits(BigInt("123456789012345678901"), 3)).toBe("123456789012345678.901");
	});
});

describe("sumUnits", () => {
	it("adds signed amounts exactly, beyond the safe integer range", () => {
		expect(sumUnits([])).toBe(units(0));
		expect(sumUnits([units(8990), units(-10000), units(5)])).toBe(units(-1005));
		expect(sumUnits([units("9007199254740993"), units("9007199254740993")])).toBe(
			units("18014398509481986"),
		);
	});
});

describe("multiplyToUnits", () => {
	it("multiplies a quantity by a rate exactly, rounding once at the end", () => {
		// 123.4 km at 0.30 EUR/km
		expect(multiplyToUnits("123.4", "0.30", 2, "half_up")).toBe(units(3702));
		// 1000 JPY at 0.0061 EUR per JPY
		expect(multiplyToUnits({ units: units(1000), scale: 0 }, "0.0061", 2, "half_up")).toBe(
			units(610),
		);
	});

	it("rounds a half away from zero (half_up) or to the even neighbour (half_even)", () => {
		expect(multiplyToUnits("0.125", "1", 2, "half_up")).toBe(units(13));
		expect(multiplyToUnits("0.125", "1", 2, "half_even")).toBe(units(12));
		expect(multiplyToUnits("0.135", "1", 2, "half_even")).toBe(units(14));
		expect(multiplyToUnits("-0.125", "1", 2, "half_up")).toBe(units(-13));
		expect(multiplyToUnits("-0.125", "1", 2, "half_even")).toBe(units(-12));
		expect(multiplyToUnits("0.1249", "1", 2, "half_up")).toBe(units(12));
		expect(multiplyToUnits("-0.1251", "1", 2, "half_even")).toBe(units(-13));
	});

	it("never overflows on large amounts and long rates", () => {
		expect(multiplyToUnits("99999999999.99", "1000000.123456", 2, "half_even")).toBe(
			// 100000012345589999.99876544 rounds up to 100000012345590000.00
			units("10000001234559000000"),
		);
	});

	it("refuses an operand that is not a plain decimal", () => {
		expect(() => multiplyToUnits("1,5", "2", 2, "half_up")).toThrow(RangeError);
	});
});
describe("divideToUnits", () => {
	it("divides exactly and rounds once, for rates quoted the other way round", () => {
		// 100 USD at 1.0823 USD per EUR is 92.3958... EUR
		expect(divideToUnits("100.00", "1.0823", 2, "half_up")).toBe(units(9240));
		expect(divideToUnits("0.25", "2", 2, "half_even")).toBe(units(12));
		expect(divideToUnits("0.25", "2", 2, "half_up")).toBe(units(13));
		expect(divideToUnits("-1", "3", 2, "half_up")).toBe(units(-33));
	});

	it("refuses to divide by zero", () => {
		expect(() => divideToUnits("1", "0.00", 2, "half_up")).toThrow(RangeError);
	});
});

describe("roundToScale", () => {
	it("re-expresses a decimal at another scale, rounding only lost digits", () => {
		expect(roundToScale("6.1", 2, "half_up")).toBe(units(610));
		expect(roundToScale({ units: units(61049), scale: 4 }, 0, "half_up")).toBe(units(6));
		expect(roundToScale("2.5", 0, "half_even")).toBe(units(2));
		expect(roundToScale("2.5", 0, "half_up")).toBe(units(3));
	});
});

describe("currencyMinorUnitDigits", () => {
	it("knows each currency's minor-unit exponent", () => {
		expect(currencyMinorUnitDigits("EUR")).toBe(2);
		expect(currencyMinorUnitDigits("JPY")).toBe(0);
		expect(currencyMinorUnitDigits("KWD")).toBe(3);
	});

	it("stores every amount at two decimals, whatever the currency", () => {
		expect(STORED_AMOUNT_SCALE).toBe(2);
	});
});
