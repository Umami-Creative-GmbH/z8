import type { DailyWorkActualMinutes } from "@/lib/calendar/types";
import {
	buildDailyCompletedMinutes,
	buildDailyWorkHoursSummaries,
	type CompletedWork,
} from "@/lib/calendar/work-hours-summary";
import { localDayRange, localMonthRange, localWeekRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	type PlainDate,
} from "@/lib/datetime/temporal-core";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { buildDayTotalBasis, type DayTotalWorkPeriod } from "./day-totals";
import type { DayTotalBasis } from "./types";

/** The work policy's working time limits the KPI cards warn against. */
export interface TimeKpiLimits {
	maxDailyMinutes: number | null;
	maxWeeklyMinutes: number | null;
	/** How close to a limit worked time turns the card amber. */
	alertBeforeLimitMinutes: number;
}

/** What it takes to recompute the KPI cards at a later instant while live work runs. */
export interface TimeKpiBasis extends DayTotalBasis {
	/** Completed work, kept whole so the previous period can be cut at the same point. */
	completedWork: CompletedWork[];
	/** Required time per local day, across this and the previous week and month. */
	requiredMinutesByDate: DailyWorkActualMinutes;
	limits: TimeKpiLimits | null;
}

/**
 * `progress` until required time is met, `met` after; `near_limit` and `over_limit` once worked
 * time comes close to or passes the work policy's limit.
 */
export type TimeKpiTone = "progress" | "met" | "near_limit" | "over_limit";

export interface TimeKpiDay {
	date: string;
	workedMinutes: number;
	requiredMinutes: number;
	/** The day has not started yet. */
	upcoming: boolean;
}

export interface TodayKpi {
	/** Today's local date. */
	date: string;
	workedMinutes: number;
	surchargeMinutes: number;
	/** Null when today has no required time. */
	requiredMinutes: number | null;
	tone: TimeKpiTone;
}

export interface PeriodKpi {
	workedMinutes: number;
	surchargeMinutes: number;
	/** Null when the period has no required time. */
	requiredMinutes: number | null;
	/** Required time up to now: past days in full, today in proportion to its elapsed time. */
	requiredSoFarMinutes: number | null;
	/** The previous period up to the same point. */
	previous: { workedMinutes: number; requiredMinutes: number };
	days: TimeKpiDay[];
	tone: TimeKpiTone;
}

export interface TimeKpis {
	today: TodayKpi;
	week: PeriodKpi;
	month: PeriodKpi;
}

/** The KPIs as read on the server, and what the client needs to advance them as live work runs. */
export interface TimeKpiRead {
	kpis: TimeKpis;
	basis: TimeKpiBasis;
}

export function buildTimeKpiBasis({
	periods,
	timezone,
	weekStartDay,
	requiredMinutesByDate,
	limits,
}: {
	periods: DayTotalWorkPeriod[];
	timezone: string;
	weekStartDay: WeekStartDay;
	requiredMinutesByDate: DailyWorkActualMinutes;
	limits: TimeKpiLimits | null;
}): TimeKpiBasis {
	const completedWork: CompletedWork[] = [];
	for (const period of periods) {
		if (period.endTime)
			completedWork.push({ startedAt: period.startTime, endedAt: period.endTime });
	}
	return {
		...buildDayTotalBasis({ periods, timezone, weekStartDay }),
		completedWork,
		requiredMinutesByDate,
		limits,
	};
}

function localDate(instant: Instant, timezone: string): PlainDate {
	return instant.toZonedDateTimeISO(timezone).toPlainDate();
}

/** The instants covering the previous and current week and month, which the KPI reads must cover. */
export function timeKpiRange(now: Instant, timezone: string, weekStartDay: WeekStartDay) {
	const today = localDate(now, timezone);
	const week = localWeekRange(today.subtract({ days: 7 }).toString(), timezone, weekStartDay);
	const month = localMonthRange(
		today.with({ day: 1 }).subtract({ months: 1 }).toString(),
		timezone,
	);
	const currentWeekEnd = localWeekRange(today.toString(), timezone, weekStartDay).endExclusive;
	const currentMonthEnd = localMonthRange(today.toString(), timezone).endExclusive;
	return {
		start: dateFromInstant(compareInstants(week.start, month.start) < 0 ? week.start : month.start),
		endExclusive: dateFromInstant(
			compareInstants(currentWeekEnd, currentMonthEnd) > 0 ? currentWeekEnd : currentMonthEnd,
		),
	};
}

function sum(values: Iterable<number>) {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

/** The instant `months` or `weeks` before `now`; past the end of a shorter month, that month's end. */
function samePointBefore(
	now: Instant,
	timezone: string,
	unit: "weeks" | "months",
	previousStart: PlainDate,
): Instant {
	const zonedNow = now.toZonedDateTimeISO(timezone);
	if (unit === "months" && zonedNow.day > previousStart.daysInMonth) {
		return localMonthRange(previousStart.toString(), timezone).endExclusive;
	}
	return zonedNow.subtract({ [unit]: 1 }).toInstant();
}

function tone(
	workedMinutes: number,
	requiredMinutes: number | null,
	limitMinutes: number | null,
	alertBeforeLimitMinutes: number,
): TimeKpiTone {
	if (limitMinutes !== null && workedMinutes > limitMinutes) return "over_limit";
	if (limitMinutes !== null && workedMinutes >= limitMinutes - alertBeforeLimitMinutes) {
		return "near_limit";
	}
	if (requiredMinutes !== null && workedMinutes >= requiredMinutes) return "met";
	return "progress";
}

/** Today, this week and this month as of `now`, each against required time and limits. */
export function summarizeTimeKpis(basis: TimeKpiBasis, now: Instant): TimeKpis {
	const { timezone, requiredMinutesByDate: required, limits } = basis;
	const today = localDate(now, timezone);
	const todayKey = today.toString();

	const workedByDate = new Map<string, number>();
	for (const [date, dayTotal] of buildDailyWorkHoursSummaries({
		dailyRequirements: {},
		dailyActualMinutes: basis.completedMinutesByDate,
		liveWork: basis.liveWork,
		timezone,
		now,
	})) {
		workedByDate.set(date, dayTotal.actualMinutes);
	}
	// Live work counts until now when the previous period is cut at the same point.
	const work: CompletedWork[] = [
		...basis.completedWork,
		...basis.liveWork.map((live) => ({ startedAt: live.startedAt, endedAt: dateFromInstant(now) })),
	];

	/** Required time from `first` up to `point`, its last day in proportion to the elapsed time. */
	const requiredThrough = (first: PlainDate, point: Instant) => {
		const firstKey = first.toString();
		const pointDate = localDate(point, timezone).toString();
		const day = localDayRange(pointDate, timezone);
		const elapsed =
			day.start.until(point).total({ unit: "milliseconds" }) /
			day.start.until(day.endExclusive).total({ unit: "milliseconds" });
		let total = 0;
		for (const [date, minutes] of Object.entries(required)) {
			if (date < firstKey || date > pointDate) continue;
			total += date === pointDate ? minutes * elapsed : minutes;
		}
		return Math.round(total);
	};

	const period = (
		first: PlainDate,
		dayCount: number,
		previousFirst: PlainDate,
		unit: "weeks" | "months",
		limitMinutes: number | null,
	): PeriodKpi => {
		const days: TimeKpiDay[] = [];
		for (let index = 0; index < dayCount; index++) {
			const date = first.add({ days: index }).toString();
			days.push({
				date,
				workedMinutes: workedByDate.get(date) ?? 0,
				requiredMinutes: required[date] ?? 0,
				upcoming: date > todayKey,
			});
		}
		const firstKey = first.toString();
		const lastKey = days[days.length - 1]?.date ?? firstKey;
		const surchargeMinutes = sum(
			Object.entries(basis.surchargeMinutesByDate)
				.filter(([date]) => date >= firstKey && date <= lastKey)
				.map(([, minutes]) => minutes),
		);
		const workedMinutes = sum(days.map((day) => day.workedMinutes));
		const requiredTotal = sum(days.map((day) => day.requiredMinutes));
		const requiredMinutes = requiredTotal > 0 ? requiredTotal : null;

		const previousPoint = samePointBefore(now, timezone, unit, previousFirst);
		const previousStart = localDayRange(previousFirst.toString(), timezone).start;
		const previousWorked =
			compareInstants(previousStart, previousPoint) < 0
				? sum(
						Object.values(
							buildDailyCompletedMinutes(work, timezone, {
								start: dateFromInstant(previousStart),
								endExclusive: dateFromInstant(previousPoint),
							}),
						),
					)
				: 0;

		return {
			workedMinutes,
			surchargeMinutes,
			requiredMinutes,
			requiredSoFarMinutes: requiredMinutes === null ? null : requiredThrough(first, now),
			previous: {
				workedMinutes: previousWorked,
				requiredMinutes: requiredThrough(previousFirst, previousPoint),
			},
			days,
			tone: tone(
				workedMinutes,
				requiredMinutes,
				limitMinutes,
				limits?.alertBeforeLimitMinutes ?? 0,
			),
		};
	};

	const weekStart = localDate(
		localWeekRange(todayKey, timezone, basis.weekStartDay).start,
		timezone,
	);
	const monthStart = today.with({ day: 1 });
	const todayWorked = workedByDate.get(todayKey) ?? 0;
	const todayRequired = required[todayKey] ? required[todayKey] : null;

	return {
		today: {
			date: todayKey,
			workedMinutes: todayWorked,
			surchargeMinutes: basis.surchargeMinutesByDate[todayKey] ?? 0,
			requiredMinutes: todayRequired,
			tone: tone(
				todayWorked,
				todayRequired,
				limits?.maxDailyMinutes ?? null,
				limits?.alertBeforeLimitMinutes ?? 0,
			),
		},
		week: period(
			weekStart,
			7,
			weekStart.subtract({ days: 7 }),
			"weeks",
			limits?.maxWeeklyMinutes ?? null,
		),
		month: period(
			monthStart,
			today.daysInMonth,
			monthStart.subtract({ months: 1 }),
			"months",
			null,
		),
	};
}
