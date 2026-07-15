/** @vitest-environment jsdom */

import "temporal-polyfill/global";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { useRef, useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CalendarEvent,
	DailyWorkHoursSummaries,
	WorkPeriodEvent,
} from "@/lib/calendar/types";
import { ScheduleXCalendarWrapper } from "./schedule-x-calendar";
import {
	buildCalendarTimeZoneDate,
	buildCurrentTimeIndicatorPosition,
	filterEventsForScheduleXView,
	hasExceededPointerDragThreshold,
	isIntentionalRangePointerDown,
	isScheduleXEventElement,
	resolveClickableCalendarEvent,
	resolveEventModalLeft,
	shouldRetryRequirementHeaderInjection,
} from "./schedule-x-calendar-utils";
import {
	useScheduleXClockOutDelegation,
	useScheduleXDomLifecycle,
} from "./use-schedule-x-dom-lifecycle";

const useCalendarAppMock = vi.hoisted(() => vi.fn());

const EMPTY_CALENDAR_EVENTS: CalendarEvent[] = [];
const EMPTY_CLOCK_OUT_ALLOWED_WORK_PERIOD_IDS = new Set<string>();
const EMPTY_VISIBLE_REQUIREMENT_DATES: DateTime[] = [];
const EMPTY_WORK_HOURS_DATA: DailyWorkHoursSummaries = new Map();
const translateFallback = (_key: string, fallback: string) => fallback;

type ScheduleXPluginTestDouble = {
	beforeRender?: () => void;
	setDate?: ReturnType<typeof vi.fn>;
};

type CalendarAppTestDouble = {
	events: { set: ReturnType<typeof vi.fn> };
	setTheme: ReturnType<typeof vi.fn>;
};

function useCalendarAppTestDouble(config: { plugins: ScheduleXPluginTestDouble[] }) {
	const initialPlugins = useRef(config.plugins);
	const calendar = useRef<CalendarAppTestDouble | null>(null);

	return useSyncExternalStore(
		(onCalendarReady) => {
			if (!calendar.current) {
				for (const plugin of initialPlugins.current) plugin.beforeRender?.();
				calendar.current = {
					events: { set: vi.fn() },
					setTheme: vi.fn(),
				};
				onCalendarReady();
			}

			return () => {};
		},
		() => calendar.current,
		() => null,
	);
}

vi.mock("@schedule-x/calendar", () => ({
	createViewDay: () => "day",
	createViewMonthAgenda: () => "month-agenda",
	createViewMonthGrid: () => "month-grid",
	createViewWeek: () => "week",
}));

vi.mock("@schedule-x/calendar-controls", () => ({
	createCalendarControlsPlugin: () => {
		let isInitialized = false;
		return {
			beforeRender: () => {
				isInitialized = true;
			},
			setDate: vi.fn(() => {
				if (!isInitialized) {
					throw new TypeError("Cannot read properties of undefined (reading 'datePickerState')");
				}
			}),
			setView: vi.fn(),
		};
	},
}));

vi.mock("@schedule-x/event-modal", () => ({
	createEventModalPlugin: () => ({}),
}));

vi.mock("@schedule-x/react", () => ({
	ScheduleXCalendar: () => <div data-testid="schedule-x-calendar" />,
	useCalendarApp: useCalendarAppMock,
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
	useWeekStartDay: () => 1,
}));

vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const completedWorkPeriod: WorkPeriodEvent = {
	id: "work-completed",
	type: "work_period",
	date: new Date("2026-05-18T08:00:00.000Z"),
	endDate: new Date("2026-05-18T16:00:00.000Z"),
	title: "Completed work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 480,
		employeeName: "Kai Hentschel",
	},
};

const runningWorkPeriod: WorkPeriodEvent = {
	id: "work-running",
	type: "work_period",
	date: new Date("2026-05-18T16:30:00.000Z"),
	title: "Running work period",
	color: "#10b981",
	metadata: {
		durationMinutes: 0,
		employeeName: "Kai Hentschel",
		isRunning: true,
	},
};

function ClockOutDelegationHarness({
	events,
	clockOutAllowedWorkPeriodIds,
	onRunningPeriodClockOutRequest,
}: {
	events: WorkPeriodEvent[];
	clockOutAllowedWorkPeriodIds: ReadonlySet<string>;
	onRunningPeriodClockOutRequest: (event: WorkPeriodEvent) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	useScheduleXClockOutDelegation({
		calendarContainerRef: containerRef,
		events,
		clockOutAllowedWorkPeriodIds,
		onRunningPeriodClockOutRequest,
	});

	return <div ref={containerRef} data-testid="clock-out-delegation-container" />;
}

function DomLifecycleHarness() {
	const containerRef = useRef<HTMLDivElement>(null);
	useScheduleXDomLifecycle({
		calendarContainerRef: containerRef,
		events: EMPTY_CALENDAR_EVENTS,
		clockOutAllowedWorkPeriodIds: EMPTY_CLOCK_OUT_ALLOWED_WORK_PERIOD_IDS,
		isLoading: false,
		viewMode: "month",
		timeZone: "Europe/Berlin",
		visibleRequirementDates: EMPTY_VISIBLE_REQUIREMENT_DATES,
		workHoursData: EMPTY_WORK_HOURS_DATA,
		isSummaryLoading: false,
		t: translateFallback,
	});

	return (
		<div ref={containerRef} data-testid="dom-lifecycle-container">
			<div className="sx__event" data-testid="dom-lifecycle-event" />
			<div className="sx__event-modal is-open" />
		</div>
	);
}

beforeEach(() => {
	useCalendarAppMock.mockReset();
	useCalendarAppMock.mockImplementation(useCalendarAppTestDouble);
});

describe("ScheduleXCalendarWrapper header", () => {
	it("waits for the calendar app before synchronizing the selected date", () => {
		expect(() =>
			render(
				<ScheduleXCalendarWrapper
					events={[]}
					initialDateKey="2026-05-18"
					isLoading
					onViewModeChange={vi.fn()}
					viewMode="day"
				/>,
			),
		).not.toThrow();
	});

	it("provides the initial date to Schedule-X configuration", () => {
		render(
			<ScheduleXCalendarWrapper
				events={[]}
				initialDateKey="2026-05-18"
				onViewModeChange={vi.fn()}
				viewMode="day"
			/>,
		);

		expect(useCalendarAppMock.mock.calls[0]?.[0].selectedDate).toEqual(
			Temporal.PlainDate.from("2026-05-18"),
		);
	});

	it("updates the calendar control when the parent changes its date", () => {
		const { rerender } = render(
			<ScheduleXCalendarWrapper
				events={[]}
				initialDateKey="2026-05-18"
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="day"
			/>,
		);

		const calendarControls = useCalendarAppMock.mock.calls[0]?.[0].plugins[1];
		calendarControls.setDate.mockClear();

		rerender(
			<ScheduleXCalendarWrapper
				events={[]}
				initialDateKey="2026-05-19"
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="day"
			/>,
		);

		expect(calendarControls.setDate).toHaveBeenCalledWith(Temporal.PlainDate.from("2026-05-19"));
	});

	it("renders separate desktop and mobile headers with compact mobile week text", () => {
		render(
			<ScheduleXCalendarWrapper
				events={[]}
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="week"
			/>,
		);

		const desktopHeader = screen.getByTestId("calendar-desktop-header");
		const mobileHeader = screen.getByTestId("calendar-mobile-header");
		const mobileDateRange = screen.getByTestId("calendar-mobile-date-range");
		const mobileControls = screen.getByTestId("calendar-mobile-header-controls");

		expect(desktopHeader.classList.contains("hidden")).toBe(true);
		expect(desktopHeader.classList.contains("lg:flex")).toBe(true);
		expect(mobileHeader.classList.contains("lg:hidden")).toBe(true);
		expect(mobileDateRange.classList.contains("whitespace-nowrap")).toBe(true);
		expect(mobileDateRange.classList.contains("truncate")).toBe(true);
		expect(mobileControls.classList.contains("overflow-x-auto")).toBe(true);
		expect(mobileControls.classList.contains("whitespace-nowrap")).toBe(true);
		expect(mobileDateRange.textContent).not.toMatch(/, \d{4}$/);
	});

	it("uses the parent-provided initial view without Schedule-X responsive view coercion", () => {
		render(
			<ScheduleXCalendarWrapper
				events={[]}
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="day"
			/>,
		);

		const calendarConfig = useCalendarAppMock.mock.calls[0]?.[0];

		expect(calendarConfig.defaultView).toBe("day");
		expect(calendarConfig.isResponsive).toBe(false);
	});
});

describe("ScheduleXCalendarWrapper running clock-out action", () => {
	it("delegates an allowed running clock-out click through the DOM lifecycle hook", () => {
		const onRunningPeriodClockOutRequest = vi.fn();

		render(
			<ClockOutDelegationHarness
				events={[runningWorkPeriod]}
				clockOutAllowedWorkPeriodIds={new Set([runningWorkPeriod.id])}
				onRunningPeriodClockOutRequest={onRunningPeriodClockOutRequest}
			/>,
		);

		const button = document.createElement("button");
		button.dataset.runningClockOutButton = "true";
		button.dataset.workPeriodId = runningWorkPeriod.id;
		screen.getByTestId("clock-out-delegation-container").append(button);

		fireEvent.click(button);

		expect(onRunningPeriodClockOutRequest).toHaveBeenCalledWith(runningWorkPeriod);
	});

	it("passes allowed running clock-out ids into the Schedule-X event conversion path", () => {
		render(
			<ScheduleXCalendarWrapper
				events={[runningWorkPeriod]}
				clockOutAllowedWorkPeriodIds={new Set([runningWorkPeriod.id])}
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="week"
			/>,
		);

		const calendarConfig = useCalendarAppMock.mock.calls[0]?.[0];
		expect(calendarConfig.events[0]?._customContent?.timeGrid).toContain(
			"data-running-clock-out-button",
		);
	});

	it("delegates running stop button clicks to the matching running event", () => {
		const onRunningPeriodClockOutRequest = vi.fn();

		render(
			<ScheduleXCalendarWrapper
				events={[runningWorkPeriod, completedWorkPeriod]}
				clockOutAllowedWorkPeriodIds={new Set([runningWorkPeriod.id])}
				onRunningPeriodClockOutRequest={onRunningPeriodClockOutRequest}
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="week"
			/>,
		);

		const calendarRoot = screen.getByTestId("schedule-x-calendar").parentElement;
		expect(calendarRoot).not.toBeNull();
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.runningClockOutButton = "true";
		button.dataset.workPeriodId = runningWorkPeriod.id;
		calendarRoot?.append(button);

		fireEvent.click(button);

		expect(onRunningPeriodClockOutRequest).toHaveBeenCalledTimes(1);
		expect(onRunningPeriodClockOutRequest).toHaveBeenCalledWith(runningWorkPeriod);
	});

	it("does not delegate running stop button clicks when current authorization denies it", () => {
		const onRunningPeriodClockOutRequest = vi.fn();

		render(
			<ScheduleXCalendarWrapper
				events={[runningWorkPeriod]}
				clockOutAllowedWorkPeriodIds={new Set()}
				onRunningPeriodClockOutRequest={onRunningPeriodClockOutRequest}
				onRefresh={vi.fn()}
				onViewModeChange={vi.fn()}
				viewMode="week"
			/>,
		);

		const calendarRoot = screen.getByTestId("schedule-x-calendar").parentElement;
		expect(calendarRoot).not.toBeNull();
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.runningClockOutButton = "true";
		button.dataset.workPeriodId = runningWorkPeriod.id;
		calendarRoot?.append(button);

		fireEvent.click(button);

		expect(onRunningPeriodClockOutRequest).not.toHaveBeenCalled();
	});
});

describe("Schedule-X DOM lifecycle cleanup", () => {
	it("cancels a pending modal reposition animation frame on unmount", () => {
		const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(321);
		const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
		const { unmount } = render(<DomLifecycleHarness />);

		fireEvent.pointerUp(screen.getByTestId("dom-lifecycle-event"));
		fireEvent.scroll(screen.getByTestId("dom-lifecycle-container"));
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		unmount();

		expect(cancelAnimationFrame).toHaveBeenCalledWith(321);
		requestAnimationFrame.mockRestore();
		cancelAnimationFrame.mockRestore();
	});
});

describe("filterEventsForScheduleXView", () => {
	it("keeps running work periods in day and week views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "day")).toEqual(events);
		expect(filterEventsForScheduleXView(events, "week")).toEqual(events);
	});

	it("removes only running work periods from month and year views", () => {
		const events = [completedWorkPeriod, runningWorkPeriod];

		expect(filterEventsForScheduleXView(events, "month")).toEqual([completedWorkPeriod]);
		expect(filterEventsForScheduleXView(events, "year")).toEqual([completedWorkPeriod]);
	});
});

describe("resolveClickableCalendarEvent", () => {
	it("returns null for running work periods", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: runningWorkPeriod.id })).toBeNull();
	});

	it("returns clicked non-running events", () => {
		const events = [
			{ id: runningWorkPeriod.id, _eventData: runningWorkPeriod },
			{ id: completedWorkPeriod.id, _eventData: completedWorkPeriod },
		];

		expect(resolveClickableCalendarEvent(events, { id: completedWorkPeriod.id })).toBe(
			completedWorkPeriod,
		);
	});
});

describe("calendar timezone source", () => {
	it("supports an explicit calendar timezone for timed work periods", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/calendar/schedule-x-calendar.tsx"),
			"utf8",
		);

		expect(source).toContain("timeZone: explicitTimeZone");
		expect(source).toContain("explicitTimeZone ?? viewerTimeZone");
		expect(source).not.toContain("timezone: timeZone");
		expect(source).not.toContain("useOrganizationTimezone");
	});
});

describe("calendar current-time indicator styles", () => {
	it("styles the custom current-time indicator", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/calendar/schedule-x-calendar.css"),
			"utf8",
		);

		expect(source).toContain(".z8-current-time-indicator");
		expect(source).toContain("background: rgb(239 68 68)");
	});
});

describe("calendar summary skeleton styles", () => {
	it("uses reduced-motion-safe skeleton styling", () => {
		const source = readFileSync(
			join(process.cwd(), "src/components/calendar/schedule-x-calendar.css"),
			"utf8",
		);

		expect(source).toContain(".z8-requirement-header-summary--skeleton");
		expect(source).toContain("@media (prefers-reduced-motion: reduce)");
		expect(source).toContain("animation: none");
	});
});

describe("shouldRetryRequirementHeaderInjection", () => {
	it("retries while Schedule-X has not rendered every visible header cell", () => {
		expect(shouldRetryRequirementHeaderInjection({ headerCellCount: 0, visibleDateCount: 7 })).toBe(
			true,
		);
		expect(shouldRetryRequirementHeaderInjection({ headerCellCount: 4, visibleDateCount: 7 })).toBe(
			true,
		);
	});

	it("stops when all visible header cells are available", () => {
		expect(shouldRetryRequirementHeaderInjection({ headerCellCount: 7, visibleDateCount: 7 })).toBe(
			false,
		);
		expect(shouldRetryRequirementHeaderInjection({ headerCellCount: 1, visibleDateCount: 1 })).toBe(
			false,
		);
	});
});

describe("isScheduleXEventElement", () => {
	it.each([
		"sx__event",
		"sx__time-grid-event",
		"sx__date-grid-event",
	])("identifies %s elements as Schedule-X events", (className) => {
		const eventElement = document.createElement("div");
		eventElement.className = className;
		const child = document.createElement("span");
		eventElement.append(child);

		expect(isScheduleXEventElement(child)).toBe(true);
	});

	it("does not identify empty grid cells as Schedule-X events", () => {
		const gridCell = document.createElement("div");
		gridCell.className = "sx__time-grid-day";

		expect(isScheduleXEventElement(gridCell)).toBe(false);
	});
});

describe("resolveEventModalLeft", () => {
	it("keeps a small gap from the visible event edge when there is room on the right", () => {
		expect(
			resolveEventModalLeft({
				appLeft: 0,
				appRight: 1200,
				eventLeft: 240,
				eventRight: 454,
				modalWidth: 400,
				gap: 10,
			}),
		).toBe(464);
	});

	it("places the modal to the left of the event when the right side has no room", () => {
		expect(
			resolveEventModalLeft({
				appLeft: 0,
				appRight: 800,
				eventLeft: 620,
				eventRight: 760,
				modalWidth: 400,
				gap: 10,
			}),
		).toBe(210);
	});
});

describe("isIntentionalRangePointerDown", () => {
	it("accepts primary mouse and pen pointerdown events", () => {
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "mouse" })).toBe(true);
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "pen" })).toBe(true);
	});

	it("ignores touch and non-primary pointerdown events", () => {
		expect(isIntentionalRangePointerDown({ button: 0, pointerType: "touch" })).toBe(false);
		expect(isIntentionalRangePointerDown({ button: 1, pointerType: "mouse" })).toBe(false);
		expect(isIntentionalRangePointerDown({ button: 2, pointerType: "pen" })).toBe(false);
	});
});

describe("hasExceededPointerDragThreshold", () => {
	it("requires movement beyond the drag threshold", () => {
		expect(
			hasExceededPointerDragThreshold({ clientX: 10, clientY: 20 }, { clientX: 13, clientY: 22 }),
		).toBe(false);
		expect(
			hasExceededPointerDragThreshold({ clientX: 10, clientY: 20 }, { clientX: 15, clientY: 20 }),
		).toBe(true);
	});
});

describe("buildCalendarTimeZoneDate", () => {
	it("builds range selection instants in the calendar timezone", () => {
		const selectedDate = buildCalendarTimeZoneDate("2026-05-29", 10 * 60 + 15, "Europe/Berlin");

		expect(DateTime.fromJSDate(selectedDate, { zone: "Europe/Berlin" }).toFormat("HH:mm")).toBe(
			"10:15",
		);
		expect(selectedDate.toISOString()).toBe("2026-05-29T08:15:00.000Z");
	});
});

describe("buildCurrentTimeIndicatorPosition", () => {
	it("positions now in the selected timezone on the neutral calendar grid", () => {
		const position = buildCurrentTimeIndicatorPosition(
			new Date("2026-05-26T05:00:00.000Z"),
			"Europe/Berlin",
		);

		expect(position).toEqual({ dateKey: "2026-05-26", topPercent: (7 * 60 * 100) / 1440 });
	});
});
