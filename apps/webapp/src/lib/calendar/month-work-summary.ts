import { Temporal } from "temporal-polyfill";
import {
	addCalendarDateKey,
	allDayDateKeyForDate,
	calendarDateKeyForDate,
	todayCalendarDateKey,
} from "@/lib/calendar/date-keys";
import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkHoursSummary,
} from "./types";

type WorkPeriodTotalStatus = Exclude<DailyWorkHoursStatus, "missing">;

export interface WorkPeriodTotal {
	requiredMinutes: number;
	actualMinutes: number;
	deltaMinutes: number;
	status: WorkPeriodTotalStatus;
	includesLiveWork: boolean;
}

export interface MonthWorkDay {
	date: PlainDate;
	dateKey: string;
	isActiveMonth: boolean;
	workHoursSummary: DailyWorkHoursSummary | null;
	events: CalendarEvent[];
}

export interface MonthWorkWeek {
	weekNumber: number;
	days: MonthWorkDay[];
	total: WorkPeriodTotal | null;
}

export interface MonthWorkSummary {
	year: number;
	monthIndex: number;
	weeks: MonthWorkWeek[];
	monthTotal: WorkPeriodTotal | null;
}

interface BuildMonthWorkSummaryOptions {
	year: number;
	monthIndex: number;
	weekStartDay: WeekStartDay;
	workHoursData: DailyWorkHoursSummaries;
	events?: CalendarEvent[];
	timezone?: string;
	now?: Instant;
}

function getTotalStatus(deltaMinutes: number): WorkPeriodTotalStatus {
	if (deltaMinutes > 0) return "over";
	if (deltaMinutes === 0) return "met";
	return "under";
}

function getGridStart(date: PlainDate, weekStartDay: WeekStartDay): PlainDate {
	const daysSinceStart = weekStartDay === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
	return date.subtract({ days: daysSinceStart });
}

function getGridEnd(date: PlainDate, weekStartDay: WeekStartDay): PlainDate {
	const endOfMonth = date.with({ day: date.daysInMonth });
	const daysUntilWeekEnd =
		weekStartDay === "monday" ? 7 - endOfMonth.dayOfWeek : 6 - (endOfMonth.dayOfWeek % 7);

	return endOfMonth.add({ days: daysUntilWeekEnd });
}

export function totalWorkSummaries(summaries: DailyWorkHoursSummary[]): WorkPeriodTotal | null {
	if (summaries.length === 0) return null;

	const requiredMinutes = summaries.reduce(
		(total, summary) => total + (summary.requirement?.requiredMinutes ?? 0),
		0,
	);
	const actualMinutes = summaries.reduce((total, summary) => total + summary.actualMinutes, 0);
	const deltaMinutes = actualMinutes - requiredMinutes;

	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status: getTotalStatus(deltaMinutes),
		includesLiveWork: summaries.some((summary) => summary.includesLiveWork),
	};
}

export function groupCalendarEventsByDate(
	events: CalendarEvent[],
	timezone: string = "UTC",
): Map<string, CalendarEvent[]> {
	const grouped = new Map<string, CalendarEvent[]>();

	for (const event of events) {
		const isAllDay = event.type === "absence" || event.type === "holiday";
		const dateKeyForEventDate = (date: Date) =>
			isAllDay ? allDayDateKeyForDate(date) : calendarDateKeyForDate(date, timezone);
		const startDateKey = dateKeyForEventDate(event.date);
		const endDateKey = event.endDate ? dateKeyForEventDate(event.endDate) : startDateKey;
		const lastDateKey =
			Temporal.PlainDate.compare(
				Temporal.PlainDate.from(endDateKey),
				Temporal.PlainDate.from(startDateKey),
			) < 0
				? startDateKey
				: endDateKey;

		for (
			let dateKey = startDateKey;
			Temporal.PlainDate.compare(
				Temporal.PlainDate.from(dateKey),
				Temporal.PlainDate.from(lastDateKey),
			) <= 0;
			dateKey = addCalendarDateKey(dateKey, { days: 1 })
		) {
			const existing = grouped.get(dateKey) ?? [];
			existing.push(event);
			grouped.set(dateKey, existing);
		}
	}

	return grouped;
}

export function buildMonthWorkSummary({
	year,
	monthIndex,
	weekStartDay,
	workHoursData,
	events = [],
	timezone = "UTC",
	now = systemClock.nowInstant(),
}: BuildMonthWorkSummaryOptions): MonthWorkSummary {
	const monthStart = Temporal.PlainDate.from({ year, month: monthIndex + 1, day: 1 });
	const todayDateKey = todayCalendarDateKey(timezone, now);
	const gridStart = getGridStart(monthStart, weekStartDay);
	const gridEnd = getGridEnd(monthStart, weekStartDay);
	const eventsByDate = groupCalendarEventsByDate(events, timezone);
	const weeks: MonthWorkWeek[] = [];
	const monthSummaries: DailyWorkHoursSummary[] = [];

	let current = gridStart;
	while (comparePlainDates(current, gridEnd) <= 0) {
		const days: MonthWorkDay[] = [];
		const weekSummaries: DailyWorkHoursSummary[] = [];

		for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
			const dateKey = current.toString();
			const isActiveMonth = current.month === monthStart.month;
			const isFutureCurrentMonthDay =
				monthStart.year === Number(todayDateKey.slice(0, 4)) &&
				monthStart.month === Number(todayDateKey.slice(5, 7)) &&
				dateKey > todayDateKey;
			const workHoursSummary = workHoursData.get(dateKey) ?? null;

			if (isActiveMonth && !isFutureCurrentMonthDay && workHoursSummary) {
				weekSummaries.push(workHoursSummary);
				monthSummaries.push(workHoursSummary);
			}

			days.push({
				date: current,
				dateKey,
				isActiveMonth,
				workHoursSummary,
				events: eventsByDate.get(dateKey) ?? [],
			});

			current = current.add({ days: 1 });
		}

		weeks.push({
			weekNumber: days[0]!.date.weekOfYear ?? 1,
			days,
			total: totalWorkSummaries(weekSummaries),
		});
	}

	return {
		year,
		monthIndex,
		weeks,
		monthTotal: totalWorkSummaries(monthSummaries),
	};
}
