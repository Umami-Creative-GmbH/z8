"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { memo, useMemo } from "react";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
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

const MONTH_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function getMonthNames(locale: string): string[] {
	return MONTH_INDICES.map((month) =>
		new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, month, 1)),
	);
}

function getWeekdayNames(locale: string): string[] {
	// Sunday=0 based reference week: Jan 2–8 2000 (Sun–Sat)
	return Array.from({ length: 7 }, (_, i) =>
		new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2000, 0, 2 + i)),
	);
}

function getDaysInMonth(year: number, month: number): Date[] {
	const days: Date[] = [];
	const date = new Date(year, month, 1);
	while (date.getMonth() === month) {
		days.push(new Date(date));
		date.setDate(date.getDate() + 1);
	}
	return days;
}

function getFirstDayOfMonth(year: number, month: number, weekStartDay: WeekStartDay): number {
	const day = new Date(year, month, 1).getDay();
	return weekStartDay === "monday" ? (day + 6) % 7 : day;
}

interface MiniMonthProps {
	year: number;
	month: number;
	monthName: string;
	eventsByDate: Map<string, CalendarEvent[]>;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	workHoursData?: Map<string, { expected: number; actual: number }>;
	onDayClick?: (date: Date) => void;
}

const MiniMonth = memo(function MiniMonth({
	year,
	month,
	monthName,
	eventsByDate,
	weekdays,
	weekStartDay,
	workHoursData,
	onDayClick,
}: MiniMonthProps) {
	const days = getDaysInMonth(year, month);
	const firstDay = getFirstDayOfMonth(year, month, weekStartDay);
	const today = new Date();
	const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

	// Create padding for days before the first day of the month
	const paddingDays = Array.from({ length: firstDay }, (_, dayOffset) =>
		format(new Date(year, month, dayOffset - firstDay + 1), "yyyy-MM-dd"),
	);

	return (
		<div className="p-2 border rounded-lg bg-card">
			<h3 className="text-sm font-medium text-center mb-2">{monthName}</h3>

			{/* Weekday headers */}
			<div className="grid grid-cols-7 gap-0.5 text-center mb-1">
				{weekdays.map((day) => (
					<div key={day} className="text-[10px] text-muted-foreground font-medium">
						{day}
					</div>
				))}
			</div>

			{/* Days grid */}
			<div className="grid grid-cols-7 gap-0.5">
				{/* Padding for alignment */}
				{paddingDays.map((dateKey) => (
					<div key={dateKey} className="aspect-square" />
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
										"absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full",
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
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const weekStartDay = useWeekStartDay();
	const monthNames = useMemo(() => getMonthNames(locale), [locale]);
	const weekdays = useMemo(() => {
		const names = getWeekdayNames(locale);
		return weekStartDay === "monday" ? [...names.slice(1), names[0]] : names;
	}, [locale, weekStartDay]);

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
					<Button
						variant="outline"
						size="icon"
						onClick={() => onYearChange(year - 1)}
						aria-label={t("calendar.view.previous", "Previous")}
					>
						<IconChevronLeft className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						onClick={() => onYearChange(year + 1)}
						aria-label={t("calendar.view.next", "Next")}
					>
						<IconChevronRight className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onYearChange(new Date().getFullYear())}
					>
						{t("calendar.view.today", "Today")}
					</Button>
				</div>
				<h2 className="text-lg font-semibold">{year}</h2>
				<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
						<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
						<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
						<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/* Legend */}
			<div className="flex flex-wrap items-center justify-center gap-4 mb-4 text-xs">
				<div className="flex items-center gap-1">
					<div className="size-2 rounded-full bg-green-500" />
					<span>{t("calendar.legend.hoursMet", "Hours Met")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-2 rounded-full bg-purple-500" />
					<span>{t("calendar.legend.overtime", "Overtime")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-2 rounded-full bg-orange-500" />
					<span>{t("calendar.legend.undertime", "Undertime")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-3 rounded bg-amber-100 dark:bg-amber-900/30 border" />
					<span>{t("calendar.legend.holiday", "Holiday")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-3 rounded bg-blue-100 dark:bg-blue-900/30 border" />
					<span>{t("calendar.legend.absence", "Absence")}</span>
				</div>
			</div>

			{/* 12 month grid */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 flex-1 overflow-auto">
				{MONTH_INDICES.map((month) => (
					<MiniMonth
						key={month}
						year={year}
						month={month}
						monthName={monthNames[month]}
						eventsByDate={eventsByDate}
						weekdays={weekdays}
						weekStartDay={weekStartDay}
						workHoursData={workHoursData}
						onDayClick={onDayClick}
					/>
				))}
			</div>
		</div>
	);
}
