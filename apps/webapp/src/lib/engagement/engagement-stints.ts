import { and, eq, inArray } from "drizzle-orm";
import { employee, employeeEmploymentPeriod, userSettings } from "@/db/schema";
import {
	type EmploymentPeriodSnapshot,
	engagementKindOnDay,
} from "@/lib/contracts/resolve-contract";
import { type InstantRange, localDayRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	type DaysEngagement,
	type EngagementStints,
	employeeTimeWithin,
	hasEmployeeTimeWithin,
	PLAIN_EMPLOYEE_STINTS,
} from "./employee-time";

type Reader = Pick<DatabaseClient, "select">;

/** Every recorded stint of the employees, as the contract resolver reads them (#1996). */
export async function loadEmploymentPeriodSnapshots(
	db: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<EmploymentPeriodSnapshot[]> {
	if (employeeIds.length === 0) return [];
	const rows = await db
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
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...employeeIds]),
			),
		);
	return rows.map((row) => ({
		...row,
		startedAt: row.startedAt ? instantFromDate(row.startedAt) : null,
		endedAt: row.endedAt ? instantFromDate(row.endedAt) : null,
		createdAt: instantFromDate(row.createdAt),
	}));
}

/**
 * Who of a set of employees was an employee when (#1997): the payroll, earnings and statutory
 * domains read only employee time, never an External Contractor's stint.
 */
export interface EmployeeTime {
	/** The employee's stints; an employee outside the organization reads as a plain employee. */
	stintsOf(employeeId: string): EngagementStints;
	/** The parts of `window` that are the employee's employee time (`employeeTimeWithin`). */
	within(employeeId: string, window: InstantRange): InstantRange[];
	/**
	 * Whether any of `startDate`..`endDate` (inclusive, employee-local days in the employee's
	 * effective zone) is employee time: whether the employee belongs in an employee read of them.
	 */
	hasEmployeeTimeOn(employeeId: string, startDate: string, endDate: string): boolean;
	/**
	 * Whether an employee-local calendar day is an employee day, decided per day like the contract
	 * resolver (`engagementKindOnDay`), for day-based records: absences, payouts, settled days.
	 */
	isEmployeeDay(employeeId: string, date: string): boolean;
	/**
	 * The employee days of a day-based record (an absence): its first to its last employee day,
	 * or null when every day of it falls in an External Contractor stint. Recording refuses
	 * absences across an engagement change (#1996), so this only trims rows written before.
	 */
	employeeDaysOf(
		employeeId: string,
		dates: { startDate: string; endDate: string },
	): { startDate: string; endDate: string } | null;
	/** The employees, of `employeeIds`, with employee time on any of the days. */
	withEmployeeTimeOn(employeeIds: readonly string[], startDate: string, endDate: string): string[];
	/**
	 * Whose time all of `startDate`..`endDate` (inclusive, employee-local days) is, for a record
	 * that is paid whole or not at all (a travel expense report): `employee` when every moment of
	 * the days is employee time, `contractor` when none is, `both` when the days meet an
	 * engagement change (a conversion day counts as both).
	 */
	engagementOfDays(employeeId: string, startDate: string, endDate: string): DaysEngagement;
}

/** `EmployeeTime` over loaded stints and each employee's effective calendar zone. */
export function employeeTime(
	stints: ReadonlyMap<string, EngagementStints>,
	timezones: ReadonlyMap<string, string>,
	fallbackTimezone: string,
): EmployeeTime {
	const stintsOf = (employeeId: string) => stints.get(employeeId) ?? PLAIN_EMPLOYEE_STINTS;
	const timezoneOf = (employeeId: string) => timezones.get(employeeId) ?? fallbackTimezone;
	const hasEmployeeTimeOn = (employeeId: string, startDate: string, endDate: string) => {
		const own = stintsOf(employeeId);
		if (own.periods.length === 0) return own.employeeEngagementKind === "employee";
		const timezone = timezoneOf(employeeId);
		return hasEmployeeTimeWithin(own, {
			start: localDayRange(startDate, timezone).start,
			endExclusive: localDayRange(endDate, timezone).endExclusive,
		});
	};
	const isEmployeeDay = (employeeId: string, date: string) => {
		const own = stintsOf(employeeId);
		if (own.periods.length === 0) return own.employeeEngagementKind === "employee";
		return (
			engagementKindOnDay({
				periods: own.periods,
				day: parsePlainDate(date),
				employeeCalendarTimezone: timezoneOf(employeeId),
				employeeEngagementKind: own.employeeEngagementKind,
			}) === "employee"
		);
	};
	return {
		stintsOf,
		within: (employeeId, window) => employeeTimeWithin(stintsOf(employeeId), window),
		hasEmployeeTimeOn,
		isEmployeeDay,
		employeeDaysOf: (employeeId, dates) => {
			let first: string | null = null;
			let last: string | null = null;
			const end = parsePlainDate(dates.endDate);
			for (
				let day = parsePlainDate(dates.startDate);
				day.until(end).days >= 0;
				day = day.add({ days: 1 })
			) {
				if (!isEmployeeDay(employeeId, day.toString())) continue;
				first ??= day.toString();
				last = day.toString();
			}
			return first && last ? { startDate: first, endDate: last } : null;
		},
		withEmployeeTimeOn: (employeeIds, startDate, endDate) =>
			employeeIds.filter((employeeId) => hasEmployeeTimeOn(employeeId, startDate, endDate)),
		engagementOfDays: (employeeId, startDate, endDate) => {
			const own = stintsOf(employeeId);
			if (own.periods.length === 0) return own.employeeEngagementKind;
			const timezone = timezoneOf(employeeId);
			const window: InstantRange = {
				start: localDayRange(startDate, timezone).start,
				endExclusive: localDayRange(endDate, timezone).endExclusive,
			};
			const parts = employeeTimeWithin(own, window);
			const [only] = parts;
			if (!only) return "contractor";
			return parts.length === 1 &&
				compareInstants(only.start, window.start) === 0 &&
				compareInstants(only.endExclusive, window.endExclusive) === 0
				? "employee"
				: "both";
		},
	};
}

/**
 * `EmployeeTime` for employees of the organization (#1997), with their stints and effective
 * calendar zones (own setting, else the organization's). Employees outside the organization read
 * as plain employees and match no record of it anyway. One query after another: `db` may be a
 * transaction on one connection.
 */
export async function loadEmployeeTime(
	db: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<EmployeeTime> {
	// Once each, in one order: callers passing the same employees in any order run the same
	// statements, which a request-scoped `memoizedReader` reads once.
	const ids = [...new Set(employeeIds)].sort();
	const organizationTimezone = await loadOrganizationTimezone(db, organizationId);
	const stints = new Map<string, EngagementStints>();
	const timezones = new Map<string, string>();
	if (ids.length > 0) {
		const people = await db
			.select({
				id: employee.id,
				engagementKind: employee.engagementKind,
				timezone: userSettings.timezone,
			})
			.from(employee)
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, ids)));
		const periods = Map.groupBy(
			await loadEmploymentPeriodSnapshots(db, organizationId, ids),
			(period) => period.employeeId,
		);
		for (const person of people) {
			stints.set(person.id, {
				periods: periods.get(person.id) ?? [],
				employeeEngagementKind: person.engagementKind,
			});
			timezones.set(person.id, resolveEffectiveTimezone(person.timezone, organizationTimezone));
		}
	}
	return employeeTime(stints, timezones, organizationTimezone);
}
