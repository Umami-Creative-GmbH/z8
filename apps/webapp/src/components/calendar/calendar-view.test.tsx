/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarView } from "./calendar-view";

const refetch = vi.fn();

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ isManagerOrAbove: false }),
}));

vi.mock("@/hooks/use-calendar-data", () => ({
	useCalendarData: () => ({
		events: [],
		dailyRequirements: new Map(),
		dailyActualMinutes: new Map(),
		isLoading: false,
		error: null,
		refetch,
	}),
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
	YearCalendarView: () => <div data-testid="year-calendar-view" />,
}));

vi.mock("./schedule-x-wrapper", () => ({
	ScheduleXWrapper: ({ onViewModeChange, viewMode }: { onViewModeChange: (mode: "month") => void; viewMode: string }) => (
		<div data-testid="schedule-x-wrapper" data-view-mode={viewMode}>
			<button type="button" onClick={() => onViewModeChange("month")}>
				Month
			</button>
		</div>
	),
}));

vi.mock("./month-work-summary-view", () => ({
	MonthWorkSummaryView: ({ onRefresh, viewMode }: { onRefresh: () => void; viewMode: string }) => (
		<div data-testid="month-work-summary-view" data-view-mode={viewMode}>
			<button type="button" onClick={onRefresh}>
				Refresh month
			</button>
		</div>
	),
}));

describe("CalendarView", () => {
	it("renders the work summary month view outside Schedule-X when month mode is selected", () => {
		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Month" }));

		expect(screen.getByTestId("month-work-summary-view").getAttribute("data-view-mode")).toBe(
			"month",
		);
		expect(screen.queryByTestId("schedule-x-wrapper")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Refresh month" }));

		expect(refetch).toHaveBeenCalledTimes(1);
	});
});
