import "server-only";

import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { absenceEntry, employee, employeeVacationAllowance, vacationAllowance } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AbsenceDaysDatabase, loadWorkingDaysForEmployees } from "./absence-days-resolver";
import { loadProratedVacationAllowances } from "./prorated-allowance-store";
import type { AbsenceWithCategory, VacationBalance } from "./types";
import { loadVacationAdjustmentTotals } from "./vacation-adjustments";
import { calculateVacationBalance } from "./vacation-calculator";

/** A vacation policy (`vacation_allowance` row). */
export type VacationBalancePolicy = typeof vacationAllowance.$inferSelect;

export interface VacationBalances {
	/** The organization's company default policy for the year; undefined when there is none. */
	policy: VacationBalancePolicy | undefined;
	/** Each employee's balance; empty without a policy. Only employees of the organization. */
	balances: Map<string, VacationBalance>;
}

/**
 * The vacation balance of each employee for a year (#1111): the one server-side computation behind
 * the employee's Absences page and the admin vacation pages, so they always agree.
 *
 * The policy is the active company default in effect during the year (the newest start). Each
 * balance starts from the prorated allowance (#1110), adds carryover and every adjustment
 * (#1105, #1106), subtracts approved and pending vacation in the calendar year, and reports
 * overdrawn vacation. `timezone` is the organization's, for the carryover expiry.
 */
export async function loadVacationBalances(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
		timezone: string;
	},
): Promise<VacationBalances> {
	const { organizationId, year } = input;
	const startOfYear = Temporal.PlainDate.from({ year, month: 1, day: 1 }).toString();
	const endOfYear = Temporal.PlainDate.from({ year, month: 12, day: 31 }).toString();
	const policy = await database.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, organizationId),
			eq(vacationAllowance.isCompanyDefault, true),
			eq(vacationAllowance.isActive, true),
			lte(vacationAllowance.startDate, endOfYear),
			or(isNull(vacationAllowance.validUntil), gte(vacationAllowance.validUntil, startOfYear)),
		),
		orderBy: desc(vacationAllowance.startDate),
	});
	const employeeIds = [...new Set(input.employeeIds)];
	if (!policy || employeeIds.length === 0) return { policy, balances: new Map() };

	const [allowances, employeeAllowances, absences, workingDays, adjustmentTotals] =
		await Promise.all([
			// Only employees of the organization get an allowance, and so a balance.
			loadProratedVacationAllowances(database, { organizationId, employeeIds, year, policy }),
			// `employee_vacation_allowance` has no organization column: scope through the employee.
			database
				.select({
					employeeId: employeeVacationAllowance.employeeId,
					customAnnualDays: employeeVacationAllowance.customAnnualDays,
					customCarryoverDays: employeeVacationAllowance.customCarryoverDays,
				})
				.from(employeeVacationAllowance)
				.innerJoin(employee, eq(employee.id, employeeVacationAllowance.employeeId))
				.where(
					and(
						eq(employee.organizationId, organizationId),
						inArray(employeeVacationAllowance.employeeId, employeeIds),
						eq(employeeVacationAllowance.year, year),
					),
				)
				.orderBy(desc(employeeVacationAllowance.updatedAt)),
			database.query.absenceEntry.findMany({
				where: and(
					or(isNull(absenceEntry.organizationId), eq(absenceEntry.organizationId, organizationId)),
					inArray(absenceEntry.employeeId, employeeIds),
					lte(absenceEntry.startDate, endOfYear),
					gte(absenceEntry.endDate, startOfYear),
				),
				with: { category: true },
			}),
			loadWorkingDaysForEmployees(database, {
				organizationId,
				employeeIds,
				startDate: startOfYear,
				endDate: endOfYear,
			}),
			loadVacationAdjustmentTotals(database, { organizationId, employeeIds, year }),
		]);

	const employeeAllowanceById = new Map<string, (typeof employeeAllowances)[number]>();
	for (const row of employeeAllowances) {
		if (!employeeAllowanceById.has(row.employeeId)) employeeAllowanceById.set(row.employeeId, row);
	}
	const absencesByEmployee = Map.groupBy(
		absences as unknown as AbsenceWithCategory[],
		(absence) => absence.employeeId,
	);
	const currentDate = currentTimestamp();

	const balances = new Map<string, VacationBalance>();
	for (const [employeeId, allowance] of allowances) {
		balances.set(
			employeeId,
			calculateVacationBalance({
				organizationAllowance: policy,
				employeeAllowance: employeeAllowanceById.get(employeeId) ?? null,
				allowance,
				absences: absencesByEmployee.get(employeeId) ?? [],
				isWorkingDay: workingDays.get(employeeId),
				currentDate,
				year,
				adjustmentTotal: adjustmentTotals.get(employeeId) ?? 0,
				timezone: input.timezone,
			}),
		);
	}
	return { policy, balances };
}
