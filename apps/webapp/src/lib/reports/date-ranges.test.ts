import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatDateRangeLabel, getDateRangeForPreset } from "./date-ranges";

describe("getDateRangeForPreset", () => {
	it("resolves the current month from the organization-local current instant", () => {
		expect(
			getDateRangeForPreset("current_month", {
				timezone: "Europe/Berlin",
				now: parseInstant("2026-05-31T23:30:00Z"),
			}),
		).toEqual({ startDate: "2026-06-01", endDate: "2026-06-30" });
	});

	it("resolves last month using PlainDate arithmetic", () => {
		expect(
			getDateRangeForPreset("last_month", {
				timezone: "Pacific/Honolulu",
				now: parseInstant("2026-05-01T01:00:00Z"),
			}),
		).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-31" });
	});
});

describe("formatDateRangeLabel", () => {
	it("formats calendar dates in the requested locale", () => {
		const english = formatDateRangeLabel("2026-07-01", "2026-07-31", "en-US");
		const german = formatDateRangeLabel("2026-07-01", "2026-07-31", "de-DE");

		expect(english).toContain("Jul");
		expect(german).toContain("Juli");
		expect(german).not.toBe(english);
	});
});
