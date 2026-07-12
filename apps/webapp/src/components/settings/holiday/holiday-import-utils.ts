import { Temporal } from "temporal-polyfill";

type HolidayPreviewForImport = {
	name: string;
	date: string;
	startDate: string;
	endDate: string;
	type: string;
};

const holidayTypes = ["optional", "public", "bank", "school", "observance"] as const;
type HolidayType = (typeof holidayTypes)[number];

export function isHolidayType(type: string): type is HolidayType {
	return holidayTypes.some((holidayType) => holidayType === type);
}

export function buildPresetHolidayImportValue(holiday: HolidayPreviewForImport) {
	if (!isHolidayType(holiday.type)) return null;
	const calendarDate = Temporal.PlainDate.from(holiday.date.slice(0, 10));
	const startDate = Temporal.Instant.from(holiday.startDate);
	const endDate = Temporal.Instant.from(holiday.endDate);
	const durationDays = Math.max(1, Math.ceil(endDate.since(startDate).total({ unit: "days" })));

	return {
		name: holiday.name,
		description: "",
		month: calendarDate.month,
		day: calendarDate.day,
		durationDays,
		holidayType: holiday.type,
		isFloating: false,
		isActive: true,
	};
}
