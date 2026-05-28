import { DateTime } from "luxon";

type HolidayPreviewForImport = {
	name: string;
	date: string;
	startDate: string;
	endDate: string;
	type: string;
};

export function buildPresetHolidayImportValue(holiday: HolidayPreviewForImport) {
	const calendarDate = DateTime.fromFormat(holiday.date.slice(0, 10), "yyyy-MM-dd", {
		zone: "utc",
	});
	const startDate = DateTime.fromISO(holiday.startDate, { zone: "utc" });
	const endDate = DateTime.fromISO(holiday.endDate, { zone: "utc" });
	const durationDays = Math.max(1, Math.ceil(endDate.diff(startDate, "days").days));

	return {
		name: holiday.name,
		description: "",
		month: calendarDate.month,
		day: calendarDate.day,
		durationDays,
		holidayType: holiday.type as "optional" | "public" | "bank" | "school" | "observance",
		isFloating: false,
		isActive: true,
	};
}
