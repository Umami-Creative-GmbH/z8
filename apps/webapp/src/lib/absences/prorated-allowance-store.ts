import "server-only";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
	employee,
	employeeDeparture,
	employeeEmploymentPeriod,
	employeeVacationAllowance,
} from "@/db/schema";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	type AbsenceDaysDatabase,
	loadWorkingWeekPeriodsForEmployees,
} from "./absence-days-resolver";
import {
	type DepartureRecord,
	type EmploymentPeriodRecord,
	type EmploymentStint,
	employmentStintsFromRecords,
	FIRST_WORKING_WEEK_YEAR,
	type ProratedAllowance,
	type ProrationPolicy,
	resolveVacationAllowance,
} from "./prorated-allowance";
import { workingWeeksWithin } from "./weighted-vacation-policy";
import type { WorkingWeekPeriod } from "./working-days";

/** An employee's `employee_vacation_allowance` overrides for a year. */
export interface EmployeeVacationOverride {
	allowanceId?: string;
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
}

/**
 * Each employee's vacation overrides for a year: the newest `employee_vacation_allowance` row.
 * Only employees of the organization get an entry.
 */
export async function loadEmployeeVacationOverrides(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
	},
): Promise<Map<string, EmployeeVacationOverride>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	// `employee_vacation_allowance` has no organization column: scope through the employee.
	const rows = await database
		.select({
			employeeId: employeeVacationAllowance.employeeId,
			allowanceId: employeeVacationAllowance.id,
			customAnnualDays: employeeVacationAllowance.customAnnualDays,
			customCarryoverDays: employeeVacationAllowance.customCarryoverDays,
		})
		.from(employeeVacationAllowance)
		.innerJoin(employee, eq(employee.id, employeeVacationAllowance.employeeId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employeeVacationAllowance.employeeId, employeeIds),
				eq(employeeVacationAllowance.year, input.year),
			),
		)
		.orderBy(
			desc(employeeVacationAllowance.updatedAt),
			desc(employeeVacationAllowance.id),
		);

	const overrides = new Map<string, EmployeeVacationOverride>();
	for (const { employeeId, ...override } of rows) {
		if (!overrides.has(employeeId)) overrides.set(employeeId, override);
	}
	return overrides;
}

/** An employee's employments (`employmentStintsFromRecords`). */
export interface EmployeeEmployments {
	isActive: boolean;
	/** Only the employee stints: External Contractor periods are no employment for vacation. */
	employments: EmploymentStint[];
}

/**
 * The employments of the organization's employees, from their employment periods and pending or
 * effective departures. Without `employeeIds`, of every employee of the organization, active or
 * not. Read-only: it never backfills employment periods.
 *
 * External Contractor periods accrue no vacation (#1996): they are left out, so a contractor who
 * was never an employee has no employment at all, never one from `employee.startDate`.
 */
export async function loadEmployeeEmployments(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds?: readonly string[];
		employeeEmploymentStartDateOverrides?: ReadonlyMap<string, string>;
	},
): Promise<Map<string, EmployeeEmployments>> {
	const { organizationId } = input;
	const employeeIds = input.employeeIds
		? [...new Set(input.employeeIds)]
		: null;
	if (employeeIds?.length === 0) return new Map();
	const onlyThese = (column: Parameters<typeof inArray>[0]): SQL | undefined =>
		employeeIds ? inArray(column, employeeIds) : undefined;

	// One after another: `database` may be one connection, and pg@9 refuses a query while another is executing.
	const employees = await database
		.select({
			id: employee.id,
			isActive: employee.isActive,
			startDate: employee.startDate,
			endDate: employee.endDate,
			engagementKind: employee.engagementKind,
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				onlyThese(employee.id),
			),
		);
	const periods = await database
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			id: employeeEmploymentPeriod.id,
			startedAt: employeeEmploymentPeriod.startedAt,
			endedAt: employeeEmploymentPeriod.endedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
			engagementKind: employeeEmploymentPeriod.engagementKind,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				onlyThese(employeeEmploymentPeriod.employeeId),
			),
		);
	const departures = await database
		.select({
			employeeId: employeeDeparture.employeeId,
			employmentPeriodId: employeeDeparture.employmentPeriodId,
			status: employeeDeparture.status,
			lastWorkingDay: employeeDeparture.lastWorkingDay,
			cutoffAt: employeeDeparture.cutoffAt,
			timezone: employeeDeparture.timezone,
			createdAt: employeeDeparture.createdAt,
		})
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.organizationId, organizationId),
				onlyThese(employeeDeparture.employeeId),
				inArray(employeeDeparture.status, ["pending", "effective"]),
			),
		);
	const timezone = await loadOrganizationTimezone(database, organizationId);

	const periodsByEmployee = Map.groupBy(periods, (period) => period.employeeId);
	const departuresByEmployee = Map.groupBy(
		departures,
		(departure) => departure.employeeId,
	);
	return new Map(
		employees.map((row) => {
			const allPeriods = periodsByEmployee.get(row.id) ?? [];
			const employeePeriods = allPeriods.filter(
				(period) => period.engagementKind !== "contractor",
			);
			const onlyContractor =
				allPeriods.length > 0
					? employeePeriods.length === 0
					: row.engagementKind === "contractor";
			return [
				row.id,
				{
					isActive: row.isActive,
					employments: onlyContractor ? [] : employmentsOf(row, employeePeriods),
				},
			];
		}),
	);

	function employmentsOf(
		row: (typeof employees)[number],
		employeePeriods: typeof periods,
	): EmploymentStint[] {
		return employmentStintsFromRecords({
			employeeStartDate: input.employeeEmploymentStartDateOverrides?.has(row.id)
				? dateFromInstant(
						parsePlainDate(input.employeeEmploymentStartDateOverrides.get(row.id) ?? "")
							.toZonedDateTime("UTC")
							.toInstant(),
					)
				: row.startDate,
			employeeEndDate: row.endDate,
			periods: projectEmploymentPeriodStart(
				employeePeriods,
				input.employeeEmploymentStartDateOverrides?.get(row.id),
				timezone,
			),
			departures: (departuresByEmployee.get(row.id) ?? []) satisfies DepartureRecord[],
			timezone,
		});
	}
}

/**
 * The vacation allowance of each employee for a year (#1110): their custom allowance, or the
 * policy's allowance prorated in a year they join or leave. Every balance reader takes the
 * allowance from here, so an employee shows the same allowance everywhere.
 *
 * The caller supplies a shared legacy policy or each employee's weighted policy. A shared policy
 * converts to each employee's working week here (Absences ADR 0003); an employee whose work
 * schedule has no working days gets no entry, because their allowance needs review. `overrides`
 * saves the lookup when the caller already loaded them. Only employees of the organization get
 * an entry.
 */
export async function loadProratedVacationAllowances(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
		policy?: ProrationPolicy;
		policies?: ReadonlyMap<string, ProrationPolicy>;
		overrides?: Map<string, EmployeeVacationOverride>;
		employeeEmploymentStartDateOverrides?: ReadonlyMap<string, string>;
	},
): Promise<Map<string, ProratedAllowance>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();
	const { organizationId, year } = input;

	const startDate = `${year}-01-01`;
	const endDate = `${year}-12-31`;
	// One after another: `database` may be one connection, and pg@9 refuses a query while another is executing.
	const employments = await loadEmployeeEmployments(database, {
		organizationId,
		employeeIds,
		employeeEmploymentStartDateOverrides:
			input.employeeEmploymentStartDateOverrides,
	});
	const overrides =
		input.overrides ??
		(await loadEmployeeVacationOverrides(database, {
			organizationId,
			employeeIds,
			year,
		}));
	const workingWeeks =
		!input.policies && year >= FIRST_WORKING_WEEK_YEAR
			? await loadWorkingWeekPeriodsForEmployees(database, {
					organizationId,
					employeeIds,
					startDate,
					endDate,
				})
			: new Map<string, WorkingWeekPeriod[]>();

	const allowances = new Map<string, ProratedAllowance>();
	for (const [employeeId, employee] of employments) {
		let policy = input.policies
			? input.policies.get(employeeId)
			: input.policy;
		if (!policy) continue;
		if (!input.policies && workingWeeks.has(employeeId)) {
			const weeks = workingWeeksWithin(workingWeeks.get(employeeId) ?? [], {
				startDate,
				endDate,
			});
			if (weeks.some((week) => week.workingDaysPerWeek === 0)) continue;
			const { defaultAnnualDays, statutoryMinimumDays } = policy;
			policy = {
				...policy,
				allowanceRates: weeks.map((week) => ({
					startDate: week.startDate,
					endDate: week.endDate,
					referenceAnnualDays: Number(defaultAnnualDays),
					referenceStatutoryMinimumDays: Number(statutoryMinimumDays),
					workingDaysPerWeek: week.workingDaysPerWeek,
				})),
			};
		}
		allowances.set(
			employeeId,
			resolveVacationAllowance({
				policy,
				customAnnualDays: overrides.get(employeeId)?.customAnnualDays ?? null,
				employments: employee.employments,
				year,
			}),
		);
	}
	return allowances;
}

/** Project only the original stint; departures and subsequent rehire starts remain authoritative. */
export function projectEmploymentPeriodStart<T extends EmploymentPeriodRecord>(
	periods: readonly T[],
	joiningDate: string | undefined,
	timezone: string,
): T[] {
	if (!joiningDate || periods.length === 0) return [...periods];
	const first = [...periods].sort(
		(a, b) =>
			(a.startedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
				(b.startedAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
			a.id.localeCompare(b.id),
	)[0];
	return periods.map((period) =>
		period.id !== first?.id
			? period
			: period.startProvenance === "recorded"
				? {
						...period,
						startedAt: dateFromInstant(
							parsePlainDate(joiningDate).toZonedDateTime(timezone).toInstant(),
						),
					}
				: { ...period, startProvenance: "legacy" },
	);
}
