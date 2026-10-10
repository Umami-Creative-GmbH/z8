import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { toUpcomingShift, upcomingShiftWindow } from "./upcoming-shifts";

describe("upcomingShiftWindow", () => {
	it("starts at the organization's today, not the UTC date, just after its midnight", () => {
		// 00:30 on 2026-10-09 in Berlin, still 2026-10-08 in UTC.
		const window = upcomingShiftWindow(
			Temporal.Instant.from("2026-10-08T22:30:00Z"),
			"Europe/Berlin",
		);

		expect(window).toEqual({
			today: "2026-10-09",
			todayStart: new Date("2026-10-08T22:00:00Z"),
			tomorrowStart: new Date("2026-10-09T22:00:00Z"),
			currentTime: "00:30",
		});
	});

	it("reads the wall time in the organization's zone west of UTC", () => {
		// 23:45 on 2026-10-09 in New York, already 2026-10-10 in UTC.
		const window = upcomingShiftWindow(
			Temporal.Instant.from("2026-10-10T03:45:00Z"),
			"America/New_York",
		);

		expect(window.today).toBe("2026-10-09");
		expect(window.currentTime).toBe("23:45");
		expect(window.todayStart).toEqual(new Date("2026-10-09T04:00:00Z"));
	});
});

describe("toUpcomingShift", () => {
	it("keys a shift stored at Berlin midnight by its Berlin calendar date", () => {
		const shift = toUpcomingShift(
			{
				id: "shift-1",
				date: new Date("2026-10-08T22:00:00Z"),
				startTime: "22:00",
				endTime: "06:00",
				notes: "Night delivery",
				subarea: { name: "Floor", location: { name: "Store" } },
			},
			"Europe/Berlin",
		);

		expect(shift).toEqual({
			id: "shift-1",
			date: "2026-10-09",
			startTime: "22:00",
			endTime: "06:00",
			notes: "Night delivery",
			subareaName: "Floor",
			locationName: "Store",
		});
	});

	it("keeps a shift without a loaded subarea", () => {
		const shift = toUpcomingShift(
			{
				id: "shift-2",
				date: new Date("2026-10-09T00:00:00Z"),
				startTime: "08:00",
				endTime: "16:00",
				notes: null,
				subarea: null,
			},
			"UTC",
		);

		expect(shift).toMatchObject({ date: "2026-10-09", subareaName: null, locationName: null });
	});
});
