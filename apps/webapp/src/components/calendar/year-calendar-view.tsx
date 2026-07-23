"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	addCalendarDateKey,
	todayCalendarDateKey,
} from "@/lib/calendar/date-keys";
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
} from "@/lib/calendar/types";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./schedule-x-calendar";
import { groupYearCalendarEventsByDate } from "./year-calendar-events";

interface YearCalendarViewProps {
	events: CalendarEvent[];
	year: number;
	viewMode: ViewMode;
	onYearChange: (year: number) => void;
	onViewModeChange: (mode: ViewMode) => void;
	onDayClick?: (dateKey: string) => void;
	workHoursData?: DailyWorkHoursSummaries;
	timeZone: string;
}

const MONTH_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const monthFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const dayLabelFormatters = new Map<string, Intl.DateTimeFormat>();

function getMonthFormatter(locale: string) {
	const cachedFormatter = monthFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.DateTimeFormat(locale, { month: "long" });
	monthFormatters.set(locale, formatter);
	return formatter;
}

function getShortWeekdayFormatter(locale: string) {
	const cachedFormatter = weekdayFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.DateTimeFormat(locale, { weekday: "short" });
	weekdayFormatters.set(locale, formatter);
	return formatter;
}

function getDayLabelFormatter(locale: string) {
	const cachedFormatter = dayLabelFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.DateTimeFormat(locale, {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
	dayLabelFormatters.set(locale, formatter);
	return formatter;
}

function getMonthNames(locale: string): string[] {
	const formatter = getMonthFormatter(locale);
	return MONTH_INDICES.map((month) => formatter.format(new Date(2000, month, 1)));
}

function getWeekdayNames(locale: string): string[] {
	const formatter = getShortWeekdayFormatter(locale);
	// Sunday=0 based reference week: Jan 2–8 2000 (Sun–Sat)
	return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2000, 0, 2 + i)));
}

function getDaysInMonth(year: number, month: number): string[] {
	const start = Temporal.PlainDate.from({ year, month: month + 1, day: 1 });
	const days: string[] = [];
	for (let date = start; date.month === start.month; date = date.add({ days: 1 })) {
		days.push(date.toString());
	}
	return days;
}

function getFirstDayOfMonth(year: number, month: number, weekStartDay: WeekStartDay): number {
	const dayOfWeek = Temporal.PlainDate.from({ year, month: month + 1, day: 1 }).dayOfWeek;
	return weekStartDay === "monday" ? dayOfWeek - 1 : dayOfWeek % 7;
}

type Translate = ReturnType<typeof useTranslate>["t"];

function getWorkStatusLabel(status: DailyWorkHoursStatus, t: Translate): string {
	switch (status) {
		case "met":
			return t("calendar.workStatus.requirementMet", "requirement met");
		case "over":
			return t("calendar.workStatus.overRequirement", "over requirement");
		case "under":
			return t("calendar.workStatus.underRequirement", "under requirement");
		case "missing":
			return t("calendar.workStatus.requiredHoursMissing", "required hours missing");
	}
}

interface MiniMonthProps {
	year: number;
	month: number;
	monthName: string;
	eventsByDate: Map<string, CalendarEvent[]>;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	locale: string;
	timeZone: string;
	t: Translate;
	workHoursData?: DailyWorkHoursSummaries;
	onDayClick?: (dateKey: string) => void;
}

const MiniMonth = function MiniMonth({
	year,
	month,
	monthName,
	eventsByDate,
	weekdays,
	weekStartDay,
	locale,
	t,
	workHoursData,
	onDayClick,
	timeZone,
}: MiniMonthProps) {
	const days = getDaysInMonth(year, month);
	const firstDay = getFirstDayOfMonth(year, month, weekStartDay);
	const dayLabelFormatter = getDayLabelFormatter(locale);
	const todayDateKey = todayCalendarDateKey(timeZone);
	const isCurrentMonth =
		todayDateKey.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`;

	// Create padding for days before the first day of the month
	const paddingDays = Array.from({ length: firstDay }, (_, dayOffset) =>
		addCalendarDateKey(`${year}-${String(month + 1).padStart(2, "0")}-01`, {
			days: dayOffset - firstDay,
		}),
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
				{days.map((dateKey) => {
					const date = Temporal.PlainDate.from(dateKey);
					const dateLabel = dayLabelFormatter.format(new Date(`${dateKey}T00:00:00.000Z`));
					const dayEvents = eventsByDate.get(dateKey) || [];
					const workHours = workHoursData?.get(dateKey);
					const isToday = isCurrentMonth && dateKey === todayDateKey;
					const isWeekend = date.dayOfWeek === 6 || date.dayOfWeek === 7;

					const workStatus: DailyWorkHoursStatus | "none" = workHours?.status ?? "none";
					const dayLabel =
						workStatus === "none"
							? dateLabel
							: t("calendar.year.dayWithWorkStatus", "{date}, {status}", {
									date: dateLabel,
									status: getWorkStatusLabel(workStatus, t),
								});

					// Determine if there are events to show
					const hasHoliday = dayEvents.some((e) => e.type === "holiday");
					const hasAbsence = dayEvents.some((e) => e.type === "absence");

					return (
						<button
							key={dateKey}
							type="button"
							aria-label={dayLabel}
							onClick={() => onDayClick?.(dateKey)}
							className={cn(
								"aspect-square flex flex-col items-center justify-center text-[10px] rounded-sm relative",
								"hover:bg-accent transition-colors",
								isToday && "ring-1 ring-primary font-bold",
								isWeekend && "text-muted-foreground",
								hasHoliday && "bg-amber-100 dark:bg-amber-900/30",
								hasAbsence && !hasHoliday && "bg-blue-100 dark:bg-blue-900/30",
							)}
						>
							<span>{date.day}</span>

							{/* Work hours status indicator */}
							{workStatus !== "none" && (
								<div
									className={cn(
										"absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full",
										workStatus === "met" && "bg-green-500",
										workStatus === "over" && "bg-green-500",
										workStatus === "under" && "bg-red-500",
										workStatus === "missing" && "bg-muted-foreground",
									)}
								/>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
};

export function YearCalendarView({
	events,
	year,
	viewMode,
	onYearChange,
	onViewModeChange,
	onDayClick,
	workHoursData,
	timeZone,
}: YearCalendarViewProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const weekStartDay = useWeekStartDay();
	function handleCurrentYearClick() {
		onYearChange(Temporal.PlainDate.from(todayCalendarDateKey(timeZone)).year);
	}
	const monthNames = getMonthNames(locale);
	const weekdays = (() => {
		const names = getWeekdayNames(locale);
		return weekStartDay === "monday" ? [...names.slice(1), names[0]] : names;
	})();

	// Group events by date
	const eventsByDate = groupYearCalendarEventsByDate(events, timeZone);

	return (
		<div className="flex flex-col h-full">
			{/* Year navigation header */}
			<div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3">
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
					<Button variant="outline" size="sm" onClick={handleCurrentYearClick}>
						{t("calendar.view.today", "Today")}
					</Button>
				</div>
				<h2 className="text-lg font-semibold">{year}</h2>
				<Tabs
					value={viewMode}
					onValueChange={(v) => onViewModeChange(v as ViewMode)}
					className="w-full sm:w-auto"
				>
					<TabsList className="grid w-full grid-cols-4">
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
					<span>{t("calendar.legend.requirementMetOrOver", "Requirement met/over")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-2 rounded-full bg-red-500" />
					<span>{t("calendar.legend.underRequirement", "Under requirement")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-2 rounded-full bg-muted-foreground" />
					<span>{t("calendar.legend.missingRequiredWork", "Missing required work")}</span>
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
						locale={locale}
						t={t}
						workHoursData={workHoursData}
						onDayClick={onDayClick}
						timeZone={timeZone}
					/>
				))}
			</div>
		</div>
	);
}
