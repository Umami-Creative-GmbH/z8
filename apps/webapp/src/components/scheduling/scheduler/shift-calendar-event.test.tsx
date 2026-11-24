/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { createCalendar, createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { ScheduleXCalendar } from "@schedule-x/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { scheduleXTimeAxisFormat } from "@/lib/calendar/schedule-x-locale";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { shiftCalendarEventComponents } from "./shift-calendar-event";

const BERLIN = "Europe/Berlin";

function englishPlannerCalendar(view: typeof createViewWeek, timeFormat: TimeFormat) {
	return createCalendar({
		views: [view()],
		selectedDate: Temporal.PlainDate.from("2026-07-08"),
		timezone: BERLIN,
		locale: "en-US",
		weekOptions: { timeAxisFormatOptions: scheduleXTimeAxisFormat(timeFormat) },
		calendars: {
			published: {
				colorName: "published",
				lightColors: { main: "#3b82f6", container: "#dbeafe", onContainer: "#1e40af" },
			},
		},
		events: [
			{
				id: "late",
				title: "Ada Lovelace",
				start: Temporal.ZonedDateTime.from("2026-07-08T14:00[Europe/Berlin]"),
				end: Temporal.ZonedDateTime.from("2026-07-08T22:30[Europe/Berlin]"),
				calendarId: "published",
			},
		],
	});
}

function renderPlanner(view: typeof createViewWeek, timeFormat: TimeFormat) {
	render(
		<UserPreferencesProvider timeFormat={timeFormat}>
			<ScheduleXCalendar
				calendarApp={englishPlannerCalendar(view, timeFormat)}
				customComponents={shiftCalendarEventComponents}
			/>
		</UserPreferencesProvider>,
	);
}

describe("planner shifts in Schedule-X follow the 12/24-hour setting", () => {
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

	afterEach(async () => {
		// Schedule-X renders with Preact; see shift-scheduler-calendar.test.tsx.
		actPreact(() => cleanup());
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	it("shows a 24-hour English planner the shift and the hour axis on the 24-hour clock", async () => {
		renderPlanner(createViewWeek, "24h");

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("14:00 – 22:30")).toBeTruthy();
		expect(screen.getByText("14:00")).toBeTruthy();
		expect(screen.queryByText(/PM/)).toBeNull();
	});

	it("shows a 12-hour planner the shift on the 12-hour clock", async () => {
		renderPlanner(createViewWeek, "12h");

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("2:00 PM – 10:30 PM")).toBeTruthy();
	});

	it("shows the start time on the month grid", async () => {
		renderPlanner(createViewMonthGrid, "24h");

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("14:00")).toBeTruthy();
	});
});
