import { DateTime } from "luxon";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import type { EmployeeScheduleComplianceInput, ScheduleComplianceRegulation } from "./types";

/** A shift as `shift` stores it: `date` at the organization-local midnight, wall-clock times. */
export interface ComplianceShiftSource {
	date: Date;
	startTime: string;
	endTime: string;
}

/** A completed work period. */
export interface ComplianceWorkPeriodSource {
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
}

export interface ComplianceRegulationSource {
	minRestPeriodMinutes: number | null;
	maxDailyMinutes: number | null;
	overtimeDailyThresholdMinutes: number | null;
	overtimeWeeklyThresholdMinutes: number | null;
	overtimeMonthlyThresholdMinutes: number | null;
}

interface Interval {
	start: DateTime;
	end: DateTime;
}

function addMinutes(target: Record<string, number>, dayKey: string | null, minutes: number): void {
	if (!dayKey || minutes <= 0) {
		return;
	}
	target[dayKey] = (target[dayKey] ?? 0) + minutes;
}

/** The thresholds a work-policy regulation sets; unset ones are left out, not judged. */
export function normalizeScheduleComplianceRegulation(
	regulation: ComplianceRegulationSource | null,
): ScheduleComplianceRegulation {
	if (!regulation) {
		return {};
	}

	return {
		...(regulation.minRestPeriodMinutes != null
			? { minRestPeriodMinutes: regulation.minRestPeriodMinutes }
			: {}),
		...(regulation.maxDailyMinutes != null ? { maxDailyMinutes: regulation.maxDailyMinutes } : {}),
		...(regulation.overtimeDailyThresholdMinutes != null
			? {
					overtimeDailyThresholdMinutes: regulation.overtimeDailyThresholdMinutes,
				}
			: {}),
		...(regulation.overtimeWeeklyThresholdMinutes != null
			? {
					overtimeWeeklyThresholdMinutes: regulation.overtimeWeeklyThresholdMinutes,
				}
			: {}),
		...(regulation.overtimeMonthlyThresholdMinutes != null
			? {
					overtimeMonthlyThresholdMinutes: regulation.overtimeMonthlyThresholdMinutes,
				}
			: {}),
	};
}

function toShiftInterval(params: {
	date: Date;
	startTime: string;
	endTime: string;
	timezone: string;
}): Interval | null {
	const baseDate = shiftCalendarDate(params.date, params.timezone).toString();

	const start = DateTime.fromISO(`${baseDate}T${params.startTime}`, {
		zone: params.timezone,
	});
	let end = DateTime.fromISO(`${baseDate}T${params.endTime}`, {
		zone: params.timezone,
	});

	if (!start.isValid || !end.isValid) {
		return null;
	}

	if (end <= start) {
		end = end.plus({ days: 1 });
	}

	return { start, end };
}

/**
 * One employee's compliance input from their shifts and completed work periods: actual and
 * scheduled minutes per organization-local day, and the rest gaps between consecutive intervals.
 * A shift's minutes count on its start day.
 */
export function buildEmployeeComplianceInput(params: {
	employeeId: string;
	shifts: readonly ComplianceShiftSource[];
	workPeriods: readonly ComplianceWorkPeriodSource[];
	timezone: string;
}): EmployeeScheduleComplianceInput {
	const actualMinutesByDay: Record<string, number> = {};
	const scheduledMinutesByDay: Record<string, number> = {};
	const intervals: Interval[] = [];

	for (const employeePeriod of params.workPeriods) {
		const endTime = employeePeriod.endTime;
		if (!endTime) {
			continue;
		}
		const start = DateTime.fromJSDate(employeePeriod.startTime).setZone(params.timezone);
		const end = DateTime.fromJSDate(endTime).setZone(params.timezone);
		const minutes =
			employeePeriod.durationMinutes ?? Math.max(0, Math.round(end.diff(start, "minutes").minutes));

		addMinutes(actualMinutesByDay, start.toISODate(), minutes);
		intervals.push({ start, end });
	}

	for (const employeeShift of params.shifts) {
		const interval = toShiftInterval({
			date: employeeShift.date,
			startTime: employeeShift.startTime,
			endTime: employeeShift.endTime,
			timezone: params.timezone,
		});

		if (!interval) {
			continue;
		}

		const minutes = Math.max(0, Math.round(interval.end.diff(interval.start, "minutes").minutes));
		addMinutes(scheduledMinutesByDay, interval.start.toISODate(), minutes);
		intervals.push(interval);
	}

	intervals.sort((a, b) => a.start.toMillis() - b.start.toMillis());

	const restTransitions: EmployeeScheduleComplianceInput["restTransitions"] = [];
	for (let index = 1; index < intervals.length; index++) {
		const previous = intervals[index - 1];
		const current = intervals[index];
		// The evaluator judges only transitions into the window.
		if (current.start > previous.end) {
			restTransitions.push({
				fromEndIso: previous.end.toISO() ?? previous.end.toUTC().toISO() ?? "",
				toStartIso: current.start.toISO() ?? current.start.toUTC().toISO() ?? "",
			});
		}
	}

	return {
		employeeId: params.employeeId,
		actualMinutesByDay,
		scheduledMinutesByDay,
		restTransitions,
	};
}
