import { describe, expect, it } from "vitest";
import { toAnalyticsDateRange } from "./date-ranges";

describe("toAnalyticsDateRange", () => {
	it("adapts report calendar strings to the legacy inclusive Date range", () => {
		const range = toAnalyticsDateRange({ startDate: "2026-03-29", endDate: "2026-03-29" });

		expect(range.start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-03-29T23:59:59.999Z");
	});

	it("preserves Berlin daylight-saving boundaries for legacy Date consumers", () => {
		const range = toAnalyticsDateRange(
			{ startDate: "2026-03-29", endDate: "2026-03-29" },
			"Europe/Berlin",
		);

		expect(range.start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-03-29T21:59:59.999Z");
	});

	it("preserves Berlin calendar metadata alongside May 1 boundary instants", () => {
		const range = toAnalyticsDateRange(
			{ startDate: "2026-05-01", endDate: "2026-05-01" },
			"Europe/Berlin",
		);

		expect(range).toMatchObject({
			startDate: "2026-05-01",
			endDate: "2026-05-01",
			timezone: "Europe/Berlin",
		});
		expect(range.start.toISOString()).toBe("2026-04-30T22:00:00.000Z");
	});
});
