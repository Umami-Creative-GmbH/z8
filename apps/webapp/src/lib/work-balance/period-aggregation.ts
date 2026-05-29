import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { getYearPeriodForDate } from "./periods";

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
	dbClient?: PeriodAggregationDbClient;
	periodType: EmployeeWorkBalancePeriodType;
	periodStart: string;
	periodEnd: string;
	calculationStartDate?: string | null;
	isClosed: boolean;
	now?: Date;
}) {
	const dbClient = input.dbClient ?? db;
	const periodStart = DateTime.fromISO(input.periodStart, { zone: "utc" }).startOf("day");
	const periodEnd = DateTime.fromISO(input.periodEnd, { zone: "utc" }).endOf("day");
	const calculationStart = input.calculationStartDate
		? DateTime.fromISO(input.calculationStartDate, { zone: "utc" }).startOf("day")
		: null;
	const effectiveStart = calculationStart && calculationStart > periodStart ? calculationStart : periodStart;

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

	const [actualRow, requirements] = await Promise.all([
		dbClient
			.select({ totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)` })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.employeeId, input.employeeId),
					eq(workPeriod.organizationId, input.organizationId),
					isNotNull(workPeriod.endTime),
					isNotNull(workPeriod.durationMinutes),
					gte(workPeriod.startTime, startDate),
					lte(workPeriod.startTime, endDate),
				),
			),
		getDailyWorkRequirementsForEmployee({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			startDate,
			endDate,
		}),
	]);

	const requiredMinutes = Object.values(requirements).reduce(
		(total, requirement) => total + requirement.requiredMinutes,
		0,
	);

	return buildPeriodBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: input.periodType,
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		actualMinutes: Number(actualRow[0]?.totalMinutes ?? 0),
		requiredMinutes,
		computedAt: input.now ?? new Date(),
		isClosed: input.isClosed,
	});
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
