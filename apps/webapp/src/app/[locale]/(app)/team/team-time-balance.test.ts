import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculateBalanceMinutes,
	calculateDayAbsenceAdjustmentMinutes,
	formatSignedBalance,
	getCurrentYearRange,
} from "./team-time-balance";

describe("team time balance helpers", () => {
	it("returns the current calendar year range", () => {
		const range = getCurrentYearRange(DateTime.fromISO("2026-05-18T12:00:00", { zone: "utc" }));
		expect(range.year).toBe(2026);
		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("calculates positive, negative, and zero balances", () => {
		expect(calculateBalanceMinutes({ actualMinutes: 2520, expectedMinutes: 2400, absenceAdjustedMinutes: 0 })).toBe(120);
		expect(calculateBalanceMinutes({ actualMinutes: 2100, expectedMinutes: 2400, absenceAdjustedMinutes: 0 })).toBe(-300);
		expect(calculateBalanceMinutes({ actualMinutes: 2100, expectedMinutes: 2400, absenceAdjustedMinutes: 300 })).toBe(0);
	});

	it("never lets absence adjustment make expected minutes negative", () => {
		expect(calculateBalanceMinutes({ actualMinutes: 60, expectedMinutes: 240, absenceAdjustedMinutes: 480 })).toBe(60);
	});

	it("adjusts full and half-day absences by expected day minutes", () => {
		expect(calculateDayAbsenceAdjustmentMinutes(480, "full_day")).toBe(480);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "am")).toBe(240);
		expect(calculateDayAbsenceAdjustmentMinutes(480, "pm")).toBe(240);
	});

	it("formats signed balances for display", () => {
		expect(formatSignedBalance(750)).toBe("+12h 30m");
		expect(formatSignedBalance(-255)).toBe("-4h 15m");
		expect(formatSignedBalance(0)).toBe("0h");
	});
});
