import {
	type Instant,
	instantFromDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";

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

export function todayCalendarDateKey(
	timezone: string,
	now: Instant = systemClock.nowInstant(),
): string {
	return calendarDateKeyForInstant(now, timezone);
}
