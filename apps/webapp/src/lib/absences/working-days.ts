import { Temporal } from "temporal-polyfill";
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
	/** The assigned work policy, so a working-week problem can name it. */
	policyId?: string;
	assignmentType: "organization" | "team" | "employee";
	effectiveFrom: Temporal.Instant | null;
	effectiveUntil: Temporal.Instant | null;
	createdAt: Temporal.Instant;
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
export function scheduledWeekdays(schedule: WorkingDaySchedule): ReadonlySet<number> {
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
		(!assignment.effectiveFrom || assignment.effectiveFrom.epochMilliseconds < nextDayStart) &&
		(!assignment.effectiveUntil || assignment.effectiveUntil.epochMilliseconds > dayStart)
	);
}

/** The work policy service's order: latest start first (open start last), then newest. */
function compareAssignments(left: WorkingDayPolicyAssignment, right: WorkingDayPolicyAssignment) {
	const leftFrom = left.effectiveFrom?.epochMilliseconds ?? Number.NEGATIVE_INFINITY;
	const rightFrom = right.effectiveFrom?.epochMilliseconds ?? Number.NEGATIVE_INFINITY;
	if (leftFrom !== rightFrom) return rightFrom - leftFrom;
	const created = right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds;
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
	const effectiveWeekdays = effectiveWeekdaysFrom(input.assignments);
	const holidays = holidayDateKeys(input.holidays);

	return (day) => {
		if (holidays.has(day.toString())) return false;
		const weekdays = effectiveWeekdays(day).weekdays;
		return weekdays ? weekdays.has(day.dayOfWeek) : mondayToFriday(day);
	};
}

/**
 * The assignment in effect on a day and its scheduled ISO weekdays; null weekdays when no
 * assignment applies or its policy has no schedule.
 */
function effectiveWeekdaysFrom(assignments: readonly WorkingDayPolicyAssignment[]) {
	const byLevel = LEVELS.map((level) =>
		assignments
			.filter((assignment) => assignment.assignmentType === level)
			.toSorted(compareAssignments),
	);
	const weekdaysBySchedule = new Map<WorkingDaySchedule, ReadonlySet<number>>();

	return (
		day: Temporal.PlainDate,
	): { assignment?: WorkingDayPolicyAssignment; weekdays: ReadonlySet<number> | null } => {
		let assignment: WorkingDayPolicyAssignment | undefined;
		for (const candidates of byLevel) {
			assignment = candidates.find((candidate) => inForceOn(candidate, day));
			if (assignment) break;
		}
		const schedule = assignment?.schedule;
		if (!schedule) return { assignment, weekdays: null };

		let weekdays = weekdaysBySchedule.get(schedule);
		if (!weekdays) {
			weekdays = scheduledWeekdays(schedule);
			weekdaysBySchedule.set(schedule, weekdays);
		}
		return { assignment, weekdays };
	};
}

/** Days with the same scheduled working week (Absences ADR 0003). Dates are inclusive. */
export interface WorkingWeekPeriod {
	startDate: string;
	endDate: string;
	/**
	 * The distinct weekdays the effective schedule works, before holidays and regardless of hours.
	 * Five without a policy or schedule; 0 only for an explicitly configured schedule without
	 * working days, which is a configuration error.
	 */
	workingDaysPerWeek: number;
	/** The work policy in effect; null when no work policy applies. */
	workPolicyId: string | null;
}

const MONDAY_TO_FRIDAY_DAYS = 5;

/**
 * The employee's working days per week over a range, from the work policy in effect on each day
 * with the same precedence and schedule interpretation as `workingDaysFrom`. Public holidays never
 * reduce the week. Consecutive days with the same week and policy form one period.
 */
export function workingWeekPeriodsFrom(input: {
	assignments: readonly WorkingDayPolicyAssignment[];
	/** First calendar day, `YYYY-MM-DD`. */
	startDate: string;
	/** Last calendar day (inclusive), `YYYY-MM-DD`. */
	endDate: string;
}): WorkingWeekPeriod[] {
	const effectiveWeekdays = effectiveWeekdaysFrom(input.assignments);
	const end = Temporal.PlainDate.from(input.endDate);
	const periods: WorkingWeekPeriod[] = [];
	for (
		let day = Temporal.PlainDate.from(input.startDate);
		Temporal.PlainDate.compare(day, end) <= 0;
		day = day.add({ days: 1 })
	) {
		const { assignment, weekdays } = effectiveWeekdays(day);
		const workingDaysPerWeek = weekdays ? weekdays.size : MONDAY_TO_FRIDAY_DAYS;
		const workPolicyId = assignment?.policyId ?? null;
		const last = periods.at(-1);
		if (last && last.workingDaysPerWeek === workingDaysPerWeek && last.workPolicyId === workPolicyId) {
			last.endDate = day.toString();
		} else {
			periods.push({
				startDate: day.toString(),
				endDate: day.toString(),
				workingDaysPerWeek,
				workPolicyId,
			});
		}
	}
	return periods;
}
