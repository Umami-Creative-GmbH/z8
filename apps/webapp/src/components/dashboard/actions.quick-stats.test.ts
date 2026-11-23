import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { calculateAdjustedExpectedHoursForRange } from "./quick-stats-calculations";

const weeklySimpleSchedule = {
	scheduleType: "simple",
	scheduleCycle: "weekly",
	hoursPerCycle: "40",
};

describe("calculateAdjustedExpectedHoursForRange", () => {
	it("preserves the legacy calendar-prorated November target instead of replacing it with weekday requirements", () => {
		expect(
			calculateAdjustedExpectedHoursForRange({
				schedule: weeklySimpleSchedule,
				start: Temporal.Instant.from("2026-11-01T00:00:00Z").toZonedDateTimeISO("UTC"),
				end: Temporal.Instant.from("2026-11-30T23:59:59Z").toZonedDateTimeISO("UTC"),
				excludedDates: new Set(),
			}),
		).toBe(171.43);
	});
	it("subtracts scheduled work hours for holidays and approved absences", () => {
		const expected = calculateAdjustedExpectedHoursForRange({
			schedule: weeklySimpleSchedule,
			start: Temporal.Instant.from("2026-05-11T00:00:00Z").toZonedDateTimeISO("UTC"),
			end: Temporal.Instant.from("2026-05-17T23:59:59Z").toZonedDateTimeISO("UTC"),
			excludedDates: new Set(["2026-05-13", "2026-05-15"]),
		});

		expect(expected).toBe(24);
	});
});
