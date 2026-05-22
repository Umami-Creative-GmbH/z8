import { DateTime } from "luxon";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkHoursSummary,
} from "./types";

export interface MonthWorkSummaryTotal {
	requiredMinutes: number;
	actualMinutes: number;
	deltaMinutes: number;
	status: DailyWorkHoursStatus;
}

export interface MonthWorkSummaryDay {
	date: DateTime;
	dateKey: string;
	isActiveMonth: boolean;
	workHoursSummary: DailyWorkHoursSummary | null;
	events: CalendarEvent[];
}

export interface MonthWorkSummaryWeek {
	weekNumber: number;
	days: MonthWorkSummaryDay[];
	total: MonthWorkSummaryTotal | null;
}

export interface MonthWorkSummary {
	year: number;
	monthIndex: number;
	weeks: MonthWorkSummaryWeek[];
	monthTotal: MonthWorkSummaryTotal | null;
}

interface BuildMonthWorkSummaryOptions {
	year: number;
	monthIndex: number;
	weekStartDay: WeekStartDay;
	workHoursData: DailyWorkHoursSummaries;
	events?: CalendarEvent[];
}

function getStatus(actualMinutes: number, requiredMinutes: number): DailyWorkHoursStatus {
	if (actualMinutes === 0) return "missing";
	if (actualMinutes > requiredMinutes) return "over";
	if (actualMinutes === requiredMinutes) return "met";
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

export function totalWorkSummaries(summaries: DailyWorkHoursSummary[]): MonthWorkSummaryTotal | null {
	if (summaries.length === 0) return null;

	const requiredMinutes = summaries.reduce((total, summary) => total + summary.requiredMinutes, 0);
	const actualMinutes = summaries.reduce((total, summary) => total + summary.actualMinutes, 0);
	const deltaMinutes = actualMinutes - requiredMinutes;

	return {
		requiredMinutes,
		actualMinutes,
		deltaMinutes,
		status: getStatus(actualMinutes, requiredMinutes),
	};
}

export function groupCalendarEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
	const grouped = new Map<string, CalendarEvent[]>();

	for (const event of events) {
		const dateKey = DateTime.fromJSDate(event.date, { zone: "utc" }).toISODate();
		if (!dateKey) continue;

		const existing = grouped.get(dateKey) ?? [];
		existing.push(event);
		grouped.set(dateKey, existing);
	}

	return grouped;
}

export function buildMonthWorkSummary({
	year,
	monthIndex,
	weekStartDay,
	workHoursData,
	events = [],
}: BuildMonthWorkSummaryOptions): MonthWorkSummary {
	const monthStart = DateTime.local(year, monthIndex + 1, 1).startOf("day");
	const gridStart = getGridStart(monthStart, weekStartDay);
	const gridEnd = getGridEnd(monthStart, weekStartDay);
	const eventsByDate = groupCalendarEventsByDate(events);
	const weeks: MonthWorkSummaryWeek[] = [];
	const monthSummaries: DailyWorkHoursSummary[] = [];

	let current = gridStart;
	while (current <= gridEnd) {
		const days: MonthWorkSummaryDay[] = [];
		const weekSummaries: DailyWorkHoursSummary[] = [];

		for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
			const dateKey = current.toISODate()!;
			const isActiveMonth = current.month === monthStart.month;
			const workHoursSummary = workHoursData.get(dateKey) ?? null;

			if (isActiveMonth && workHoursSummary) {
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
