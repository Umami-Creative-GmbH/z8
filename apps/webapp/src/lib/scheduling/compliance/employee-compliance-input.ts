import { Temporal } from "temporal-polyfill";
import { compareInstants, instantFromDate, type ZonedDateTime } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { parseTimeZone } from "@/lib/timezone/validation";
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
	start: ZonedDateTime;
	end: ZonedDateTime;
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
	try {
		const timezone = parseTimeZone(params.timezone);
		const baseDate = shiftCalendarDate(params.date, timezone);
		const startClock = Temporal.PlainTime.from(params.startTime);
		const endClock = Temporal.PlainTime.from(params.endTime);

		const start = baseDate
			.toPlainDateTime(startClock)
			.toZonedDateTime(timezone, { disambiguation: "compatible" });
		let end = baseDate
			.toPlainDateTime(endClock)
			.toZonedDateTime(timezone, { disambiguation: "compatible" });

		if (compareInstants(end.toInstant(), start.toInstant()) <= 0) {
			end = baseDate
				.add({ days: 1 })
				.toPlainDateTime(endClock)
				.toZonedDateTime(timezone, { disambiguation: "compatible" });
		}

		return { start, end };
	} catch {
		return null;
	}
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
	const timezone = parseTimeZone(params.timezone);
	const actualMinutesByDay: Record<string, number> = {};
	const scheduledMinutesByDay: Record<string, number> = {};
	const intervals: Interval[] = [];

	for (const employeePeriod of params.workPeriods) {
		const endTime = employeePeriod.endTime;
		if (!endTime) {
			continue;
		}
		const startInstant = instantFromDate(employeePeriod.startTime);
		const endInstant = instantFromDate(endTime);
		const start = startInstant.toZonedDateTimeISO(timezone);
		const end = endInstant.toZonedDateTimeISO(timezone);
		const minutes =
			employeePeriod.durationMinutes ??
			Math.max(0, Math.round(endInstant.since(startInstant).total({ unit: "minutes" })));

		addMinutes(actualMinutesByDay, start.toPlainDate().toString(), minutes);
		intervals.push({ start, end });
	}

	for (const employeeShift of params.shifts) {
		const interval = toShiftInterval({
			date: employeeShift.date,
			startTime: employeeShift.startTime,
			endTime: employeeShift.endTime,
			timezone,
		});

		if (!interval) {
			continue;
		}

		const minutes = Math.max(
			0,
			Math.round(
				interval.end.toInstant().since(interval.start.toInstant()).total({ unit: "minutes" }),
			),
		);
		addMinutes(scheduledMinutesByDay, interval.start.toPlainDate().toString(), minutes);
		intervals.push(interval);
	}

	intervals.sort((a, b) => compareInstants(a.start.toInstant(), b.start.toInstant()));

	const restTransitions: EmployeeScheduleComplianceInput["restTransitions"] = [];
	for (let index = 1; index < intervals.length; index++) {
		const previous = intervals[index - 1];
		const current = intervals[index];
		// The evaluator judges only transitions into the window.
		if (compareInstants(current.start.toInstant(), previous.end.toInstant()) > 0) {
			restTransitions.push({
				fromEndIso: previous.end.toString({ timeZoneName: "never" }),
				toStartIso: current.start.toString({ timeZoneName: "never" }),
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
