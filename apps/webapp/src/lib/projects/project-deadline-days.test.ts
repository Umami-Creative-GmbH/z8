import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { daysUntilProjectDeadline, projectDeadlineDay } from "./project-deadline-days";

// The deadline day 10 May 2026, stored as its UTC midnight.
const deadline = new Date("2026-05-10T00:00:00.000Z");

function daysAt(instant: string, timeZone: string) {
	return daysUntilProjectDeadline({ deadline, now: Temporal.Instant.from(instant), timeZone });
}

describe("projectDeadlineDay", () => {
	it("reads the deadline day in UTC", () => {
		expect(projectDeadlineDay(deadline).toString()).toBe("2026-05-10");
	});
});

describe("daysUntilProjectDeadline", () => {
	it("counts from the organization's calendar date at 23:30 UTC", () => {
		// 01:30 on 10 May in Berlin, 19:30 on 9 May in New York.
		expect(daysAt("2026-05-09T23:30:00Z", "Europe/Berlin")).toBe(0);
		expect(daysAt("2026-05-09T23:30:00Z", "America/New_York")).toBe(1);
		expect(daysAt("2026-05-09T23:30:00Z", "UTC")).toBe(1);
	});

	it("turns over at the organization's midnight, not UTC's", () => {
		// Berlin is UTC+2 in May: its 10 May starts at 22:00 UTC on 9 May.
		expect(daysAt("2026-05-09T21:59:59Z", "Europe/Berlin")).toBe(1);
		expect(daysAt("2026-05-09T22:00:00Z", "Europe/Berlin")).toBe(0);
		// New York is UTC-4 in May: its 10 May starts at 04:00 UTC on 10 May.
		expect(daysAt("2026-05-10T03:59:59Z", "America/New_York")).toBe(1);
		expect(daysAt("2026-05-10T04:00:00Z", "America/New_York")).toBe(0);
	});

	it("goes negative once the deadline day has passed in the organization", () => {
		// 01:30 on 11 May in Berlin, 19:30 on 10 May in New York.
		expect(daysAt("2026-05-10T23:30:00Z", "Europe/Berlin")).toBe(-1);
		expect(daysAt("2026-05-10T23:30:00Z", "America/New_York")).toBe(0);
	});

	it("counts whole calendar days across a DST change", () => {
		// Berlin springs forward on 29 March 2026; 23-hour days still count as one.
		expect(daysAt("2026-03-25T23:30:00Z", "Europe/Berlin")).toBe(45);
		expect(daysAt("2026-03-25T23:30:00Z", "America/New_York")).toBe(46);
	});
});
