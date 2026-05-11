import { DateTime } from "luxon";

type PresenceMode = "minimum_count" | "fixed_days";
export type PresenceDayOfWeek =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

const WEEKDAY_BY_NUMBER: Record<number, PresenceDayOfWeek> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

export function calculatePresenceStatusCounts({
	presenceMode,
	requiredOnsiteDays,
	requiredOnsiteFixedDays,
	workPeriods,
}: {
	presenceMode: PresenceMode;
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: PresenceDayOfWeek[] | null;
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>;
}) {
	const requiredFixedDaySet = new Set(requiredOnsiteFixedDays ?? []);
	const onsiteDates = new Set<string>();

	for (const period of workPeriods) {
		if (period.workLocationType !== "office") continue;

		const dateTime = DateTime.fromJSDate(period.startTime);
		if (
			presenceMode === "fixed_days" &&
			!requiredFixedDaySet.has(WEEKDAY_BY_NUMBER[dateTime.weekday])
		) {
			continue;
		}

		const date = dateTime.toISODate();
		if (date) {
			onsiteDates.add(date);
		}
	}

	return {
		required:
			presenceMode === "minimum_count" ? (requiredOnsiteDays ?? 0) : requiredFixedDaySet.size,
		actual: onsiteDates.size,
	};
}
