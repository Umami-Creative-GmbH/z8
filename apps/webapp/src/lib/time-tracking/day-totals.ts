import type { DailyWorkActualMinutes, LiveWork } from "@/lib/calendar/types";
import {
	buildDailyCompletedMinutes,
	buildDailyWorkHoursSummaries,
	type CompletedWork,
} from "@/lib/calendar/work-hours-summary";
import { localMonthRange, localWeekRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
} from "@/lib/datetime/temporal-core";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import type { DayTotalBasis, DayTotalSummary } from "./types";

/** A work period as the day totals see it: live while it has no end. */
export interface DayTotalWorkPeriod {
	startTime: Date;
	endTime: Date | null;
	surchargeMinutes: number | null;
}

function localDate(instant: Instant, timezone: string): PlainDate {
	return instant.toZonedDateTimeISO(timezone).toPlainDate();
}

/** The instants covering this week and this month, which the work periods to load must overlap. */
export function dayTotalRange(now: Instant, timezone: string, weekStartDay: WeekStartDay) {
	const today = localDate(now, timezone).toString();
	const week = localWeekRange(today, timezone, weekStartDay);
	const month = localMonthRange(today, timezone);
	return {
		start: dateFromInstant(compareInstants(week.start, month.start) < 0 ? week.start : month.start),
		endExclusive: dateFromInstant(
			compareInstants(week.endExclusive, month.endExclusive) > 0
				? week.endExclusive
				: month.endExclusive,
		),
	};
}

export function buildDayTotalBasis({
	periods,
	timezone,
	weekStartDay,
}: {
	periods: DayTotalWorkPeriod[];
	timezone: string;
	weekStartDay: WeekStartDay;
}): DayTotalBasis {
	const completedWork: CompletedWork[] = [];
	const liveWork: LiveWork[] = [];
	const surchargeMinutesByDate: DailyWorkActualMinutes = {};

	for (const period of periods) {
		if (!period.endTime) {
			// Live work has no surcharge until clock-out.
			liveWork.push({ startedAt: period.startTime });
			continue;
		}
		completedWork.push({ startedAt: period.startTime, endedAt: period.endTime });
		if (period.surchargeMinutes) {
			// Surcharge stays on the day its work period started; only base minutes split at midnight.
			const startDate = localDate(instantFromDate(period.startTime), timezone).toString();
			surchargeMinutesByDate[startDate] =
				(surchargeMinutesByDate[startDate] ?? 0) + period.surchargeMinutes;
		}
	}

	return {
		timezone,
		weekStartDay,
		completedMinutesByDate: buildCompletedMinutesByLocalMonth(completedWork, timezone),
		surchargeMinutesByDate,
		liveWork,
	};
}

/**
 * The calendar clips completed work to each local month before splitting it at
 * midnight, so doing the same keeps every day total equal to the calendar's.
 */
function buildCompletedMinutesByLocalMonth(
	completedWork: CompletedWork[],
	timezone: string,
): DailyWorkActualMinutes {
	const months = new Set<string>();
	for (const work of completedWork) {
		const lastMonth = localDate(instantFromDate(work.endedAt), timezone).with({ day: 1 });
		for (
			let month = localDate(instantFromDate(work.startedAt), timezone).with({ day: 1 });
			comparePlainDates(month, lastMonth) <= 0;
			month = month.add({ months: 1 })
		) {
			months.add(month.toString());
		}
	}

	const completedMinutesByDate: DailyWorkActualMinutes = {};
	for (const month of months) {
		const range = localMonthRange(month, timezone);
		Object.assign(
			completedMinutesByDate,
			buildDailyCompletedMinutes(completedWork, timezone, {
				start: dateFromInstant(range.start),
				endExclusive: dateFromInstant(range.endExclusive),
			}),
		);
	}
	return completedMinutesByDate;
}

/** Sums the day totals of today, this week and this month as of `now`. */
export function summarizeDayTotals(basis: DayTotalBasis, now: Instant): DayTotalSummary {
	const { timezone } = basis;
	const today = localDate(now, timezone).toString();
	const weekStart = localDate(localWeekRange(today, timezone, basis.weekStartDay).start, timezone);
	const weekStartKey = weekStart.toString();
	const weekEndKey = weekStart.add({ days: 7 }).toString();
	const monthKey = today.slice(0, 7);

	// ISO date keys sort chronologically, so plain string comparison selects a range.
	const isToday = (dateKey: string) => dateKey === today;
	const isThisWeek = (dateKey: string) => dateKey >= weekStartKey && dateKey < weekEndKey;
	const isThisMonth = (dateKey: string) => dateKey.slice(0, 7) === monthKey;
	const sumWhere = (minutesByDate: [string, number][], inRange: (dateKey: string) => boolean) =>
		minutesByDate.reduce(
			(total, [dateKey, minutes]) => total + (inRange(dateKey) ? minutes : 0),
			0,
		);

	const dayTotals = buildDailyWorkHoursSummaries({
		dailyRequirements: {},
		dailyActualMinutes: basis.completedMinutesByDate,
		liveWork: basis.liveWork,
		timezone,
		now,
	});
	const dayTotalMinutes = [...dayTotals].map(([dateKey, dayTotal]): [string, number] => [
		dateKey,
		dayTotal.actualMinutes,
	]);
	const surchargeMinutes = Object.entries(basis.surchargeMinutesByDate);
	const summary: DayTotalSummary = {
		todayMinutes: sumWhere(dayTotalMinutes, isToday),
		weekMinutes: sumWhere(dayTotalMinutes, isThisWeek),
		monthMinutes: sumWhere(dayTotalMinutes, isThisMonth),
	};

	const todaySurchargeMinutes = sumWhere(surchargeMinutes, isToday);
	const weekSurchargeMinutes = sumWhere(surchargeMinutes, isThisWeek);
	const monthSurchargeMinutes = sumWhere(surchargeMinutes, isThisMonth);
	const hasSurcharge = todaySurchargeMinutes + weekSurchargeMinutes + monthSurchargeMinutes > 0;
	return hasSurcharge
		? { ...summary, todaySurchargeMinutes, weekSurchargeMinutes, monthSurchargeMinutes }
		: summary;
}
