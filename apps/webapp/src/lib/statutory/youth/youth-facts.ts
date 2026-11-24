/**
 * Database reads shared by the JArbSchG monitors (#1993): Scheduling / Staffing contributors and
 * the clock-out compliance check. Every read is scoped to one organization and batched over the
 * employees judged.
 */
import { and, eq, gte, inArray, isNull, lt, ne, notInArray } from "drizzle-orm";
import { employee, shift, workPeriod } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	type EmployeeTime,
	employeeTime,
	loadEmployeeTime,
} from "@/lib/engagement/engagement-stints";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import { birthdayCalendarDate } from "@/lib/organization/employee-birthday";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { employeeShiftRows, employeeWorkRows, hasEmployeeTimeOnDay } from "../employee-time";
import { loadStatutoryThresholds } from "../thresholds";
import type { StatutoryThresholdKey } from "../threshold-catalog";
import type { JarbschgLimits } from "./jarbschg-rules";
import type { YouthShiftRecord, YouthWorkRecord } from "./youth-intervals";

type Reader = Pick<DatabaseClient, "select">;

const LIMIT_KEYS = {
	maxDailyMinutes: "de_jarbschg_max_daily_minutes",
	maxDailyCompensatoryMinutes: "de_jarbschg_max_daily_compensatory_minutes",
	maxWeeklyMinutes: "de_jarbschg_max_weekly_minutes",
	maxDaysPerWeek: "de_jarbschg_max_days_per_week",
	minRestMinutes: "de_jarbschg_min_rest_minutes",
	breakAfter270Minutes: "de_jarbschg_break_after_270_minutes",
	breakAfter360Minutes: "de_jarbschg_break_after_360_minutes",
	minBreakSegmentMinutes: "de_jarbschg_min_break_segment_minutes",
	maxUninterruptedMinutes: "de_jarbschg_max_uninterrupted_minutes",
	nightStartMinuteOfDay: "de_jarbschg_night_start",
	nightEndMinuteOfDay: "de_jarbschg_night_end",
} as const satisfies Record<keyof JarbschgLimits, StatutoryThresholdKey>;

/** The JArbSchG baselines in force on each day of `[from, until)`; null where any is missing. */
export async function loadJarbschgLimits(
	db: Reader,
	range: { readonly from: string; readonly until: string },
): Promise<(day: PlainDate) => JarbschgLimits | null> {
	const table = await loadStatutoryThresholds(db, {
		keys: Object.values(LIMIT_KEYS),
		from: range.from,
		until: range.until,
	});
	return (day) => {
		const date = day.toString();
		const limits: Partial<Record<keyof JarbschgLimits, number>> = {};
		for (const [field, key] of Object.entries(LIMIT_KEYS) as [
			keyof JarbschgLimits,
			StatutoryThresholdKey,
		][]) {
			const value = table.valueOn(key, date);
			if (value === null) return null;
			limits[field] = value;
		}
		return limits as JarbschgLimits;
	};
}

/**
 * `employeeIds` once each, in one order: callers passing the same employees in different orders
 * then run the same statement, which a request-scoped `memoizedReader` reads once.
 */
const canonicalIds = (employeeIds: readonly string[]) => [...new Set(employeeIds)].sort();

/** Recorded birthdays (calendar dates) of the organization's employees; null when unknown. */
export async function loadEmployeeBirthdays(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeIds: readonly string[] },
): Promise<Map<string, PlainDate | null>> {
	if (input.employeeIds.length === 0) return new Map();
	const rows = await db
		.select({ id: employee.id, birthday: employee.birthday })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, canonicalIds(input.employeeIds)),
			),
		);
	return new Map(
		rows.map((row) => [row.id, row.birthday ? birthdayCalendarDate(row.birthday) : null]),
	);
}

/** The organization's employees' engagement kind (`employee.engagement_kind`). */
export async function loadEmployeeEngagementKinds(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeIds: readonly string[] },
): Promise<Map<string, EngagementKind>> {
	if (input.employeeIds.length === 0) return new Map();
	const rows = await db
		.select({ id: employee.id, engagementKind: employee.engagementKind })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, canonicalIds(input.employeeIds)),
			),
		);
	return new Map(rows.map((row) => [row.id, row.engagementKind]));
}

/**
 * The time youth limits judge: the employees' employee time only (#2010), or, when the
 * organization applies JArbSchG to minor contractors (#2022), all of it, contractor stints
 * included, so their contractor days are judged exactly like employee days.
 */
export async function loadYouthJudgedTime(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly timezone: string;
		readonly applyJarbschgToMinorContractors: boolean;
	},
): Promise<EmployeeTime> {
	if (input.applyJarbschgToMinorContractors) {
		return employeeTime(new Map(), new Map(), input.timezone);
	}
	return loadEmployeeTime(db, input.organizationId, input.employeeIds);
}

/**
 * The local days of `[from, until)` in `timezone` with none of the employee's employee time: days
 * spent wholly as an External Contractor (#1996, #2010), or outside any employment. A contractor is
 * no employee: youth limits judge none of these days. A conversion day is judged for its employee part; the work and shifts
 * of its contractor part are left out by `loadYouthWork` and `loadYouthShifts`.
 */
export function daysWithoutEmployeeTime(
	employeeTime: EmployeeTime,
	employeeId: string,
	range: { readonly timezone: string; readonly from: string; readonly until: string },
): Set<string> {
	const days = new Set<string>();
	const until = parsePlainDate(range.until);
	for (
		let day = parsePlainDate(range.from);
		day.until(until).sign > 0;
		day = day.add({ days: 1 })
	) {
		const date = day.toString();
		if (!hasEmployeeTimeOnDay(employeeTime, employeeId, date, range.timezone)) days.add(date);
	}
	return days;
}

/**
 * Assigned shifts (draft and published) of the employees on organization-local days
 * `[from, until)`, in their employee time only (`employeeShiftRows`).
 */
export async function loadYouthShifts(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly organizationTimezone: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
		readonly excludeShiftId?: string | null;
		readonly excludeShiftIds?: readonly string[];
		readonly employeeTime: EmployeeTime;
	},
): Promise<YouthShiftRecord[]> {
	if (input.employeeIds.length === 0) return [];
	const bounds = shiftDateRangeBounds(input.from, input.until, input.organizationTimezone);
	const conditions = [
		eq(shift.organizationId, input.organizationId),
		inArray(shift.employeeId, [...new Set(input.employeeIds)]),
		gte(shift.date, bounds.start),
		lt(shift.date, bounds.endExclusive),
	];
	if (input.excludeShiftId) conditions.push(ne(shift.id, input.excludeShiftId));
	if (input.excludeShiftIds?.length) {
		conditions.push(notInArray(shift.id, [...input.excludeShiftIds]));
	}
	const rows = employeeShiftRows(
		input.employeeTime,
		await db
			.select({
				id: shift.id,
				employeeId: shift.employeeId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.where(and(...conditions)),
		input.organizationTimezone,
	);
	return rows.flatMap((row) => {
		if (!row.employeeId) return [];
		const date = shiftCalendarDate(row.date, input.organizationTimezone);
		const { start, end } = shiftInterval(
			{ date, startTime: row.startTime, endTime: row.endTime },
			input.organizationTimezone,
		);
		return [{ id: row.id, employeeId: row.employeeId, date, start, end }];
	});
}

/**
 * Not deleted work of the employees starting within `[from, until)` local to `timezone`: completed
 * work and open clock-ins (`end` null), in their employee time only (`employeeWorkRows`).
 */
export async function loadYouthWork(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly timezone: string;
		readonly from: string;
		readonly until: string;
		readonly employeeTime: EmployeeTime;
	},
): Promise<Map<string, YouthWorkRecord[]>> {
	const result = new Map<string, YouthWorkRecord[]>();
	if (input.employeeIds.length === 0) return result;
	const stored = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isActive: workPeriod.isActive,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, [...new Set(input.employeeIds)]),
				isNull(workPeriod.deletedAt),
				gte(workPeriod.startTime, dateFromInstant(localDayRange(input.from, input.timezone).start)),
				lt(workPeriod.startTime, dateFromInstant(localDayRange(input.until, input.timezone).start)),
			),
		);
	const rows = employeeWorkRows(
		input.employeeTime,
		stored.flatMap((row) => {
			if (row.isActive) return [{ ...row, endTime: null }];
			return row.endTime ? [row] : [];
		}),
	);
	for (const row of rows) {
		const end = row.endTime;
		const records = result.get(row.employeeId) ?? [];
		records.push({
			id: row.id,
			employeeId: row.employeeId,
			start: instantFromDate(row.startTime),
			end: end ? instantFromDate(end) : null,
			durationMinutes: row.durationMinutes,
		});
		result.set(row.employeeId, records);
	}
	return result;
}
