import "server-only";

import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import {
	type AbsenceDayRange,
	countAbsenceDays,
	holidayDateKeys,
	type IsWorkingDay,
	mondayToFriday,
} from "./absence-days";
import { getVacationHolidays } from "./vacation-holidays";
import type { WeekdayName, WorkingWeekPeriod } from "./working-days";

/** The caller's client: the global `db`, its `DatabaseService`'s, or a transaction. */
export type AbsenceDaysDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WorkingDaysRange {
	/** First calendar day, `YYYY-MM-DD`. */
	startDate: string;
	/** Last calendar day (inclusive), `YYYY-MM-DD`. */
	endDate: string;
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

const MONDAY_TO_FRIDAY_DAYS = 5;

function enumerateDateRange(startDate: string, endDate: string): Temporal.PlainDate[] {
	const start = Temporal.PlainDate.from(startDate);
	const end = Temporal.PlainDate.from(endDate);
	if (Temporal.PlainDate.compare(start, end) > 0) return [];
	const dates: Temporal.PlainDate[] = [];
	for (
		let cursor = start;
		Temporal.PlainDate.compare(cursor, end) <= 0;
		cursor = cursor.add({ days: 1 })
	) {
		dates.push(cursor);
	}
	return dates;
}

/**
 * The scheduled ISO weekdays (1=Mon..7=Sun) of a single day's unified contract, whether or not
 * the employee is employed that day, or `null` when no schedule applies (Mon-Fri).
 * Honors multi-week `cycleWeek` and all simple cycles resolved by `resolveEffectiveContractPure`
 * (A1-13), versioned `scheduleEnabled` flags, and custom working days.
 */
function scheduledWeekdaysForContract(
	contract: EffectiveContractOnDay | undefined,
): ReadonlySet<number> | null {
	if (!contract) return null;
	if (contract.scheduleSource !== "policy") return null;

	if (contract.scheduleMode === "custom_days" || contract.scheduleMode === "hours_only") {
		const days = contract.weeklyScheduleDays.flatMap((d) =>
			d.isWorkDay ? [ISO_WEEKDAY[d.dayOfWeek]] : [],
		);
		return new Set(days);
	}

	const activeSchedule =
		contract.workPolicy?.scheduleEnabled && contract.workPolicy.schedule
			? contract.workPolicy.schedule
			: null;
	if (!activeSchedule) return null;

	// Consume the canonical per-day schedule already resolved for this exact day & cycleWeek.
	const days = contract.weeklyScheduleDays.flatMap((d) =>
		d.isWorkDay ? [ISO_WEEKDAY[d.dayOfWeek]] : [],
	);
	return new Set(days);
}

/**
 * The weekdays an absence can take on a single day: none outside employment (A1-26), else the
 * contract's schedule, or `null` (Mon-Fri).
 */
function absenceWeekdaysForContract(
	contract: EffectiveContractOnDay | undefined,
): ReadonlySet<number> | null {
	if (contract && !contract.isEmployedOnDay) return new Set();
	return scheduledWeekdaysForContract(contract);
}

/**
 * The working days of each employee in the organization over a range (Absences ADR 0001).
 * Resolved strictly through the unified read-only contract resolver so versioned policy
 * `schedule_enabled` toggles, org/team defaults, and custom working days stay aligned
 * with Preview, Work Balance, Payroll, and Presence. An employee outside the organization
 * gets no entry.
 */
export async function loadWorkingDaysForEmployees(
	database: AbsenceDaysDatabase,
	input: WorkingDaysRange & { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, IsWorkingDay>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	const dates = enumerateDateRange(input.startDate, input.endDate);
	if (dates.length === 0) return new Map();

	const contractsByEmployee = await loadEffectiveContractsBatch(database, {
		organizationId: input.organizationId,
		employeeIds,
		dates,
	});

	// One after another: `database` may be one connection, and pg@9 refuses a query while another is executing.
	const workingDays = new Map<string, IsWorkingDay>();
	for (const [employeeId, contractsByDate] of contractsByEmployee) {
		const holidays = holidayDateKeys(
			await getVacationHolidays({
				database,
				organizationId: input.organizationId,
				employeeId,
				startDate: input.startDate,
				endDate: input.endDate,
			}),
		);
		const isWorkingDay: IsWorkingDay = (day) => {
			const dayStr = day.toString();
			if (holidays.has(dayStr)) return false;
			const weekdays = absenceWeekdaysForContract(contractsByDate.get(dayStr));
			return weekdays ? weekdays.has(day.dayOfWeek) : mondayToFriday(day);
		};
		workingDays.set(employeeId, isWorkingDay);
	}
	return workingDays;
}

/**
 * The working days per week of each employee in the organization over a range (Absences ADR
 * 0003), from the unified contract in effect on each day, without holidays.
 * An employee outside the organization gets no entry.
 *
 * A day outside employment keeps its schedule rather than counting as a work schedule without
 * working days, which would leave the vacation allowance unknown (#2011). Employment prorates
 * the allowance instead.
 */
export async function loadWorkingWeekPeriodsForEmployees(
	database: AbsenceDaysDatabase,
	input: WorkingDaysRange & { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, WorkingWeekPeriod[]>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	const dates = enumerateDateRange(input.startDate, input.endDate);
	if (dates.length === 0) return new Map();

	const contractsByEmployee = await loadEffectiveContractsBatch(database, {
		organizationId: input.organizationId,
		employeeIds,
		dates,
	});

	const result = new Map<string, WorkingWeekPeriod[]>();
	for (const [employeeId, contractsByDate] of contractsByEmployee) {
		const periods: WorkingWeekPeriod[] = [];
		for (const day of dates) {
			const dayStr = day.toString();
			const contract = contractsByDate.get(dayStr);
			const weekdays = scheduledWeekdaysForContract(contract);
			const workingDaysPerWeek = weekdays ? weekdays.size : MONDAY_TO_FRIDAY_DAYS;
			const workPolicyId = contract?.workPolicy?.policyId ?? null;
			const last = periods.at(-1);
			if (
				last &&
				last.workingDaysPerWeek === workingDaysPerWeek &&
				last.workPolicyId === workPolicyId
			) {
				last.endDate = dayStr;
			} else {
				periods.push({
					startDate: dayStr,
					endDate: dayStr,
					workingDaysPerWeek,
					workPolicyId,
				});
			}
		}
		result.set(employeeId, periods);
	}
	return result;
}

/** One employee's working days over a range; Monday to Friday when they aren't in the organization. */
export async function loadWorkingDays(
	database: AbsenceDaysDatabase,
	input: WorkingDaysRange & { organizationId: string; employeeId: string },
): Promise<IsWorkingDay> {
	const workingDays = await loadWorkingDaysForEmployees(database, {
		...input,
		employeeIds: [input.employeeId],
	});
	return workingDays.get(input.employeeId) ?? mondayToFriday;
}

/** The absence days of one employee's absence: the one server-side source (Absences ADR 0001). */
export async function getAbsenceDays(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; absence: AbsenceDayRange },
): Promise<number> {
	const isWorkingDay = await loadWorkingDays(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startDate: input.absence.startDate,
		endDate: input.absence.endDate,
	});
	return countAbsenceDays(input.absence, isWorkingDay);
}

/**
 * The absence days of many absences, possibly of many employees, by absence id. The working
 * days load once per employee, over the range all the absences span.
 */
export async function getAbsenceDaysByAbsenceId(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		absences: ReadonlyArray<AbsenceDayRange & { id: string; employeeId: string }>;
	},
): Promise<Map<string, number>> {
	const [first, ...rest] = input.absences;
	if (!first) return new Map();

	let { startDate, endDate } = first;
	for (const absence of rest) {
		if (absence.startDate < startDate) startDate = absence.startDate;
		if (absence.endDate > endDate) endDate = absence.endDate;
	}
	const workingDays = await loadWorkingDaysForEmployees(database, {
		organizationId: input.organizationId,
		employeeIds: input.absences.map((absence) => absence.employeeId),
		startDate,
		endDate,
	});

	return new Map(
		input.absences.map((absence) => [
			absence.id,
			countAbsenceDays(absence, workingDays.get(absence.employeeId) ?? mondayToFriday),
		]),
	);
}
