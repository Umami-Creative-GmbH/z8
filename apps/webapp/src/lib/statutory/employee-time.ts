/**
 * Statutory monitors judge employee time only (#2010, spec #1935). An External Contractor stint is
 * no employment under the Minijob, short-term, working-student, § 12 TzBfG, JArbSchG or BBiG
 * rules, so every monitor reads its people's work and shifts through these filters, over the
 * engagement stints of `loadEmployeeTime`. Exact to the instant, as payroll splits a conversion
 * day (`clipRecordToEmployeeTime`): work before a conversion instant is contractor time, work
 * after it employee time. Employees without a contractor stint read exactly as before.
 */
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { clipRecordToEmployeeTime } from "@/lib/engagement/payroll-scope";
import type { EmployeeTime } from "@/lib/engagement/engagement-stints";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import type { StatutoryProposedShift } from "./scheduling/contributor";

/**
 * A stored work period as the monitors read it. Open while `isActive` (or, without `isActive`,
 * while `endTime` is null); a completed period without `endTime` ends `durationMinutes` after its
 * start.
 */
interface WorkRow {
	readonly employeeId: string;
	readonly startTime: Date;
	readonly endTime: Date | null;
	readonly durationMinutes: number | null;
	readonly isActive?: boolean;
}

/**
 * The work rows' employee time: a row wholly in employee time as it is, a row across a
 * conversion instant from its first to its last employee instant (its minutes by the payroll
 * credit rule, its `endTime` set), a row wholly in a contractor stint dropped. An open clock-in
 * belongs to the stint it started in.
 */
export function employeeWorkRows<T extends WorkRow>(time: EmployeeTime, rows: readonly T[]): T[] {
	return rows.flatMap((row) => {
		const startAt = instantFromDate(row.startTime);
		const endAt = endOf(row, startAt);
		const clipped = clipRecordToEmployeeTime(time, row.employeeId, {
			startAt,
			endAt,
			durationMinutes: row.durationMinutes,
		});
		if (!clipped) return [];
		if (clipped.startAt === startAt && clipped.endAt === endAt) return [row];
		return [
			{
				...row,
				startTime: dateFromInstant(clipped.startAt),
				endTime: clipped.endAt ? dateFromInstant(clipped.endAt) : null,
				durationMinutes: clipped.durationMinutes,
			},
		];
	});
}

/** A stored shift as the monitors read it, stored at its organization-local midnight. */
interface ShiftRow {
	readonly employeeId: string | null;
	readonly date: Date;
	readonly startTime: string;
	readonly endTime: string;
}

/**
 * The shift rows' employee time: a shift wholly in employee time as it is, one wholly in a
 * contractor stint dropped, one across a conversion instant shortened to its employee part (its
 * wall times on the minute, in `timezone`, the organization's calendar zone the shift is stored
 * in). Unassigned shifts are kept: they are nobody's time. A shift whose employee part would
 * start after its own date's midnight cannot be written as wall times of that date and is kept
 * whole.
 */
export function employeeShiftRows<T extends ShiftRow>(
	time: EmployeeTime,
	rows: readonly T[],
	timezone: string,
): T[] {
	return rows.flatMap((row) => {
		if (!row.employeeId) return [row];
		const date = shiftCalendarDate(row.date, timezone);
		const times = employeeWallTimes(time, row.employeeId, { ...row, date }, timezone);
		if (times === null) return [];
		return [times === "whole" ? row : { ...row, ...times }];
	});
}

/** Staffing's proposed shifts in employee time only, as `employeeShiftRows` reads stored ones. */
export function employeeProposedShifts(
	time: EmployeeTime,
	proposals: readonly StatutoryProposedShift[],
	timezone: string,
): StatutoryProposedShift[] {
	return proposals.flatMap((proposal) => {
		const date = parsePlainDate(proposal.date);
		const times = employeeWallTimes(time, proposal.employeeId, { ...proposal, date }, timezone);
		if (times === null) return [];
		return [times === "whole" ? proposal : { ...proposal, ...times }];
	});
}

/**
 * The part of a planned interval that is the employee's employee time, from its first to its
 * last employee instant; null when none of it is.
 */
export function employeeIntervalOf(
	time: EmployeeTime,
	employeeId: string,
	interval: { readonly start: Instant; readonly end: Instant },
): { start: Instant; end: Instant } | null {
	const parts = time.within(employeeId, { start: interval.start, endExclusive: interval.end });
	const first = parts[0];
	const last = parts.at(-1);
	return first && last ? { start: first.start, end: last.endExclusive } : null;
}

/** A confirmed terms row as the monitors read it. */
interface TermsRow {
	readonly employeeId: string;
	readonly employmentPeriodId: string | null;
	readonly validFromDate: string;
}

/**
 * The terms rows of employee stints: a row of an External Contractor stint is no employment
 * under any monitor, whatever its profile. A row without a stint (written before stints were
 * recorded) is an employee's when its first day is an employee day.
 */
export function employeeTermRows<T extends TermsRow>(time: EmployeeTime, rows: readonly T[]): T[] {
	return rows.filter((row) => {
		if (row.employmentPeriodId === null) {
			return time.isEmployeeDay(row.employeeId, row.validFromDate);
		}
		const stint = time
			.stintsOf(row.employeeId)
			.periods.find((period) => period.id === row.employmentPeriodId);
		return stint?.engagementKind !== "contractor";
	});
}

/**
 * Whether any of the organization-local day `date` (`YYYY-MM-DD` in `timezone`) is the
 * employee's employee time: whether a day-based statutory record of it (a judged youth day)
 * applies. A conversion day is an employee day for its employee part. Unlike
 * `EmployeeTime.hasEmployeeTimeOn`, the day is the organization's calendar day the monitors
 * judge, not the employee's own.
 */
export function hasEmployeeTimeOnDay(
	time: EmployeeTime,
	employeeId: string,
	date: string,
	timezone: string,
): boolean {
	const day = localDayRange(date, timezone);
	return time.within(employeeId, day).length > 0;
}

/**
 * The wall times of a planned shift's employee part: `whole` when all of it is employee time,
 * null when none of it is, else its employee part on the minute (kept whole when that part would
 * start after the shift date's midnight: it cannot be written as wall times of that date).
 */
function employeeWallTimes(
	time: EmployeeTime,
	employeeId: string,
	shift: { readonly date: PlainDate; readonly startTime: string; readonly endTime: string },
	timezone: string,
): { startTime: string; endTime: string } | "whole" | null {
	const interval = shiftInterval(shift, timezone);
	const employeePart = employeeIntervalOf(time, employeeId, interval);
	if (!employeePart) return null;
	const start = ceilToMinute(employeePart.start);
	const end = floorToMinute(employeePart.end);
	if (compareInstants(start, interval.start) <= 0 && compareInstants(end, interval.end) >= 0) {
		return "whole";
	}
	if (compareInstants(start, end) >= 0) return null;
	if (!plainDateAt(start, timezone).equals(shift.date)) return "whole";
	return { startTime: wallTime(start, timezone), endTime: wallTime(end, timezone) };
}

function endOf(row: WorkRow, startAt: Instant): Instant | null {
	if (row.isActive) return null;
	if (row.endTime) return instantFromDate(row.endTime);
	if (row.isActive === false && row.durationMinutes !== null) {
		return startAt.add({ minutes: row.durationMinutes });
	}
	return null;
}

function floorToMinute(instant: Instant): Instant {
	return instant.round({ smallestUnit: "minute", roundingMode: "floor" });
}

function ceilToMinute(instant: Instant): Instant {
	return instant.round({ smallestUnit: "minute", roundingMode: "ceil" });
}

function wallTime(instant: Instant, timezone: string): string {
	return instant.toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: "minute" });
}
