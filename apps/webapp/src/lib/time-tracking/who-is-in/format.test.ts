import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatPresenceSince } from "./format";

describe("formatPresenceSince", () => {
	const now = parseInstant("2026-10-10T12:00:00Z");

	it("shows only the time for a start earlier the same local day, in the captured zone", () => {
		// Whether the 24-hour hour is zero-padded depends on the runtime's Intl/Temporal
		// (Node 24 "8:30", Node 26 "08:30"); the captured zone is what this pins.
		expect(
			formatPresenceSince(parseInstant("2026-10-10T06:30:00Z"), "+02:00", {
				locale: "de",
				timeFormat: "24h",
				now,
			}),
		).toMatch(/^0?8:30$/);
		expect(
			formatPresenceSince(parseInstant("2026-10-10T10:15:00Z"), "Europe/Berlin", {
				locale: "en",
				timeFormat: "12h",
				now,
			}),
		).toBe("12:15 PM");
	});

	it("adds the date when the start was on an earlier local day", () => {
		expect(
			formatPresenceSince(parseInstant("2026-10-09T20:00:00Z"), "UTC", {
				locale: "en",
				timeFormat: "24h",
				now,
			}),
		).toBe("Oct 9, 2026, 20:00");
	});
});
