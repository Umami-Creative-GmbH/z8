/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { createCalendar, createViewWeek } from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { ScheduleXCalendar } from "@schedule-x/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { createScheduleXDragAndDropPlugin } from "./schedule-x-drag-and-drop";
import {
	calendarRangeToDateRange,
	getWeekDateRange,
	scheduleXFirstDayOfWeek,
	shiftToEvent,
} from "./shift-scheduler-utils";

const BERLIN = "Europe/Berlin";

function shift(overrides: Partial<ShiftWithRelations>): ShiftWithRelations {
	return {
		id: "shift",
		organizationId: "org-1",
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

function plannerCalendar(weekStartDay: WeekStartDay, shifts: ShiftWithRelations[]) {
	const controls = createCalendarControlsPlugin();
	const calendarApp = createCalendar(
		{
			views: [createViewWeek()],
			selectedDate: Temporal.PlainDate.from("2026-07-08"),
			timezone: BERLIN,
			firstDayOfWeek: scheduleXFirstDayOfWeek(weekStartDay),
			events: shifts.map((entry) => shiftToEvent(entry, BERLIN)),
		},
		[controls],
	);
	return { calendarApp, controls };
}

describe("planner shifts in Schedule-X's week view", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
	});

	it("renders day and overnight shifts without throwing", async () => {
		const errors: unknown[] = [];
		const onError = (event: ErrorEvent) => errors.push(event.error);
		window.addEventListener("error", onError);
		const { calendarApp } = plannerCalendar("monday", [
			shift({ id: "day", status: "draft" }),
			shift({
				id: "night",
				employeeId: "employee-1",
				employee: { firstName: "Ada", lastName: "Lovelace" } as ShiftWithRelations["employee"],
				startTime: "22:00",
				endTime: "06:00",
			}),
		]);

		render(<ScheduleXCalendar calendarApp={calendarApp} />);

		await waitFor(() => expect(screen.getByText("[Draft] Open Shift")).toBeTruthy());
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
		window.removeEventListener("error", onError);
		expect(errors).toEqual([]);
	});

	it.each(["monday", "sunday"] as const)(
		"shows the week the first fetch covers (week starts %s)",
		async (weekStartDay) => {
			const { calendarApp, controls } = plannerCalendar(weekStartDay, []);
			render(<ScheduleXCalendar calendarApp={calendarApp} />);

			const range = controls.getRange();
			if (!range) throw new Error("Schedule-X has no range");
			expect(calendarRangeToDateRange(range)).toEqual(getWeekDateRange("2026-07-08", weekStartDay));
		},
	);

	it("hands a dragged timed shift to the drag-and-drop plugin", async () => {
		const dragAndDrop = createScheduleXDragAndDropPlugin();
		// Calendar 4 calls start…Drag; the 3.7.3 plugin alone has only create…DragHandler.
		const startTimeGridDrag = vi.spyOn(dragAndDrop, "startTimeGridDrag");
		const calendarApp = createCalendar(
			{
				views: [createViewWeek()],
				selectedDate: Temporal.PlainDate.from("2026-07-08"),
				timezone: BERLIN,
				events: [shiftToEvent(shift({ id: "day" }), BERLIN)],
			},
			[dragAndDrop],
		);
		render(<ScheduleXCalendar calendarApp={calendarApp} />);
		await waitFor(() => expect(screen.getByText("Open Shift")).toBeTruthy());

		const event = screen.getByText("Open Shift").closest(".sx__time-grid-event");
		if (!event) throw new Error("No time grid event");
		fireEvent.mouseDown(event, { clientX: 10, clientY: 10 });

		await waitFor(() => expect(startTimeGridDrag).toHaveBeenCalledOnce());
		expect(startTimeGridDrag.mock.results[0]?.type).toBe("return");
		fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });
	});
});
