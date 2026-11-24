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
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { clipRecordToEmployeeTime } from "@/lib/engagement/payroll-scope";
import type { EmployeeTime } from "@/lib/engagement/engagement-stints";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";

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
		const interval = shiftInterval(
			{ date, startTime: row.startTime, endTime: row.endTime },
			timezone,
		);
		const parts = time.within(row.employeeId, {
			start: interval.start,
			endExclusive: interval.end,
		});
		const first = parts[0];
		const last = parts.at(-1);
		if (!first || !last) return [];
		const start = ceilToMinute(first.start);
		const end = floorToMinute(last.endExclusive);
		if (compareInstants(start, interval.start) <= 0 && compareInstants(end, interval.end) >= 0) {
			return [row];
		}
		if (compareInstants(start, end) >= 0) return [];
		if (!plainDateAt(start, timezone).equals(date)) return [row];
		return [{ ...row, startTime: wallTime(start, timezone), endTime: wallTime(end, timezone) }];
	});
}

/**
 * Whether any of the organization-local day `date` (`YYYY-MM-DD` in `timezone`) is the
 * employee's employee time: whether a day-based statutory record of it (a school or exam
 * release, a judged youth day) applies. A conversion day is an employee day for its employee
 * part.
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
