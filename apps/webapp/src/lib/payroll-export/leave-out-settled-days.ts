import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { splitCreditByLocalDay } from "@/lib/payroll-period/period-rows";
import type { AbsenceData, WorkPeriodData } from "./types";

/**
 * The formatter input of a payroll file without the settled employee-days (#1898).
 *
 * Work is attributed to days as the Days tab credits it: each line is split at the
 * employee's local midnights by the payroll period module's per-day credit rule. A line
 * that touches no settled day stays exactly as it was. A line that touches only settled
 * days is left out. A line crossing midnight from a settled into an unsettled day (or
 * back) keeps one line per unsettled day: the part of its span on that local day, with
 * that day's credited minutes, dated on that day.
 *
 * Absence ranges are logical dates; the settled dates are cut out of them.
 */
export function leaveOutSettledDays(input: {
	workPeriods: readonly WorkPeriodData[];
	absences: readonly AbsenceData[];
	settledDays: readonly { employeeId: string; date: string }[];
	/** Each employee's timezone, as the payroll period module reads it. */
	timezones: ReadonlyMap<string, string>;
}): { workPeriods: WorkPeriodData[]; absences: AbsenceData[] } {
	const settled = new Set(input.settledDays.map((day) => dayKey(day.employeeId, day.date)));
	if (settled.size === 0)
		return { workPeriods: [...input.workPeriods], absences: [...input.absences] };
	const isSettled = (employeeId: string, date: string) => settled.has(dayKey(employeeId, date));

	return {
		workPeriods: input.workPeriods.flatMap((period) =>
			workWithoutSettledDays(period, input.timezones.get(period.employeeId) ?? "UTC", isSettled),
		),
		absences: input.absences.flatMap((absence) => absenceWithoutSettledDays(absence, isSettled)),
	};
}

function workWithoutSettledDays(
	period: WorkPeriodData,
	timezone: string,
	isSettled: (employeeId: string, date: string) => boolean,
): WorkPeriodData[] {
	// A line without an end or minutes carries no hours; the formatters skip it.
	if (!period.endTime || !period.durationMinutes) return [period];
	const startAt = Temporal.Instant.fromEpochMilliseconds(period.startTime.toMillis());
	const endExclusive = Temporal.Instant.fromEpochMilliseconds(period.endTime.toMillis());
	const days = [
		...splitCreditByLocalDay({ startAt, endExclusive, minutes: period.durationMinutes }, timezone),
	];
	if (!days.some(([date]) => isSettled(period.employeeId, date))) return [period];

	return days
		.filter(([date]) => !isSettled(period.employeeId, date))
		.map(([date, minutes]) => {
			const day = localDayRange(date, timezone);
			const start = Temporal.Instant.compare(startAt, day.start) > 0 ? startAt : day.start;
			const end =
				Temporal.Instant.compare(endExclusive, day.endExclusive) < 0
					? endExclusive
					: day.endExclusive;
			return {
				...period,
				// In the employee's zone, so a formatter dating lines by their start reads the local day.
				startTime: DateTime.fromMillis(start.epochMilliseconds, { zone: timezone }),
				endTime: DateTime.fromMillis(end.epochMilliseconds, { zone: timezone }),
				durationMinutes: minutes,
			};
		});
}

function absenceWithoutSettledDays(
	absence: AbsenceData,
	isSettled: (employeeId: string, date: string) => boolean,
): AbsenceData[] {
	if (!absence.startDate || absence.endDate < absence.startDate) return [absence];
	const ranges: AbsenceData[] = [];
	let open: { startDate: string; endDate: string } | null = null;
	let touched = false;
	for (
		let date = parsePlainDate(absence.startDate);
		date.toString() <= absence.endDate;
		date = date.add({ days: 1 })
	) {
		const key = date.toString();
		if (isSettled(absence.employeeId, key)) {
			touched = true;
			if (open) ranges.push({ ...absence, ...open });
			open = null;
		} else if (open) {
			open.endDate = key;
		} else {
			open = { startDate: key, endDate: key };
		}
	}
	if (!touched) return [absence];
	if (open) ranges.push({ ...absence, ...open });
	return ranges;
}

function dayKey(employeeId: string, date: string): string {
	return `${employeeId}:${date}`;
}
