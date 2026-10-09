import { describe, expect, it } from "vitest";
import {
	accrueAmount,
	addAccruedAmounts,
	formatRate,
	parseRate,
	roundAccruedAmount,
	ZERO_ACCRUED,
} from "./money";

const HOUR_MS = 3_600_000;

describe("billable rate input", () => {
	it("reads an hourly rate as exact cents, with a decimal point or comma", () => {
		expect(parseRate("85.50")).toEqual({ ok: true, units: BigInt(8550) });
		expect(parseRate(" 120,5 ")).toEqual({ ok: true, units: BigInt(12050) });
		expect(parseRate("95")).toEqual({ ok: true, units: BigInt(9500) });
	});

	it("refuses anything that is not a positive amount of whole cents", () => {
		expect(parseRate("")).toEqual({ ok: false, reason: "invalid" });
		expect(parseRate("abc")).toEqual({ ok: false, reason: "invalid" });
		expect(parseRate("1.234,50")).toEqual({ ok: false, reason: "invalid" });
		expect(parseRate("85.505")).toEqual({ ok: false, reason: "invalid" });
		expect(parseRate("0")).toEqual({ ok: false, reason: "not_positive" });
		expect(parseRate("-10")).toEqual({ ok: false, reason: "not_positive" });
		expect(parseRate("1000000")).toEqual({ ok: false, reason: "too_large" });
	});

	it("writes rates as two-decimal strings for the database and the wire", () => {
		expect(formatRate(BigInt(8550))).toBe("85.50");
		expect(formatRate(BigInt(7))).toBe("0.07");
	});
});

describe("amounts for elapsed time", () => {
	it("prices whole hours exactly", () => {
		expect(roundAccruedAmount(accrueAmount(BigInt(8550), 2 * HOUR_MS))).toBe(BigInt(17100));
	});

	it("rounds once per aggregate, half up to the cent", () => {
		// 20 minutes at 100.00/h is 33.333… each; three of them are exactly 100.00.
		const third = accrueAmount(BigInt(10000), 20 * 60_000);
		expect(roundAccruedAmount(third)).toBe(BigInt(3333));
		expect(roundAccruedAmount(addAccruedAmounts([third, third, third]))).toBe(BigInt(10000));
		// 1.5 minutes at 1.00/h is 2.5 cents: half up.
		expect(roundAccruedAmount(accrueAmount(BigInt(100), 90_000))).toBe(BigInt(3));
		expect(roundAccruedAmount(ZERO_ACCRUED)).toBe(BigInt(0));
	});

	it("refuses fractional or negative milliseconds", () => {
		expect(() => accrueAmount(BigInt(100), 1.5)).toThrow(RangeError);
		expect(() => accrueAmount(BigInt(100), -1)).toThrow(RangeError);
	});
});
