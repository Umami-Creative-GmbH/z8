"use client";

// Temporal polyfill must be imported before Schedule-X
import "temporal-polyfill/global";

import { createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import type {
	DateRange,
	ShiftTemplate,
	ShiftWithRelations,
} from "@/app/[locale]/(app)/scheduling/types";
import { ShiftDialog } from "../shifts/shift-dialog";
import {
	CoverageHeatmapOverlay,
	CoverageSummaryBar,
	useCoverageHeatmap,
} from "./coverage-heatmap-overlay";
import { PublishComplianceDialog } from "./publish-compliance-dialog";
import { PublishFab } from "./publish-fab";
import { ScheduleComplianceBanner } from "./schedule-compliance-banner";
import {
	getWeekDateRange,
	plainDateTimeToDate,
	plainDateTimeToTimeString,
} from "./shift-scheduler-utils";
import { TemplateSidebar } from "./template-sidebar";
import { useShiftPublishFlow } from "./use-shift-publish-flow";
import { useShiftSchedulerData } from "./use-shift-scheduler-data";

interface ShiftSchedulerProps {
	organizationId: string;
	employeeId: string;
	isManager: boolean;
}

export function ShiftScheduler({
	organizationId,
	employeeId: _employeeId,
	isManager,
}: ShiftSchedulerProps) {
	const { resolvedTheme } = useTheme();
	const [dateRange, setDateRange] = useState<DateRange>(getWeekDateRange);
	const [selectedShift, setSelectedShift] = useState<ShiftWithRelations | null>(null);
	const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
	const [newShiftDate, setNewShiftDate] = useState<Date | null>(null);
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
	} = useShiftSchedulerData({ organizationId, dateRange, isManager });
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

	// Handle event click - Schedule-X passes (event, uiEvent)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handleEventClick = useCallback(
		(event: any, _e: UIEvent) => {
			const eventId = event?.id as string | undefined;
			if (!eventId) return;
			const shift = shifts.find((s) => s.id === eventId);
			if (shift) {
				setSelectedShift(shift);
				setIsShiftDialogOpen(true);
			}
		},
		[shifts],
	);

	// Handle drag end - Schedule-X passes the updated event with Temporal types
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handleEventUpdate = useCallback(
		(updatedEvent: any) => {
			if (!isManager) return;

			const eventId = updatedEvent?.id as string | undefined;
			const eventStart = updatedEvent?.start as Temporal.PlainDateTime | undefined;
			const eventEnd = updatedEvent?.end as Temporal.PlainDateTime | undefined;
			if (!eventId || !eventStart || !eventEnd) return;

			const shift = shifts.find((s) => s.id === eventId);
			if (!shift) return;

			updateShift({
				id: shift.id,
				employeeId: shift.employeeId,
				subareaId: shift.subareaId,
				date: plainDateTimeToDate(eventStart),
				startTime: plainDateTimeToTimeString(eventStart),
				endTime: plainDateTimeToTimeString(eventEnd),
			});
		},
		[isManager, shifts, updateShift],
	);

	// Handle date range change from calendar
	const handleRangeChange = useCallback(
		(range: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }) => {
			setDateRange({
				start: new Date(range.start.epochMilliseconds),
				end: new Date(range.end.epochMilliseconds),
			});
		},
		[],
	);

	// Handle template drop (create new shift)
	const handleTemplateDrop = useCallback((_template: ShiftTemplate, date: Date) => {
		setNewShiftDate(date);
		setSelectedShift(null);
		setIsShiftDialogOpen(true);
	}, []);

	// Create calendar
	const calendar = useCalendarApp({
		views: [createViewWeek(), createViewMonthGrid()],
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
		plugins: [...(isManager ? [createDragAndDropPlugin()] : []), createEventModalPlugin()],
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
	}, [calendar, events]);

	// Update dark mode when theme changes
	useEffect(() => {
		if (calendar) {
			calendar.setTheme(isDark ? "dark" : "light");
		}
	}, [calendar, isDark]);

	if (shiftsLoading) {
		return (
			<div className="flex items-center justify-center py-20">
				<div className="animate-pulse text-muted-foreground">Loading schedule...</div>
			</div>
		);
	}

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

			<div className="flex gap-4 flex-1 min-h-0">
				{/* Template sidebar for managers */}
				{isManager && <TemplateSidebar templates={templates} onTemplateDrop={handleTemplateDrop} />}

				{/* Main calendar */}
				<div className="flex-1 relative h-full overflow-hidden">
					<ScheduleXCalendar calendarApp={calendar} />

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
