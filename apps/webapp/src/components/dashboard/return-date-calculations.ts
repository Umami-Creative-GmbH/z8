import { DateTime } from "luxon";

type DayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

type ScheduleDay = {
	dayOfWeek: string;
	isWorkDay: boolean;
};

export type ReturnDateSchedule = {
	workingDaysPreset?: "weekdays" | "weekends" | "all_days" | "custom" | string;
	days?: ScheduleDay[] | null;
} | null;

export type AbsenceRange = {
	startDate: string;
	endDate: string;
};

const DAY_NAMES: Record<number, DayName> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

function isScheduledWorkDay(schedule: ReturnDateSchedule, date: DateTime): boolean {
	const dayName = DAY_NAMES[date.weekday];
	const scheduleDay = schedule?.days?.find((day) => day.dayOfWeek === dayName);
	if (scheduleDay) return scheduleDay.isWorkDay;

	switch (schedule?.workingDaysPreset) {
		case "weekends":
			return date.weekday === 6 || date.weekday === 7;
		case "all_days":
			return true;
		case "custom":
			return false;
		case "weekdays":
		default:
			return date.weekday >= 1 && date.weekday <= 5;
	}
}

function isAbsent(dateKey: string, absenceRanges: AbsenceRange[]): boolean {
	return absenceRanges.some(
		(absence) => absence.startDate <= dateKey && absence.endDate >= dateKey,
	);
}

export function getNextAvailableReturnDate({
	absenceEndDate,
	today,
	schedule,
	holidayDates,
	absenceRanges,
}: {
	absenceEndDate: string;
	today: string;
	schedule: ReturnDateSchedule;
	holidayDates: Set<string>;
	absenceRanges: AbsenceRange[];
}): { returnDate: string; returnsTomorrow: boolean } {
	const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate();
	let candidate = DateTime.fromISO(absenceEndDate).plus({ days: 1 });

	for (let attempts = 0; attempts < 366; attempts++) {
		const dateKey = candidate.toISODate();
		if (
			dateKey &&
			isScheduledWorkDay(schedule, candidate) &&
			!holidayDates.has(dateKey) &&
			!isAbsent(dateKey, absenceRanges)
		) {
			return {
				returnDate: dateKey,
				returnsTomorrow: dateKey === tomorrow,
			};
		}

		candidate = candidate.plus({ days: 1 });
	}

	const fallback = DateTime.fromISO(absenceEndDate).plus({ days: 1 }).toISODate() ?? absenceEndDate;
	return { returnDate: fallback, returnsTomorrow: fallback === tomorrow };
}
