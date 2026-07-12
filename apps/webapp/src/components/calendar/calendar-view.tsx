"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { useOrganization } from "@/hooks/use-organization";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { todayCalendarDateKey } from "@/lib/calendar/date-keys";
import type { CalendarEvent } from "@/lib/calendar/types";
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
import { useRouter } from "@/navigation";
import { CalendarEventDialogs } from "./calendar-event-dialogs";
import { CalendarMainContent } from "./calendar-main-content";
import type { ViewMode } from "./schedule-x-calendar";

interface CalendarViewProps {
	organizationId: string;
	currentEmployeeId?: string;
	initialSelectedEmployeeId?: string;
	initialDateKey?: string;
	initialTimezone?: string;
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

const getEmployeeDisplayName = (employee?: SelectableEmployee) => {
	if (!employee) return null;
	return buildAuthUserDisplayName(employee.user);
};

export function CalendarView({
	organizationId,
	currentEmployeeId,
	initialSelectedEmployeeId,
	initialDateKey,
	initialTimezone,
}: CalendarViewProps) {
	const calendarTimezone = initialTimezone ?? "UTC";
	const calendarDateKey = initialDateKey ?? todayCalendarDateKey(calendarTimezone);

	return (
		<CalendarViewContent
			key={`${calendarDateKey}:${calendarTimezone}`}
			organizationId={organizationId}
			currentEmployeeId={currentEmployeeId}
			initialSelectedEmployeeId={initialSelectedEmployeeId}
			initialDateKey={calendarDateKey}
			initialTimezone={calendarTimezone}
		/>
	);
}

function CalendarViewContent({
	organizationId,
	currentEmployeeId,
	initialSelectedEmployeeId,
	initialDateKey,
	initialTimezone,
}: CalendarViewProps) {
	const router = useRouter();
	const locale = useLocale();
	const timeFormat = useTimeFormat();
	const { t } = useTranslate();
	const { isManagerOrAbove } = useOrganization();
	const initialEmployeeId = initialSelectedEmployeeId ?? currentEmployeeId ?? null;
	const initialCalendarTimezone = initialTimezone ?? "UTC";
	const [viewMode, setViewMode] = useState<ViewMode>("week");

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			if (window.matchMedia("(max-width: 767px)").matches) {
				setViewMode("day");
			}
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, []);
	const [employeeSelectionOverride, setEmployeeSelectionOverride] =
		useState<EmployeeSelectionOverride | null>(null);
	const activeEmployeeSelectionOverride =
		employeeSelectionOverride && employeeSelectionOverride.id !== initialEmployeeId
			? employeeSelectionOverride
			: null;
	const selectedEmployeeId = activeEmployeeSelectionOverride?.id ?? initialEmployeeId;
	const selectedEmployeeName = activeEmployeeSelectionOverride?.name ?? null;
	const [currentDateKey, setCurrentDateKey] = useState(
		() => initialDateKey ?? todayCalendarDateKey(initialCalendarTimezone),
	);
	const currentCalendarDate = Temporal.PlainDate.from(currentDateKey);
	const currentYear = currentCalendarDate.year;
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	const [pendingClockOutEvent, setPendingClockOutEvent] = useState<CalendarEvent | null>(null);
	const [isClockOutPending, setIsClockOutPending] = useState(false);

	const [showSplitDialog, setShowSplitDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [manualEntryOpen, setManualEntryOpen] = useState(false);
	const [manualEntryDefaults, setManualEntryDefaults] = useState<ManualEntryDefaults | null>(null);
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
		month: currentCalendarDate.month - 1,
		year: currentYear,
		filters: effectiveFilters,
		fullYear: viewMode === "year",
	});
	const calendarTimeZone = calendarTimezone ?? initialCalendarTimezone;
	const calendarDisplayContext = {
		locale,
		timezone: calendarTimeZone,
		timeFormat,
	};
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
	const handleRangeChange = (range: { startDateKey: string; endDateKey: string }) => {
		const start = Temporal.PlainDate.from(range.startDateKey);
		const end = Temporal.PlainDate.from(range.endDateKey);
		const midpoint = start.add({ days: Math.floor(start.until(end).days / 2) });
		setCurrentDateKey(midpoint.toString());
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
	const handleDayClick = (dateKey: string) => {
		setCurrentDateKey(dateKey);
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

			<CalendarEventDialogs
				currentEmployeeId={currentEmployeeId}
				selectedEmployeeId={selectedEmployeeId}
				selectedEmployeeName={selectedEmployeeName}
				calendarTimezone={calendarTimeZone}
				manualEntryOpen={manualEntryOpen}
				manualEntryDefaults={manualEntryDefaults}
				onManualEntryOpenChange={setManualEntryOpen}
				onManualEntrySuccess={refetch}
				pendingClockOut={pendingClockOutEvent !== null}
				isClockOutPending={isClockOutPending}
				onClockOutOpenChange={(open) => {
					if (!open && !isClockOutPending) setPendingClockOutEvent(null);
				}}
				onConfirmClockOut={() => void handleConfirmClockOut()}
				selectedEvent={selectedEvent}
				showSplitDialog={showSplitDialog}
				showDeleteDialog={showDeleteDialog}
				displayContext={calendarDisplayContext}
				onCloseDetails={handleCloseDetails}
				onSplitClick={handleSplitClick}
				onDeleteClick={handleDeleteClick}
				onSplitDialogOpenChange={(open) => !open && setShowSplitDialog(false)}
				onDeleteDialogOpenChange={(open) => !open && setShowDeleteDialog(false)}
				onSplitComplete={handleSplitComplete}
				onDeleteComplete={handleDeleteComplete}
				onNotesUpdated={refetch}
			/>

			<CalendarMainContent
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentEmployeeId={currentEmployeeId}
				selectedEmployeeId={selectedEmployeeId}
				onEmployeeChange={handleEmployeeChange}
				isManagerOrAbove={isManagerOrAbove}
				workBalance={workBalance}
				filters={effectiveFilters}
				onFiltersChange={setFilters}
				events={events}
				completedEvents={completedEvents}
				workHoursData={workHoursData}
				currentYear={currentYear}
				currentDateKey={currentDateKey}
				timeZone={calendarTimeZone}
				isLoading={isLoading}
				isSummaryLoading={isFetching}
				onYearChange={(year) => setCurrentDateKey(currentCalendarDate.with({ year }).toString())}
				onDayClick={handleDayClick}
				onMonthChange={setCurrentDateKey}
				onEventClick={handleEventClick}
				clockOutAllowedWorkPeriodIds={clockOutAllowedWorkPeriodIds}
				onRunningPeriodClockOutRequest={handleRunningPeriodClockOutRequest}
				onRangeChange={handleRangeChange}
				onTimeRangeSelect={handleTimeRangeSelect}
				onRefresh={refetch}
			/>
		</div>
	);
}
