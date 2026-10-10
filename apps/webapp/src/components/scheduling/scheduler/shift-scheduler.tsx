"use client";

// Temporal polyfill must be imported before Schedule-X
import "temporal-polyfill/global";

import { createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import type {
	DateRange,
	ShiftTemplate,
	ShiftWithRelations,
} from "@/app/[locale]/(app)/scheduling/types";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { PlainDate, ZonedDateTime } from "@/lib/datetime/temporal-core";
import { ShiftDialog } from "../shifts/shift-dialog";
import { EmployeeShiftSchedule } from "./employee-shift-schedule";
import {
	CoverageHeatmapOverlay,
	CoverageSummaryBar,
} from "./coverage-heatmap-overlay";
import { PublishComplianceDialog } from "./publish-compliance-dialog";
import { PublishFab } from "./publish-fab";
import { ScheduleComplianceBanner } from "./schedule-compliance-banner";
import { createScheduleXDragAndDropPlugin } from "./schedule-x-drag-and-drop";
import {
	calendarRangeToDateRange,
	eventToShiftTimes,
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
				organizationId={props.organizationId}
				organizationTimezone={props.organizationTimezone}
				focusDate={props.focusDate}
			/>
		);
	}
	return <PlannerShiftScheduler {...props} />;
}

function PlannerShiftScheduler({
	organizationId,
	organizationTimezone,
	employeeId: _employeeId,
	isManager,
	focusEmployeeId,
	focusDate,
}: ShiftSchedulerProps) {
	const { t } = useTranslate();
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
	const [showCoverageOverlay, setShowCoverageOverlay] = useState(true);
	const isDark = resolvedTheme === "dark";

	const {
		shifts,
		templates,
		events,
		shiftsLoading,
		complianceSummary,
		draftCount,
		complianceFindingsCount,
		hasComplianceWarnings,
		updateShift,
	} = useShiftSchedulerData({
		organizationId,
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
	const { data: coverageData, hasGaps: hasCoverageGaps } = useCoverageHeatmap(
		organizationId,
		dateRange,
		isManager && showCoverageOverlay,
	);

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
			setSelectedShift(shift);
			setIsShiftDialogOpen(true);
		}
	};

	// Drag end: Schedule-X passes the moved event in the organization's zone.
	const handleEventUpdate = (updatedEvent: {
		id: string | number;
		start: ZonedDateTime | PlainDate;
		end: ZonedDateTime | PlainDate;
	}) => {
		if (!isManager) return;
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

	// Handle template drop (create new shift)
	const handleTemplateDrop = (_template: ShiftTemplate, date: Date) => {
		setNewShiftDate(
			Temporal.Instant.fromEpochMilliseconds(date.getTime())
				.toZonedDateTimeISO("UTC")
				.toPlainDate()
				.toString(),
		);
		setSelectedShift(null);
		setIsShiftDialogOpen(true);
	};

	// Create calendar
	const calendar = useCalendarApp({
		views: [createViewWeek(), createViewMonthGrid()],
		selectedDate: initialView.selectedDate,
		timezone: organizationTimezone,
		firstDayOfWeek: scheduleXFirstDayOfWeek(weekStartDay),
		events,
		isDark,
		calendars: {
			published: {
				colorName: "published",
				lightColors: {
					main: "#3b82f6",
					container: "#dbeafe",
					onContainer: "#1e40af",
				},
				darkColors: {
					main: "#60a5fa",
					container: "#1e3a8a",
					onContainer: "#bfdbfe",
				},
			},
			draft: {
				colorName: "draft",
				lightColors: {
					main: "#9ca3af",
					container: "#f3f4f6",
					onContainer: "#374151",
				},
				darkColors: {
					main: "#6b7280",
					container: "#374151",
					onContainer: "#d1d5db",
				},
			},
			open: {
				colorName: "open",
				lightColors: {
					main: "#f59e0b",
					container: "#fef3c7",
					onContainer: "#92400e",
				},
				darkColors: {
					main: "#fbbf24",
					container: "#78350f",
					onContainer: "#fde68a",
				},
			},
		},
		// No event modal: a click opens the shift dialog, which the modal would only duplicate.
		plugins: isManager ? [createScheduleXDragAndDropPlugin()] : [],
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

	return (
		<div className="flex flex-col gap-4 h-[calc(100vh-200px)]">
			{isManager && <ScheduleComplianceBanner summary={complianceSummary} />}

			{/* Coverage summary bar and toggle for managers */}
			{isManager && (
				<div className="flex items-center gap-4">
					<CoverageHeatmapOverlay
						organizationId={organizationId}
						dateRange={dateRange}
						visible={showCoverageOverlay}
						onToggle={() => setShowCoverageOverlay((v) => !v)}
					/>
				</div>
			)}

			{/* Coverage summary when visible */}
			{isManager && showCoverageOverlay && coverageData.length > 0 && (
				<CoverageSummaryBar data={coverageData} visible={showCoverageOverlay} />
			)}

			{employeeFilter && (
				<EmployeeFilterNotice
					employeeId={employeeFilter}
					shifts={shifts}
					onShowAll={() => setShowAllEmployees(true)}
				/>
			)}

			<div className="flex gap-4 flex-1 min-h-0">
				{/* Template sidebar for managers */}
				{isManager && <TemplateSidebar templates={templates} onTemplateDrop={handleTemplateDrop} />}

				{/* Main calendar */}
				{/* `isolate` keeps Schedule-X's z-indexes (sticky header 100) below dialogs and sheets. */}
				<div className="flex-1 relative isolate h-full overflow-hidden">
					<ScheduleXCalendar calendarApp={calendar} />
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

					{/* Publish FAB for managers with draft shifts */}
					{isManager && draftCount > 0 && (
						<PublishFab
							draftCount={draftCount}
							onPublish={publish}
							isPublishing={isPublishing}
							hasCoverageGaps={hasCoverageGaps}
							hasComplianceWarnings={hasComplianceWarnings}
							complianceFindingsCount={complianceFindingsCount}
						/>
					)}
				</div>
			</div>

			{/* Shift dialog */}
			<ShiftDialog
				open={isShiftDialogOpen}
				onOpenChange={setIsShiftDialogOpen}
				shift={selectedShift}
				templates={templates}
				isManager={isManager}
				defaultDate={newShiftDate}
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
