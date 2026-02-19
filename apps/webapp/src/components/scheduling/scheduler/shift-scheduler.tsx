"use client";

// Temporal polyfill must be imported before Schedule-X
import "temporal-polyfill/global";

import { createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	getIncompleteDays,
	getScheduleComplianceSummary,
	getShifts,
	getShiftTemplates,
	publishShifts,
	upsertShift,
} from "@/app/[locale]/(app)/scheduling/actions";
import type {
	DateRange,
	PublishAcknowledgmentInput,
	PublishShiftsResult,
	ShiftTemplate,
	ShiftWithRelations,
} from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";
import { ShiftDialog } from "../shifts/shift-dialog";
import {
	CoverageHeatmapOverlay,
	CoverageSummaryBar,
	useCoverageHeatmap,
} from "./coverage-heatmap-overlay";
import {
	PublishComplianceDialog,
	shouldOpenComplianceDialog,
} from "./publish-compliance-dialog";
import { PublishFab } from "./publish-fab";
import { ScheduleComplianceBanner } from "./schedule-compliance-banner";
import { TemplateSidebar } from "./template-sidebar";

interface ShiftSchedulerProps {
	organizationId: string;
	employeeId: string;
	isManager: boolean;
}

// Convert shift to Schedule-X event format
function shiftToEvent(shift: ShiftWithRelations) {
	const startDate = new Date(shift.date);
	const [startHours, startMinutes] = shift.startTime.split(":").map(Number);
	startDate.setHours(startHours, startMinutes, 0, 0);

	const endDate = new Date(shift.date);
	const [endHours, endMinutes] = shift.endTime.split(":").map(Number);
	endDate.setHours(endHours, endMinutes, 0, 0);

	const isOpenShift = !shift.employeeId;
	const isDraft = shift.status === "draft";

	let title = isOpenShift
		? "Open Shift"
		: `${shift.employee?.firstName || ""} ${shift.employee?.lastName || ""}`.trim() || "Assigned";

	if (isDraft) {
		title = `[Draft] ${title}`;
	}

	return {
		id: shift.id,
		title,
		start: dateToPlainDateTime(startDate),
		end: dateToPlainDateTime(endDate),
		calendarId: isOpenShift ? "open" : isDraft ? "draft" : "published",
		_shiftData: shift,
	};
}

function dateToPlainDateTime(date: Date): Temporal.PlainDateTime {
	return Temporal.PlainDateTime.from({
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
		hour: date.getHours(),
		minute: date.getMinutes(),
	});
}

function getWeekDateRange(): DateRange {
	const today = new Date();
	const dayOfWeek = today.getDay();
	const start = new Date(today);
	start.setDate(today.getDate() - dayOfWeek);
	start.setHours(0, 0, 0, 0);

	const end = new Date(start);
	end.setDate(start.getDate() + 6);
	end.setHours(23, 59, 59, 999);

	return { start, end };
}

export function ShiftScheduler({
	organizationId,
	employeeId: _employeeId,
	isManager,
}: ShiftSchedulerProps) {
	const queryClient = useQueryClient();
	const { resolvedTheme } = useTheme();
	const [dateRange, setDateRange] = useState<DateRange>(getWeekDateRange);
	const [selectedShift, setSelectedShift] = useState<ShiftWithRelations | null>(null);
	const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
	const [newShiftDate, setNewShiftDate] = useState<Date | null>(null);
	const [showCoverageOverlay, setShowCoverageOverlay] = useState(true);
	const [pendingAcknowledgment, setPendingAcknowledgment] = useState<
		Extract<PublishShiftsResult, { published: false; requiresAcknowledgment: true }> | null
	>(null);
	const [isComplianceDialogOpen, setIsComplianceDialogOpen] = useState(false);
	const isDark = resolvedTheme === "dark";

	// Fetch shifts
	const { data: shiftsResult, isLoading: shiftsLoading } = useQuery({
		queryKey: queryKeys.shifts.list(organizationId, dateRange),
		queryFn: async () => {
			const result = await getShifts({
				startDate: dateRange.start,
				endDate: dateRange.end,
				includeOpenShifts: true,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	// Fetch templates for sidebar
	const { data: templatesResult } = useQuery({
		queryKey: queryKeys.shiftTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getShiftTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	// Fetch incomplete days for warnings
	const { data: incompleteDaysResult } = useQuery({
		queryKey: queryKeys.shifts.incomplete(organizationId, dateRange),
		queryFn: async () => {
			const result = await getIncompleteDays(dateRange);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	const shifts = shiftsResult || [];
	const templates = templatesResult || [];
	// Reserved for future use - will be used for day header warnings
	const _incompleteDays = incompleteDaysResult || [];

	// Fetch coverage heatmap data
	const {
		data: coverageData,
		hasGaps: hasCoverageGaps,
	} = useCoverageHeatmap(organizationId, dateRange, isManager && showCoverageOverlay);

	const { data: complianceSummaryResult } = useQuery({
		queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
		queryFn: async () => {
			const result = await getScheduleComplianceSummary(dateRange);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: isManager,
	});

	// Convert shifts to Schedule-X events
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const events = useMemo(() => shifts.map(shiftToEvent) as any[], [shifts]);

	// Mutation for updating shifts
	const updateShiftMutation = useMutation({
		mutationFn: async (data: {
			id: string;
			employeeId?: string | null;
			subareaId: string;
			date: Date;
			startTime: string;
			endTime: string;
		}) => {
			const result = await upsertShift({
				id: data.id,
				employeeId: data.employeeId,
				subareaId: data.subareaId,
				date: data.date,
				startTime: data.startTime,
				endTime: data.endTime,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			if (result.metadata.hasOverlap) {
				toast.warning("Shift saved with overlap warning", {
					description: `This shift overlaps with ${result.metadata.overlappingShifts.length} other shift(s)`,
				});
			} else {
				toast.success("Shift updated");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			toast.error("Failed to update shift", { description: error.message });
		},
	});

	// Mutation for publishing shifts
	const publishMutation = useMutation({
		mutationFn: async (input?: { acknowledgment?: PublishAcknowledgmentInput | null }) => {
			const result = await publishShifts(dateRange, input?.acknowledgment ?? null);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			if (shouldOpenComplianceDialog(result)) {
				setPendingAcknowledgment(result);
				setIsComplianceDialogOpen(true);
				return;
			}

			setPendingAcknowledgment(null);
			setIsComplianceDialogOpen(false);
			toast.success(`Published ${result.count} shift(s)`);
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			toast.error("Failed to publish shifts", { description: error.message });
		},
	});

	const handlePublishConfirm = useCallback(() => {
		if (!pendingAcknowledgment) {
			return;
		}

		publishMutation.mutate({
			acknowledgment: {
				evaluationFingerprint: pendingAcknowledgment.evaluationFingerprint,
			},
		});
	}, [pendingAcknowledgment, publishMutation]);

	// Count draft shifts for publish button
	const draftCount = shifts.filter((s) => s.status === "draft").length;
	const complianceSummary = complianceSummaryResult?.summary;
	const complianceFindingsCount = complianceSummary?.totalFindings ?? 0;
	const hasComplianceWarnings = complianceFindingsCount > 0;

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

			// Extract date and time from Temporal PlainDateTime
			const newDate = new Date(eventStart.year, eventStart.month - 1, eventStart.day);
			const startTime = `${String(eventStart.hour).padStart(2, "0")}:${String(eventStart.minute).padStart(2, "0")}`;
			const endTime = `${String(eventEnd.hour).padStart(2, "0")}:${String(eventEnd.minute).padStart(2, "0")}`;

			updateShiftMutation.mutate({
				id: shift.id,
				employeeId: shift.employeeId,
				subareaId: shift.subareaId,
				date: newDate,
				startTime,
				endTime,
			});
		},
		[isManager, shifts, updateShiftMutation],
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
							onPublish={() => publishMutation.mutate(undefined)}
							isPublishing={publishMutation.isPending}
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
				onConfirm={handlePublishConfirm}
				isConfirming={publishMutation.isPending}
			/>
		</div>
	);
}
