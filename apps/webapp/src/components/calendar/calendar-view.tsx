"use client";

import { IconAdjustmentsHorizontal, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { ManualTimeEntryDialog } from "@/components/time-tracking/manual-time-entry-dialog";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
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

interface EmployeeSelectionOverride {
	id: string | null;
	name: string | null;
}

export function CalendarView({
	organizationId,
	currentEmployeeId,
	initialSelectedEmployeeId,
}: CalendarViewProps) {
	const router = useRouter();
	const { t } = useTranslate();
	const { isManagerOrAbove } = useOrganization();
	const viewerTimeZone = useUserTimezone();
	const initialEmployeeId = initialSelectedEmployeeId ?? currentEmployeeId ?? null;
	const mobileControlsTitle = t("calendar.mobileControls.title", "Filters & Legend");
	const mobileControlsDescription = t(
		"calendar.mobileControls.description",
		"Choose which calendar entries are visible.",
	);

	// View mode state
	const [viewMode, setViewMode] = useState<ViewMode>("week");
	const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			if (window.matchMedia("(max-width: 767px)").matches) {
				setViewMode("day");
			}
		}, 0);

		return () => window.clearTimeout(timeoutId);
	}, []);

	// Selected employee for calendar view (defaults to current user)
	const [employeeSelectionOverride, setEmployeeSelectionOverride] =
		useState<EmployeeSelectionOverride | null>(null);
	const activeEmployeeSelectionOverride =
		employeeSelectionOverride && employeeSelectionOverride.id !== initialEmployeeId
			? employeeSelectionOverride
			: null;
	const selectedEmployeeId = activeEmployeeSelectionOverride?.id ?? initialEmployeeId;
	const selectedEmployeeName = activeEmployeeSelectionOverride?.name ?? null;

	// Current date range for data fetching
	const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
	const [currentYear, setCurrentYear] = useState<number>(() => new Date().getFullYear());

	// Selected event for details panel
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	const [pendingClockOutEvent, setPendingClockOutEvent] = useState<CalendarEvent | null>(null);
	const [isClockOutPending, setIsClockOutPending] = useState(false);

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
	});
	const effectiveFilters: CalendarFilters = {
		...filters,
		// Calendar pages pass the authenticated employee, keeping this scoped by default.
		employeeId: selectedEmployeeId ?? undefined,
	};

	const getEmployeeDisplayName = (employee?: SelectableEmployee) => {
		if (!employee) return null;
		return buildAuthUserDisplayName(employee.user);
	};

	// Handle employee selection change
	const handleEmployeeChange = (employeeId: string | null, employee?: SelectableEmployee) => {
		const nextEmployeeId = employeeId ?? currentEmployeeId ?? null;

		setEmployeeSelectionOverride({
			id: nextEmployeeId,
			name: getEmployeeDisplayName(employee),
		});

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
		isFetching,
		error,
		refetch,
	} = useCalendarData({
		organizationId,
		month: currentMonth.getMonth(),
		year: viewMode === "year" ? currentYear : currentMonth.getFullYear(),
		filters: effectiveFilters,
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

	const canClockOutRunningPeriod = (event: CalendarEvent) => {
		return (
			isManagerOrAbove &&
			isRunningWorkPeriod(event) &&
			event.metadata.employeeId !== currentEmployeeId
		);
	};
	const clockOutAllowedWorkPeriodIds = new Set<string>();
	for (const event of events) {
		if (canClockOutRunningPeriod(event)) {
			clockOutAllowedWorkPeriodIds.add(event.id);
		}
	}

	const handleRunningPeriodClockOutRequest = (event: CalendarEvent) => {
		if (!canClockOutRunningPeriod(event)) return;

		setPendingClockOutEvent(event);
	};

	const handleConfirmClockOut = async () => {
		if (!pendingClockOutEvent || isClockOutPending) return;

		setIsClockOutPending(true);

		try {
			const response = await fetch("/api/time-entries/clock-out-on-behalf", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workPeriodId: pendingClockOutEvent.id }),
			});

			if (!response.ok) {
				let message = t("calendar.clockOutOnBehalf.error", "Failed to clock out employee");

				try {
					const body = (await response.json()) as { error?: unknown };
					if (typeof body.error === "string" && body.error.length > 0) {
						message = body.error;
					}
				} catch {
					// Keep the translated fallback when the server does not return JSON.
				}

				toast.error(message);
				setIsClockOutPending(false);
				return;
			}

			toast.success(t("calendar.clockOutOnBehalf.success", "Employee clocked out successfully"));
			setPendingClockOutEvent(null);
			refetch();
			setIsClockOutPending(false);
		} catch {
			toast.error(t("calendar.clockOutOnBehalf.error", "Failed to clock out employee"));
			setIsClockOutPending(false);
		}
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

			<AlertDialog
				open={pendingClockOutEvent !== null}
				onOpenChange={(open) => {
					if (!open && !isClockOutPending) {
						setPendingClockOutEvent(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("calendar.clockOutOnBehalf.title", "Clock out employee?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"calendar.clockOutOnBehalf.description",
								"This creates an auditable clock-out entry at the current server time. If anything needs adjustment afterward, use corrections.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isClockOutPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<Button
							type="button"
							disabled={isClockOutPending}
							onClick={() => {
								void handleConfirmClockOut();
							}}
						>
							{isClockOutPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							{isClockOutPending
								? t("calendar.clockOutOnBehalf.loading", "Clocking out...")
								: t("calendar.clockOutOnBehalf.confirm", "Clock Out")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
					<div className="space-y-2 order-2 md:order-1 md:space-y-4">
						{/* Employee selector - replaces team toggle for better performance */}
						<CalendarEmployeeSelector
							currentEmployeeId={currentEmployeeId}
							selectedEmployeeId={selectedEmployeeId}
							onEmployeeChange={handleEmployeeChange}
							isManagerOrAbove={isManagerOrAbove}
						/>
						<div data-testid="calendar-desktop-work-balance" className="hidden md:block">
							<WorkBalanceCard balance={workBalance} compact />
						</div>
						<div data-testid="calendar-mobile-work-balance" className="md:hidden">
							<WorkBalanceCard balance={workBalance} compact mobileCompact />
						</div>
						<div data-testid="calendar-desktop-controls" className="hidden space-y-4 md:block">
							<CalendarFiltersComponent
								filters={effectiveFilters}
								onFiltersChange={setFilters}
								currentEmployeeId={currentEmployeeId}
								idPrefix="calendar-desktop"
							/>
							<CalendarLegend />
						</div>
						<div data-testid="calendar-mobile-controls" className="space-y-2 md:hidden">
							<Sheet open={mobileControlsOpen} onOpenChange={setMobileControlsOpen}>
								<SheetTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="h-8 w-full gap-2 px-3"
									>
										<IconAdjustmentsHorizontal className="size-4" />
										{mobileControlsTitle}
									</Button>
								</SheetTrigger>
								<SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
									<SheetHeader>
										<SheetTitle>{mobileControlsTitle}</SheetTitle>
										<SheetDescription>{mobileControlsDescription}</SheetDescription>
									</SheetHeader>
									<div className="space-y-4 p-4 pt-0">
										<CalendarFiltersComponent
											filters={effectiveFilters}
											onFiltersChange={setFilters}
											currentEmployeeId={currentEmployeeId}
											idPrefix="calendar-mobile"
										/>
										<CalendarLegend />
									</div>
								</SheetContent>
							</Sheet>
						</div>
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
							isSummaryLoading={isFetching}
						/>
					) : (
						<ScheduleXWrapper
							events={events}
							timeZone={calendarTimeZone}
							isLoading={isLoading}
							viewMode={viewMode}
							onViewModeChange={setViewMode}
							onEventClick={handleEventClick}
							clockOutAllowedWorkPeriodIds={clockOutAllowedWorkPeriodIds}
							onRunningPeriodClockOutRequest={handleRunningPeriodClockOutRequest}
							onRangeChange={handleRangeChange}
							onTimeRangeSelect={handleTimeRangeSelect}
							onRefresh={refetch}
							workHoursData={workHoursData}
							isSummaryLoading={isFetching}
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
