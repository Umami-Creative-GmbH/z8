import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { projectDeadlineFromTemplateOffset } from "./project-template-deadline";

const at = (value: string) => Temporal.Instant.from(value);

describe("projectDeadlineFromTemplateOffset", () => {
	it("adds the offset to today's calendar date in the organization's timezone", () => {
		expect(
			projectDeadlineFromTemplateOffset({
				now: at("2026-03-10T09:00:00Z"),
				timezone: "Europe/Berlin",
				offsetDays: 30,
			}),
		).toEqual(new Date("2026-04-09T00:00:00Z"));
	});

	it("uses the organization's date, not the UTC date, around midnight", () => {
		// 23:30 UTC on 28 March is already 29 March in Berlin, and still 28 March in New York.
		const now = at("2026-03-28T23:30:00Z");

		expect(
			projectDeadlineFromTemplateOffset({ now, timezone: "Europe/Berlin", offsetDays: 1 }),
		).toEqual(new Date("2026-03-30T00:00:00Z"));
		expect(
			projectDeadlineFromTemplateOffset({ now, timezone: "America/New_York", offsetDays: 1 }),
		).toEqual(new Date("2026-03-29T00:00:00Z"));
	});

	it("keeps the creation date for a zero offset and counts calendar days across month ends", () => {
		const now = at("2026-01-31T12:00:00Z");

		expect(projectDeadlineFromTemplateOffset({ now, timezone: "UTC", offsetDays: 0 })).toEqual(
			new Date("2026-01-31T00:00:00Z"),
		);
		expect(projectDeadlineFromTemplateOffset({ now, timezone: "UTC", offsetDays: 29 })).toEqual(
			new Date("2026-03-01T00:00:00Z"),
		);
	});

	it("has no deadline without an offset", () => {
		expect(
			projectDeadlineFromTemplateOffset({
				now: at("2026-03-10T09:00:00Z"),
				timezone: "UTC",
				offsetDays: null,
			}),
		).toBe(null);
	});
});
