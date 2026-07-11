import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { getWeekDateRange, plainDateTimeToDateKey, shiftToEvent } from "./shift-scheduler-utils";

describe("scheduler calendar primitives", () => {
	it("keeps Berlin schedule dates stable when the browser runs in Honolulu", () => {
		const range = getWeekDateRange("2026-07-08");

		expect(range).toEqual({ startDate: "2026-07-05", endDateExclusive: "2026-07-12" });
		expect(plainDateTimeToDateKey(Temporal.PlainDateTime.from("2026-07-08T09:30"))).toBe(
			"2026-07-08",
		);
	});

	it("creates Schedule-X event wall times from the stored calendar date", () => {
		const event = shiftToEvent({
			id: "shift-1",
			organizationId: "org-1",
			date: new Date("2026-07-07T22:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
			status: "draft",
			employeeId: null,
			templateId: null,
			subareaId: "subarea-1",
			recurrenceId: null,
			publishedAt: null,
			publishedBy: null,
			notes: null,
			color: null,
			createdAt: new Date("2026-07-01T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-07-01T00:00:00.000Z"),
		});

		expect(event.start.toString()).toBe("2026-07-08T09:00:00");
		expect(event.end.toString()).toBe("2026-07-08T17:00:00");
	});
});
