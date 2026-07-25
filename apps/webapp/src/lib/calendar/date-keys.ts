import {
	type Instant,
	instantFromDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { Temporal } from "temporal-polyfill";

export function calendarDateKeyForInstant(instant: Instant, timezone: string): string {
	return instant.toZonedDateTimeISO(parseIanaTimeZone(timezone)).toPlainDate().toString();
}

export function calendarDateKeyForDate(date: Date, timezone: string): string {
	return calendarDateKeyForInstant(instantFromDate(date), timezone);
}

export function allDayDateKeyForDate(date: Date): string {
	return calendarDateKeyForInstant(instantFromDate(date), "UTC");
}

export function addCalendarDateKey(dateKey: string, duration: Temporal.DurationLike): string {
	return parsePlainDate(dateKey).add(duration).toString();
}

export function calendarWeekDateKeyRange(
	dateKey: string,
	weekStartDay: WeekStartDay,
): { startDateKey: string; endDateKey: string } {
	const date = Temporal.PlainDate.from(dateKey);
	const daysSinceStart =
		weekStartDay === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
	const start = date.subtract({ days: daysSinceStart });

	return {
		startDateKey: start.toString(),
		endDateKey: start.add({ days: 6 }).toString(),
	};
}

export function todayCalendarDateKey(
	timezone: string,
	now: Instant = systemClock.nowInstant(),
): string {
	return calendarDateKeyForInstant(now, timezone);
}
