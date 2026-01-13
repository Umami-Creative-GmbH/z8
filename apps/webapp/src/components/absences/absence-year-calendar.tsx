"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toCalendarEvents } from "@/lib/absences/absence-calendar-adapter";
import type { AbsenceWithCategory, Holiday } from "@/lib/absences/types";
import type { CalendarEvent } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

interface AbsenceYearCalendarProps {
	absences: AbsenceWithCategory[];
	holidays: Holiday[];
	initialYear?: number;
	onDayClick?: (date: Date) => void;
	onYearChange?: (year: number) => void;
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

function getFirstDayOfMonth(year: number, month: number): number {
	return new Date(year, month, 1).getDay();
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function MiniMonth({
	year,
	month,
	monthName,
	weekdays,
	eventsByDate,
	onDayClick,
}: {
	year: number;
	month: number;
	monthName: string;
	weekdays: string[];
	eventsByDate: Map<string, CalendarEvent[]>;
	onDayClick?: (date: Date) => void;
}) {
	const days = getDaysInMonth(year, month);
	const firstDay = getFirstDayOfMonth(year, month);
	const today = new Date();
	const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

	// Create padding for days before the first day of the month
	const paddingDays = Array.from({ length: firstDay }, (_, i) => i);

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
				{paddingDays.map((i) => (
					<div key={`pad-${i}`} className="aspect-square" />
				))}

				{/* Actual days */}
				{days.map((date) => {
					const dateKey = formatDateKey(date);
					const dayEvents = eventsByDate.get(dateKey) || [];
					const isToday = isCurrentMonth && date.getDate() === today.getDate();
					const isWeekend = date.getDay() === 0 || date.getDay() === 6;

					// Determine event type to show
					const hasHoliday = dayEvents.some((e) => e.type === "holiday");
					const absenceEvent = dayEvents.find((e) => e.type === "absence");
					const absenceStatus = absenceEvent?.metadata?.status as
						| "pending"
						| "approved"
						| "rejected"
						| undefined;

					// Determine background color based on status
					let bgClass = "";
					if (hasHoliday) {
						bgClass = "bg-amber-100 dark:bg-amber-900/30";
					} else if (absenceStatus === "approved") {
						bgClass = "bg-blue-100 dark:bg-blue-900/30";
					} else if (absenceStatus === "pending") {
						bgClass = "bg-yellow-100 dark:bg-yellow-900/30";
					} else if (absenceStatus === "rejected") {
						bgClass = "bg-red-100 dark:bg-red-900/30";
					}

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
								bgClass,
							)}
						>
							<span>{date.getDate()}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function AbsenceYearCalendar({
	absences,
	holidays,
	initialYear = new Date().getFullYear(),
	onDayClick,
	onYearChange,
}: AbsenceYearCalendarProps) {
	const { t } = useTranslate();
	const [year, setYear] = useState(initialYear);

	const MONTHS = [
		t("common.months.january", "January"),
		t("common.months.february", "February"),
		t("common.months.march", "March"),
		t("common.months.april", "April"),
		t("common.months.may", "May"),
		t("common.months.june", "June"),
		t("common.months.july", "July"),
		t("common.months.august", "August"),
		t("common.months.september", "September"),
		t("common.months.october", "October"),
		t("common.months.november", "November"),
		t("common.months.december", "December"),
	];

	const WEEKDAYS = [
		t("common.weekdays.su", "Su"),
		t("common.weekdays.mo", "Mo"),
		t("common.weekdays.tu", "Tu"),
		t("common.weekdays.we", "We"),
		t("common.weekdays.th", "Th"),
		t("common.weekdays.fr", "Fr"),
		t("common.weekdays.sa", "Sa"),
	];

	// Transform data to CalendarEvent format
	const events = useMemo(() => {
		return toCalendarEvents(absences, holidays);
	}, [absences, holidays]);

	// Group events by date
	const eventsByDate = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const event of events) {
			const dateKey = formatDateKey(event.date);
			if (!map.has(dateKey)) {
				map.set(dateKey, []);
			}
			map.get(dateKey)?.push(event);
		}
		return map;
	}, [events]);

	const handleYearChange = (newYear: number) => {
		setYear(newYear);
		onYearChange?.(newYear);
	};

	return (
		<div className="flex flex-col h-full">
			{/* Year navigation header */}
			<div className="flex items-center justify-between gap-4 pb-3 mb-3">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={() => handleYearChange(year - 1)}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Button variant="outline" size="icon" onClick={() => handleYearChange(year + 1)}>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => handleYearChange(new Date().getFullYear())}
					>
						{t("common.today", "Today")}
					</Button>
				</div>
				<h2 className="text-lg font-semibold">{year}</h2>
				<div className="w-[160px]" /> {/* Spacer for centering */}
			</div>

			{/* Absences-specific legend */}
			<div className="flex flex-wrap items-center justify-center gap-4 mb-4 text-xs">
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/30 border border-blue-500" />
					<span>{t("absences.calendar.legend.approved", "Approved")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-500" />
					<span>{t("absences.calendar.legend.pending", "Pending")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30 border border-red-500" />
					<span>{t("absences.calendar.legend.rejected", "Rejected")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/30 border border-amber-500" />
					<span>{t("absences.calendar.legend.holiday", "Holiday")}</span>
				</div>
			</div>

			{/* 12 month grid */}
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 flex-1 overflow-auto">
				{Array.from({ length: 12 }, (_, month) => (
					<MiniMonth
						key={month}
						year={year}
						month={month}
						monthName={MONTHS[month]}
						weekdays={WEEKDAYS}
						eventsByDate={eventsByDate}
						onDayClick={onDayClick}
					/>
				))}
			</div>
		</div>
	);
}
