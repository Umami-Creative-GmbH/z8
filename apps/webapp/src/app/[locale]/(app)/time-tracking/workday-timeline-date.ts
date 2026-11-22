import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { isValidTimeZone, parseTimeZone } from "@/lib/timezone/validation";
import type { SelectedWorkdayDate } from "./workday-timeline.types";

interface GetSelectedWorkdayDateInput {
	dateParam: string | undefined;
	timezone: string;
	locale?: string;
	now?: Date;
}

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatWorkdayLabel(date: Date, timezone: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "long",
		timeZone: timezone,
	}).format(date);
}

function tryParseDateParam(dateParam: string | undefined): PlainDate | null {
	if (!dateParam || !DATE_PARAM_PATTERN.test(dateParam)) return null;
	try {
		return parsePlainDate(dateParam);
	} catch {
		return null;
	}
}

export function getSelectedWorkdayDate({
	dateParam,
	timezone,
	locale = "en",
	now,
}: GetSelectedWorkdayDateInput): SelectedWorkdayDate {
	const zone = isValidTimeZone(timezone) ? parseTimeZone(timezone) : "UTC";
	const nowInstant = now ? instantFromDate(now) : systemClock.nowInstant();
	const today = plainDateAt(nowInstant, zone);
	const selectedDay = tryParseDateParam(dateParam) ?? today;
	const dayRange = localDayRange(selectedDay.toString(), zone);

	return {
		dateKey: selectedDay.toString(),
		todayDateKey: today.toString(),
		previousDateKey: selectedDay.subtract({ days: 1 }).toString(),
		nextDateKey: selectedDay.add({ days: 1 }).toString(),
		label: formatWorkdayLabel(dateFromInstant(dayRange.start), zone, locale),
		startUtc: dayRange.start,
		endUtc: dayRange.endExclusive.subtract({ milliseconds: 1 }),
	};
}
