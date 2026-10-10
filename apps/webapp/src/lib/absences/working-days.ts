import type { Temporal } from "temporal-polyfill";
import { holidayDateKeys, type IsWorkingDay, mondayToFriday } from "./absence-days";
import type { Holiday } from "./types";

export type WeekdayName =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

/** The part of a work policy's schedule that decides its working days. */
export interface WorkingDaySchedule {
	scheduleType: "simple" | "detailed";
	workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
	days: ReadonlyArray<{ dayOfWeek: WeekdayName; isWorkDay: boolean }>;
}

/**
 * One work policy assignment that can reach the employee: their own, their team's, or their
 * organization's. Its policy must be active and belong to the employee's organization.
 */
export interface WorkingDayPolicyAssignment {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	createdAt: Date;
	/** Null when the policy's scheduling is disabled or it has no schedule. */
	schedule: WorkingDaySchedule | null;
}

const ISO_WEEKDAY: Record<WeekdayName, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

const PRESET_WEEKDAYS: Record<
	Exclude<WorkingDaySchedule["workingDaysPreset"], "custom">,
	number[]
> = {
	weekdays: [1, 2, 3, 4, 5],
	weekends: [6, 7],
	all_days: [1, 2, 3, 4, 5, 6, 7],
};

const LEVELS: WorkingDayPolicyAssignment["assignmentType"][] = ["employee", "team", "organization"];

/**
 * The ISO weekdays a schedule works. Simple presets name them; a custom preset or a detailed
 * schedule lists them as work days. The cycle and `cycleWeek` are ignored (Absences ADR 0001).
 */
function scheduledWeekdays(schedule: WorkingDaySchedule): ReadonlySet<number> {
	if (schedule.scheduleType === "simple" && schedule.workingDaysPreset !== "custom") {
		return new Set(PRESET_WEEKDAYS[schedule.workingDaysPreset]);
	}
	return new Set(
		schedule.days.flatMap((day) => (day.isWorkDay ? [ISO_WEEKDAY[day.dayOfWeek]] : [])),
	);
}

function inForceOn(assignment: WorkingDayPolicyAssignment, day: Temporal.PlainDate): boolean {
	const dayStart = day.toZonedDateTime("UTC").epochMilliseconds;
	const nextDayStart = day.add({ days: 1 }).toZonedDateTime("UTC").epochMilliseconds;
	return (
		(!assignment.effectiveFrom || assignment.effectiveFrom.getTime() < nextDayStart) &&
		(!assignment.effectiveUntil || assignment.effectiveUntil.getTime() >= dayStart)
	);
}

/** The work policy service's order: latest start first (open start last), then newest. */
function compareAssignments(left: WorkingDayPolicyAssignment, right: WorkingDayPolicyAssignment) {
	const leftFrom = left.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
	const rightFrom = right.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
	if (leftFrom !== rightFrom) return rightFrom - leftFrom;
	const created = right.createdAt.getTime() - left.createdAt.getTime();
	if (created !== 0) return created;
	return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
}

/**
 * The employee's working days: each day uses the work policy in effect on that day (employee,
 * then team, then organization assignment) and drops their holidays. A day is the UTC calendar
 * date, like holidays and absence dates; an assignment in force at any moment of it applies.
 * Without a policy, or with one that has no schedule, the employee works Monday to Friday.
 */
export function workingDaysFrom(input: {
	assignments: readonly WorkingDayPolicyAssignment[];
	holidays: readonly Holiday[];
}): IsWorkingDay {
	const byLevel = LEVELS.map((level) =>
		input.assignments
			.filter((assignment) => assignment.assignmentType === level)
			.toSorted(compareAssignments),
	);
	const weekdaysBySchedule = new Map<WorkingDaySchedule, ReadonlySet<number>>();
	const holidays = holidayDateKeys(input.holidays);

	return (day) => {
		if (holidays.has(day.toString())) return false;

		let assignment: WorkingDayPolicyAssignment | undefined;
		for (const candidates of byLevel) {
			assignment = candidates.find((candidate) => inForceOn(candidate, day));
			if (assignment) break;
		}
		const schedule = assignment?.schedule;
		if (!schedule) return mondayToFriday(day);

		let weekdays = weekdaysBySchedule.get(schedule);
		if (!weekdays) {
			weekdays = scheduledWeekdays(schedule);
			weekdaysBySchedule.set(schedule, weekdays);
		}
		return weekdays.has(day.dayOfWeek);
	};
}
