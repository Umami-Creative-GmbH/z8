import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	calendarRangeToDateRange,
	employeeScheduleWeek,
	employeeShiftEvent,
	groupShiftsByDay,
} from "./employee-schedule-utils";

function shift(overrides: Partial<ShiftWithRelations>): ShiftWithRelations {
	return {
		id: "shift",
		organizationId: "org-1",
		employeeId: "employee-1",
		templateId: null,
		subareaId: "subarea-1",
		recurrenceId: null,
		date: new Date("2026-10-08T22:00:00Z"),
		startTime: "08:00",
		endTime: "16:00",
		status: "published",
		publishedAt: null,
		publishedBy: null,
		notes: null,
		color: null,
		createdAt: new Date("2026-10-01T00:00:00Z"),
		createdBy: "user-1",
		updatedAt: new Date("2026-10-01T00:00:00Z"),
		...overrides,
	} as ShiftWithRelations;
}

describe("employeeScheduleWeek", () => {
	it("starts the week on the viewer's preferred Monday", () => {
		const week = employeeScheduleWeek(Temporal.PlainDate.from("2026-10-09"), "monday");

		expect(week.days.map(String)).toEqual([
			"2026-10-05",
			"2026-10-06",
			"2026-10-07",
			"2026-10-08",
			"2026-10-09",
			"2026-10-10",
			"2026-10-11",
		]);
		expect(week.dateRange).toEqual({ startDate: "2026-10-05", endDateExclusive: "2026-10-12" });
	});

	it("starts the week on Sunday, including when the anchor is a Sunday", () => {
		const week = employeeScheduleWeek(Temporal.PlainDate.from("2026-10-11"), "sunday");

		expect(week.dateRange).toEqual({ startDate: "2026-10-11", endDateExclusive: "2026-10-18" });
	});
});

describe("groupShiftsByDay", () => {
	it("puts a shift stored at Berlin midnight on its Berlin day, ordered by start time", () => {
		const days = employeeScheduleWeek(Temporal.PlainDate.from("2026-10-09"), "monday").days;
		const late = shift({ id: "late", startTime: "22:00", endTime: "06:00" });
		const early = shift({ id: "early", startTime: "00:30", endTime: "06:00" });

		const grouped = groupShiftsByDay([late, early], days, "Europe/Berlin");

		expect(grouped.map((day) => [day.date.toString(), day.shifts.map((s) => s.id)])).toEqual([
			["2026-10-05", []],
			["2026-10-06", []],
			["2026-10-07", []],
			["2026-10-08", []],
			["2026-10-09", ["early", "late"]],
			["2026-10-10", []],
			["2026-10-11", []],
		]);
	});

	it("leaves out shifts outside the week", () => {
		const days = employeeScheduleWeek(Temporal.PlainDate.from("2026-10-09"), "monday").days;

		const grouped = groupShiftsByDay(
			[shift({ date: new Date("2026-10-11T22:00:00Z") })],
			days,
			"Europe/Berlin",
		);

		expect(grouped.every((day) => day.shifts.length === 0)).toBe(true);
	});
});

describe("calendarRangeToDateRange", () => {
	it("covers every organization day the calendar shows, through its last day", () => {
		expect(
			calendarRangeToDateRange({
				start: Temporal.ZonedDateTime.from("2026-10-05T00:00:00+02:00[Europe/Berlin]"),
				end: Temporal.ZonedDateTime.from("2026-10-11T23:59:59.999+02:00[Europe/Berlin]"),
			}),
		).toEqual({ startDate: "2026-10-05", endDateExclusive: "2026-10-12" });
	});
});

describe("employeeShiftEvent", () => {
	it("places a night shift in the organization's zone, ending the next morning", () => {
		const event = employeeShiftEvent(
			shift({
				id: "night",
				startTime: "22:00",
				endTime: "06:00",
				subarea: { id: "s", name: "Floor", location: { id: "l", name: "Store" } },
			}),
			"Europe/Berlin",
			"Shift",
		);

		expect(event.start).toBeInstanceOf(Temporal.ZonedDateTime);
		expect(event.start.toString()).toBe("2026-10-09T22:00:00+02:00[Europe/Berlin]");
		expect(event.end.toString()).toBe("2026-10-10T06:00:00+02:00[Europe/Berlin]");
		expect(event).toMatchObject({ id: "night", title: "Store · Floor", calendarId: "published" });
	});

	it("falls back to the given title without a place", () => {
		expect(employeeShiftEvent(shift({ subarea: null }), "Europe/Berlin", "Shift").title).toBe(
			"Shift",
		);
	});
});
