import { describe, expect, it } from "vitest";
import { workPeriodEntryTimesOf } from "./entry-times";

describe("workPeriodEntryTimesOf", () => {
	it("keeps each endpoint at the offset stored on its own entry", () => {
		const clockIn = { timestamp: new Date("2026-05-11T07:15:00Z"), utcOffsetMinutes: 120 };
		const clockOut = { timestamp: new Date("2026-05-11T15:00:00Z"), utcOffsetMinutes: -240 };

		expect(workPeriodEntryTimesOf(clockIn, clockOut)).toEqual({
			clockIn: { at: clockIn.timestamp, utcOffsetMinutes: 120 },
			clockOut: { at: clockOut.timestamp, utcOffsetMinutes: -240 },
		});
	});

	it("has no clock-out for an open period", () => {
		const clockIn = { timestamp: new Date("2026-05-11T07:15:00Z"), utcOffsetMinutes: 0 };

		expect(workPeriodEntryTimesOf(clockIn, undefined).clockOut).toBeNull();
		expect(workPeriodEntryTimesOf(clockIn, null).clockOut).toBeNull();
	});
});
