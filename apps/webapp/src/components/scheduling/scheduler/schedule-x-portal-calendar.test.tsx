/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { createCalendar, createViewWeek } from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduleXDragAndDropPlugin } from "./schedule-x-drag-and-drop";
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
		vi.restoreAllMocks();
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

	it("drops the old calendar's event components when a new calendar replaces it", async () => {
		const first = createCalendar({
			views: [createViewWeek()],
			selectedDate: Temporal.PlainDate.from("2026-07-08"),
			timezone: BERLIN,
			events: [shiftOn("2026-07-08", "a"), shiftOn("2026-07-09", "b")],
		});
		const { rerender } = render(
			<ScheduleXPortalCalendar calendarApp={first} customComponents={components} />,
		);
		await screen.findByText("Shift b");

		const second = createCalendar({
			views: [createViewWeek()],
			selectedDate: Temporal.PlainDate.from("2026-07-08"),
			timezone: BERLIN,
			events: [shiftOn("2026-07-08", "c")],
		});
		actPreact(() => {
			rerender(<ScheduleXPortalCalendar calendarApp={second} customComponents={components} />);
		});

		await screen.findByText("Shift c");
		await waitFor(() => expect(mounted).toBe(1));
		expect(screen.queryByText("Shift a")).toBeNull();
	});

	it("unmounts the copy of an overnight shift dragged in the date grid", async () => {
		// jsdom lays nothing out; Schedule-X divides by a day column's width.
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
		const calendarApp = createCalendar({
			views: [createViewWeek()],
			selectedDate: Temporal.PlainDate.from("2026-07-08"),
			timezone: BERLIN,
			plugins: [createScheduleXDragAndDropPlugin()],
			events: [
				{
					id: "night",
					title: "Night watch",
					start: Temporal.ZonedDateTime.from(`2026-07-08T22:00[${BERLIN}]`),
					end: Temporal.ZonedDateTime.from(`2026-07-09T06:00[${BERLIN}]`),
				},
			],
		});
		render(
			<ScheduleXPortalCalendar
				calendarApp={calendarApp}
				customComponents={{ dateGridEvent: CountedEvent }}
			/>,
		);
		const wrapper = (await screen.findByText("Night watch")).closest<HTMLElement>(
			"[data-event-id]",
		);
		if (!wrapper) throw new Error("No Schedule-X event wrapper");
		expect(mounted).toBe(1);

		actPreact(() => {
			fireEvent.mouseDown(wrapper, { clientX: 250, clientY: 10 });
		});
		// Schedule-X starts a drag after holding the button for 150 ms.
		await new Promise((resolve) => setTimeout(resolve, 200));
		// One day column (100 px) to the right, then a second, re-rendering the copy each time.
		for (const clientX of [350, 450]) {
			actPreact(() => {
				fireEvent.mouseMove(document, { clientX, clientY: 10 });
			});
		}
		await waitFor(() => expect(mounted).toBe(2));
		actPreact(() => {
			fireEvent.mouseUp(document, { clientX: 450, clientY: 10 });
		});

		await waitFor(() => expect(mounted).toBe(1));
	});

	it("unmounts every event component with the calendar", async () => {
		renderCalendar();
		await screen.findByText("Shift a");

		actPreact(() => cleanup());

		expect(mounted).toBe(0);
	});
});
