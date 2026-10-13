import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { employee, vacationAdjustment } from "@/db/schema";
import {
	type Instant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { getEmployeesWithVacationData, getVacationAllowance } from "@/lib/query/vacation.queries";
import { isAccrualPolicy } from "./vacation-calculator";

const logger = createLogger("vacation-accrual");

/**
 * The first year whose missed accrual periods the job catches up (#1106). Before it, the job never
 * wrote a row in production, and earlier years' balances and carryover stay as they are.
 */
export const FIRST_ACCRUAL_CATCH_UP_YEAR = 2026;

/** English month names of the stored accrual reason, which migration 0214 parses back. */
const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/** At most this many rows per insert, well below PostgreSQL's bind-parameter limit. */
const INSERT_CHUNK_SIZE = 500;

export type VacationAccrualResult = {
	employeesProcessed: number;
	/** The days of the accrual rows this run wrote. */
	totalDaysAccrued: number;
	/** Accrual rows this run wrote; months already accrued are skipped. */
	rowsWritten: number;
};

const NOTHING_ACCRUED: VacationAccrualResult = {
	employeesProcessed: 0,
	totalDaysAccrued: 0,
	rowsWritten: 0,
};

/**
 * One month's accrual share: 1/12 of the allowance on a monthly policy and 2/26 on a biweekly one
 * (about two pay periods per month). In the hire month only the days from the start date count;
 * before the hire month nothing accrues.
 */
function monthlyAccrualDays(input: {
	accrualType: string;
	annualDays: number;
	year: number;
	month: number;
	startDate: PlainDate | null;
}): number | null {
	const monthStart = Temporal.PlainDate.from({ year: input.year, month: input.month, day: 1 });
	const share =
		input.accrualType === "monthly" ? input.annualDays / 12 : (input.annualDays / 26) * 2;
	if (!input.startDate) return share;

	const monthEnd = monthStart.with({ day: monthStart.daysInMonth });
	if (Temporal.PlainDate.compare(input.startDate, monthEnd) > 0) return null;
	if (input.startDate.year === input.year && input.startDate.month === input.month) {
		const daysEmployed = monthStart.daysInMonth - input.startDate.day + 1;
		return (share / monthStart.daysInMonth) * daysEmployed;
	}
	return share;
}

/**
 * Accrue the given months of a year for every active employee of the organization on a monthly or
 * biweekly policy (#1106). Each employee gets at most one `accrual` row per month: months already
 * accrued are skipped, and the unique period index turns a concurrent duplicate into a no-op, so
 * the job can retry and catch up safely. Accrual rows are system rows without an adjusting employee.
 */
export async function accrueVacationPeriods(
	organizationId: string,
	input: { year: number; months: readonly number[] },
): Promise<VacationAccrualResult> {
	const months = [...new Set(input.months)].filter((month) => month >= 1 && month <= 12);
	if (months.length === 0) return NOTHING_ACCRUED;

	const policy = await getVacationAllowance(organizationId, input.year);
	if (!policy || !isAccrualPolicy(policy)) return NOTHING_ACCRUED;

	const employees = await getEmployeesWithVacationData(organizationId, input.year);
	if (employees.length === 0) return NOTHING_ACCRUED;

	const accrued = await db
		.select({
			employeeId: vacationAdjustment.employeeId,
			month: vacationAdjustment.accrualMonth,
		})
		.from(vacationAdjustment)
		.innerJoin(employee, eq(employee.id, vacationAdjustment.employeeId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(vacationAdjustment.year, input.year),
				eq(vacationAdjustment.kind, "accrual"),
				isNotNull(vacationAdjustment.accrualMonth),
				inArray(vacationAdjustment.accrualMonth, months),
			),
		);
	const accruedKeys = new Set(accrued.map((row) => `${row.employeeId}:${row.month}`));

	const rows: (typeof vacationAdjustment.$inferInsert)[] = [];
	for (const emp of employees) {
		const annualDays = emp.allowance?.customAnnualDays
			? Number.parseFloat(emp.allowance.customAnnualDays)
			: Number.parseFloat(policy.defaultAnnualDays);
		// `employee.start_date` holds the calendar date as UTC midnight.
		const startDate = emp.startDate ? plainDateAt(instantFromDate(emp.startDate), "UTC") : null;

		for (const month of months) {
			if (accruedKeys.has(`${emp.id}:${month}`)) continue;
			const share = monthlyAccrualDays({
				accrualType: policy.accrualType,
				annualDays,
				year: input.year,
				month,
				startDate,
			});
			if (share === null) continue;
			const days = share.toFixed(2);
			rows.push({
				employeeId: emp.id,
				year: input.year,
				days,
				reason: `Monthly accrual for ${MONTH_NAMES[month - 1]} ${input.year}: +${days} days`,
				kind: "accrual",
				accrualMonth: month,
				adjustedBy: null,
			});
		}
	}

	let rowsWritten = 0;
	let totalDaysAccrued = 0;
	for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
		const written = await db
			.insert(vacationAdjustment)
			.values(rows.slice(index, index + INSERT_CHUNK_SIZE))
			.onConflictDoNothing()
			.returning({ days: vacationAdjustment.days });
		rowsWritten += written.length;
		totalDaysAccrued += written.reduce((sum, row) => sum + Number.parseFloat(row.days), 0);
	}

	logger.info(
		{ organizationId, year: input.year, months, employeesProcessed: employees.length, rowsWritten },
		"Vacation accrual complete",
	);

	return { employeesProcessed: employees.length, totalDaysAccrued, rowsWritten };
}

/**
 * Accrue every month of the organization's current year up to and including the current month,
 * in the organization's timezone: a month is accrued on its first day, as the job always did.
 * Months already accrued are skipped, so a daily run catches up whatever earlier runs missed
 * (#1106). Years before FIRST_ACCRUAL_CATCH_UP_YEAR are never touched.
 */
export async function accrueDueVacationPeriods(
	organizationId: string,
	input: { timezone: string; now: Instant },
): Promise<VacationAccrualResult & { year: number; throughMonth: number }> {
	const today = plainDateAt(input.now, input.timezone);
	const due = { year: today.year, throughMonth: today.month };
	if (today.year < FIRST_ACCRUAL_CATCH_UP_YEAR) return { ...NOTHING_ACCRUED, ...due };

	const months = Array.from({ length: today.month }, (_, index) => index + 1);
	return { ...(await accrueVacationPeriods(organizationId, { year: today.year, months })), ...due };
}
