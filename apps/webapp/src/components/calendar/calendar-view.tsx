"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import type { SelectableEmployee } from "@/components/employee-select/types";
import {
	useTimeFormat,
	useWeekStartDay,
} from "@/components/providers/user-preferences-provider";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { useLiveWorkNow } from "@/hooks/use-live-work-now";
import { useOrganization } from "@/hooks/use-organization";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	calendarWeekDateKeyRange,
	todayCalendarDateKey,
} from "@/lib/calendar/date-keys";
import type { CalendarEvent } from "@/lib/calendar/types";
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
import { projectTaskRefusalMessage } from "@/lib/projects/project-task-model";
import { namedTaskId } from "@/lib/time-tracking/task-attribution";
import { useRouter } from "@/navigation";
import { CalendarEventDialogs } from "./calendar-event-dialogs";
import type { OnBehalfClockOutTaskChoice } from "./clock-out-on-behalf-dialog";
import { CalendarMainContent } from "./calendar-main-content";
import type { ViewMode } from "./schedule-x-calendar";
import type { WorkPeriodActions } from "./work-period-context-menu";

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

function useClockOutOnBehalf({
	currentEmployeeId,
	events,
	isManagerOrAbove,
	refetch,
}: {
	currentEmployeeId?: string;
	events: CalendarEvent[];
	isManagerOrAbove: boolean;
	refetch: () => unknown;
}) {
	const { t } = useTranslate();
	const [pendingClockOutEvent, setPendingClockOutEvent] =
		useState<CalendarEvent | null>(null);
	const [isClockOutPending, setIsClockOutPending] = useState(false);
	// One identity per intended closure, resent on every retry until it succeeds,
	// so a lost response replays the committed clock-out instead of failing (#276).
	const operationIdsRef = useRef(new Map<string, string>());

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

	const handleConfirmClockOut = async (choice?: OnBehalfClockOutTaskChoice) => {
		if (!pendingClockOutEvent || isClockOutPending) return;

		setIsClockOutPending(true);
		const workPeriodId = pendingClockOutEvent.id;
		// Omitted, the running work's task stays with its project (#874).
		const taskId = choice?.taskId;
		// The explicit billable choice (#900); omitted keeps the work's billability.
		const billable = choice?.billable;
		// Task and billability are part of the intended closure: another choice is another closure.
		const closureKey = `${workPeriodId}:${taskId === undefined ? "keep" : (taskId ?? "clear")}:${billable ?? "keep"}`;
		const operationId =
			operationIdsRef.current.get(closureKey) ??
			globalThis.crypto.randomUUID();
		operationIdsRef.current.set(closureKey, operationId);

		await (async () => {
			try {
				const response = await fetch("/api/time-entries/clock-out-on-behalf", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						workPeriodId,
						operationId,
						...namedTaskId(taskId),
						...(billable === undefined ? {} : { billable }),
					}),
				});

				if (!response.ok) {
					let message = t(
						"calendar.clockOutOnBehalf.error",
						"Failed to clock out employee",
					);

					try {
						const body = (await response.json()) as { error?: unknown; reason?: unknown };
						const taskRefusal = projectTaskRefusalMessage(
							typeof body.reason === "string" ? body.reason : null,
						);
						if (taskRefusal) {
							message = t(taskRefusal[0], taskRefusal[1]);
						} else if (typeof body.error === "string" && body.error.length > 0) {
							message = body.error;
						}
					} catch {
						// Keep the translated fallback when the server does not return JSON.
					}

					toast.error(message);
					return;
				}

				operationIdsRef.current.delete(closureKey);
				toast.success(
					t(
						"calendar.clockOutOnBehalf.success",
						"Employee clocked out successfully",
					),
				);
				setPendingClockOutEvent(null);
				refetch();
			} catch {
				toast.error(
					t("calendar.clockOutOnBehalf.error", "Failed to clock out employee"),
				);
			}
		})().finally(() => {
			setIsClockOutPending(false);
		});
	};

	return {
		clockOutAllowedWorkPeriodIds,
		handleConfirmClockOut,
		handleRunningPeriodClockOutRequest,
		isClockOutPending,
		pendingClockOutEvent,
		setPendingClockOutEvent,
	};
}

export function CalendarView({
	organizationId,
	currentEmployeeId,
	initialSelectedEmployeeId,
	initialDateKey,
	initialTimezone,
}: CalendarViewProps) {
	const calendarTimezone = initialTimezone ?? "UTC";
	const calendarDateKey =
		initialDateKey ?? todayCalendarDateKey(calendarTimezone);

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
	const { t } = useTranslate();
	const router = useRouter();
	const locale = useLocale();
	const timeFormat = useTimeFormat();
	const weekStartDay = useWeekStartDay();
	const { isManagerOrAbove } = useOrganization();
	const initialEmployeeId =
		initialSelectedEmployeeId ?? currentEmployeeId ?? null;
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
		employeeSelectionOverride &&
		employeeSelectionOverride.id !== initialEmployeeId
			? employeeSelectionOverride
			: null;
	const selectedEmployeeId =
		activeEmployeeSelectionOverride?.id ?? initialEmployeeId;
	const selectedEmployeeName = activeEmployeeSelectionOverride?.name ?? null;
	const [currentDateKey, setCurrentDateKey] = useState(
		() => initialDateKey ?? todayCalendarDateKey(initialCalendarTimezone),
	);
	const visibleDateRange = calendarWeekDateKeyRange(
		currentDateKey,
		weekStartDay,
	);
	const currentCalendarDate = Temporal.PlainDate.from(currentDateKey);
	const currentYear = currentCalendarDate.year;
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
		null,
	);

	const [showSplitDialog, setShowSplitDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	// Context menu entry point (#507): "Edit" opens the time form, "Delete"
	// opens only the deletion dialog.
	const [initialTimeEditing, setInitialTimeEditing] = useState(false);
	const [deleteFromContextMenu, setDeleteFromContextMenu] = useState(false);
	const [manualEntryOpen, setManualEntryOpen] = useState(false);
	const [manualEntryDefaults, setManualEntryDefaults] =
		useState<ManualEntryDefaults | null>(null);
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
	const handleEmployeeChange = (
		employeeId: string | null,
		employee?: SelectableEmployee,
	) => {
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
		liveWork,
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
		dateRange: viewMode === "week" ? visibleDateRange : undefined,
	});
	const calendarTimeZone = calendarTimezone ?? initialCalendarTimezone;
	const calendarDisplayContext = {
		locale,
		timezone: calendarTimeZone,
		timeFormat,
	};
	const completedEvents = events.filter((event) => !isRunningWorkPeriod(event));
	const liveWorkNow = useLiveWorkNow(liveWork);

	// Day totals count live work as it runs, advancing on each elapsed minute.
	const workHoursData = buildDailyWorkHoursSummaries({
		dailyRequirements,
		dailyActualMinutes,
		liveWork: liveWorkNow ? liveWork : [],
		timezone: calendarTimeZone,
		now: liveWorkNow ?? undefined,
	});
	const {
		clockOutAllowedWorkPeriodIds,
		handleConfirmClockOut,
		handleRunningPeriodClockOutRequest,
		isClockOutPending,
		pendingClockOutEvent,
		setPendingClockOutEvent,
	} = useClockOutOnBehalf({
		currentEmployeeId,
		events,
		isManagerOrAbove,
		refetch,
	});

	// Handle event click
	const handleEventClick = (event: CalendarEvent) => {
		setInitialTimeEditing(false);
		setDeleteFromContextMenu(false);
		setSelectedEvent(event);
	};

	// Own entries follow the change policy; managers, admins and owners change
	// their employees' entries through the approval chain. The server decides.
	const workPeriodActions: WorkPeriodActions = {
		canManage: (event) =>
			event.metadata.employeeId === currentEmployeeId || isManagerOrAbove,
		onEdit: (event) => {
			setShowSplitDialog(false);
			setShowDeleteDialog(false);
			setDeleteFromContextMenu(false);
			setInitialTimeEditing(true);
			setSelectedEvent(event);
		},
		onDelete: (event) => {
			setShowSplitDialog(false);
			setInitialTimeEditing(false);
			setDeleteFromContextMenu(true);
			setShowDeleteDialog(true);
			setSelectedEvent(event);
		},
	};

	// Handle date range change from schedule-x
	const handleRangeChange = (range: {
		startDateKey: string;
		endDateKey: string;
	}) => {
		try {
			const start = Temporal.PlainDate.from(range.startDateKey);
			const end = Temporal.PlainDate.from(range.endDateKey);
			if (start.until(end).days !== 6) return;

			setCurrentDateKey(start.add({ days: 3 }).toString());
		} catch {
			// Ignore malformed or non-week ranges reported while Schedule-X changes views.
		}
	};

	const handleTimeRangeSelect = (range: { start: Date; end: Date }) => {
		const [clockInDate, clockOutDate] =
			range.start.getTime() <= range.end.getTime()
				? [range.start, range.end]
				: [range.end, range.start];
		const clockIn = DateTime.fromJSDate(clockInDate, {
			zone: calendarTimeZone,
		});
		const clockOut = DateTime.fromJSDate(clockOutDate, {
			zone: calendarTimeZone,
		});

		setManualEntryDefaults({
			date: clockIn.toISODate() ?? "",
			clockInTime: clockIn.toFormat("HH:mm"),
			clockOutTime: clockOut.toFormat("HH:mm"),
		});
		setManualEntryOpen(true);
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
		setInitialTimeEditing(false);
		setDeleteFromContextMenu(false);
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
		setDeleteFromContextMenu(false);
		setShowDeleteDialog(true);
	};

	// Cancelling a context-menu deletion closes everything; from the edit
	// panel it returns to the panel.
	const handleDeleteDialogOpenChange = (open: boolean) => {
		if (open) return;
		if (deleteFromContextMenu) {
			handleCloseDetails();
			return;
		}
		setShowDeleteDialog(false);
	};

	// Handle delete complete
	const handleDeleteComplete = () => {
		setShowDeleteDialog(false);
		setSelectedEvent(null);
		refetch();
	};

	// The selected event holds the old times, so close the panel after a time edit
	const handleTimesUpdated = () => {
		setSelectedEvent(null);
		refetch();
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 overflow-hidden min-h-0">
			{/* Error message */}
			{error && (
				<div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm shrink-0">
					{t(
						"calendar.loadEventsError",
						"Failed to load calendar events: {message}",
						{ message: error.message },
					)}
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
				pendingClockOutEvent={pendingClockOutEvent}
				isClockOutPending={isClockOutPending}
				onClockOutOpenChange={(open) => {
					if (!open && !isClockOutPending) setPendingClockOutEvent(null);
				}}
				onConfirmClockOut={(choice) => void handleConfirmClockOut(choice)}
				selectedEvent={selectedEvent}
				showSplitDialog={showSplitDialog}
				showDeleteDialog={showDeleteDialog}
				initialTimeEditing={initialTimeEditing}
				displayContext={calendarDisplayContext}
				onCloseDetails={handleCloseDetails}
				onSplitClick={handleSplitClick}
				onDeleteClick={handleDeleteClick}
				onSplitDialogOpenChange={(open) => !open && setShowSplitDialog(false)}
				onDeleteDialogOpenChange={handleDeleteDialogOpenChange}
				onSplitComplete={handleSplitComplete}
				onDeleteComplete={handleDeleteComplete}
				onNotesUpdated={refetch}
				onTimesUpdated={handleTimesUpdated}
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
				onYearChange={(year) =>
					setCurrentDateKey(currentCalendarDate.with({ year }).toString())
				}
				onDayClick={handleDayClick}
				onMonthChange={setCurrentDateKey}
				onEventClick={handleEventClick}
				clockOutAllowedWorkPeriodIds={clockOutAllowedWorkPeriodIds}
				onRunningPeriodClockOutRequest={handleRunningPeriodClockOutRequest}
				workPeriodActions={workPeriodActions}
				onRangeChange={handleRangeChange}
				onTimeRangeSelect={handleTimeRangeSelect}
				onRefresh={refetch}
			/>
		</div>
	);
}
