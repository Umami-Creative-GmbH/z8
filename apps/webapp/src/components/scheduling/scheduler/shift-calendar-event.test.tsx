/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { createCalendar, createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { ScheduleXCalendar } from "@schedule-x/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { scheduleXTimeAxisFormat } from "@/lib/calendar/schedule-x-locale";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { shiftCalendarEventComponents } from "./shift-calendar-event";

const BERLIN = "Europe/Berlin";

interface PlannerEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	calendarId: "published" | "draft" | "open";
}

const LATE_SHIFT: PlannerEvent = {
	id: "late",
	title: "Ada Lovelace",
	start: "2026-07-08T14:00",
	end: "2026-07-08T22:30",
	calendarId: "published",
};

function color(main: string) {
	return { main, container: "#ffffff", onContainer: "#000000" };
}

function renderPlanner(
	view: typeof createViewWeek,
	timeFormat: TimeFormat,
	{
		events = [LATE_SHIFT],
		locale = "en-US",
		onEventClick,
	}: {
		events?: PlannerEvent[];
		locale?: string;
		onEventClick?: (event: { id: string | number }) => void;
	} = {},
) {
	const calendarApp = createCalendar({
		views: [view()],
		selectedDate: Temporal.PlainDate.from("2026-07-08"),
		timezone: BERLIN,
		locale,
		weekOptions: { timeAxisFormatOptions: scheduleXTimeAxisFormat(timeFormat) },
		// The same ids and colour names as the planner and the employee schedule.
		calendars: {
			published: { colorName: "published", lightColors: color("#3b82f6") },
			draft: { colorName: "draft", lightColors: color("#9ca3af") },
			open: { colorName: "open", lightColors: color("#f59e0b") },
		},
		callbacks: onEventClick ? { onEventClick } : undefined,
		events: events.map((event) => ({
			...event,
			start: Temporal.ZonedDateTime.from(`${event.start}[${BERLIN}]`),
			end: Temporal.ZonedDateTime.from(`${event.end}[${BERLIN}]`),
		})),
	});
	render(
		<UserPreferencesProvider timeFormat={timeFormat}>
			<ScheduleXCalendar
				calendarApp={calendarApp}
				customComponents={shiftCalendarEventComponents}
			/>
		</UserPreferencesProvider>,
	);
}

async function shiftEvent(title: string) {
	const element = (await screen.findByText(title)).closest<HTMLElement>("[data-shift-event]");
	if (!element) throw new Error(`No shift event around "${title}"`);
	return element;
}

function expectColors(element: HTMLElement, colorName: string) {
	expect(element.style.backgroundColor).toBe(`var(--sx-color-${colorName}-container)`);
	expect(element.style.color).toBe(`var(--sx-color-on-${colorName}-container)`);
	expect(element.getAttribute("style")).toContain(`3px solid var(--sx-color-${colorName})`);
}

describe("planner shifts in Schedule-X", () => {
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

	it("shows a German planner the shift on the 24-hour clock", async () => {
		renderPlanner(createViewWeek, "24h", { locale: "de-DE" });

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("14:00 – 22:30")).toBeTruthy();
		expect(screen.queryByText(/PM/)).toBeNull();
	});

	it("shows the start time on the month grid", async () => {
		renderPlanner(createViewMonthGrid, "24h");

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("14:00")).toBeTruthy();
	});

	it("fills a published shift with the published calendar's colours", async () => {
		renderPlanner(createViewWeek, "24h");

		expectColors(await shiftEvent("Ada Lovelace"), "published");
	});

	it("gives draft and open shifts their own colours, in the week and on the month grid", async () => {
		const events: PlannerEvent[] = [
			{ ...LATE_SHIFT, id: "draft", title: "[Draft] Grace Hopper", calendarId: "draft" },
			{ ...LATE_SHIFT, id: "open", title: "Open shift", calendarId: "open" },
		];
		renderPlanner(createViewWeek, "24h", { events });

		expectColors(await shiftEvent("[Draft] Grace Hopper"), "draft");
		expectColors(await shiftEvent("Open shift"), "open");

		actPreact(() => cleanup());
		renderPlanner(createViewMonthGrid, "24h", { events });

		expectColors(await shiftEvent("[Draft] Grace Hopper"), "draft");
		expectColors(await shiftEvent("Open shift"), "open");
	});

	it("shows a 24-hour English planner an overnight shift's start on the 24-hour clock", async () => {
		const night: PlannerEvent = {
			id: "night",
			title: "Night watch",
			start: "2026-07-08T22:00",
			end: "2026-07-09T06:00",
			calendarId: "published",
		};
		renderPlanner(createViewWeek, "24h", { events: [night] });

		const event = await shiftEvent("Night watch");
		expect(event.textContent).toContain("22:00");
		expect(event.textContent).not.toMatch(/PM/);
		expectColors(event, "published");
	});

	it("puts a short shift's title and start time on one line, as Schedule-X does", async () => {
		const short: PlannerEvent = {
			...LATE_SHIFT,
			id: "short",
			title: "Handover",
			end: "2026-07-08T14:30",
		};
		renderPlanner(createViewWeek, "24h", { events: [short] });

		const event = await shiftEvent("Handover");
		// The range would not fit the event's height; the start time alone sits beside the title.
		expect(event.textContent).toBe("Handover14:00");
		expect(event.className).toContain("flex-row");
	});

	it("keeps an hour-long shift's title and time range on separate lines", async () => {
		renderPlanner(createViewWeek, "24h", { events: [{ ...LATE_SHIFT, end: "2026-07-08T15:00" }] });

		const event = await shiftEvent("Ada Lovelace");
		expect(event.textContent).toBe("Ada Lovelace14:00 – 15:00");
		expect(event.className).toContain("flex-col");
	});

	it("opens a shift on click and on Enter", async () => {
		const onEventClick = vi.fn();
		renderPlanner(createViewWeek, "24h", { onEventClick });

		const wrapper = (await shiftEvent("Ada Lovelace")).closest<HTMLElement>("[data-event-id]");
		if (!wrapper) throw new Error("No Schedule-X event wrapper");
		actPreact(() => {
			fireEvent.click(wrapper);
		});
		expect(onEventClick).toHaveBeenCalledTimes(1);
		expect(onEventClick.mock.calls[0]?.[0]).toMatchObject({ id: "late" });

		actPreact(() => {
			fireEvent.keyDown(wrapper, { key: "Enter" });
		});
		expect(onEventClick).toHaveBeenCalledTimes(2);
	});
});
