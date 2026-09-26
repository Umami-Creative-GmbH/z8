import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { departureCutoffDate, formatDepartureCutoff } from "./cutoff-display";

describe("departure cutoff display", () => {
	it("formats the cutoff in the departure's zone, not the viewer's", () => {
		const cutoff = "2026-03-31T22:00:00Z";

		expect(formatDepartureCutoff(cutoff, "Europe/Berlin", "en-US")).toBe("Apr 1, 2026, 12:00 AM");
		expect(formatDepartureCutoff(cutoff, "America/New_York", "en-US")).toBe(
			"Mar 31, 2026, 6:00 PM",
		);
	});

	it("accepts a Temporal instant", () => {
		const cutoff = Temporal.Instant.from("2026-03-31T22:00:00Z");

		expect(formatDepartureCutoff(cutoff, "Europe/Berlin", "de-DE")).toBe("01.04.2026, 00:00");
	});

	it("derives the zoned calendar date across the UTC day boundary", () => {
		expect(departureCutoffDate("2026-03-31T22:00:00Z", "Europe/Berlin")).toBe("2026-04-01");
		expect(departureCutoffDate("2026-03-31T22:00:00Z", "America/New_York")).toBe("2026-03-31");
	});
});
