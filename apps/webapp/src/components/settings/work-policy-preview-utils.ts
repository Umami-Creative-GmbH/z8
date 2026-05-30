export interface ScheduleDayInput {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek?: number;
}

export const DAY_ORDER = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

export function generateDaysFromPreset(
	preset: "weekdays" | "weekends" | "all_days" | "custom",
): ScheduleDayInput[] {
	return DAY_ORDER.map((day) => {
		let isWorkDay = false;
		switch (preset) {
			case "weekdays":
				isWorkDay = day !== "saturday" && day !== "sunday";
				break;
			case "weekends":
				isWorkDay = day === "saturday" || day === "sunday";
				break;
			case "all_days":
				isWorkDay = true;
				break;
			default:
				isWorkDay = day !== "saturday" && day !== "sunday";
		}
		return {
			dayOfWeek: day as ScheduleDayInput["dayOfWeek"],
			hoursPerDay: isWorkDay ? "8" : "0",
			isWorkDay,
			cycleWeek: 1,
		};
	});
}
