import {
	type InstantRange,
	localDayRange,
	resolveManualWallClock,
} from "@/lib/datetime/temporal-boundaries";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";

export interface ScheduleDateRangeInput {
	startDate: string;
	endDateExclusive: string;
}

export interface ScheduleWallTimeInput {
	date: string;
	time: string;
}

export function resolveScheduleDateRange(
	input: ScheduleDateRangeInput,
	organizationTimezone: string,
): InstantRange {
	const timezone = parseIanaTimeZone(organizationTimezone);
	const startDate = parsePlainDate(input.startDate);
	const endDateExclusive = parsePlainDate(input.endDateExclusive);
	if (comparePlainDates(startDate, endDateExclusive) >= 0) {
		throw new RangeError("Schedule range end must be after its start");
	}

	return {
		start: localDayRange(input.startDate, timezone).start,
		endExclusive: localDayRange(input.endDateExclusive, timezone).start,
	};
}

export function resolveScheduleWallTime(
	input: ScheduleWallTimeInput,
	organizationTimezone: string,
) {
	return resolveManualWallClock({
		...input,
		timezone: parseIanaTimeZone(organizationTimezone),
		disambiguation: "reject",
	});
}
