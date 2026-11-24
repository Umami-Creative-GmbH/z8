import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { collectTrustBasedBalanceDates } from "@/lib/calendar/trust-based-dates";
import type { DailyWorkRequirements } from "@/lib/calendar/types";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EngagementStints } from "@/lib/engagement/employee-time";
import { loadEmployeeTime } from "@/lib/engagement/engagement-stints";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import type { WorkBalanceDbClient } from "./db-client";
import { getYearPeriodForDate } from "./periods";
import {
	sumTrackedWorkMinutes,
	sumTrackedWorkMinutesExcludingDates,
	sumUntrackedEmployeeWorkMinutes,
} from "./tracked-work";

export type EmployeeWorkBalancePeriodType = "month" | "year";

type PeriodAggregationDbClient = Pick<typeof db, "insert" | "select">;

export function buildPeriodBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	actualMinutes: number;
	requiredMinutes: number;
	computedAt: Date;
	isClosed: boolean;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: input.periodType,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		actualMinutes: input.actualMinutes,
		requiredMinutes: input.requiredMinutes,
		balanceMinutes: input.actualMinutes - input.requiredMinutes,
		computedAt: input.computedAt,
		isClosed: input.isClosed,
		isDirty: false,
		dirtyFromDate: null,
		refreshRequestedAt: null,
		lastError: null,
		updatedAt: input.computedAt,
	};
}

export async function computeEmployeePeriodBalance(input: {
	employeeId: string;
	organizationId: string;
	dbClient?: WorkBalanceDbClient;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	calculationStartDate?: string | null;
	trackingStartDateOverride?: string | null;
	employeeTrackingStartDateOverride?: string | null;
	employeeEmploymentStartDateOverride?: string;
	employeeTimezoneOverride?: string;
	timezone?: string;
	isClosed: boolean;
	now?: Date;
}) {
	const dbClient = input.dbClient ?? db;
	const tracking = await loadEmployeeTrackingContext(dbClient, input);
	const timezone = tracking?.timezone ?? input.timezone ?? "UTC";
	const calculationStartDate =
		tracking && (!input.calculationStartDate || tracking.startDate > input.calculationStartDate)
			? tracking.startDate
			: input.calculationStartDate;
	const periodStart = DateTime.fromISO(input.periodStart, {
		zone: timezone,
	}).startOf("day");
	const periodEnd = DateTime.fromISO(input.periodEnd, { zone: timezone }).endOf("day");
	const calculationStart = calculationStartDate
		? DateTime.fromISO(calculationStartDate, { zone: timezone }).startOf("day")
		: null;
	const effectiveStart =
		calculationStart && calculationStart > periodStart ? calculationStart : periodStart;

	if (effectiveStart > periodEnd) {
		return buildPeriodBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			periodType: input.periodType,
			periodStart: input.periodStart,
			periodEnd: input.periodEnd,
			actualMinutes: 0,
			requiredMinutes: 0,
			computedAt: input.now ?? new Date(),
			isClosed: input.isClosed,
		});
	}

	const startDate = effectiveStart.toJSDate();
	const endDate = periodEnd.toJSDate();

	// One after another: `dbClient` may be one connection, and pg@9 refuses a query while another is executing.
	const requirements = await getDailyWorkRequirementsForEmployee(
		{
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			startDate,
			endDate,
			timezone,
			trackingStartDateOverride: input.trackingStartDateOverride,
			employeeTrackingStartDateOverride: input.employeeTrackingStartDateOverride,
			employeeEmploymentStartDateOverride: input.employeeEmploymentStartDateOverride,
			employeeTimezoneOverride: input.employeeTimezoneOverride,
		},
		...(input.dbClient ? ([input.dbClient] as const) : []),
	);

	const balanceInput = { ...input, startDate, endDate, timezone };
	let actualMinutes: number;
	let requiredMinutes: number;
	if (tracking) {
		const days = await readBalanceDays(dbClient, balanceInput, requirements);
		const windowInput = {
			...input,
			startDate: effectiveStart.toISODate()!,
			throughDate: input.periodEnd,
			timezone,
		};
		actualMinutes =
			days.excludedDates.size > 0
				? await sumTrackedWorkMinutesExcludingDates(
						dbClient,
						windowInput,
						days.excludedDates,
						days.stints,
					)
				: await sumTrackedWorkMinutes(dbClient, windowInput, days.stints);
		requiredMinutes = days.requiredMinutes;
	} else {
		({ actualMinutes, requiredMinutes } = await computeUntrackedBalanceMinutes(
			dbClient,
			balanceInput,
			requirements,
		));
	}

	return buildPeriodBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: input.periodType,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		actualMinutes,
		requiredMinutes,
		computedAt: input.now ?? new Date(),
		isClosed: input.isClosed,
	});
}

type BalanceInput = {
	employeeId: string;
	organizationId: string;
	/** The first and last instant of the balance's days in `timezone`. */
	startDate: Date;
	endDate: Date;
	timezone: string;
};

type BalanceDays = {
	stints: EngagementStints;
	/** Days whose actual minutes drop out whole, as their required minutes do. */
	excludedDates: ReadonlySet<string>;
	requiredMinutes: number;
};

/**
 * Actual and required minutes of days without a tracking start: each completed work period
 * counts whole on the day it started in `timezone`, but only its employee time (#1935). The
 * month and year rows and the total balance of an organization without a tracking start
 * (`computeEmployeeWorkBalance`) both read days this way, so they agree.
 */
export async function computeUntrackedBalanceMinutes(
	dbClient: Pick<WorkBalanceDbClient, "select">,
	input: BalanceInput,
	requirements: DailyWorkRequirements,
): Promise<{ actualMinutes: number; requiredMinutes: number }> {
	const days = await readBalanceDays(dbClient, input, requirements);
	const { excludedDates, stints, requiredMinutes } = days;

	if (hasContractorStint(stints)) {
		return {
			actualMinutes: await sumUntrackedEmployeeWorkMinutes(dbClient, input, excludedDates, stints),
			requiredMinutes,
		};
	}
	if (excludedDates.size > 0) {
		const rows = await dbClient
			.select({
				startTime: workPeriod.startTime,
				durationMinutes: workPeriod.durationMinutes,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.employeeId, input.employeeId),
					eq(workPeriod.organizationId, input.organizationId),
					isNotNull(workPeriod.endTime),
					isNotNull(workPeriod.durationMinutes),
					gte(workPeriod.startTime, input.startDate),
					lte(workPeriod.startTime, input.endDate),
				),
			);
		const actualMinutes = rows.reduce((total, row) => {
			const dayKey = DateTime.fromJSDate(row.startTime, { zone: "utc" })
				.setZone(input.timezone)
				.toISODate();
			if (dayKey && excludedDates.has(dayKey)) return total;
			return total + Number(row.durationMinutes ?? 0);
		}, 0);
		return { actualMinutes, requiredMinutes };
	}
	const actualRow = await dbClient
		.select({
			totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, input.startDate),
				lte(workPeriod.startTime, input.endDate),
			),
		);
	return { actualMinutes: Number(actualRow[0]?.totalMinutes ?? 0), requiredMinutes };
}

/**
 * How the balance reads the person's days. Trust-based days emit an exact 0 delta (neither
 * actual nor required contributes), preserving prior accrued balance across tracked <->
 * trust_based transitions.
 *
 * Only employee time is actual time (#1935), cut at the conversion instant as payroll cuts it
 * (`allocateEmployeeMinutes`): an External Contractor's work never enters the balance, and on a
 * conversion day the employee part of the day still does. So only trust-based employee time
 * drops out whole; a contractor day has no requirement and its contractor work is no employee
 * time. Required time stays the resolver's: a day follows the stint in force at its end
 * (`resolveEmploymentPeriodForDay`), so a contractor -> employee day requires the employee's day,
 * an employee -> contractor day nothing. On such a day the employee morning is credited, unless
 * the employee stint was under trust-based terms that day: then it adds 0, as every trust-based
 * day does.
 */
async function readBalanceDays(
	dbClient: Pick<WorkBalanceDbClient, "select">,
	input: BalanceInput,
	requirements: DailyWorkRequirements,
): Promise<BalanceDays> {
	const trustBasedDates = collectTrustBasedBalanceDates(requirements);
	const employeeTime = await loadEmployeeTime(dbClient, input.organizationId, [input.employeeId]);
	const stints = employeeTime.stintsOf(input.employeeId);

	const excludedDates = new Set<string>();
	const leftEmployeeOn: string[] = [];
	for (const date of trustBasedDates) {
		if (employeeTime.isEmployeeDay(input.employeeId, date)) {
			excludedDates.add(date);
		} else if (employeeTime.hasEmployeeTimeOn(input.employeeId, date, date)) {
			leftEmployeeOn.push(date);
		}
	}
	for (const date of await trustBasedEmployeeStintDays(dbClient, input, stints, leftEmployeeOn)) {
		excludedDates.add(date);
	}

	const requiredMinutes = Object.entries(requirements).reduce((total, [dateKey, requirement]) => {
		if (trustBasedDates.has(dateKey)) return total;
		return total + requirement.requiredMinutes;
	}, 0);
	return { stints, excludedDates, requiredMinutes };
}

/**
 * Of days the resolver gives to a later contractor stint but which begin in employee time (an
 * employee -> contractor day), those whose employee stint was under trust-based terms. That is
 * the contract resolved from the employee stints alone, as on the stint's last full day: the
 * departure ends the stint's terms on the day of the conversion (`valid_until_date`), so the day
 * itself only shows the defaults. A stint that began that day is read on the day.
 */
async function trustBasedEmployeeStintDays(
	dbClient: Pick<WorkBalanceDbClient, "select">,
	input: BalanceInput,
	stints: EngagementStints,
	dates: readonly string[],
): Promise<string[]> {
	const employeeStints = stints.periods.filter((period) => period.engagementKind === "employee");
	if (dates.length === 0 || employeeStints.length === 0) return [];
	const dayBefore = (date: string) => parsePlainDate(date).subtract({ days: 1 }).toString();
	const contracts = (
		await loadEffectiveContractsBatch(dbClient, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			dates: dates.flatMap((date) => [dayBefore(date), date]),
			timezoneOverride: input.timezone,
			preloadedPeriods: employeeStints,
		})
	).get(input.employeeId);
	return dates.filter((date) => {
		const onDay = contracts?.get(date);
		const lastFullDay = contracts?.get(dayBefore(date));
		const contract =
			lastFullDay?.isEmployedOnDay &&
			lastFullDay.employmentPeriodId !== null &&
			lastFullDay.employmentPeriodId === onDay?.employmentPeriodId
				? lastFullDay
				: onDay;
		return contract?.engagementKind === "employee" && contract.contributesZeroBalanceDelta;
	});
}

/** Whether any of the person's time was an External Contractor's (a stint, or the kind today). */
function hasContractorStint(stints: EngagementStints): boolean {
	return stints.periods.length > 0
		? stints.periods.some((period) => period.engagementKind === "contractor")
		: stints.employeeEngagementKind === "contractor";
}

export async function upsertEmployeeWorkBalancePeriod(
	values: ReturnType<typeof buildPeriodBalanceValues>,
	options?: { dbClient?: PeriodAggregationDbClient; refreshStartedAt?: Date },
) {
	const dbClient = options?.dbClient ?? db;
	const refreshStartedAt = options?.refreshStartedAt ?? values.computedAt;

	await dbClient
		.insert(employeeWorkBalancePeriod)
		.values(values)
		.onConflictDoUpdate({
			target: [
				employeeWorkBalancePeriod.organizationId,
				employeeWorkBalancePeriod.employeeId,
				employeeWorkBalancePeriod.periodType,
				employeeWorkBalancePeriod.periodStart,
			],
			set: {
				periodEnd: values.periodEnd,
				actualMinutes: values.actualMinutes,
				requiredMinutes: values.requiredMinutes,
				balanceMinutes: values.balanceMinutes,
				computedAt: values.computedAt,
				isClosed: values.isClosed,
				isDirty: sql`case when ${employeeWorkBalancePeriod.refreshRequestedAt} is not null and ${employeeWorkBalancePeriod.refreshRequestedAt} > ${refreshStartedAt} then true else false end`,
				dirtyFromDate: sql`case when ${employeeWorkBalancePeriod.refreshRequestedAt} is not null and ${employeeWorkBalancePeriod.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalancePeriod.dirtyFromDate} else null end`,
				refreshRequestedAt: sql`case when ${employeeWorkBalancePeriod.refreshRequestedAt} is not null and ${employeeWorkBalancePeriod.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalancePeriod.refreshRequestedAt} else null end`,
				lastError: null,
				updatedAt: values.updatedAt,
			},
		});
}

export async function rebuildEmployeeYearBalanceFromMonths(input: {
	employeeId: string;
	organizationId: string;
	dbClient?: PeriodAggregationDbClient;
	dateInYear: string;
	calculationStartDate?: string | null;
	now?: Date;
}) {
	const dbClient = input.dbClient ?? db;
	const yearPeriod = getYearPeriodForDate(input.dateInYear);
	const [row] = await dbClient
		.select({
			actualMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.actualMinutes}), 0)`,
			requiredMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.requiredMinutes}), 0)`,
		})
		.from(employeeWorkBalancePeriod)
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
				eq(employeeWorkBalancePeriod.periodType, "month"),
				eq(employeeWorkBalancePeriod.isClosed, true),
				gte(employeeWorkBalancePeriod.periodStart, yearPeriod.periodStart),
				lte(employeeWorkBalancePeriod.periodEnd, yearPeriod.periodEnd),
				...(input.calculationStartDate
					? [gte(employeeWorkBalancePeriod.periodEnd, input.calculationStartDate)]
					: []),
			),
		);

	const values = buildPeriodBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: "year",
		periodStart: yearPeriod.periodStart,
		periodEnd: yearPeriod.periodEnd,
		actualMinutes: Number(row?.actualMinutes ?? 0),
		requiredMinutes: Number(row?.requiredMinutes ?? 0),
		computedAt: input.now ?? new Date(),
		isClosed: true,
	});

	await upsertEmployeeWorkBalancePeriod(values, { dbClient });
	return values;
}

export async function markEmployeeWorkBalanceFullRebuildRequested(input: {
	employeeId: string;
	organizationId: string;
	requestedAt?: Date;
}) {
	const requestedAt = input.requestedAt ?? new Date();
	const set = {
		isDirty: true,
		dirtyFromDate: null,
		refreshRequestedAt: requestedAt,
		updatedAt: requestedAt,
	};

	await db
		.update(employeeWorkBalancePeriod)
		.set(set)
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
			),
		);

	await db
		.update(employeeWorkBalance)
		.set(set)
		.where(
			and(
				eq(employeeWorkBalance.employeeId, input.employeeId),
				eq(employeeWorkBalance.organizationId, input.organizationId),
			),
		);
}
