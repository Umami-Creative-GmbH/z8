/**
 * Database reads shared by the JArbSchG monitors (#1993): Scheduling / Staffing contributors and
 * the clock-out compliance check. Every read is scoped to one organization and batched over the
 * employees judged.
 */
import { and, eq, gte, inArray, isNull, lt, ne, notInArray } from "drizzle-orm";
import { employee, employeeEmploymentPeriod, shift, workPeriod } from "@/db/schema";
import {
	getAssignedHolidayDateKeys,
	getAssignedHolidaysForEmployees,
} from "@/lib/calendar/assigned-holidays";
import {
	type EmploymentPeriodSnapshot,
	employmentPeriodSnapshotOf,
	engagementKindOnDay,
} from "@/lib/contracts/resolve-contract";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { birthdayCalendarDate } from "@/lib/organization/employee-birthday";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
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
				inArray(employee.id, [...new Set(input.employeeIds)]),
			),
		);
	return new Map(
		rows.map((row) => [row.id, row.birthday ? birthdayCalendarDate(row.birthday) : null]),
	);
}

/**
 * The local days of `[from, until)` each employee spends as an External Contractor, as the contract
 * resolver decides them (`engagementKindOnDay`, #1996). A contractor is no employee: youth limits
 * judge no contractor day, and contractor work records no violation. Employees with no contractor
 * day are left out.
 */
export async function loadContractorDays(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly timezone: string;
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, Set<string>>> {
	const result = new Map<string, Set<string>>();
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return result;
	const [kinds, periodRows] = await Promise.all([
		db
			.select({ id: employee.id, engagementKind: employee.engagementKind })
			.from(employee)
			.where(
				and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
			),
		db
			.select({
				id: employeeEmploymentPeriod.id,
				employeeId: employeeEmploymentPeriod.employeeId,
				status: employeeEmploymentPeriod.status,
				startedAt: employeeEmploymentPeriod.startedAt,
				startProvenance: employeeEmploymentPeriod.startProvenance,
				endedAt: employeeEmploymentPeriod.endedAt,
				createdAt: employeeEmploymentPeriod.createdAt,
				engagementKind: employeeEmploymentPeriod.engagementKind,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					inArray(employeeEmploymentPeriod.employeeId, employeeIds),
				),
			),
	]);
	const periodsOf = new Map<string, EmploymentPeriodSnapshot[]>();
	for (const row of periodRows) {
		const own = periodsOf.get(row.employeeId);
		if (own) own.push(employmentPeriodSnapshotOf(row));
		else periodsOf.set(row.employeeId, [employmentPeriodSnapshotOf(row)]);
	}
	const until = parsePlainDate(input.until);
	for (const { id, engagementKind } of kinds) {
		const periods = periodsOf.get(id) ?? [];
		const everContractor =
			periods.length === 0
				? engagementKind === "contractor"
				: periods.some((period) => period.engagementKind === "contractor");
		if (!everContractor) continue;
		const days = new Set<string>();
		for (
			let day = parsePlainDate(input.from);
			day.until(until).sign > 0;
			day = day.add({ days: 1 })
		) {
			const kind = engagementKindOnDay({
				periods,
				day,
				employeeCalendarTimezone: input.timezone,
				employeeEngagementKind: engagementKind,
			});
			if (kind === "contractor") days.add(day.toString());
		}
		if (days.size > 0) result.set(id, days);
	}
	return result;
}

/**
 * Public holiday date keys per employee over `[from, until)`. The holiday reader needs the
 * relational query API; it only reads.
 */
export async function loadHolidayDateKeys(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, Set<string>>> {
	if (input.employeeIds.length === 0) return new Map();
	const holidays = await getAssignedHolidaysForEmployees({
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		startDate: new Date(`${input.from}T00:00:00.000Z`),
		endDate: new Date(`${parsePlainDate(input.until).subtract({ days: 1 })}T23:59:59.999Z`),
		database: db as DatabaseClient,
	});
	return new Map(
		input.employeeIds.map((employeeId) => [
			employeeId,
			getAssignedHolidayDateKeys(holidays.get(employeeId) ?? []),
		]),
	);
}

/** Assigned shifts (draft and published) of the employees on organization-local days `[from, until)`. */
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
	const rows = await db
		.select({
			id: shift.id,
			employeeId: shift.employeeId,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
		})
		.from(shift)
		.where(and(...conditions));
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
 * work and open clock-ins (`end` null).
 */
export async function loadYouthWork(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly timezone: string;
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, YouthWorkRecord[]>> {
	const result = new Map<string, YouthWorkRecord[]>();
	if (input.employeeIds.length === 0) return result;
	const rows = await db
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
	for (const row of rows) {
		const end = row.isActive ? null : row.endTime;
		if (!row.isActive && !end) continue;
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
