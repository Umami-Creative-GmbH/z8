import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
	employee,
	employeeDeparture,
	employeeEmploymentPeriod,
	employeeVacationAllowance,
} from "@/db/schema";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import {
	type DepartureRecord,
	type EmploymentPeriodRecord,
	employmentStintsFromRecords,
	type ProratedAllowance,
	type ProrationPolicy,
	resolveVacationAllowance,
} from "./prorated-allowance";

/**
 * The vacation allowance of each employee for a year (#1110): their custom allowance, or the
 * policy's allowance prorated in a year they join or leave. Every balance reader takes the
 * allowance from here, so an employee shows the same allowance everywhere.
 *
 * The policy is whichever one the reader resolves. Read-only: it never backfills employment
 * periods. Only employees of the organization get an entry.
 */
export async function loadProratedVacationAllowances(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
		policy: ProrationPolicy;
	},
): Promise<Map<string, ProratedAllowance>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();
	const { organizationId } = input;

	const [employees, periods, departures, customAllowances, timezone] = await Promise.all([
		database
			.select({ id: employee.id, startDate: employee.startDate })
			.from(employee)
			.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds))),
		database
			.select({
				employeeId: employeeEmploymentPeriod.employeeId,
				id: employeeEmploymentPeriod.id,
				startedAt: employeeEmploymentPeriod.startedAt,
				endedAt: employeeEmploymentPeriod.endedAt,
				startProvenance: employeeEmploymentPeriod.startProvenance,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, organizationId),
					inArray(employeeEmploymentPeriod.employeeId, employeeIds),
				),
			),
		database
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
					inArray(employeeDeparture.employeeId, employeeIds),
					inArray(employeeDeparture.status, ["pending", "effective"]),
				),
			),
		// `employee_vacation_allowance` has no organization column: scope through the employee.
		database
			.select({
				employeeId: employeeVacationAllowance.employeeId,
				customAnnualDays: employeeVacationAllowance.customAnnualDays,
			})
			.from(employeeVacationAllowance)
			.innerJoin(employee, eq(employee.id, employeeVacationAllowance.employeeId))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(employeeVacationAllowance.employeeId, employeeIds),
					eq(employeeVacationAllowance.year, input.year),
					isNotNull(employeeVacationAllowance.customAnnualDays),
				),
			)
			.orderBy(desc(employeeVacationAllowance.updatedAt)),
		loadOrganizationTimezone(database, organizationId),
	]);

	const periodsByEmployee = Map.groupBy(periods, (period) => period.employeeId);
	const departuresByEmployee = Map.groupBy(departures, (departure) => departure.employeeId);
	const customByEmployee = new Map<string, string>();
	for (const row of customAllowances) {
		if (row.customAnnualDays && !customByEmployee.has(row.employeeId)) {
			customByEmployee.set(row.employeeId, row.customAnnualDays);
		}
	}

	return new Map(
		employees.map((row) => [
			row.id,
			resolveVacationAllowance({
				policy: input.policy,
				customAnnualDays: customByEmployee.get(row.id) ?? null,
				employments: employmentStintsFromRecords({
					employeeStartDate: row.startDate,
					periods: (periodsByEmployee.get(row.id) ?? []) satisfies EmploymentPeriodRecord[],
					departures: (departuresByEmployee.get(row.id) ?? []) satisfies DepartureRecord[],
					timezone,
				}),
				year: input.year,
			}),
		]),
	);
}

/**
 * One employee's vacation allowance for a year. An employee outside the organization gets the
 * policy's full allowance, as the readers did before proration.
 */
export async function loadProratedVacationAllowance(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; year: number; policy: ProrationPolicy },
): Promise<ProratedAllowance> {
	const allowances = await loadProratedVacationAllowances(database, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
		policy: input.policy,
	});
	const fullAllowance = Number.parseFloat(input.policy.defaultAnnualDays);
	return (
		allowances.get(input.employeeId) ?? {
			fullAllowance,
			allowance: fullAllowance,
			reason: { kind: "none", cause: "no_known_start" },
		}
	);
}
