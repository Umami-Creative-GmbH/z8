import "server-only";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import {
	employee,
	type VacationAccrualType,
	vacationAdjustment,
} from "@/db/schema";
import {
	type Instant,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { EmploymentStint } from "./prorated-allowance";
import {
	type EmployeeEmployments,
	loadEmployeeEmployments,
	loadEmployeeVacationOverrides,
} from "./prorated-allowance-store";
import type { VacationBalanceConfiguration } from "./types";
import { loadVacationBalances } from "./vacation-balance-store";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import { isAccrualPolicy } from "./vacation-policy-settings";

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
	skippedEmployees: Array<{
		employeeId: string;
		configuration: VacationBalanceConfiguration;
	}>;
	employeesProcessed: number;
	/** The days of the accrual rows this run wrote. */
	totalDaysAccrued: number;
	/** Accrual rows this run wrote; months already accrued are skipped. */
	rowsWritten: number;
};

const NOTHING_ACCRUED: VacationAccrualResult = {
	skippedEmployees: [],
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
export function monthlyAccrualDays(input: {
	accrualType: VacationAccrualType;
	annualDays: number;
	year: number;
	month: number;
	employments: readonly EmploymentStint[];
}): number | null {
	const monthStart = Temporal.PlainDate.from({
		year: input.year,
		month: input.month,
		day: 1,
	});
	const monthEnd = monthStart.with({ day: monthStart.daysInMonth });
	const share =
		input.accrualType === "monthly"
			? input.annualDays / 12
			: (input.annualDays / 26) * 2;

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

/** Existing monthly/biweekly cadence, intersected with dated policy and employment coverage.
 * Callers require resolved configuration before using this numeric calculation. */
export function policyPeriodMonthlyAccrualDays(input: {
	periods: readonly EmployeeVacationPolicyPeriod[];
	customAnnualDays?: string | null;
	year: number;
	month: number;
	employments: readonly EmploymentStint[];
}): number | null {
	let total = 0;
	let covered = false;
	for (const period of input.periods) {
		const resolution = period.resolution;
		if (resolution.status !== "resolved" && resolution.status !== "legacy")
			continue;
		const policy = resolution.policy;
		if (!policy || !isAccrualPolicy(policy)) continue;
		const employments = input.employments.map((employment) => ({
			startDate: latest(
				employment.startDate ?? Temporal.PlainDate.from(period.startDate),
				Temporal.PlainDate.from(period.startDate),
			),
			lastWorkingDay: earliest(
				employment.lastWorkingDay ?? Temporal.PlainDate.from(period.endDate),
				Temporal.PlainDate.from(period.endDate),
			),
		}));
		const days = monthlyAccrualDays({
			accrualType: policy.accrualType,
			annualDays: Number(input.customAnnualDays ?? policy.defaultAnnualDays),
			year: input.year,
			month: input.month,
			employments,
		});
		if (days !== null) {
			total += days;
			covered = true;
		}
	}
	return covered ? total : null;
}

/** Only due, unposted employment coverage needs a policy; unrelated annual gaps stay visible in balances. */
function requiredAccrualConfiguration(
	periods: readonly EmployeeVacationPolicyPeriod[],
	input: {
		year: number;
		month: number;
		employments: readonly EmploymentStint[];
	},
): VacationBalanceConfiguration {
	const monthStart = Temporal.PlainDate.from({
		year: input.year,
		month: input.month,
		day: 1,
	});
	const monthEnd = monthStart.with({ day: monthStart.daysInMonth });
	const problems: Array<{
		startDate: string;
		endDate: string;
		policyIds?: string[];
		reason?: "incompatible_transition";
	}> = [];
	let conflict = false;
	for (const employment of input.employments) {
		const from = latest(employment.startDate ?? monthStart, monthStart);
		const through = earliest(employment.lastWorkingDay ?? monthEnd, monthEnd);
		if (Temporal.PlainDate.compare(from, through) > 0) continue;
		let cursor = from;
		for (const period of periods) {
			const start = latest(Temporal.PlainDate.from(period.startDate), from);
			const end = earliest(Temporal.PlainDate.from(period.endDate), through);
			if (Temporal.PlainDate.compare(start, end) > 0) continue;
			if (Temporal.PlainDate.compare(cursor, start) < 0)
				problems.push({
					startDate: cursor.toString(),
					endDate: start.subtract({ days: 1 }).toString(),
				});
			const resolution = period.resolution;
			if (resolution.status === "conflict") {
				conflict = true;
				problems.push({
					startDate: start.toString(),
					endDate: end.toString(),
					policyIds: resolution.policyIds,
					reason: resolution.reason,
				});
			} else if (resolution.status === "missing" || !resolution.policy)
				problems.push({ startDate: start.toString(), endDate: end.toString() });
			cursor = end.add({ days: 1 });
		}
		if (Temporal.PlainDate.compare(cursor, through) <= 0)
			problems.push({
				startDate: cursor.toString(),
				endDate: through.toString(),
			});
	}
	return problems.length
		? { status: conflict ? "conflict" : "missing", periods: problems }
		: { status: "resolved" };
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
export function accruingEmployments(
	employee: EmployeeEmployments,
): EmploymentStint[] {
	return employee.isActive
		? employee.employments
		: employee.employments.filter(
				(employment) => employment.lastWorkingDay !== null,
			);
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
	const months = [...new Set(input.months)].filter(
		(month) => month >= 1 && month <= 12,
	);
	if (months.length === 0) return NOTHING_ACCRUED;

	const employees = [
		...(await loadEmployeeEmployments(db, { organizationId })),
	].flatMap(([id, employee]) => {
		const employments = accruingEmployments(employee);
		return employments.length > 0 ? [{ id, employments }] : [];
	});
	if (employees.length === 0) return NOTHING_ACCRUED;
	const [overrides, accrued, resolved] = await Promise.all([
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
		loadVacationBalances(db, {
			organizationId,
			employeeIds: employees.map((emp) => emp.id),
			year: input.year,
			timezone: "UTC",
		}),
	]);
	const accruedKeys = new Set(
		accrued.map((row) => `${row.employeeId}:${row.month}`),
	);

	const rows: (typeof vacationAdjustment.$inferInsert)[] = [];
	const skippedEmployees: VacationAccrualResult["skippedEmployees"] = [];
	for (const emp of employees) {
		const customAnnualDays = overrides.get(emp.id)?.customAnnualDays;

		for (const month of months) {
			if (accruedKeys.has(`${emp.id}:${month}`)) continue;
			const configuration = requiredAccrualConfiguration(
				resolved.periods.get(emp.id) ?? [],
				{ year: input.year, month, employments: emp.employments },
			);
			if (
				configuration.status === "missing" ||
				configuration.status === "conflict"
			) {
				const existing = skippedEmployees.find(
					(row) => row.employeeId === emp.id,
				);
				if (
					existing &&
					(existing.configuration.status === "missing" ||
						existing.configuration.status === "conflict")
				)
					existing.configuration = {
						status:
							existing.configuration.status === "conflict" ||
							configuration.status === "conflict"
								? "conflict"
								: "missing",
						periods: [
							...existing.configuration.periods,
							...configuration.periods,
						],
					};
				else skippedEmployees.push({ employeeId: emp.id, configuration });
				continue;
			}
			const share = policyPeriodMonthlyAccrualDays({
				periods: resolved.periods.get(emp.id) ?? [],
				customAnnualDays,
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
		totalDaysAccrued += written.reduce(
			(sum, row) => sum + Number.parseFloat(row.days),
			0,
		);
	}

	logger.info(
		{
			organizationId,
			year: input.year,
			months,
			employeesProcessed: employees.length,
			rowsWritten,
		},
		"Vacation accrual complete",
	);

	return {
		employeesProcessed: employees.length,
		totalDaysAccrued,
		rowsWritten,
		skippedEmployees,
	};
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
	if (today.year < FIRST_ACCRUAL_CATCH_UP_YEAR)
		return { ...NOTHING_ACCRUED, ...due };

	const months = Array.from({ length: today.month }, (_, index) => index + 1);
	return {
		...(await accrueVacationPeriods(organizationId, {
			year: today.year,
			months,
		})),
		...due,
	};
}
