import type { DateTime } from "luxon";

type ScheduleDay = {
	dayOfWeek: string;
	isWorkDay: boolean;
	hoursPerDay: string;
};

type QuickStatsSchedule = {
	scheduleType?: string;
	scheduleCycle?: string;
	hoursPerCycle?: string | null;
	days?: ScheduleDay[];
} | null;

const WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const DAY_NAMES: Record<number, string> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

function getWeeklyHours(schedule: QuickStatsSchedule): number {
	if (!schedule) return 40;

	if (schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
		const hoursPerCycle = Number.parseFloat(schedule.hoursPerCycle);
		if (Number.isNaN(hoursPerCycle)) return 0;

		switch (schedule.scheduleCycle) {
			case "daily":
				return hoursPerCycle * 7;
			case "weekly":
				return hoursPerCycle;
			case "biweekly":
				return hoursPerCycle / 2;
			case "monthly":
				return (hoursPerCycle * 12) / 52;
			case "yearly":
				return hoursPerCycle / 52;
			default:
				return hoursPerCycle;
		}
	}

	if (schedule.days?.length) {
		return schedule.days.reduce((total, day) => {
			if (!day.isWorkDay) return total;
			const hours = Number.parseFloat(day.hoursPerDay);
			return total + (Number.isNaN(hours) ? 0 : hours);
		}, 0);
	}

	return 40;
}

function getHoursForDate(
	schedule: QuickStatsSchedule,
	weeklyHours: number,
	date: DateTime,
): number {
	const scheduleDay = schedule?.days?.find((day) => day.dayOfWeek === DAY_NAMES[date.weekday]);
	if (scheduleDay) {
		if (!scheduleDay.isWorkDay) return 0;
		const hours = Number.parseFloat(scheduleDay.hoursPerDay);
		return Number.isNaN(hours) ? 0 : hours;
	}

	return WEEKDAYS.has(date.weekday) ? weeklyHours / 5 : 0;
}

export function calculateAdjustedExpectedHoursForRange({
	schedule,
	start,
	end,
	excludedDates,
}: {
	schedule: QuickStatsSchedule;
	start: DateTime;
	end: DateTime;
	excludedDates: Set<string>;
}): number {
	const weeklyHours = getWeeklyHours(schedule);
	const totalRangeMs = Math.max(0, end.toMillis() - start.toMillis());
	let expected = weeklyHours * (totalRangeMs / (7 * 24 * 60 * 60 * 1000));

	let current = start.startOf("day");
	const last = end.startOf("day");
	while (current <= last) {
		const dateKey = current.toISODate();
		if (dateKey && excludedDates.has(dateKey)) {
			expected -= getHoursForDate(schedule, weeklyHours, current);
		}
		current = current.plus({ days: 1 });
	}

	return Math.max(0, Math.round(expected * 100) / 100);
}
