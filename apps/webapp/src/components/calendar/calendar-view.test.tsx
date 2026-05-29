/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./calendar-view";

const { capturedCalendarFilters, push, refetch } = vi.hoisted(() => ({
	capturedCalendarFilters: [] as unknown[],
	push: vi.fn(),
	refetch: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ isManagerOrAbove: true }),
}));

vi.mock("@/hooks/use-calendar-data", () => ({
	useCalendarData: ({ filters }: { filters: unknown }) => {
		capturedCalendarFilters.push(filters);

		return {
			events: [],
			dailyRequirements: new Map(),
			dailyActualMinutes: new Map(),
			workBalance: null,
			isLoading: false,
			error: null,
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
	YearCalendarView: () => <div data-testid="year-calendar-view" />,
}));

vi.mock("./schedule-x-wrapper", () => ({
	ScheduleXWrapper: ({
		onViewModeChange,
		viewMode,
	}: {
		onViewModeChange: (mode: "month") => void;
		viewMode: string;
	}) => (
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
	beforeEach(() => {
		capturedCalendarFilters.length = 0;
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
