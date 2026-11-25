/** @vitest-environment jsdom */
import "temporal-polyfill/global";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	createCalendar,
	createViewDay,
	createViewMonthGrid,
	createViewWeek,
} from "@schedule-x/calendar";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act as actPreact } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { scheduleXTimeAxisFormat } from "@/lib/calendar/schedule-x-locale";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { createScheduleXDragAndDropPlugin } from "./schedule-x-drag-and-drop";
import { ScheduleXPortalCalendar } from "./schedule-x-portal-calendar";
import { shiftCalendarEventComponents } from "./shift-calendar-event-components";
import { SHIFT_CALENDARS } from "./shift-calendars";

const BERLIN = "Europe/Berlin";

interface PlannerEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	calendarId?: string;
}

const LATE_SHIFT: PlannerEvent = {
	id: "late",
	title: "Ada Lovelace",
	start: "2026-07-08T14:00",
	end: "2026-07-08T22:30",
	calendarId: "published",
};

const NIGHT_SHIFT: PlannerEvent = {
	id: "night",
	title: "Night watch",
	start: "2026-07-08T22:00",
	end: "2026-07-09T06:00",
	calendarId: "published",
};

function renderPlanner(
	view: typeof createViewWeek,
	timeFormat: TimeFormat,
	{
		events = [LATE_SHIFT],
		locale = "en-US",
		onEventClick,
		draggable = false,
	}: {
		events?: PlannerEvent[];
		locale?: string;
		onEventClick?: (event: { id: string | number }) => void;
		draggable?: boolean;
	} = {},
) {
	const calendarApp = createCalendar({
		views: [view()],
		selectedDate: Temporal.PlainDate.from("2026-07-08"),
		timezone: BERLIN,
		locale,
		weekOptions: { timeAxisFormatOptions: scheduleXTimeAxisFormat(timeFormat) },
		// The planner's and the employee schedule's calendars.
		calendars: SHIFT_CALENDARS,
		plugins: draggable ? [createScheduleXDragAndDropPlugin()] : [],
		callbacks: onEventClick ? { onEventClick } : undefined,
		events: events.map((event) => ({
			...event,
			start: Temporal.ZonedDateTime.from(`${event.start}[${BERLIN}]`),
			end: Temporal.ZonedDateTime.from(`${event.end}[${BERLIN}]`),
		})),
	});
	render(
		<UserPreferencesProvider timeFormat={timeFormat}>
			<ScheduleXPortalCalendar
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

/** The component's stylesheet, which Vitest does not load with the import. */
function loadShiftEventStyles() {
	const style = document.createElement("style");
	style.textContent = readFileSync(
		join(process.cwd(), "src/components/scheduling/scheduler/shift-calendar-event.css"),
		"utf8",
	);
	document.head.append(style);
	return () => style.remove();
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
		vi.restoreAllMocks();
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

	it("shows a German planner on the 12-hour clock the shift on that clock, not Schedule-X's German 24 hours", async () => {
		renderPlanner(createViewWeek, "12h", { locale: "de-DE" });

		const event = await shiftEvent("Ada Lovelace");
		expect(event.textContent).toBe("Ada Lovelace2:00 PM – 10:30 PM");
		expect(screen.queryByText(/14:00 – 22:30/)).toBeNull();
	});

	it("shows the start time on the month grid", async () => {
		renderPlanner(createViewMonthGrid, "24h");

		await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
		expect(screen.getByText("14:00")).toBeTruthy();
	});

	it("shows a 12-hour planner the start time on the month grid on the 12-hour clock", async () => {
		renderPlanner(createViewMonthGrid, "12h");

		const event = await shiftEvent("Ada Lovelace");
		expect(event.textContent).toBe("2:00 PMAda Lovelace");
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

	it("falls back to Schedule-X's primary colours for an event outside the shift calendars", async () => {
		const events: PlannerEvent[] = [
			{ ...LATE_SHIFT, id: "none", title: "No calendar", calendarId: undefined },
			{ ...LATE_SHIFT, id: "unknown", title: "Unknown calendar", calendarId: "holidays" },
		];
		renderPlanner(createViewWeek, "24h", { events });

		expectColors(await shiftEvent("No calendar"), "primary");
		expectColors(await shiftEvent("Unknown calendar"), "primary");
	});

	it("shows a 24-hour English planner an overnight shift's start on the 24-hour clock", async () => {
		renderPlanner(createViewWeek, "24h", { events: [NIGHT_SHIFT] });

		const event = await shiftEvent("Night watch");
		expect(event.textContent).toContain("22:00");
		expect(event.textContent).not.toMatch(/PM/);
		expectColors(event, "published");
	});

	it("shows a 12-hour planner an overnight shift's start on the 12-hour clock", async () => {
		renderPlanner(createViewWeek, "12h", { events: [NIGHT_SHIFT] });

		const event = await shiftEvent("Night watch");
		expect(event.textContent).toBe("Night watch10:00 PM");
	});

	it("marks an overnight shift in the day view as running on past the day", async () => {
		const removeStyles = loadShiftEventStyles();
		try {
			renderPlanner(createViewDay, "24h", { events: [NIGHT_SHIFT] });

			const event = await shiftEvent("Night watch");
			expect(event.parentElement?.classList).toContain("sx__date-grid-event--overflow-right");
			const style = getComputedStyle(event);
			// Room for the continuation arrow, and a square edge where the shift runs on.
			expect(style.marginRight).toBe("10px");
			expect(style.borderTopRightRadius).toBe("0px");
			expect(style.borderBottomRightRadius).toBe("0px");
			expect(style.marginLeft).not.toBe("10px");
		} finally {
			removeStyles();
		}
	});

	it("marks a shift that started in the previous week as running on from before it", async () => {
		const removeStyles = loadShiftEventStyles();
		try {
			// Sunday night into Monday; the week view starts on Monday 2026-07-06.
			const sundayNight: PlannerEvent = {
				...NIGHT_SHIFT,
				start: "2026-07-05T22:00",
				end: "2026-07-06T06:00",
			};
			renderPlanner(createViewWeek, "24h", { events: [sundayNight] });

			const event = await shiftEvent("Night watch");
			expect(event.parentElement?.classList).toContain("sx__date-grid-event--overflow-left");
			const style = getComputedStyle(event);
			expect(style.marginLeft).toBe("10px");
			expect(style.borderTopLeftRadius).toBe("0px");
			expect(style.borderBottomLeftRadius).toBe("0px");
			// The start border Schedule-X sets inline is dropped on the cut-off edge.
			expect(event.getAttribute("style")).toContain("border-inline-start: 3px solid");
			expect(style.getPropertyValue("border-inline-start")).toMatch(/^0px\b/);
		} finally {
			removeStyles();
		}
	});

	it("draws an overnight shift's continuation in the next week of the month grid without a start border", async () => {
		// Sunday night into Monday: the month grid's weeks start on Monday.
		const sundayNight: PlannerEvent = {
			...NIGHT_SHIFT,
			start: "2026-07-12T22:00",
			end: "2026-07-13T06:00",
		};
		renderPlanner(createViewMonthGrid, "24h", { events: [sundayNight] });

		await waitFor(() => expect(screen.getAllByText("Night watch")).toHaveLength(2));
		const [first, continuation] = screen
			.getAllByText("Night watch")
			.map((title) => title.closest<HTMLElement>("[data-shift-event]"));
		expect(first?.getAttribute("style")).toContain("3px solid var(--sx-color-published)");
		expect(continuation?.getAttribute("style")).not.toContain("solid");
		expect(continuation?.style.backgroundColor).toBe("var(--sx-color-published-container)");
	});

	it("puts a 44-minute shift's title and start time on one line, as Schedule-X does", async () => {
		const short: PlannerEvent = {
			...LATE_SHIFT,
			id: "short",
			title: "Handover",
			end: "2026-07-08T14:44",
		};
		renderPlanner(createViewWeek, "24h", { events: [short] });

		const event = await shiftEvent("Handover");
		// The range would not fit the event's height; the start time alone sits beside the title.
		expect(event.textContent).toBe("Handover14:00");
		expect(event.className).toContain("flex-row");
	});

	it("keeps a 45-minute shift's title and time range on separate lines", async () => {
		renderPlanner(createViewWeek, "24h", { events: [{ ...LATE_SHIFT, end: "2026-07-08T14:45" }] });

		const event = await shiftEvent("Ada Lovelace");
		expect(event.textContent).toBe("Ada Lovelace14:00 – 14:45");
		expect(event.className).toContain("flex-col");
	});

	it("shows the dragged copy of a shift at the times it is being moved to", async () => {
		// jsdom lays nothing out; Schedule-X divides by the day column's width.
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
		renderPlanner(createViewWeek, "24h", { draggable: true });

		const wrapper = (await shiftEvent("Ada Lovelace")).closest<HTMLElement>("[data-event-id]");
		if (!wrapper) throw new Error("No Schedule-X event wrapper");
		actPreact(() => {
			fireEvent.mouseDown(wrapper, { clientX: 50, clientY: 500 });
		});
		// Schedule-X starts a drag after holding the button for 150 ms.
		await new Promise((resolve) => setTimeout(resolve, 200));
		// The default 1600 px grid shows 24 hours: 100 px up is 1.5 hours earlier.
		actPreact(() => {
			fireEvent.mouseMove(document, { clientX: 50, clientY: 400 });
		});

		await waitFor(() => expect(screen.getByText("12:30 – 21:00")).toBeTruthy());

		actPreact(() => {
			fireEvent.mouseUp(document, { clientX: 50, clientY: 400 });
		});
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
