import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { employee, type VacationAccrualType, vacationAdjustment } from "@/db/schema";
import { type Instant, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { EmploymentStint } from "./prorated-allowance";
import {
	type EmployeeEmployments,
	loadEmployeeEmployments,
	loadEmployeeVacationOverrides,
} from "./prorated-allowance-store";
import { isAccrualPolicy } from "./vacation-policy-settings";
import { loadCompanyDefaultVacationPolicy } from "./vacation-policy-store";

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
 * (about two pay periods per month), for the days of the month the employee is employed. In the
 * hire month only the days from the start count, in the exit month only the days through the last
 * working day; a month without an employed day accrues nothing (null).
 */
function monthlyAccrualDays(input: {
	accrualType: VacationAccrualType;
	annualDays: number;
	year: number;
	month: number;
	employments: readonly EmploymentStint[];
}): number | null {
	const monthStart = Temporal.PlainDate.from({ year: input.year, month: input.month, day: 1 });
	const monthEnd = monthStart.with({ day: monthStart.daysInMonth });
	const share =
		input.accrualType === "monthly" ? input.annualDays / 12 : (input.annualDays / 26) * 2;

	let daysEmployed = 0;
	for (const employment of input.employments) {
		const from = latest(employment.startDate ?? monthStart, monthStart);
		const through = earliest(employment.lastWorkingDay ?? monthEnd, monthEnd);
		if (Temporal.PlainDate.compare(from, through) <= 0) {
			daysEmployed += from.until(through).days + 1;
		}
	}
	if (daysEmployed === 0) return null;
	if (daysEmployed >= monthStart.daysInMonth) return share;
	return (share / monthStart.daysInMonth) * daysEmployed;
}

function latest(left: PlainDate, right: PlainDate): PlainDate {
	return Temporal.PlainDate.compare(left, right) >= 0 ? left : right;
}

function earliest(left: PlainDate, right: PlainDate): PlainDate {
	return Temporal.PlainDate.compare(left, right) <= 0 ? left : right;
}

/**
 * The employments the accrual job accrues for: every employment of an active employee, and the
 * employments with a known last working day of one who is no longer active, so a leaver accrues
 * the months they were still employed. An inactive employee without a recorded end accrues nothing.
 */
function accruingEmployments(employee: EmployeeEmployments): EmploymentStint[] {
	return employee.isActive
		? employee.employments
		: employee.employments.filter((employment) => employment.lastWorkingDay !== null);
}

/**
 * Accrue the given months of a year for every employee of the organization on a monthly or
 * biweekly policy who is employed in them (#1106), leavers included: employments come from the
 * employment periods and departures, as for the prorated allowance (`loadEmployeeEmployments`).
 * Each employee gets at most one `accrual` row per month: months already accrued are skipped, and
 * the unique period index turns a concurrent duplicate into a no-op, so the job can retry and
 * catch up safely. Accrual rows are system rows without an adjusting employee.
 */
export async function accrueVacationPeriods(
	organizationId: string,
	input: { year: number; months: readonly number[] },
): Promise<VacationAccrualResult> {
	const months = [...new Set(input.months)].filter((month) => month >= 1 && month <= 12);
	if (months.length === 0) return NOTHING_ACCRUED;

	const policy = await loadCompanyDefaultVacationPolicy(db, { organizationId, year: input.year });
	if (!policy || !isAccrualPolicy(policy)) return NOTHING_ACCRUED;

	const employees = [...(await loadEmployeeEmployments(db, { organizationId }))].flatMap(
		([id, employee]) => {
			const employments = accruingEmployments(employee);
			return employments.length > 0 ? [{ id, employments }] : [];
		},
	);
	if (employees.length === 0) return NOTHING_ACCRUED;
	const [overrides, accrued] = await Promise.all([
		loadEmployeeVacationOverrides(db, {
			organizationId,
			employeeIds: employees.map((emp) => emp.id),
			year: input.year,
		}),

		db
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
			),
	]);
	const accruedKeys = new Set(accrued.map((row) => `${row.employeeId}:${row.month}`));

	const rows: (typeof vacationAdjustment.$inferInsert)[] = [];
	for (const emp of employees) {
		const customAnnualDays = overrides.get(emp.id)?.customAnnualDays;
		const annualDays = Number.parseFloat(customAnnualDays || policy.defaultAnnualDays);

		for (const month of months) {
			if (accruedKeys.has(`${emp.id}:${month}`)) continue;
			const share = monthlyAccrualDays({
				accrualType: policy.accrualType,
				annualDays,
				year: input.year,
				month,
				employments: emp.employments,
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
