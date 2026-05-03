import { DateTime } from "luxon";
import type { holidayPresetHoliday } from "@/db/schema";
import type { Holiday } from "@/lib/absences/types";

type PresetHolidayForExpansion = Pick<
	typeof holidayPresetHoliday.$inferSelect,
	"id" | "name" | "month" | "day" | "durationDays" | "categoryId"
>;

export function expandPresetHolidayForYear(
	presetHoliday: PresetHolidayForExpansion,
	year: number,
): Holiday[] {
	const startDate = DateTime.local(year, presetHoliday.month, presetHoliday.day).startOf("day");
	const durationDays = Math.max(presetHoliday.durationDays || 1, 1);
	const endDate = startDate.plus({ days: durationDays - 1 });

	if (!startDate.isValid || !endDate.isValid) {
		return [];
	}

	return [
		{
			id: `preset-holiday-${presetHoliday.id}-${year}`,
			name: presetHoliday.name,
			startDate: startDate.toJSDate(),
			endDate: endDate.toJSDate(),
			categoryId: presetHoliday.categoryId ?? "",
		},
	];
}
