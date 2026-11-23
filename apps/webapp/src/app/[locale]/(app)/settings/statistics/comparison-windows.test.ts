import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { comparisonWindowsAt } from "./comparison-windows";

const iso = (instant: { toString(): string }) => instant.toString();

describe("comparisonWindowsAt", () => {
	it("compares the month so far with the same elapsed span of last month", () => {
		// Nov 5, 14:00 in Berlin.
		const windows = comparisonWindowsAt(parseInstant("2026-11-05T13:00:00Z"), "Europe/Berlin");

		expect(iso(windows.current.start)).toBe("2026-10-31T23:00:00Z");
		expect(iso(windows.current.end)).toBe("2026-11-05T13:00:00Z");
		expect(windows.current.firstDay.toString()).toBe("2026-11-01");
		expect(windows.current.lastDay.toString()).toBe("2026-11-05");

		expect(iso(windows.previous.start)).toBe("2026-09-30T22:00:00Z");
		expect(iso(windows.previous.end)).toBe("2026-10-05T12:00:00Z");
		expect(windows.previous.firstDay.toString()).toBe("2026-10-01");
		expect(windows.previous.lastDay.toString()).toBe("2026-10-05");
	});

	it("compares the end of a longer month with all of the shorter month before it", () => {
		// Mar 31, 10:00 in Berlin; February 2026 has 28 days.
		const windows = comparisonWindowsAt(parseInstant("2026-03-31T08:00:00Z"), "Europe/Berlin");

		expect(iso(windows.previous.start)).toBe("2026-01-31T23:00:00Z");
		expect(iso(windows.previous.end)).toBe("2026-02-28T23:00:00Z");
		expect(windows.previous.firstDay.toString()).toBe("2026-02-01");
		expect(windows.previous.lastDay.toString()).toBe("2026-02-28");
	});

	it("keeps the same day and time when last month has that day", () => {
		const windows = comparisonWindowsAt(parseInstant("2026-03-28T08:00:00Z"), "Europe/Berlin");

		expect(iso(windows.previous.end)).toBe("2026-02-28T08:00:00Z");
		expect(windows.previous.lastDay.toString()).toBe("2026-02-28");
	});

	it("reads the month in the organization's zone, not UTC", () => {
		// Still February 28 in New York while March has begun in UTC.
		const windows = comparisonWindowsAt(parseInstant("2026-03-01T03:00:00Z"), "America/New_York");

		expect(windows.current.firstDay.toString()).toBe("2026-02-01");
		expect(windows.current.lastDay.toString()).toBe("2026-02-28");
		expect(windows.previous.firstDay.toString()).toBe("2026-01-01");
		expect(windows.previous.lastDay.toString()).toBe("2026-01-28");
	});
});
