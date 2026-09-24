import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { departureCutoff } from "./cutoff";

const JANUARY = parseInstant("2026-01-01T00:00:00Z");

describe("departureCutoff", () => {
	it.each([
		// Spring forward: the following day starts at 00:00 CEST (+02:00).
		["2026-03-28", "Europe/Berlin", "2026-03-28T23:00:00Z"],
		["2026-03-29", "Europe/Berlin", "2026-03-29T22:00:00Z"],
		// Fall back: the following day starts at 00:00 CET (+01:00).
		["2026-10-25", "Europe/Berlin", "2026-10-25T23:00:00Z"],
		["2026-09-14", "UTC", "2026-09-15T00:00:00Z"],
		// Chile skips local midnight on 2026-09-06; the day starts at 01:00 -03:00.
		["2026-09-05", "America/Santiago", "2026-09-06T04:00:00Z"],
	])("ends %s in %s at %s", (lastWorkingDay, timezone, expected) => {
		const result = departureCutoff({ lastWorkingDay, timezone, now: JANUARY });

		expect(result.cutoff.toString()).toBe(expected);
		expect(result).toMatchObject({ lastWorkingDay, timezone });
	});

	it("resolves a missing organization timezone to UTC", () => {
		const result = departureCutoff({
			lastWorkingDay: "2026-09-14",
			timezone: null,
			now: JANUARY,
		});

		expect(result.timezone).toBe("UTC");
		expect(result.cutoff.toString()).toBe("2026-09-15T00:00:00Z");
	});

	it("allows today in the organization zone even when UTC is already tomorrow", () => {
		const result = departureCutoff({
			lastWorkingDay: "2026-09-14",
			timezone: "America/New_York",
			now: parseInstant("2026-09-15T02:00:00Z"),
		});

		expect(result.cutoff.toString()).toBe("2026-09-15T04:00:00Z");
	});

	it("rejects a past local date", () => {
		expect(() =>
			departureCutoff({
				lastWorkingDay: "2026-09-13",
				timezone: "Europe/Berlin",
				now: parseInstant("2026-09-14T00:00:00Z"),
			}),
		).toThrow("departure_date_in_past");
	});

	it("rejects invalid zones instead of falling back", () => {
		expect(() =>
			departureCutoff({
				lastWorkingDay: "2026-09-14",
				timezone: "Invalid/Zone",
				now: JANUARY,
			}),
		).toThrow();
	});

	it("rejects malformed dates", () => {
		expect(() =>
			departureCutoff({ lastWorkingDay: "2026-02-30", timezone: "UTC", now: JANUARY }),
		).toThrow();
	});
});
