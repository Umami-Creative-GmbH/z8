import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { fullNoticeDays, notificationDay, shiftNotificationInstant } from "./notice";

describe("§ 12 Abs. 3 TzBfG notice", () => {
	it("counts the full days between notification day and shift day, both excluded", () => {
		const monday = Temporal.PlainDate.from("2026-03-02");
		expect(fullNoticeDays(monday, Temporal.PlainDate.from("2026-03-07"))).toBe(4);
		expect(fullNoticeDays(monday, Temporal.PlainDate.from("2026-03-06"))).toBe(3);
		expect(fullNoticeDays(monday, monday)).toBe(-1);
	});

	it("reads the notification day in the organization's zone", () => {
		const instant = Temporal.Instant.from("2026-03-25T23:30:00Z");
		expect(notificationDay(instant, "Europe/Berlin").toString()).toBe("2026-03-26");
		expect(notificationDay(instant, "UTC").toString()).toBe("2026-03-25");
	});

	it("announces drafts now and published shifts at publication or their later change", () => {
		const now = Temporal.Instant.from("2026-03-04T10:00:00Z");
		const published = Temporal.Instant.from("2026-02-20T09:00:00Z");
		const changedBefore = Temporal.Instant.from("2026-02-10T09:00:00Z");
		const changedAfter = Temporal.Instant.from("2026-03-01T09:00:00Z");
		expect(
			shiftNotificationInstant(
				{ status: "draft", publishedAt: null, assignmentChangedAt: changedAfter },
				now,
			),
		).toEqual(now);
		expect(
			shiftNotificationInstant(
				{ status: "published", publishedAt: published, assignmentChangedAt: changedBefore },
				now,
			),
		).toEqual(published);
		expect(
			shiftNotificationInstant(
				{ status: "published", publishedAt: published, assignmentChangedAt: changedAfter },
				now,
			),
		).toEqual(changedAfter);
	});
});
