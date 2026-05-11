import { describe, expect, it } from "vitest";
import { calculatePresenceStatusCounts } from "./presence-status";

describe("calculatePresenceStatusCounts", () => {
	it("does not let an office day satisfy a different fixed on-site day", () => {
		const counts = calculatePresenceStatusCounts({
			presenceMode: "fixed_days",
			requiredOnsiteDays: null,
			requiredOnsiteFixedDays: ["friday"],
			workPeriods: [
				{
					startTime: new Date("2026-05-04T09:00:00.000Z"), // Monday
					workLocationType: "office",
				},
			],
		});

		expect(counts).toEqual({ actual: 0, required: 1 });
	});
});
