import { describe, expect, it } from "vitest";

import {
	clampOvertime,
	weekOverWeekDelta,
	weekStartIso,
} from "../overtime-burndown";

describe("overtime burndown helpers", () => {
	it("clampOvertime caps negatives at zero and passes through positives", () => {
		expect(clampOvertime(-5)).toBe(0);
		expect(clampOvertime(0)).toBe(0);
		expect(clampOvertime(7.5)).toBe(7.5);
	});

	it("weekStartIso returns Monday bucket for 2026-02-19T10:00:00Z", () => {
		expect(weekStartIso(new Date("2026-02-19T10:00:00Z"))).toBe("2026-02-16");
	});

	it("weekOverWeekDelta returns expected delta and default for short arrays", () => {
		expect(weekOverWeekDelta([40, 32])).toBe(-8);
		expect(weekOverWeekDelta([])).toBe(0);
		expect(weekOverWeekDelta([40])).toBe(0);
	});
});
