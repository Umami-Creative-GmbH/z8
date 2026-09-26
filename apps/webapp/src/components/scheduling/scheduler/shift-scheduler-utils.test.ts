import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	filterShiftsForEmployee,
	getWeekDateRange,
	initialSchedulerView,
	parseSchedulerFocus,
	plainDateTimeToDateKey,
	shiftToEvent,
} from "./shift-scheduler-utils";

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

describe("scheduler focus from the URL", () => {
	const employeeId = "11111111-1111-4111-8111-111111111111";

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
		const view = initialSchedulerView("2026-10-01");

		expect(view.selectedDate.toString()).toBe("2026-10-01");
		expect(view.dateRange).toEqual({ startDate: "2026-09-27", endDateExclusive: "2026-10-04" });
	});
});
