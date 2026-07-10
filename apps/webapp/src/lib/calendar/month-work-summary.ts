import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import {
	addCalendarDateKey,
	allDayDateKeyForDate,
	calendarDateKeyForDate,
	todayCalendarDateKey,
} from "@/lib/calendar/date-keys";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
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
}

export interface MonthWorkDay {
	date: DateTime;
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

function getGridStart(date: DateTime, weekStartDay: WeekStartDay): DateTime {
	if (weekStartDay === "monday") return date.startOf("week").startOf("day");

	const daysSinceSunday = date.weekday % 7;
	return date.minus({ days: daysSinceSunday }).startOf("day");
}

function getGridEnd(date: DateTime, weekStartDay: WeekStartDay): DateTime {
	const endOfMonth = date.endOf("month").startOf("day");
	const daysUntilWeekEnd =
		weekStartDay === "monday" ? 7 - endOfMonth.weekday : 6 - (endOfMonth.weekday % 7);

	return endOfMonth.plus({ days: daysUntilWeekEnd });
}

export function totalWorkSummaries(summaries: DailyWorkHoursSummary[]): WorkPeriodTotal | null {
	if (summaries.length === 0) return null;

	const requiredMinutes = summaries.reduce((total, summary) => total + summary.requiredMinutes, 0);
	const actualMinutes = summaries.reduce((total, summary) => total + summary.actualMinutes, 0);
	const deltaMinutes = actualMinutes - requiredMinutes;

	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status: getTotalStatus(deltaMinutes),
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
	const monthStart = DateTime.fromObject(
		{ year, month: monthIndex + 1, day: 1 },
		{ zone: timezone },
	).startOf("day");
	const todayDateKey = todayCalendarDateKey(timezone, now);
	const gridStart = getGridStart(monthStart, weekStartDay);
	const gridEnd = getGridEnd(monthStart, weekStartDay);
	const eventsByDate = groupCalendarEventsByDate(events, timezone);
	const weeks: MonthWorkWeek[] = [];
	const monthSummaries: DailyWorkHoursSummary[] = [];

	let current = gridStart;
	while (current <= gridEnd) {
		const days: MonthWorkDay[] = [];
		const weekSummaries: DailyWorkHoursSummary[] = [];

		for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
			const dateKey = current.toISODate()!;
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

			current = current.plus({ days: 1 });
		}

		weeks.push({
			weekNumber: days[0]!.date.weekNumber,
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
