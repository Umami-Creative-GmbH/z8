"use client";

import { useTranslate } from "@tolgee/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./schedule-x-calendar";

interface YearCalendarViewProps {
	events: CalendarEvent[];
	year: number;
	viewMode: ViewMode;
	onYearChange: (year: number) => void;
	onViewModeChange: (mode: ViewMode) => void;
	onDayClick?: (date: Date) => void;
	workHoursData?: Map<string, { expected: number; actual: number }>;
}

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): Date[] {
	const days: Date[] = [];
	const date = new Date(year, month, 1);
	while (date.getMonth() === month) {
		days.push(new Date(date));
		date.setDate(date.getDate() + 1);
	}
	return days;
}

function getFirstDayOfMonth(year: number, month: number): number {
	return new Date(year, month, 1).getDay();
}

interface MiniMonthProps {
	year: number;
	month: number;
	eventsByDate: Map<string, CalendarEvent[]>;
	workHoursData?: Map<string, { expected: number; actual: number }>;
	onDayClick?: (date: Date) => void;
}

const MiniMonth = memo(function MiniMonth({
	year,
	month,
	eventsByDate,
	workHoursData,
	onDayClick,
}: MiniMonthProps) {
	const days = getDaysInMonth(year, month);
	const firstDay = getFirstDayOfMonth(year, month);
	const today = new Date();
	const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

	// Create padding for days before the first day of the month
	const paddingDays = Array.from({ length: firstDay }, (_, i) => i);

	return (
		<div className="p-2 border rounded-lg bg-card">
			<h3 className="text-sm font-medium text-center mb-2">{MONTHS[month]}</h3>

			{/* Weekday headers */}
			<div className="grid grid-cols-7 gap-0.5 text-center mb-1">
				{WEEKDAYS.map((day) => (
					<div key={day} className="text-[10px] text-muted-foreground font-medium">
						{day}
					</div>
				))}
			</div>

			{/* Days grid */}
			<div className="grid grid-cols-7 gap-0.5">
				{/* Padding for alignment */}
				{paddingDays.map((i) => (
					<div key={`pad-${i}`} className="aspect-square" />
				))}

				{/* Actual days */}
				{days.map((date) => {
					const dateKey = format(date, "yyyy-MM-dd");
					const dayEvents = eventsByDate.get(dateKey) || [];
					const workHours = workHoursData?.get(dateKey);
					const isToday = isCurrentMonth && date.getDate() === today.getDate();
					const isWeekend = date.getDay() === 0 || date.getDay() === 6;

					// Determine work hours status
					let workStatus: "met" | "overtime" | "undertime" | "none" = "none";
					if (workHours && workHours.expected > 0) {
						if (workHours.actual >= workHours.expected * 1.1) {
							workStatus = "overtime";
						} else if (workHours.actual >= workHours.expected * 0.95) {
							workStatus = "met";
						} else if (workHours.actual > 0) {
							workStatus = "undertime";
						}
					}

					// Determine if there are events to show
					const hasHoliday = dayEvents.some((e) => e.type === "holiday");
					const hasAbsence = dayEvents.some((e) => e.type === "absence");

					return (
						<button
							key={date.getTime()}
							type="button"
							onClick={() => onDayClick?.(date)}
							className={cn(
								"aspect-square flex flex-col items-center justify-center text-[10px] rounded-sm relative",
								"hover:bg-accent transition-colors",
								isToday && "ring-1 ring-primary font-bold",
								isWeekend && "text-muted-foreground",
								hasHoliday && "bg-amber-100 dark:bg-amber-900/30",
								hasAbsence && !hasHoliday && "bg-blue-100 dark:bg-blue-900/30",
							)}
						>
							<span>{date.getDate()}</span>

							{/* Work hours status indicator */}
							{workStatus !== "none" && (
								<div
									className={cn(
										"absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full",
										workStatus === "met" && "bg-green-500",
										workStatus === "overtime" && "bg-purple-500",
										workStatus === "undertime" && "bg-orange-500",
									)}
								/>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
});

export function YearCalendarView({
	events,
	year,
	viewMode,
	onYearChange,
	onViewModeChange,
	onDayClick,
	workHoursData,
}: YearCalendarViewProps) {
	const { t } = useTranslate();

	// Group events by date
	const eventsByDate = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const event of events) {
			const dateKey = format(event.date, "yyyy-MM-dd");
			if (!map.has(dateKey)) {
				map.set(dateKey, []);
			}
			map.get(dateKey)?.push(event);
		}
		return map;
	}, [events]);

	return (
		<div className="flex flex-col h-full">
			{/* Year navigation header */}
			<div className="flex items-center justify-between gap-4 pb-3 mb-3">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={() => onYearChange(year - 1)}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Button variant="outline" size="icon" onClick={() => onYearChange(year + 1)}>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onYearChange(new Date().getFullYear())}
					>
						Today
					</Button>
				</div>
				<h2 className="text-lg font-semibold">{year}</h2>
				<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">Day</TabsTrigger>
						<TabsTrigger value="week">Week</TabsTrigger>
						<TabsTrigger value="month">Month</TabsTrigger>
						<TabsTrigger value="year">Year</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/* Legend */}
			<div className="flex flex-wrap items-center justify-center gap-4 mb-4 text-xs">
				<div className="flex items-center gap-1">
					<div className="w-2 h-2 rounded-full bg-green-500" />
					<span>{t("calendar.legend.hoursMet", "Hours Met")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-2 h-2 rounded-full bg-purple-500" />
					<span>{t("calendar.legend.overtime", "Overtime")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-2 h-2 rounded-full bg-orange-500" />
					<span>{t("calendar.legend.undertime", "Undertime")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30 border" />
					<span>{t("calendar.legend.holiday", "Holiday")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/30 border" />
					<span>{t("calendar.legend.absence", "Absence")}</span>
				</div>
			</div>

			{/* 12 month grid */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 flex-1 overflow-auto">
				{Array.from({ length: 12 }, (_, month) => (
					<MiniMonth
						key={month}
						year={year}
						month={month}
						eventsByDate={eventsByDate}
						workHoursData={workHoursData}
						onDayClick={onDayClick}
					/>
				))}
			</div>
		</div>
	);
}
