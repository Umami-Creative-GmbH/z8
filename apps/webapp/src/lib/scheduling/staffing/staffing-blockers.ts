import { localDayRange, resolveScheduledWallClock } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	comparePlainDates,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import {
	type EmploymentInterval,
	isDateKeyEmployed,
} from "@/lib/employee-lifecycle/employment-coverage";
import type { ShiftInterval } from "@/lib/scheduling/shift-occasion";

/** A fact that rules an employee out of an open shift entirely. */
export type StaffingBlocker = "notEmployed" | "approvedAbsence" | "overlappingShift";

export type AbsenceDayPeriod = "full_day" | "am" | "pm";

/** An absence's calendar days as stored: `am` ends a day at noon, `pm` starts one at noon. */
export interface AbsenceRange {
	/** `YYYY-MM-DD` */
	startDate: string;
	startPeriod: AbsenceDayPeriod;
	/** `YYYY-MM-DD` */
	endDate: string;
	endPeriod: AbsenceDayPeriod;
}

const NOON = "12:00";

/** Half-open intervals that share at least one instant. Touching ends do not overlap. */
export function intervalsOverlap(left: ShiftInterval, right: ShiftInterval): boolean {
	return compareInstants(left.start, right.end) < 0 && compareInstants(right.start, left.end) < 0;
}

/** Which part of `day` the absence takes, mirroring how absences reduce daily targets. */
function absencePartOn(absence: AbsenceRange, day: string): AbsenceDayPeriod {
	if (absence.startDate === absence.endDate) {
		if (absence.startPeriod === "full_day" || absence.endPeriod === "full_day") return "full_day";
		return absence.startPeriod === absence.endPeriod ? absence.startPeriod : "full_day";
	}
	if (day === absence.startDate) return absence.startPeriod === "pm" ? "pm" : "full_day";
	if (day === absence.endDate) return absence.endPeriod === "am" ? "am" : "full_day";
	return "full_day";
}

/** The absence's part of `day` as instants: `am` before 12:00 and `pm` from 12:00, local time. */
function absenceIntervalOn(absence: AbsenceRange, day: PlainDate, timezone: string): ShiftInterval {
	const dayKey = day.toString();
	const { start, endExclusive } = localDayRange(dayKey, timezone);
	const part = absencePartOn(absence, dayKey);
	if (part === "full_day") return { start, end: endExclusive };

	const noon = resolveScheduledWallClock({ date: dayKey, time: NOON, timezone }).toInstant();
	return part === "am" ? { start, end: noon } : { start: noon, end: endExclusive };
}

/** Whether the absence takes any of the shift's time, judged in the organization's zone. */
export function absenceOverlapsShift(
	absence: AbsenceRange,
	shift: ShiftInterval,
	timezone: string,
): boolean {
	const absenceStart = parsePlainDate(absence.startDate);
	const absenceEnd = parsePlainDate(absence.endDate);
	const lastShiftDay = plainDateAt(shift.end.subtract({ nanoseconds: 1 }), timezone);

	for (
		let day = plainDateAt(shift.start, timezone);
		comparePlainDates(day, lastShiftDay) <= 0;
		day = day.add({ days: 1 })
	) {
		if (comparePlainDates(day, absenceStart) < 0 || comparePlainDates(day, absenceEnd) > 0) {
			continue;
		}
		if (intervalsOverlap(absenceIntervalOn(absence, day, timezone), shift)) {
			return true;
		}
	}
	return false;
}

/**
 * The first staffing blocker that rules the employee out of the shift, or null. Employment
 * coverage is lifecycle evidence; without it (null) the employee counts as employed.
 */
export function findStaffingBlocker(input: {
	isActive: boolean;
	employmentCoverage: readonly EmploymentInterval[] | null;
	shiftDate: PlainDate;
	timezone: string;
	shift: ShiftInterval;
	approvedAbsences: readonly AbsenceRange[];
	otherShifts: readonly ShiftInterval[];
}): StaffingBlocker | null {
	if (
		!input.isActive ||
		(input.employmentCoverage &&
			!isDateKeyEmployed(input.employmentCoverage, input.shiftDate.toString(), input.timezone))
	) {
		return "notEmployed";
	}
	if (
		input.approvedAbsences.some((absence) =>
			absenceOverlapsShift(absence, input.shift, input.timezone),
		)
	) {
		return "approvedAbsence";
	}
	if (input.otherShifts.some((other) => intervalsOverlap(other, input.shift))) {
		return "overlappingShift";
	}
	return null;
}
