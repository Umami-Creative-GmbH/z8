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

export function getDayOfWeek(date: Date): DayOfWeek {
	const weekday = DateTime.fromJSDate(date).weekday;
	const days: Record<number, DayOfWeek> = {
		1: "monday",
		2: "tuesday",
		3: "wednesday",
		4: "thursday",
		5: "friday",
		6: "saturday",
		7: "sunday",
	};

	return days[weekday] ?? "monday";
}
