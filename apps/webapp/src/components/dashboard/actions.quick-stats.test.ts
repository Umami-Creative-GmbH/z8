import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { calculateAdjustedExpectedHoursForRange } from "./quick-stats-calculations";

const weeklySimpleSchedule = {
	scheduleType: "simple",
	scheduleCycle: "weekly",
	hoursPerCycle: "40",
};

describe("calculateAdjustedExpectedHoursForRange", () => {
	it("subtracts scheduled work hours for holidays and approved absences", () => {
		const expected = calculateAdjustedExpectedHoursForRange({
			schedule: weeklySimpleSchedule,
			start: DateTime.fromISO("2026-05-11T00:00:00Z"),
			end: DateTime.fromISO("2026-05-17T23:59:59Z"),
			excludedDates: new Set(["2026-05-13", "2026-05-15"]),
		});

		expect(expected).toBe(24);
	});
});
