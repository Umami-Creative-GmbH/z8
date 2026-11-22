import { DateTime } from "luxon";
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

export function getSelectedWorkdayDate({
	dateParam,
	timezone,
	locale = "en",
	now,
}: GetSelectedWorkdayDateInput): SelectedWorkdayDate {
	const zone = DateTime.now().setZone(timezone).isValid ? timezone : "UTC";
	const today = DateTime.fromJSDate(now ?? new Date(), { zone: "utc" }).setZone(zone);
	const parsed =
		dateParam && DATE_PARAM_PATTERN.test(dateParam) ? DateTime.fromISO(dateParam, { zone }) : null;
	const selected = parsed?.isValid ? parsed : today;
	const selectedDay = selected.startOf("day");

	return {
		dateKey: selectedDay.toISODate() ?? today.toISODate() ?? "",
		todayDateKey: today.toISODate() ?? "",
		previousDateKey: selectedDay.minus({ days: 1 }).toISODate() ?? "",
		nextDateKey: selectedDay.plus({ days: 1 }).toISODate() ?? "",
		label: formatWorkdayLabel(selectedDay.toJSDate(), zone, locale),
		startUtc: selectedDay.toUTC(),
		endUtc: selectedDay.endOf("day").toUTC(),
	};
}
