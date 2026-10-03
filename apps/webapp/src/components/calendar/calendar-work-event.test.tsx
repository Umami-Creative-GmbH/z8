/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import {
	createCalendar,
	createViewDay,
	createViewMonthAgenda,
} from "@schedule-x/calendar";
import { ScheduleXCalendar } from "@schedule-x/react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { calendarEventToScheduleX } from "@/lib/calendar/schedule-x-adapter";
import {
	CalendarTimeGridEvent,
	calendarEventComponents,
} from "./calendar-work-event";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("calendar work event", () => {
	it.each([false, true])(
		"shows captured endpoint times rather than synthetic layout times (running: %s)",
		(isRunning) => {
			const event = calendarEventToScheduleX(
				{
					id: "travel",
					type: "work_period",
					title: "Work",
					color: "green",
					date: new Date("2026-09-01T07:00:00Z"),
					endDate: new Date(
						isRunning ? "2026-09-01T07:01:00Z" : "2026-09-01T12:00:00Z",
					),
					metadata: {
						workLocationType: "remote",
						isRunning,
						clockInUtcOffsetMinutes: 120,
						clockOutUtcOffsetMinutes: -240,
					},
				},
				"Europe/Berlin",
			);
			expect(event).not.toBeNull();
			render(<CalendarTimeGridEvent calendarEvent={event!} />);
			expect(
				screen.getByText(isRunning ? "09:00" : "09:00 - 08:00"),
			).toBeTruthy();
			expect(screen.queryByText("09:00 - 14:00")).toBeNull();
			expect(screen.queryByText("09:00 - 09:30")).toBeNull();
		},
	);
	it.each([createViewDay, createViewMonthAgenda])(
		"renders recorded location through Schedule-X's real React integration",
		async (createView) => {
			vi.stubGlobal(
				"ResizeObserver",
				class {
					observe() {}
					unobserve() {}
					disconnect() {}
				},
			);
			const calendarApp = createCalendar({
				views: [createView()],
				selectedDate: Temporal.PlainDate.from("2026-09-01"),
				events: [
					{
						id: "work",
						title: "Work",
						start: Temporal.ZonedDateTime.from("2026-09-01T09:00+00:00[UTC]"),
						end: Temporal.ZonedDateTime.from("2026-09-01T17:00+00:00[UTC]"),
						_calendarTimeGridContent:
							'<span>Work</span><button data-running-clock-out-button="true">Stop</button>',
						_eventData: {
							type: "work_period",
							metadata: { workLocationType: "remote" },
						},
					},
				],
			});
			render(
				<ScheduleXCalendar
					calendarApp={calendarApp}
					customComponents={calendarEventComponents}
				/>,
			);
			await waitFor(() => expect(screen.getByTitle("Remote")).toBeTruthy());
			expect(screen.getAllByText("Work")).toHaveLength(1);
		},
	);
	it.each(["office", "home", "remote", "other"])(
		"shows the %s location without losing event content",
		(workLocationType) => {
			render(
				<CalendarTimeGridEvent
					calendarEvent={{
						title: "09:00 - 17:00",
						_customContent: {
							timeGrid:
								'<span>UTC+02:00</span><button data-running-clock-out-button="true">Stop</button>',
						},
						_eventData: { type: "work_period", metadata: { workLocationType } },
					}}
				/>,
			);
			expect(
				screen.getByTitle(
					workLocationType[0].toUpperCase() + workLocationType.slice(1),
				),
			).toBeTruthy();
			expect(screen.getByText("UTC+02:00")).toBeTruthy();
			expect(
				screen
					.getByRole("button", { name: "Stop" })
					.getAttribute("data-running-clock-out-button"),
			).toBe("true");
		},
	);

	it("does not invent an office location for an unrecorded entry", () => {
		render(
			<CalendarTimeGridEvent
				calendarEvent={{
					title: "Work",
					_eventData: {
						type: "work_period",
						metadata: { workLocationType: null },
					},
				}}
			/>,
		);
		expect(screen.queryByTitle("Office")).toBeNull();
		expect(screen.getByText("Work")).toBeTruthy();
	});
});
