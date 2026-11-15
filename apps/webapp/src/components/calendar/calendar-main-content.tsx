"use client";

import { useTranslate } from "@tolgee/react";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { SelectableEmployee } from "@/components/employee-select/types";
import type {
	CalendarClosedRange,
	CalendarFilters,
} from "@/hooks/use-calendar-data";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { CalendarControls } from "./calendar-controls";
import { CalendarEmployeeSelector } from "./calendar-employee-selector";
import { MonthWorkSummaryView } from "./month-work-summary-view";
import type { ViewMode } from "./schedule-x-calendar";
import { ScheduleXWrapper } from "./schedule-x-wrapper";
import type { WorkPeriodActions } from "./work-period-context-menu";
import { YearCalendarView } from "./year-calendar-view";

interface CalendarMainContentProps {
	viewMode: ViewMode;
	onViewModeChange: Dispatch<SetStateAction<ViewMode>>;
	currentEmployeeId?: string;
	selectedEmployeeId: string | null;
	selectedEmployeeName?: string | null;
	onEmployeeChange: (
		employeeId: string | null,
		employee?: SelectableEmployee,
	) => void;
	isManagerOrAbove: boolean;
	workBalance: EmployeeWorkBalancePayload | null;
	filters: CalendarFilters;
	onFiltersChange: Dispatch<SetStateAction<CalendarFilters>>;
	events: CalendarEvent[];
	completedEvents: CalendarEvent[];
	workHoursData: NonNullable<
		ComponentProps<typeof YearCalendarView>["workHoursData"]
	>;
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
	workPeriodActions?: WorkPeriodActions;
	onRangeChange: (range: { startDateKey: string; endDateKey: string }) => void;
	onTimeRangeSelect: (range: { start: Date; end: Date }) => void;
	onRefresh: () => void;
	/** The viewed employee's closed ranges (#762). */
	closedRanges: readonly CalendarClosedRange[];
}

export function CalendarMainContent({
	viewMode,
	onViewModeChange,
	currentEmployeeId,
	selectedEmployeeId,
	selectedEmployeeName,
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
	workPeriodActions,
	onRangeChange,
	onTimeRangeSelect,
	onRefresh,
	closedRanges,
}: CalendarMainContentProps) {
	const { t } = useTranslate();
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
			<div className="flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
				<div className="w-full min-w-0 sm:w-72">
					{selectedEmployeeName ? (
						<h2 className="mb-2 break-words text-base font-semibold">
							{selectedEmployeeName}
						</h2>
					) : null}
					{!isManagerOrAbove && selectedEmployeeId === currentEmployeeId ? (
						<p className="text-sm font-medium">
							{t("calendar.employeeSelector.myCalendar", "My Calendar")}
						</p>
					) : null}
					<CalendarEmployeeSelector
						currentEmployeeId={currentEmployeeId}
						selectedEmployeeId={selectedEmployeeId}
						onEmployeeChange={onEmployeeChange}
						isManagerOrAbove={isManagerOrAbove}
					/>
				</div>
				<p className="min-w-0 break-words text-sm text-muted-foreground">
					{t("calendar.context.timezone", "Calendar timezone")}
					<span className="ml-2 font-medium text-foreground">{timeZone}</span>
				</p>
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_15rem]">
				<div className="flex min-h-[36rem] min-w-0 flex-col overflow-hidden xl:min-h-0">
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
							closedRanges={closedRanges}
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
							workPeriodActions={workPeriodActions}
							onRangeChange={onRangeChange}
							onTimeRangeSelect={onTimeRangeSelect}
							onRefresh={onRefresh}
							workHoursData={workHoursData}
							isSummaryLoading={isSummaryLoading}
						/>
					)}
				</div>
				<CalendarControls
					currentEmployeeId={currentEmployeeId}
					workBalance={workBalance}
					filters={filters}
					onFiltersChange={onFiltersChange}
				/>
			</div>
		</div>
	);
}
