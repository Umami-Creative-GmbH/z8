import { Temporal } from "temporal-polyfill";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";

export function workdayHref(dateKey: string) {
	return `/time-tracking?date=${encodeURIComponent(dateKey)}`;
}

export function weekDates(dateKey: string, weekStartDay: WeekStartDay) {
	const selected = Temporal.PlainDate.from(dateKey);
	const offset =
		weekStartDay === "monday" ? selected.dayOfWeek - 1 : selected.dayOfWeek % 7;
	const start = selected.subtract({ days: offset });
	return Array.from({ length: 7 }, (_, index) => start.add({ days: index }));
}
