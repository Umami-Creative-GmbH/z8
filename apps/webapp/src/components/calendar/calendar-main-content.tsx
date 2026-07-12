"use client";

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { SelectableEmployee } from "@/components/employee-select/types";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { CalendarControls } from "./calendar-controls";
import { MonthWorkSummaryView } from "./month-work-summary-view";
import type { ViewMode } from "./schedule-x-calendar";
import { ScheduleXWrapper } from "./schedule-x-wrapper";
import { YearCalendarView } from "./year-calendar-view";

interface CalendarMainContentProps {
	viewMode: ViewMode;
	onViewModeChange: Dispatch<SetStateAction<ViewMode>>;
	currentEmployeeId?: string;
	selectedEmployeeId: string | null;
	onEmployeeChange: (employeeId: string | null, employee?: SelectableEmployee) => void;
	isManagerOrAbove: boolean;
	workBalance: EmployeeWorkBalancePayload | null;
	filters: CalendarFilters;
	onFiltersChange: Dispatch<SetStateAction<CalendarFilters>>;
	events: CalendarEvent[];
	completedEvents: CalendarEvent[];
	workHoursData: NonNullable<ComponentProps<typeof YearCalendarView>["workHoursData"]>;
	currentYear: number;
	currentDateKey: string;
	timeZone: string;
	isLoading: boolean;
	isSummaryLoading: boolean;
	onYearChange: (year: number) => void;
	onDayClick: (dateKey: string) => void;
	onMonthChange: (dateKey: string) => void;
	onEventClick: (event: CalendarEvent) => void;
	clockOutAllowedWorkPeriodIds: ReadonlySet<string>;
	onRunningPeriodClockOutRequest: (event: CalendarEvent) => void;
	onRangeChange: (range: { startDateKey: string; endDateKey: string }) => void;
	onTimeRangeSelect: (range: { start: Date; end: Date }) => void;
	onRefresh: () => void;
}

export function CalendarMainContent({
	viewMode,
	onViewModeChange,
	currentEmployeeId,
	selectedEmployeeId,
	onEmployeeChange,
	isManagerOrAbove,
	workBalance,
	filters,
	onFiltersChange,
	events,
	completedEvents,
	workHoursData,
	currentYear,
	currentDateKey,
	timeZone,
	isLoading,
	isSummaryLoading,
	onYearChange,
	onDayClick,
	onMonthChange,
	onEventClick,
	clockOutAllowedWorkPeriodIds,
	onRunningPeriodClockOutRequest,
	onRangeChange,
	onTimeRangeSelect,
	onRefresh,
}: CalendarMainContentProps) {
	return (
		<div
			className={
				viewMode === "year"
					? "flex-1 min-h-0"
					: "grid gap-4 md:grid-cols-[250px_1fr] flex-1 min-h-0"
			}
		>
			{viewMode !== "year" ? (
				<CalendarControls
					currentEmployeeId={currentEmployeeId}
					selectedEmployeeId={selectedEmployeeId}
					onEmployeeChange={onEmployeeChange}
					isManagerOrAbove={isManagerOrAbove}
					workBalance={workBalance}
					filters={filters}
					onFiltersChange={onFiltersChange}
				/>
			) : null}
			<div
				className={
					viewMode === "year"
						? "flex flex-col flex-1 min-h-0 overflow-hidden"
						: "flex flex-col flex-1 order-1 md:order-2 min-h-0 overflow-hidden"
				}
			>
				{viewMode === "year" ? (
					<YearCalendarView
						events={completedEvents}
						year={currentYear}
						viewMode={viewMode}
						onYearChange={onYearChange}
						onViewModeChange={onViewModeChange}
						onDayClick={onDayClick}
						workHoursData={workHoursData}
						timeZone={timeZone}
					/>
				) : viewMode === "month" ? (
					<MonthWorkSummaryView
						monthDateKey={currentDateKey}
						timeZone={timeZone}
						events={completedEvents}
						workHoursData={workHoursData}
						viewMode={viewMode}
						onViewModeChange={onViewModeChange}
						onMonthChange={onMonthChange}
						onDayClick={onDayClick}
						onRefresh={onRefresh}
						isSummaryLoading={isSummaryLoading}
					/>
				) : (
					<ScheduleXWrapper
						events={events}
						timeZone={timeZone}
						isLoading={isLoading}
						viewMode={viewMode}
						initialDateKey={currentDateKey}
						onViewModeChange={onViewModeChange}
						onEventClick={onEventClick}
						clockOutAllowedWorkPeriodIds={clockOutAllowedWorkPeriodIds}
						onRunningPeriodClockOutRequest={onRunningPeriodClockOutRequest}
						onRangeChange={onRangeChange}
						onTimeRangeSelect={onTimeRangeSelect}
						onRefresh={onRefresh}
						workHoursData={workHoursData}
						isSummaryLoading={isSummaryLoading}
					/>
				)}
			</div>
		</div>
	);
}
