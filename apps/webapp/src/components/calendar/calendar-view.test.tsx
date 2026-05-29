/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CalendarView } from "./calendar-view";

const { refetch, mockCalendarData } = vi.hoisted(() => ({
	refetch: vi.fn(),
	mockCalendarData: {
		events: [] as CalendarEvent[],
		dailyRequirements: new Map(),
		dailyActualMinutes: new Map(),
		workBalance: null,
		isLoading: false,
		error: null,
	},
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ isManagerOrAbove: false }),
}));

vi.mock("@/hooks/use-calendar-data", () => ({
	useCalendarData: () => ({
		...mockCalendarData,
		refetch,
	}),
}));

vi.mock("@/components/work-balance/work-balance-card", () => ({
	WorkBalanceCard: () => <div data-testid="work-balance-card" />,
}));

vi.mock("./calendar-employee-selector", () => ({
	CalendarEmployeeSelector: () => <div data-testid="employee-selector" />,
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
		onViewModeChange,
		viewMode,
	}: {
		onViewModeChange: (mode: "month" | "year") => void;
		viewMode: string;
	}) => (
		<div data-testid="schedule-x-wrapper" data-view-mode={viewMode}>
			<button type="button" onClick={() => onViewModeChange("month")}>
				Month
			</button>
			<button type="button" onClick={() => onViewModeChange("year")}>
				Year
			</button>
		</div>
	),
}));

vi.mock("./month-work-summary-view", () => ({
	MonthWorkSummaryView: ({
		events,
		onRefresh,
		viewMode,
	}: {
		events: CalendarEvent[];
		onRefresh: () => void;
		viewMode: string;
	}) => (
		<div
			data-testid="month-work-summary-view"
			data-view-mode={viewMode}
			data-event-ids={events.map((event) => event.id).join(",")}
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
});
