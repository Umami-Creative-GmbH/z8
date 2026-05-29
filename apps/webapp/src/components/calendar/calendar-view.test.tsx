/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CalendarView } from "./calendar-view";

const { capturedCalendarFilters, mockCalendarData, push, refetch } = vi.hoisted(() => ({
	capturedCalendarFilters: [] as unknown[],
	push: vi.fn(),
	refetch: vi.fn(),
	mockCalendarData: {
		events: [] as CalendarEvent[],
		dailyRequirements: new Map(),
		dailyActualMinutes: new Map(),
		workBalance: null,
		calendarTimezone: null as string | null,
		isLoading: false,
		isFetching: false,
		error: null,
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useUserTimezone: () => "Europe/Berlin",
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ isManagerOrAbove: true }),
}));

vi.mock("@/hooks/use-calendar-data", () => ({
	useCalendarData: ({ filters }: { filters: unknown }) => {
		capturedCalendarFilters.push(filters);

		return {
			...mockCalendarData,
			refetch,
		};
	},
}));

vi.mock("@/components/work-balance/work-balance-card", () => ({
	WorkBalanceCard: () => <div data-testid="work-balance-card" />,
}));

vi.mock("./calendar-employee-selector", () => ({
	CalendarEmployeeSelector: ({
		onEmployeeChange,
	}: {
		onEmployeeChange: (employeeId: string | null) => void;
	}) => (
		<div data-testid="employee-selector">
			<button type="button" onClick={() => onEmployeeChange("employee-2")}>
				Select employee 2
			</button>
			<button type="button" onClick={() => onEmployeeChange("employee-1")}>
				Select employee 1
			</button>
		</div>
	),
}));

vi.mock("./calendar-filters", () => ({
	CalendarFiltersComponent: () => <div data-testid="calendar-filters" />,
}));

vi.mock("./calendar-legend", () => ({
	CalendarLegend: () => <div data-testid="calendar-legend" />,
}));

vi.mock("./event-details-panel", () => ({
	EventDetailsPanel: () => <div data-testid="event-details" />,
}));

vi.mock("./work-period-edit-dialog", () => ({
	WorkPeriodEditDialog: () => <div data-testid="work-period-edit" />,
}));

vi.mock("./split-work-period-dialog", () => ({
	SplitWorkPeriodDialog: () => <div data-testid="split-work-period" />,
}));

vi.mock("./delete-work-period-dialog", () => ({
	DeleteWorkPeriodDialog: () => <div data-testid="delete-work-period" />,
}));

vi.mock("./year-calendar-view", () => ({
	YearCalendarView: ({ events }: { events: CalendarEvent[] }) => (
		<div
			data-testid="year-calendar-view"
			data-event-ids={events.map((event) => event.id).join(",")}
		/>
	),
}));

vi.mock("./schedule-x-wrapper", () => ({
	ScheduleXWrapper: ({
		isSummaryLoading,
		onTimeRangeSelect,
		onViewModeChange,
		timeZone,
		viewMode,
	}: {
		isSummaryLoading?: boolean;
		onTimeRangeSelect?: (range: { start: Date; end: Date }) => void;
		onViewModeChange: (mode: "month" | "year") => void;
		timeZone?: string;
		viewMode: string;
	}) => (
		<div
			data-testid="schedule-x-wrapper"
			data-view-mode={viewMode}
			data-time-zone={timeZone}
			data-summary-loading={String(isSummaryLoading)}
		>
			<button
				type="button"
				onClick={() =>
					onTimeRangeSelect?.({
						start: new Date("2026-05-29T10:45:00.000Z"),
						end: new Date("2026-05-29T08:15:00.000Z"),
					})
				}
			>
				Select time range
			</button>
			<button type="button" onClick={() => onViewModeChange("month")}>
				Month
			</button>
			<button type="button" onClick={() => onViewModeChange("year")}>
				Year
			</button>
		</div>
	),
}));

vi.mock("@/components/time-tracking/manual-time-entry-dialog", () => ({
	ManualTimeEntryDialog: ({
		defaultClockInTime,
		defaultClockOutTime,
		defaultDate,
		employeeTimezone,
		open,
		targetEmployeeId,
	}: {
		defaultClockInTime?: string;
		defaultClockOutTime?: string;
		defaultDate?: string;
		employeeTimezone?: string;
		open?: boolean;
		targetEmployeeId?: string;
	}) => (
		<div
			data-testid="manual-entry-dialog"
			data-open={String(open)}
			data-default-date={defaultDate}
			data-clock-in={defaultClockInTime}
			data-clock-out={defaultClockOutTime}
			data-employee-timezone={employeeTimezone}
			data-target-employee-id={targetEmployeeId}
		/>
	),
}));

vi.mock("./month-work-summary-view", () => ({
	MonthWorkSummaryView: ({
		events,
		isSummaryLoading,
		onRefresh,
		viewMode,
	}: {
		events: CalendarEvent[];
		isSummaryLoading?: boolean;
		onRefresh: () => void;
		viewMode: string;
	}) => (
		<div
			data-testid="month-work-summary-view"
			data-view-mode={viewMode}
			data-event-ids={events.map((event) => event.id).join(",")}
			data-summary-loading={String(isSummaryLoading)}
		>
			<button type="button" onClick={onRefresh}>
				Refresh month
			</button>
		</div>
	),
}));

const completedWorkPeriod: CalendarEvent = {
	id: "work-completed",
	type: "work_period",
	date: new Date("2026-05-04T08:00:00Z"),
	title: "Completed work period",
	color: "blue",
	metadata: {
		durationMinutes: 480,
		employeeName: "Ada Lovelace",
	},
};

const runningWorkPeriod: CalendarEvent = {
	id: "work-running",
	type: "work_period",
	date: new Date("2026-05-04T12:00:00Z"),
	title: "Running work period",
	color: "blue",
	metadata: {
		durationMinutes: 120,
		employeeName: "Ada Lovelace",
		isRunning: true,
	},
};

describe("CalendarView", () => {
	beforeEach(() => {
		capturedCalendarFilters.length = 0;
		mockCalendarData.events = [];
		mockCalendarData.calendarTimezone = null;
		mockCalendarData.isFetching = false;
		push.mockClear();
		refetch.mockClear();
	});

	it("initializes filters from initialSelectedEmployeeId", () => {
		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		expect(capturedCalendarFilters.at(-1)).toMatchObject({ employeeId: "employee-2" });
	});

	it("updates filters when the route selected employee changes", async () => {
		const { rerender } = render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		rerender(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-3"
			/>,
		);

		await waitFor(() => {
			expect(capturedCalendarFilters.at(-1)).toMatchObject({ employeeId: "employee-3" });
		});
	});

	it("selecting staff routes to their calendar and updates filters", () => {
		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Select employee 2" }));

		expect(push).toHaveBeenCalledWith("/calendar/employee-2");
		expect(capturedCalendarFilters.at(-1)).toMatchObject({ employeeId: "employee-2" });
	});

	it("selecting current employee routes to own calendar and updates filters", () => {
		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Select employee 1" }));

		expect(push).toHaveBeenCalledWith("/calendar");
		expect(capturedCalendarFilters.at(-1)).toMatchObject({ employeeId: "employee-1" });
	});

	it("passes completed work periods but not running work periods to month view", () => {
		mockCalendarData.events = [completedWorkPeriod, runningWorkPeriod];

		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Month" }));

		expect(screen.getByTestId("month-work-summary-view").getAttribute("data-event-ids")).toBe(
			"work-completed",
		);
	});

	it("passes completed work periods but not running work periods to year view", () => {
		mockCalendarData.events = [completedWorkPeriod, runningWorkPeriod];

		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Year" }));

		expect(screen.getByTestId("year-calendar-view").getAttribute("data-event-ids")).toBe(
			"work-completed",
		);
	});

	it("renders the work summary month view outside Schedule-X when month mode is selected", () => {
		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Month" }));

		expect(screen.getByTestId("month-work-summary-view").getAttribute("data-view-mode")).toBe(
			"month",
		);
		expect(screen.getByTestId("work-balance-card")).toBeTruthy();
		expect(screen.queryByTestId("schedule-x-wrapper")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Refresh month" }));

		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it("opens manual entry dialog with normalized range for the selected employee", () => {
		mockCalendarData.calendarTimezone = "America/New_York";

		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Select time range" }));

		const dialog = screen.getByTestId("manual-entry-dialog");
		expect(dialog.getAttribute("data-open")).toBe("true");
		expect(dialog.getAttribute("data-default-date")).toBe("2026-05-29");
		expect(dialog.getAttribute("data-clock-in")).toBe("04:15");
		expect(dialog.getAttribute("data-clock-out")).toBe("06:45");
		expect(dialog.getAttribute("data-employee-timezone")).toBe("America/New_York");
		expect(dialog.getAttribute("data-target-employee-id")).toBe("employee-2");
	});

	it("passes the selected employee calendar timezone to Schedule-X", () => {
		mockCalendarData.calendarTimezone = "America/New_York";

		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		expect(screen.getByTestId("schedule-x-wrapper").getAttribute("data-time-zone")).toBe(
			"America/New_York",
		);
	});

	it("passes background fetch state to Schedule-X summaries", () => {
		mockCalendarData.isFetching = true;

		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		expect(screen.getByTestId("schedule-x-wrapper").getAttribute("data-summary-loading")).toBe(
			"true",
		);
	});

	it("passes background fetch state to month summaries", () => {
		mockCalendarData.isFetching = true;

		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);
		fireEvent.click(screen.getByRole("button", { name: "Month" }));

		expect(screen.getByTestId("month-work-summary-view").getAttribute("data-summary-loading")).toBe(
			"true",
		);
	});
});
