"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { CalendarFiltersComponent } from "./calendar-filters";
import { CalendarLegend } from "./calendar-legend";
import { CalendarWithEvents } from "./calendar-with-events";
import { DayDetails } from "./day-details";

interface CalendarViewProps {
	organizationId: string;
	currentEmployeeId?: string;
}

export function CalendarView({ organizationId, currentEmployeeId }: CalendarViewProps) {
	const { t } = useTranslate();
	const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
	const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

	const [filters, setFilters] = useState<CalendarFilters>({
		showHolidays: true,
		showAbsences: true,
		showTimeEntries: false,
		showWorkPeriods: true,
	});

	const { events, eventsByDate, isLoading, error } = useCalendarData({
		organizationId,
		month: currentMonth.getMonth(),
		year: currentMonth.getFullYear(),
		filters,
	});

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			{error && (
				<div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
					{t("calendar.error.loadFailed", "Failed to load calendar events")}: {error.message}
				</div>
			)}

			<div className="grid gap-4 md:grid-cols-[1fr_300px]">
				{/* Main calendar */}
				<div className="space-y-4">
					<CalendarWithEvents
						selected={selectedDate}
						onSelect={setSelectedDate}
						month={currentMonth}
						onMonthChange={setCurrentMonth}
						eventsByDate={eventsByDate}
					/>

					{/* Day details below calendar on mobile */}
					<div className="md:hidden">
						<DayDetails selectedDate={selectedDate || null} events={events} />
					</div>
				</div>

				{/* Sidebar */}
				<div className="space-y-4">
					{/* Filters */}
					<CalendarFiltersComponent
						filters={filters}
						onFiltersChange={setFilters}
						currentEmployeeId={currentEmployeeId}
					/>

					{/* Legend */}
					<CalendarLegend />

					{/* Day details on desktop */}
					<div className="hidden md:block">
						<DayDetails selectedDate={selectedDate || null} events={events} />
					</div>
				</div>
			</div>

			{isLoading && (
				<div className="fixed inset-0 bg-background/80 flex items-center justify-center">
					<div className="text-sm text-muted-foreground">
						{t("calendar.loading", "Loading calendar...")}
					</div>
				</div>
			)}
		</div>
	);
}
