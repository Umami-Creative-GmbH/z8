"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { ManualTimeEntryDialog } from "@/components/time-tracking/manual-time-entry-dialog";
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { useOrganization } from "@/hooks/use-organization";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { CalendarEvent } from "@/lib/calendar/types";
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
import { useRouter } from "@/navigation";
import { CalendarEmployeeSelector } from "./calendar-employee-selector";
import { CalendarFiltersComponent } from "./calendar-filters";
import { CalendarLegend } from "./calendar-legend";
import { DeleteWorkPeriodDialog } from "./delete-work-period-dialog";
import { EventDetailsPanel } from "./event-details-panel";
import { MonthWorkSummaryView } from "./month-work-summary-view";
import type { ViewMode } from "./schedule-x-calendar";
import { ScheduleXWrapper } from "./schedule-x-wrapper";
import { SplitWorkPeriodDialog } from "./split-work-period-dialog";
import { WorkPeriodEditDialog } from "./work-period-edit-dialog";
import { YearCalendarView } from "./year-calendar-view";

interface CalendarViewProps {
	organizationId: string;
	currentEmployeeId?: string;
	initialSelectedEmployeeId?: string;
}

function isRunningWorkPeriod(event: CalendarEvent): boolean {
	return event.type === "work_period" && event.metadata.isRunning === true;
}

interface ManualEntryDefaults {
	date: string;
	clockInTime: string;
	clockOutTime: string;
}

export function CalendarView({
	organizationId,
	currentEmployeeId,
	initialSelectedEmployeeId,
}: CalendarViewProps) {
	const router = useRouter();
	const { isManagerOrAbove } = useOrganization();
	const viewerTimeZone = useUserTimezone();
	const initialEmployeeId = initialSelectedEmployeeId ?? currentEmployeeId ?? null;

	// View mode state
	const [viewMode, setViewMode] = useState<ViewMode>("week");

	// Selected employee for calendar view (defaults to current user)
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(initialEmployeeId);
	const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null);

	// Current date range for data fetching
	const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
	const [currentYear, setCurrentYear] = useState<number>(() => new Date().getFullYear());

	// Selected event for details panel
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

	// Dialog states for work period actions
	const [showSplitDialog, setShowSplitDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [manualEntryOpen, setManualEntryOpen] = useState(false);
	const [manualEntryDefaults, setManualEntryDefaults] = useState<ManualEntryDefaults | null>(null);

	// Event type filters
	const [filters, setFilters] = useState<CalendarFilters>({
		showHolidays: true,
		showAbsences: true,
		showTimeEntries: false,
		showWorkPeriods: true,
		// Calendar pages pass the authenticated employee, keeping this scoped by default.
		employeeId: initialEmployeeId ?? undefined,
	});

	useEffect(() => {
		setSelectedEmployeeId(initialEmployeeId);
		setSelectedEmployeeName(null);
		setFilters((prev) => {
			const employeeId = initialEmployeeId ?? undefined;

			if (prev.employeeId === employeeId) {
				return prev;
			}

			return {
				...prev,
				employeeId,
			};
		});
	}, [initialEmployeeId]);

	const getEmployeeDisplayName = (employee?: SelectableEmployee) => {
		if (!employee) return null;
		return buildAuthUserDisplayName(employee.user);
	};

	// Handle employee selection change
	const handleEmployeeChange = (employeeId: string | null, employee?: SelectableEmployee) => {
		const nextEmployeeId = employeeId ?? currentEmployeeId ?? null;

		setSelectedEmployeeId(nextEmployeeId);
		setSelectedEmployeeName(getEmployeeDisplayName(employee));
		setFilters((prev) => ({
			...prev,
			// Always prefer the explicit selection, falling back to the current user.
			employeeId: nextEmployeeId ?? undefined,
		}));

		if (!employeeId || employeeId === currentEmployeeId) {
			router.push("/calendar");
			return;
		}

		router.push(`/calendar/${employeeId}`);
	};

	// Fetch calendar events
	// When in year view, fetch all 12 months at once
	const {
		events,
		dailyRequirements,
		dailyActualMinutes,
		workBalance,
		calendarTimezone,
		isLoading,
		error,
		refetch,
	} = useCalendarData({
		organizationId,
		month: currentMonth.getMonth(),
		year: viewMode === "year" ? currentYear : currentMonth.getFullYear(),
		filters,
		fullYear: viewMode === "year",
	});
	const calendarTimeZone = calendarTimezone ?? viewerTimeZone;
	const completedEvents = events.filter((event) => !isRunningWorkPeriod(event));

	const workHoursData = buildDailyWorkHoursSummaries({
		events: completedEvents,
		dailyRequirements,
		dailyActualMinutes,
	});

	// Handle event click
	const handleEventClick = (event: CalendarEvent) => {
		setSelectedEvent(event);
	};

	// Handle date range change from schedule-x
	const handleRangeChange = (range: { start: Date; end: Date }) => {
		// Update current month based on range midpoint
		const midpoint = new Date((range.start.getTime() + range.end.getTime()) / 2);
		setCurrentMonth(midpoint);
	};

	const handleTimeRangeSelect = (range: { start: Date; end: Date }) => {
		const [clockInDate, clockOutDate] =
			range.start.getTime() <= range.end.getTime()
				? [range.start, range.end]
				: [range.end, range.start];
		const clockIn = DateTime.fromJSDate(clockInDate, { zone: calendarTimeZone });
		const clockOut = DateTime.fromJSDate(clockOutDate, { zone: calendarTimeZone });

		setManualEntryDefaults({
			date: clockIn.toISODate() ?? "",
			clockInTime: clockIn.toFormat("HH:mm"),
			clockOutTime: clockOut.toFormat("HH:mm"),
		});
		setManualEntryOpen(true);
	};

	// Handle day click from year view
	const handleDayClick = (date: Date) => {
		setCurrentMonth(date);
		setViewMode("day");
	};

	// Close event details panel
	const handleCloseDetails = () => {
		setSelectedEvent(null);
		setShowSplitDialog(false);
		setShowDeleteDialog(false);
	};

	// Handle split click from edit dialog
	const handleSplitClick = () => {
		setShowSplitDialog(true);
	};

	// Handle split complete
	const handleSplitComplete = () => {
		setShowSplitDialog(false);
		setSelectedEvent(null);
		refetch();
	};

	// Handle delete click from edit dialog
	const handleDeleteClick = () => {
		setShowDeleteDialog(true);
	};

	// Handle delete complete
	const handleDeleteComplete = () => {
		setShowDeleteDialog(false);
		setSelectedEvent(null);
		refetch();
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 overflow-hidden min-h-0">
			{/* Error message */}
			{error && (
				<div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm shrink-0">
					Failed to load calendar events: {error.message}
				</div>
			)}

			<ManualTimeEntryDialog
				employeeId={selectedEmployeeId ?? currentEmployeeId ?? ""}
				employeeTimezone={calendarTimeZone}
				hasManager={false}
				targetEmployeeId={selectedEmployeeId ?? undefined}
				targetEmployeeName={selectedEmployeeName ?? undefined}
				defaultDate={manualEntryDefaults?.date}
				defaultClockInTime={manualEntryDefaults?.clockInTime}
				defaultClockOutTime={manualEntryDefaults?.clockOutTime}
				open={manualEntryOpen}
				onOpenChange={setManualEntryOpen}
				hideTrigger
				onSuccess={refetch}
			/>

			{/* Main content grid */}
			<div
				className={
					viewMode === "year"
						? "flex-1 min-h-0"
						: "grid gap-4 md:grid-cols-[250px_1fr] flex-1 min-h-0"
				}
			>
				{/* Filters sidebar - hidden for year view */}
				{viewMode !== "year" && (
					<div className="space-y-4 order-2 md:order-1">
						{/* Employee selector - replaces team toggle for better performance */}
						<CalendarEmployeeSelector
							currentEmployeeId={currentEmployeeId}
							selectedEmployeeId={selectedEmployeeId}
							onEmployeeChange={handleEmployeeChange}
							isManagerOrAbove={isManagerOrAbove}
						/>
						<WorkBalanceCard balance={workBalance} compact />
						<CalendarFiltersComponent
							filters={filters}
							onFiltersChange={setFilters}
							currentEmployeeId={currentEmployeeId}
						/>
						<CalendarLegend />
					</div>
				)}

				{/* Calendar - flex-1 ensures it takes remaining space, overflow-hidden contains the scroll */}
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
							onYearChange={setCurrentYear}
							onViewModeChange={setViewMode}
							onDayClick={handleDayClick}
							workHoursData={workHoursData}
						/>
					) : viewMode === "month" ? (
						<MonthWorkSummaryView
							monthDate={currentMonth}
							events={completedEvents}
							workHoursData={workHoursData}
							viewMode={viewMode}
							onViewModeChange={setViewMode}
							onMonthChange={setCurrentMonth}
							onDayClick={handleDayClick}
							onRefresh={refetch}
						/>
					) : (
						<ScheduleXWrapper
							events={events}
							timeZone={calendarTimeZone}
							isLoading={isLoading}
							viewMode={viewMode}
							onViewModeChange={setViewMode}
							onEventClick={handleEventClick}
							onRangeChange={handleRangeChange}
							onTimeRangeSelect={handleTimeRangeSelect}
							onRefresh={refetch}
							workHoursData={workHoursData}
						/>
					)}
				</div>
			</div>

			{/* Event details panel - for non-work-period events */}
			{selectedEvent && selectedEvent.type !== "work_period" && (
				<EventDetailsPanel event={selectedEvent} onClose={handleCloseDetails} />
			)}

			{/* Work period edit dialog - for work periods only */}
			{selectedEvent &&
				selectedEvent.type === "work_period" &&
				!showSplitDialog &&
				!showDeleteDialog && (
					<WorkPeriodEditDialog
						event={selectedEvent}
						open={!!selectedEvent && !showSplitDialog && !showDeleteDialog}
						onOpenChange={(open) => !open && handleCloseDetails()}
						onNotesUpdated={refetch}
						onSplitClick={handleSplitClick}
						onDeleteClick={handleDeleteClick}
					/>
				)}

			{/* Split work period dialog */}
			{selectedEvent && selectedEvent.type === "work_period" && showSplitDialog && (
				<SplitWorkPeriodDialog
					event={selectedEvent}
					open={showSplitDialog}
					onOpenChange={(open) => !open && setShowSplitDialog(false)}
					onSplitComplete={handleSplitComplete}
				/>
			)}

			{/* Delete work period dialog (convert to break) */}
			{selectedEvent && selectedEvent.type === "work_period" && showDeleteDialog && (
				<DeleteWorkPeriodDialog
					event={selectedEvent}
					open={showDeleteDialog}
					onOpenChange={(open) => !open && setShowDeleteDialog(false)}
					onDeleteComplete={handleDeleteComplete}
				/>
			)}
		</div>
	);
}
