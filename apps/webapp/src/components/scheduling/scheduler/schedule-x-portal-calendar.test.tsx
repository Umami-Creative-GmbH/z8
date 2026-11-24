/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { createCalendar, createViewWeek } from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleXPortalCalendar } from "./schedule-x-portal-calendar";

const BERLIN = "Europe/Berlin";

/** Counts the event components React still has mounted, shown or not. */
let mounted = 0;

function CountedEvent({ calendarEvent }: { calendarEvent: { title?: string } }) {
	useEffect(() => {
		mounted += 1;
		return () => {
			mounted -= 1;
		};
	}, []);
	return <span>{calendarEvent.title}</span>;
}

const components = { timeGridEvent: CountedEvent };

function shiftOn(date: string, id: string) {
	return {
		id,
		title: `Shift ${id}`,
		start: Temporal.ZonedDateTime.from(`${date}T09:00[${BERLIN}]`),
		end: Temporal.ZonedDateTime.from(`${date}T17:00[${BERLIN}]`),
	};
}

function renderCalendar() {
	const controls = createCalendarControlsPlugin();
	const calendarApp = createCalendar(
		{
			views: [createViewWeek()],
			selectedDate: Temporal.PlainDate.from("2026-07-08"),
			timezone: BERLIN,
			events: [shiftOn("2026-07-08", "a"), shiftOn("2026-07-15", "b")],
		},
		[controls],
	);
	render(<ScheduleXPortalCalendar calendarApp={calendarApp} customComponents={components} />);
	return { calendarApp, controls };
}

describe("ScheduleXPortalCalendar", () => {
	beforeEach(() => {
		mounted = 0;
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
	});

	afterEach(async () => {
		// Schedule-X renders with Preact; see shift-scheduler-calendar.test.tsx.
		actPreact(() => cleanup());
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	it("unmounts the events of a week the planner has moved away from", async () => {
		const { controls } = renderCalendar();
		await screen.findByText("Shift a");

		for (const date of ["2026-07-15", "2026-07-08", "2026-07-15", "2026-07-08"]) {
			actPreact(() => controls.setDate(Temporal.PlainDate.from(date)));
		}
		actPreact(() => controls.setDate(Temporal.PlainDate.from("2026-07-15")));

		await screen.findByText("Shift b");
		await waitFor(() => expect(mounted).toBe(1));
		expect(screen.queryByText("Shift a")).toBeNull();
	});

	it("keeps one component per event when the events are set again", async () => {
		const { calendarApp } = renderCalendar();
		await screen.findByText("Shift a");

		for (let round = 0; round < 3; round++) {
			actPreact(() =>
				calendarApp.events.set([shiftOn("2026-07-08", "a"), shiftOn("2026-07-09", `c${round}`)]),
			);
		}

		await screen.findByText("Shift c2");
		await waitFor(() => expect(mounted).toBe(2));
	});

	it("unmounts every event component with the calendar", async () => {
		renderCalendar();
		await screen.findByText("Shift a");

		actPreact(() => cleanup());

		expect(mounted).toBe(0);
	});
});
