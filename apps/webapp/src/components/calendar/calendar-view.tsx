"use client";

import { useTranslate } from "@tolgee/react";
import { useCallback, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { useOrganization } from "@/hooks/use-organization";
import type { CalendarEvent } from "@/lib/calendar/types";
import { CalendarFiltersComponent } from "./calendar-filters";
import { CalendarLegend } from "./calendar-legend";
import { EventDetailsPanel } from "./event-details-panel";
import { ScheduleXCalendarWrapper, type ViewMode } from "./schedule-x-calendar";
import { YearCalendarView } from "./year-calendar-view";

interface CalendarViewProps {
	organizationId: string;
	currentEmployeeId?: string;
}

export function CalendarView({ organizationId, currentEmployeeId }: CalendarViewProps) {
	const { t } = useTranslate();
	const { isManagerOrAbove } = useOrganization();

	// View mode state
	const [viewMode, setViewMode] = useState<ViewMode>("week");

	// Team view toggle (only for managers/admins)
	const [teamView, setTeamView] = useState(false);

	// Current date range for data fetching
	const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
	const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

	// Selected event for details panel
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

	// Event type filters
	const [filters, setFilters] = useState<CalendarFilters>({
		showHolidays: true,
		showAbsences: true,
		showTimeEntries: false,
		showWorkPeriods: true,
		// Default to own data for regular employees, all data for managers in team view
		employeeId: currentEmployeeId,
	});

	// Update employee filter when team view changes
	const handleTeamViewChange = useCallback(
		(isTeamView: boolean) => {
			setTeamView(isTeamView);
			setFilters((prev) => ({
				...prev,
				employeeId: isTeamView ? undefined : currentEmployeeId,
			}));
		},
		[currentEmployeeId],
	);

	// Fetch calendar events
	// When in year view, fetch all 12 months at once
	const { events, isLoading, error } = useCalendarData({
		organizationId,
		month: currentMonth.getMonth(),
		year: viewMode === "year" ? currentYear : currentMonth.getFullYear(),
		filters,
		fullYear: viewMode === "year",
	});

	// Calculate work hours data from work periods
	const workHoursData = useMemo(() => {
		const map = new Map<string, { expected: number; actual: number }>();

		// Group work periods by date and sum up actual hours
		for (const event of events) {
			if (event.type === "work_period") {
				const dateKey = formatDateKey(event.date);
				const existing = map.get(dateKey) || { expected: 8 * 60, actual: 0 }; // Default 8h expected
				existing.actual += event.metadata.durationMinutes || 0;
				map.set(dateKey, existing);
			}
		}

		return map;
	}, [events]);

	// Handle event click
	const handleEventClick = useCallback((event: CalendarEvent) => {
		setSelectedEvent(event);
	}, []);

	// Handle date range change from schedule-x
	const handleRangeChange = useCallback((range: { start: Date; end: Date }) => {
		// Update current month based on range midpoint
		const midpoint = new Date((range.start.getTime() + range.end.getTime()) / 2);
		setCurrentMonth(midpoint);
	}, []);

	// Handle day click from year view
	const handleDayClick = useCallback((date: Date) => {
		setCurrentMonth(date);
		setViewMode("day");
	}, []);

	// Close event details panel
	const handleCloseDetails = useCallback(() => {
		setSelectedEvent(null);
	}, []);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 overflow-hidden min-h-0">
			{/* Error message */}
			{error && (
				<div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm shrink-0">
					{t("calendar.error.loadFailed", "Failed to load calendar events")}: {error.message}
				</div>
			)}

			{/* Team toggle - only for managers and admins */}
			{isManagerOrAbove && (
				<div className="flex items-center justify-end shrink-0">
					<Tabs
						value={teamView ? "team" : "personal"}
						onValueChange={(v) => handleTeamViewChange(v === "team")}
					>
						<TabsList>
							<TabsTrigger value="personal">
								{t("calendar.view.personal", "My Calendar")}
							</TabsTrigger>
							<TabsTrigger value="team">{t("calendar.view.team", "Team Calendar")}</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
			)}

			{/* Main content grid */}
			<div className={viewMode === "year" ? "flex-1 min-h-0" : "grid gap-4 md:grid-cols-[250px_1fr] flex-1 min-h-0"}>
				{/* Filters sidebar - hidden for year view */}
				{viewMode !== "year" && (
					<div className="space-y-4 order-2 md:order-1">
						<CalendarFiltersComponent
							filters={filters}
							onFiltersChange={setFilters}
							currentEmployeeId={currentEmployeeId}
						/>
						<CalendarLegend />
					</div>
				)}

				{/* Calendar - flex-1 ensures it takes remaining space, overflow-hidden contains the scroll */}
				<div className={viewMode === "year" ? "flex flex-col flex-1 min-h-0 overflow-hidden" : "flex flex-col flex-1 order-1 md:order-2 min-h-0 overflow-hidden"}>
					{viewMode === "year" ? (
						<YearCalendarView
							events={events}
							year={currentYear}
							viewMode={viewMode}
							onYearChange={setCurrentYear}
							onViewModeChange={setViewMode}
							onDayClick={handleDayClick}
							workHoursData={workHoursData}
						/>
					) : (
						<ScheduleXCalendarWrapper
							events={events}
							isLoading={isLoading}
							viewMode={viewMode}
							onViewModeChange={setViewMode}
							onEventClick={handleEventClick}
							onRangeChange={handleRangeChange}
						/>
					)}
				</div>
			</div>

			{/* Event details panel */}
			{selectedEvent && (
				<EventDetailsPanel event={selectedEvent} onClose={handleCloseDetails} />
			)}
		</div>
	);
}

// Helper function to format date key
function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
