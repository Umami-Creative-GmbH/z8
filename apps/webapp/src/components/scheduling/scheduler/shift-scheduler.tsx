"use client";

// Temporal polyfill must be imported before Schedule-X
import "temporal-polyfill/global";

import { createViewDay, createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { IconPlus } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import type {
	DateRange,
	ShiftTemplate,
	ShiftWithRelations,
} from "@/app/[locale]/(app)/scheduling/types";
import { useTimeFormat, useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { scheduleXTimeAxisFormat, toScheduleXLocale } from "@/lib/calendar/schedule-x-locale";
import { type PlainDate, parsePlainDate, type ZonedDateTime } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { ShiftRequestsReview } from "../shift-requests/shift-requests-panel";
import { ShiftDialog } from "../shifts/shift-dialog";
import { CoverageHeatmapOverlay } from "./coverage-heatmap-overlay";
import { EmployeeShiftSchedule } from "./employee-shift-schedule";
import { PublishComplianceDialog } from "./publish-compliance-dialog";
import { PublishFab } from "./publish-fab";
import { ScheduleComplianceBanner } from "./schedule-compliance-banner";
import { ScheduleReadFailure } from "./schedule-read-failure";
import { ScheduleShiftList } from "./schedule-shift-list";
import { createScheduleXDragAndDropPlugin } from "./schedule-x-drag-and-drop";
import { ScheduleXPortalCalendar } from "./schedule-x-portal-calendar";
import { shiftCalendarEventComponents } from "./shift-calendar-event";
import { SHIFT_CALENDARS } from "./shift-calendars";
import {
	calendarRangeToDateRange,
	eventToShiftTimes,
	filterShiftsForEmployee,
	initialSchedulerView,
	scheduleXFirstDayOfWeek,
} from "./shift-scheduler-utils";
import { TemplateSidebar } from "./template-sidebar";
import { useCoverageHeatmap } from "./use-coverage-heatmap";
import { useShiftPublishFlow } from "./use-shift-publish-flow";
import { useShiftSchedulerData } from "./use-shift-scheduler-data";

interface ShiftSchedulerProps {
	organizationId: string;
	organizationTimezone: string;
	employeeId: string;
	isManager: boolean;
	/** Opens the schedule filtered to this employee (managers only). */
	focusEmployeeId: string | null;
	/** Opens the schedule on the week of this calendar date (YYYY-MM-DD). */
	focusDate: string | null;
}

export function ShiftScheduler(props: ShiftSchedulerProps) {
	if (!props.isManager) {
		return (
			<EmployeeShiftSchedule
				key={`${props.organizationId}:${props.employeeId}:employee`}
				organizationId={props.organizationId}
				employeeId={props.employeeId}
				organizationTimezone={props.organizationTimezone}
				focusDate={props.focusDate}
			/>
		);
	}
	return (
		<PlannerShiftScheduler key={`${props.organizationId}:${props.employeeId}:planner`} {...props} />
	);
}

function PlannerShiftScheduler({
	organizationId,
	organizationTimezone,
	employeeId,
	isManager,
	focusEmployeeId,
	focusDate,
}: ShiftSchedulerProps) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const { resolvedTheme } = useTheme();
	const weekStartDay = useWeekStartDay();
	const [initialView] = useState(() =>
		initialSchedulerView(focusDate, organizationTimezone, weekStartDay),
	);
	const [dateRange, setDateRange] = useState<DateRange>(initialView.dateRange);
	const [showAllEmployees, setShowAllEmployees] = useState(false);
	const employeeFilter = showAllEmployees ? null : focusEmployeeId;
	const [selectedShift, setSelectedShift] = useState<ShiftWithRelations | null>(null);
	const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
	const [newShiftDate, setNewShiftDate] = useState<string | null>(null);
	const [newTemplateId, setNewTemplateId] = useState<string | null>(null);
	const [showCoverageOverlay, setShowCoverageOverlay] = useState(true);
	const isDark = resolvedTheme === "dark";

	const {
		shifts,
		templates,
		events,
		shiftsLoading,
		shiftsFailed,
		hasLoadedShifts,
		shiftsFetching,
		retryShifts,
		templatesFailed,
		complianceFailed,
		supportingDataFetching,
		supportingDataRetryPending,
		retrySupportingData,
		complianceSummary,
		draftCount,
		complianceFindingsCount,
		hasComplianceWarnings,
		updateShift,
	} = useShiftSchedulerData({
		organizationId,
		employeeId,
		organizationTimezone,
		dateRange,
		isManager,
		employeeFilter,
	});
	const {
		pendingAcknowledgment,
		isComplianceDialogOpen,
		setIsComplianceDialogOpen,
		publish,
		confirmPublish,
		isPublishing,
	} = useShiftPublishFlow({ organizationId, dateRange });

	// Fetch coverage heatmap data
	const { hasGaps: hasCoverageGaps, readState: coverageState } = useCoverageHeatmap(
		organizationId,
		dateRange,
		showCoverageOverlay,
		employeeId,
	);

	const createShift = (template?: ShiftTemplate) => {
		setNewShiftDate(dateRange.startDate);
		setNewTemplateId(template?.id ?? null);
		setSelectedShift(null);
		setIsShiftDialogOpen(true);
	};

	const selectShift = (shift: ShiftWithRelations) => {
		setSelectedShift(shift);
		setIsShiftDialogOpen(true);
	};
	const calendar = usePlannerCalendar({
		shifts,
		updateShift,
		events,
		onSelectShift: selectShift,
		setDateRange,
		organizationTimezone,
		locale,
		initialView,
		weekStartDay,
		isDark,
	});

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
				<p className="text-sm text-muted-foreground tabular-nums">
					{formatPlainDate(parsePlainDate(dateRange.startDate), locale, "dateMedium")} –{" "}
					{formatPlainDate(
						parsePlainDate(dateRange.endDateExclusive).subtract({ days: 1 }),
						locale,
						"dateMedium",
					)}{" "}
					({organizationTimezone})
				</p>
				<Button type="button" onClick={() => createShift()}>
					<IconPlus className="size-4" aria-hidden="true" />
					{t("scheduling:scheduling.shiftDialog.createTitle", "Create Shift")}
				</Button>
			</div>
			{shiftsFailed && (
				<ScheduleReadFailure onRetry={() => void retryShifts()} pending={shiftsFetching}>
					{t(
						"scheduling:scheduling.scheduler.loadFailed",
						"Shifts could not be refreshed. Loaded shifts are retained.",
					)}
				</ScheduleReadFailure>
			)}
			{(templatesFailed || complianceFailed || supportingDataRetryPending) && (
				<ScheduleReadFailure
					onRetry={() => void retrySupportingData()}
					pending={supportingDataFetching}
				>
					{t(
						"scheduling:scheduling.scheduler.supportFailed",
						"Templates or compliance information could not be refreshed. Check again before publishing.",
					)}
				</ScheduleReadFailure>
			)}
			<ScheduleComplianceBanner summary={complianceSummary} />

			{/* Coverage summary bar and toggle for managers */}
			<div className="flex flex-wrap items-center gap-4">
				<CoverageHeatmapOverlay
					organizationId={organizationId}
					employeeId={employeeId}
					dateRange={dateRange}
					visible={showCoverageOverlay}
					onToggle={() => setShowCoverageOverlay((v) => !v)}
				/>
				<ShiftRequestsReview approverId={employeeId} organizationTimezone={organizationTimezone} />
			</div>

			{employeeFilter && (
				<EmployeeFilterNotice
					employeeId={employeeFilter}
					shifts={shifts}
					onShowAll={() => setShowAllEmployees(true)}
				/>
			)}

			<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:flex-row">
				{/* Template sidebar for managers */}
				<div className="order-2 lg:order-none">
					<TemplateSidebar templates={templates} onSelectTemplate={createShift} />
				</div>

				{/* Main calendar */}
				{/* `isolate` keeps Schedule-X's z-indexes (sticky header 100) below dialogs and sheets. */}
				<div className="relative isolate h-[36rem] min-w-0 overflow-auto rounded-lg border lg:flex-1">
					<div className="h-full min-w-[42rem]">
						<ScheduleXPortalCalendar
							calendarApp={calendar}
							customComponents={shiftCalendarEventComponents}
						/>
					</div>
					{/* Over the calendar, not instead of it, so it stays mounted while a new range loads. */}
					{shiftsLoading && (
						<div
							className="absolute inset-0 flex items-center justify-center bg-background/60"
							role="status"
						>
							<span className="animate-pulse text-muted-foreground motion-reduce:animate-none">
								{t("scheduling:scheduling.scheduler.loading", "Loading schedule...")}
							</span>
						</div>
					)}
				</div>
			</div>

			{!shiftsLoading && (!shiftsFailed || hasLoadedShifts) && (
				<ScheduleShiftList
					shifts={filterShiftsForEmployee(shifts, employeeFilter)}
					organizationTimezone={organizationTimezone}
					onSelect={selectShift}
				/>
			)}

			{/* Outside the isolated calendar so later records cannot cover this viewport action. */}
			{draftCount > 0 && (
				<PublishFab
					draftCount={draftCount}
					onPublish={publish}
					isPublishing={isPublishing}
					hasCoverageGaps={coverageState === "ready" && hasCoverageGaps}
					coverageState={coverageState}
					hasComplianceWarnings={hasComplianceWarnings}
					complianceFindingsCount={complianceFindingsCount}
				/>
			)}

			{/* Shift dialog */}
			<ShiftDialog
				open={isShiftDialogOpen}
				onOpenChange={setIsShiftDialogOpen}
				shift={selectedShift}
				templates={templates}
				isManager={isManager}
				defaultDate={newShiftDate}
				defaultTemplateId={newTemplateId}
				organizationId={organizationId}
				organizationTimezone={organizationTimezone}
			/>

			<PublishComplianceDialog
				open={isComplianceDialogOpen}
				onOpenChange={setIsComplianceDialogOpen}
				summary={pendingAcknowledgment?.complianceSummary ?? null}
				onConfirm={confirmPublish}
				isConfirming={isPublishing}
			/>
		</div>
	);
}

function usePlannerCalendar({
	shifts,
	updateShift,
	events,
	onSelectShift,
	setDateRange,
	organizationTimezone,
	locale,
	initialView,
	weekStartDay,
	isDark,
}: Pick<ReturnType<typeof useShiftSchedulerData>, "shifts" | "updateShift" | "events"> & {
	onSelectShift: (shift: ShiftWithRelations) => void;
	setDateRange: (range: DateRange) => void;
	organizationTimezone: string;
	locale: string;
	initialView: ReturnType<typeof initialSchedulerView>;
	weekStartDay: ReturnType<typeof useWeekStartDay>;
	isDark: boolean;
}) {
	// Schedule-X keeps the callbacks of its first render, so they read the latest shifts here.
	const shiftsRef = useRef(shifts);
	const updateShiftRef = useRef(updateShift);
	const resetEventsRef = useRef(() => {});
	useEffect(() => {
		shiftsRef.current = shifts;
		updateShiftRef.current = updateShift;
	}, [shifts, updateShift]);

	const handleEventClick = (event: { id: string | number }) => {
		const shift = shiftsRef.current.find((s) => s.id === event.id);
		if (shift) {
			onSelectShift(shift);
		}
	};

	// Drag end: Schedule-X passes the moved event in the organization's zone.
	const handleEventUpdate = (updatedEvent: {
		id: string | number;
		start: ZonedDateTime | PlainDate;
		end: ZonedDateTime | PlainDate;
	}) => {
		const { start, end } = updatedEvent;
		// Shifts are always timed; an all-day value can't be saved as wall times.
		if (!(start instanceof Temporal.ZonedDateTime && end instanceof Temporal.ZonedDateTime)) return;

		const shift = shiftsRef.current.find((s) => s.id === updatedEvent.id);
		if (!shift) return;

		updateShiftRef.current(
			{
				id: shift.id,
				employeeId: shift.employeeId,
				subareaId: shift.subareaId,
				...eventToShiftTimes({ start, end }, organizationTimezone),
			},
			// The shifts didn't change, so put the dropped event back where it is stored.
			{ onError: () => resetEventsRef.current() },
		);
	};

	const handleRangeChange = (range: { start: ZonedDateTime; end: ZonedDateTime }) => {
		setDateRange(calendarRangeToDateRange(range));
	};

	const timeFormat = useTimeFormat();

	// Create calendar
	const calendar = useCalendarApp({
		views: [createViewDay(), createViewWeek(), createViewMonthGrid()],
		defaultView: "week",
		locale: toScheduleXLocale(locale),
		weekOptions: { timeAxisFormatOptions: scheduleXTimeAxisFormat(timeFormat) },
		isResponsive: false,
		selectedDate: initialView.selectedDate,
		timezone: organizationTimezone,
		firstDayOfWeek: scheduleXFirstDayOfWeek(weekStartDay),
		events,
		isDark,
		calendars: SHIFT_CALENDARS,
		// No event modal: a click opens the shift dialog, which the modal would only duplicate.
		plugins: [createScheduleXDragAndDropPlugin()],
		callbacks: {
			onEventClick: handleEventClick,
			onEventUpdate: handleEventUpdate,
			onRangeUpdate: handleRangeChange,
		},
	});

	// Update events when shifts change
	useEffect(() => {
		if (calendar) {
			calendar.events.set(events);
		}
		resetEventsRef.current = () => calendar?.events.set(events);
	}, [calendar, events]);

	// Update dark mode when theme changes
	useEffect(() => {
		if (calendar) {
			calendar.setTheme(isDark ? "dark" : "light");
		}
	}, [calendar, isDark]);

	return calendar;
}

/** Names the employee the schedule is filtered to, with a way back to everyone. */
function EmployeeFilterNotice({
	employeeId,
	shifts,
	onShowAll,
}: {
	employeeId: string;
	shifts: ShiftWithRelations[];
	onShowAll: () => void;
}) {
	const { t } = useTranslate();
	const employee = shifts.find((shift) => shift.employeeId === employeeId)?.employee;
	const name = employee?.user ? buildAuthUserDisplayName(employee.user) : "";
	return (
		<div className="flex items-center gap-2 text-sm" role="status">
			<span>
				{name
					? t("scheduling:scheduling.scheduler.focus.employee", "Showing shifts for {name}", {
							name,
						})
					: t("scheduling:scheduling.scheduler.focus.anonymous", "Showing one employee's shifts")}
			</span>
			<Button type="button" variant="ghost" size="sm" onClick={onShowAll}>
				{t("scheduling:scheduling.scheduler.focus.showAll", "Show all shifts")}
			</Button>
		</div>
	);
}
