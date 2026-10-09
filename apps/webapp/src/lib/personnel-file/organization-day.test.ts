import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { todayInOrganization } from "./organization-day";

describe("todayInOrganization", () => {
	it("is the calendar day in the organization's timezone, not UTC", () => {
		const lateEvening = Temporal.Instant.from("2026-03-01T23:30:00Z");
		const berlin = todayInOrganization(lateEvening, "Europe/Berlin");
		expect(berlin).toBeInstanceOf(Temporal.PlainDate);
		expect(berlin.toString()).toBe("2026-03-02");
		expect(todayInOrganization(lateEvening, "America/New_York").toString()).toBe("2026-03-01");
	});

	it("falls back to UTC for an unknown timezone", () => {
		const instant = Temporal.Instant.from("2026-03-01T23:30:00Z");
		expect(todayInOrganization(instant, "Mars/Olympus").toString()).toBe("2026-03-01");
	});
});
