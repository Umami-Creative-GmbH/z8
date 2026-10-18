import { DateTime } from "luxon";

export type DayOfWeek =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

export interface CoverageRuleEntity {
	id: string;
	organizationId: string;
	subareaId: string;
	dayOfWeek: DayOfWeek;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	priority: number;
}

export function toCoverageRuleEntity(input: {
	id: string;
	organizationId: string;
	subareaId: string;
	dayOfWeek: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	priority?: number;
}): CoverageRuleEntity {
	return {
		id: input.id,
		organizationId: input.organizationId,
		subareaId: input.subareaId,
		dayOfWeek: input.dayOfWeek as DayOfWeek,
		startTime: input.startTime,
		endTime: input.endTime,
		minimumStaffCount: input.minimumStaffCount,
		priority: input.priority ?? 0,
	};
}

const DAY_OF_WEEK_BY_ISO_WEEKDAY: Record<number, DayOfWeek> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

/** The rule weekday of an ISO weekday number (1 = Monday … 7 = Sunday), e.g. a `PlainDate`'s. */
export function dayOfWeekOf(date: { dayOfWeek: number }): DayOfWeek {
	return DAY_OF_WEEK_BY_ISO_WEEKDAY[date.dayOfWeek] ?? "monday";
}

export function getDayOfWeek(date: Date): DayOfWeek {
	return dayOfWeekOf({ dayOfWeek: DateTime.fromJSDate(date).weekday });
}
