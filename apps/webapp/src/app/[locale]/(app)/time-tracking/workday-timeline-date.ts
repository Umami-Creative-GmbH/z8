import { DateTime } from "luxon";
import type { SelectedWorkdayDate } from "./workday-timeline.types";

interface GetSelectedWorkdayDateInput {
	dateParam: string | undefined;
	timezone: string;
	now?: Date;
}

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getSelectedWorkdayDate({
	dateParam,
	timezone,
	now,
}: GetSelectedWorkdayDateInput): SelectedWorkdayDate {
	const today = DateTime.fromJSDate(now ?? new Date(), { zone: "utc" }).setZone(timezone);
	const parsed =
		dateParam && DATE_PARAM_PATTERN.test(dateParam)
			? DateTime.fromISO(dateParam, { zone: timezone })
			: null;
	const selected = parsed?.isValid ? parsed : today;
	const selectedDay = selected.startOf("day");

	return {
		dateKey: selectedDay.toISODate() ?? today.toISODate() ?? "",
		todayDateKey: today.toISODate() ?? "",
		previousDateKey: selectedDay.minus({ days: 1 }).toISODate() ?? "",
		nextDateKey: selectedDay.plus({ days: 1 }).toISODate() ?? "",
		label: selectedDay.toLocaleString(DateTime.DATE_FULL),
		startUtc: selectedDay.toUTC(),
		endUtc: selectedDay.endOf("day").toUTC(),
	};
}
