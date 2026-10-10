import { Temporal } from "temporal-polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	calendarRangeToDateRange,
	eventToShiftTimes,
	filterShiftsForEmployee,
	getWeekDateRange,
	initialSchedulerView,
	parseSchedulerFocus,
	scheduleXFirstDayOfWeek,
	shiftToEvent,
} from "./shift-scheduler-utils";

function shift(overrides: Partial<ShiftWithRelations> = {}): ShiftWithRelations {
	return {
		id: "shift-1",
		organizationId: "org-1",
		// Berlin 2026-07-08, stored as its local midnight.
		date: new Date("2026-07-07T22:00:00.000Z"),
		startTime: "09:00",
		endTime: "17:00",
		status: "published",
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
		...overrides,
	};
}

describe("planner events for Schedule-X", () => {
	it("places wall times on the shift's organization-local date as ZonedDateTime", () => {
		const event = shiftToEvent(shift({ status: "draft" }), "Europe/Berlin");

		// Schedule-X 4 calls withTimeZone on every timed event; PlainDateTime has none.
		expect(event.start).toBeInstanceOf(Temporal.ZonedDateTime);
		expect(event.end).toBeInstanceOf(Temporal.ZonedDateTime);
		expect(event.start.toString()).toBe("2026-07-08T09:00:00+02:00[Europe/Berlin]");
		expect(event.end.toString()).toBe("2026-07-08T17:00:00+02:00[Europe/Berlin]");
		expect(event.calendarId).toBe("open");
		expect(event.title).toBe("[Draft] Open Shift");
	});

	it("reads the stored date in the organization's zone, not in UTC", () => {
		// New York 2026-07-08 is stored as 04:00Z on the same UTC day; Tokyo's as 15:00Z the day before.
		const newYork = shiftToEvent(
			shift({ date: new Date("2026-07-08T04:00:00.000Z") }),
			"America/New_York",
		);
		const tokyo = shiftToEvent(shift({ date: new Date("2026-07-07T15:00:00.000Z") }), "Asia/Tokyo");

		expect(newYork.start.toString()).toBe("2026-07-08T09:00:00-04:00[America/New_York]");
		expect(tokyo.start.toString()).toBe("2026-07-08T09:00:00+09:00[Asia/Tokyo]");
	});

	it("ends an overnight shift on the next day", () => {
		const overnight = shiftToEvent(
			shift({ startTime: "22:00", endTime: "06:00" }),
			"Europe/Berlin",
		);
		const fullDay = shiftToEvent(shift({ startTime: "08:00", endTime: "08:00" }), "Europe/Berlin");

		expect(overnight.start.toString()).toBe("2026-07-08T22:00:00+02:00[Europe/Berlin]");
		expect(overnight.end.toString()).toBe("2026-07-09T06:00:00+02:00[Europe/Berlin]");
		expect(fullDay.end.toString()).toBe("2026-07-09T08:00:00+02:00[Europe/Berlin]");
	});

	it("keeps an overnight shift's real length across a DST change", () => {
		// Berlin falls back on 2026-10-25 at 03:00, so 22:00 to 06:00 lasts nine hours.
		const event = shiftToEvent(
			shift({ date: new Date("2026-10-23T22:00:00.000Z"), startTime: "22:00", endTime: "06:00" }),
			"Europe/Berlin",
		);

		expect(event.start.until(event.end).total("hours")).toBe(9);
	});

	it("titles assigned shifts by employee name and colors them by status", () => {
		const event = shiftToEvent(
			shift({
				employeeId: "employee-1",
				employee: { firstName: "Ada", lastName: "Lovelace" } as ShiftWithRelations["employee"],
			}),
			"Europe/Berlin",
		);

		expect(event.title).toBe("Ada Lovelace");
		expect(event.calendarId).toBe("published");
	});
});

describe("moved planner events back to shift times", () => {
	it("reads the dropped date and wall times in the organization's zone", () => {
		const moved = {
			start: Temporal.ZonedDateTime.from("2026-07-10T08:30:00+02:00[Europe/Berlin]"),
			end: Temporal.ZonedDateTime.from("2026-07-10T16:30:00+02:00[Europe/Berlin]"),
		};

		expect(eventToShiftTimes(moved, "Europe/Berlin")).toEqual({
			date: "2026-07-10",
			startTime: "08:30",
			endTime: "16:30",
		});
	});

	it("converts an event reported in another zone to the organization's", () => {
		const moved = {
			start: Temporal.ZonedDateTime.from("2026-07-09T23:00:00+00:00[UTC]"),
			end: Temporal.ZonedDateTime.from("2026-07-10T07:00:00+00:00[UTC]"),
		};

		expect(eventToShiftTimes(moved, "Europe/Berlin")).toEqual({
			date: "2026-07-10",
			startTime: "01:00",
			endTime: "09:00",
		});
	});

	it("keeps an overnight shift on its start date after a round trip", () => {
		const original = shift({ startTime: "22:00", endTime: "06:00" });
		const event = shiftToEvent(original, "Europe/Berlin");
		const moved = { start: event.start.add({ days: 2 }), end: event.end.add({ days: 2 }) };

		expect(eventToShiftTimes(moved, "Europe/Berlin")).toEqual({
			date: "2026-07-10",
			startTime: "22:00",
			endTime: "06:00",
		});
	});
});

describe("scheduler ranges", () => {
	it("starts the week on the viewer's week start day", () => {
		// 2026-07-08 is a Wednesday.
		expect(getWeekDateRange("2026-07-08", "sunday")).toEqual({
			startDate: "2026-07-05",
			endDateExclusive: "2026-07-12",
		});
		expect(getWeekDateRange("2026-07-08", "monday")).toEqual({
			startDate: "2026-07-06",
			endDateExclusive: "2026-07-13",
		});
		// The start day itself opens its own week.
		expect(getWeekDateRange("2026-07-05", "sunday").startDate).toBe("2026-07-05");
		expect(getWeekDateRange("2026-07-05", "monday").startDate).toBe("2026-06-29");
	});

	it("maps the week start to Schedule-X's first day of week", () => {
		expect(scheduleXFirstDayOfWeek("monday")).toBe(1);
		expect(scheduleXFirstDayOfWeek("sunday")).toBe(7);
	});

	it("includes the last day Schedule-X shows", () => {
		const range = {
			start: Temporal.ZonedDateTime.from("2026-07-06T00:00:00+02:00[Europe/Berlin]"),
			end: Temporal.ZonedDateTime.from("2026-07-12T23:59:00+02:00[Europe/Berlin]"),
		};

		expect(calendarRangeToDateRange(range)).toEqual({
			startDate: "2026-07-06",
			endDateExclusive: "2026-07-13",
		});
	});
});

describe("scheduler focus from the URL", () => {
	const employeeId = "11111111-1111-4111-8111-111111111111";

	afterEach(() => {
		vi.useRealTimers();
	});

	it("accepts one employee and a calendar date", () => {
		expect(parseSchedulerFocus({ employeeId, date: "2026-10-01" })).toEqual({
			employeeId,
			date: "2026-10-01",
		});
	});

	it("ignores malformed or missing values", () => {
		expect(parseSchedulerFocus({ employeeId: "not-a-uuid", date: "2026-13-40" })).toEqual({
			employeeId: null,
			date: null,
		});
		expect(parseSchedulerFocus({})).toEqual({ employeeId: null, date: null });
	});

	it("keeps only the focused employee's shifts, or all without a focus", () => {
		const shifts = [
			{ id: "a", employeeId },
			{ id: "b", employeeId: "22222222-2222-4222-8222-222222222222" },
			{ id: "open", employeeId: null },
		];

		expect(filterShiftsForEmployee(shifts, employeeId).map((shift) => shift.id)).toEqual(["a"]);
		expect(filterShiftsForEmployee(shifts, null)).toBe(shifts);
	});

	it("opens on the week of the focus date", () => {
		const view = initialSchedulerView("2026-10-01", "Europe/Berlin", "sunday");

		expect(view.selectedDate.toString()).toBe("2026-10-01");
		expect(view.dateRange).toEqual({ startDate: "2026-09-27", endDateExclusive: "2026-10-04" });
		expect(initialSchedulerView("2026-10-01", "Europe/Berlin", "monday").dateRange).toEqual({
			startDate: "2026-09-28",
			endDateExclusive: "2026-10-05",
		});
	});

	it("opens on today in the organization's zone", () => {
		vi.useFakeTimers({ now: new Date("2026-10-10T23:30:00.000Z") });

		expect(initialSchedulerView(null, "Pacific/Kiritimati", "monday").selectedDate.toString()).toBe(
			"2026-10-11",
		);
		expect(initialSchedulerView(null, "America/New_York", "monday").selectedDate.toString()).toBe(
			"2026-10-10",
		);
	});
});
