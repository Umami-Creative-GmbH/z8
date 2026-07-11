import { describe, expect, it } from "vitest";
import { resolveScheduleDateRange, resolveScheduleWallTime } from "./schedule-local-input";

describe("schedule-local input", () => {
	it("uses Berlin local half-open boundaries independently of the browser zone", () => {
		const range = resolveScheduleDateRange(
			{ startDate: "2026-07-08", endDateExclusive: "2026-07-09" },
			"Europe/Berlin",
		);

		expect(range.start.toString()).toBe("2026-07-07T22:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-07-08T22:00:00Z");
	});

	it("rejects a New York spring gap and fall fold instead of silently coercing schedule wall time", () => {
		expect(() =>
			resolveScheduleWallTime({ date: "2026-03-08", time: "02:30" }, "America/New_York"),
		).toThrow(/does not exist/);
		expect(() =>
			resolveScheduleWallTime({ date: "2026-11-01", time: "01:30" }, "America/New_York"),
		).toThrow(/ambiguous/);
	});

	it("rejects ISO timestamps and invalid organization zones as calendar input", () => {
		expect(() =>
			resolveScheduleDateRange(
				{ startDate: "2026-07-08T00:00:00.000Z", endDateExclusive: "2026-07-09" },
				"Europe/Berlin",
			),
		).toThrow(/YYYY-MM-DD/);
		expect(() =>
			resolveScheduleWallTime({ date: "2026-07-08", time: "09:00" }, "Invalid/Zone"),
		).toThrow(/Invalid timezone/);
	});
});
